//! Read-only serial monitor: streams a device's serial output to the frontend
//! line by line.
//!
//! The session only ever reads. It never writes, flushes, clears input or
//! toggles DTR, so viewing a glove's log can't change what the glove is doing.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::dfu::DfuTransport;

/// How long one read waits for bytes before checking the stop flag again.
const READ_TIMEOUT_MS: u64 = 200;

/// Events streamed to the frontend over the monitor's `Channel`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum MonitorEvent {
    /// Lines completed by one read, in arrival order.
    Lines { lines: Vec<MonitorLine> },
    /// The port failed (usually unplugged). No further events follow.
    Disconnected { reason: String },
}

/// One line of serial output.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct MonitorLine {
    /// Arrival time, milliseconds since the Unix epoch.
    pub t: u64,
    pub text: String,
}

/// Turns a raw byte stream into lines.
///
/// Bytes are buffered until a newline, then decoded, so a multibyte UTF-8
/// character split across two reads still decodes. Invalid UTF-8 becomes
/// U+FFFD rather than dropping the line.
#[derive(Default)]
struct LineSplitter {
    buf: Vec<u8>,
}

impl LineSplitter {
    /// Adds bytes and returns every line they complete, without the `\n` or a
    /// trailing `\r`.
    fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(bytes);
        let mut lines = Vec::new();
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=pos).collect();
            lines.push(decode_line(&line[..pos]));
        }
        lines
    }

    /// Returns the unterminated remainder, if any.
    fn finish(&mut self) -> Option<String> {
        if self.buf.is_empty() {
            return None;
        }
        let rest = std::mem::take(&mut self.buf);
        Some(decode_line(&rest))
    }
}

fn decode_line(bytes: &[u8]) -> String {
    let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
    String::from_utf8_lossy(bytes).into_owned()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn lines_event(texts: Vec<String>) -> MonitorEvent {
    let t = now_ms();
    MonitorEvent::Lines {
        lines: texts.into_iter().map(|text| MonitorLine { t, text }).collect(),
    }
}

/// Reads until `stop` is set, `emit` returns false (frontend gone), or the
/// port fails. Emits one `Lines` event per read that completes any lines.
/// On a port error the unterminated partial line is emitted first, then
/// `Disconnected`.
fn run_monitor(
    transport: &mut dyn DfuTransport,
    stop: &AtomicBool,
    emit: &mut dyn FnMut(MonitorEvent) -> bool,
) {
    let mut splitter = LineSplitter::default();
    let mut buf = [0u8; 1024];

    while !stop.load(Ordering::SeqCst) {
        match transport.read(&mut buf, READ_TIMEOUT_MS) {
            Ok(0) => {}
            Ok(n) => {
                let lines = splitter.push(&buf[..n]);
                if !lines.is_empty() && !emit(lines_event(lines)) {
                    return;
                }
            }
            Err(e) => {
                if let Some(partial) = splitter.finish() {
                    if !emit(lines_event(vec![partial])) {
                        return;
                    }
                }
                emit(MonitorEvent::Disconnected {
                    reason: e.to_string(),
                });
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dfu::ScriptedTransport;

    fn texts(event: &MonitorEvent) -> Vec<&str> {
        match event {
            MonitorEvent::Lines { lines } => lines.iter().map(|l| l.text.as_str()).collect(),
            other => panic!("expected Lines, got {other:?}"),
        }
    }

    #[test]
    fn splits_crlf() {
        let mut splitter = LineSplitter::default();
        assert_eq!(splitter.push(b"a\r\nb\r\n"), vec!["a", "b"]);
        assert_eq!(splitter.finish(), None);
    }

    #[test]
    fn joins_line_split_across_reads() {
        let mut splitter = LineSplitter::default();
        assert!(splitter.push(b"hel").is_empty());
        assert_eq!(splitter.push(b"lo\n"), vec!["hello"]);
    }

    #[test]
    fn keeps_multibyte_char_split_across_reads() {
        let mut splitter = LineSplitter::default();
        assert!(splitter.push(&[0xC3]).is_empty());
        assert_eq!(splitter.push(&[0xA9, b'\n']), vec!["é"]);
    }

    #[test]
    fn replaces_invalid_utf8() {
        let mut splitter = LineSplitter::default();
        assert_eq!(splitter.push(&[b'a', 0xFF, b'b', b'\n']), vec!["a\u{FFFD}b"]);
    }

    #[test]
    fn partial_line_flushed_on_disconnect() {
        let mut transport = ScriptedTransport::new(vec!["x\n", "part"]).with_error_at_end();
        let stop = AtomicBool::new(false);
        let mut events = Vec::new();

        run_monitor(&mut transport, &stop, &mut |ev| {
            events.push(ev);
            true
        });

        assert_eq!(events.len(), 3, "{events:?}");
        assert_eq!(texts(&events[0]), vec!["x"]);
        assert_eq!(texts(&events[1]), vec!["part"]);
        assert!(matches!(events[2], MonitorEvent::Disconnected { .. }));
    }

    #[test]
    fn session_never_writes_or_flushes() {
        let mut transport = ScriptedTransport::new(vec!["x\n", "part"]).with_error_at_end();
        let stop = AtomicBool::new(false);

        run_monitor(&mut transport, &stop, &mut |_| true);

        assert!(transport.written().is_empty());
        assert!(transport.ops().iter().all(|&op| op == "read"), "{:?}", transport.ops());
    }

    #[test]
    fn stops_when_emit_fails() {
        let mut transport = ScriptedTransport::new(vec!["a\n", "b\n"]).with_error_at_end();
        let stop = AtomicBool::new(false);
        let mut calls = 0;

        run_monitor(&mut transport, &stop, &mut |_| {
            calls += 1;
            false
        });

        assert_eq!(calls, 1);
        assert_eq!(transport.ops(), &["read"]);
    }

    #[test]
    fn stops_on_flag() {
        // Silent transport: without the flag this would read forever.
        let mut transport = ScriptedTransport::new(vec![]);
        let stop = AtomicBool::new(true);
        let mut calls = 0;

        run_monitor(&mut transport, &stop, &mut |_| {
            calls += 1;
            true
        });

        assert_eq!(calls, 0);
        assert!(transport.ops().is_empty());
    }

    #[test]
    fn events_serialize_to_the_frontend_wire_format() {
        let lines = MonitorEvent::Lines {
            lines: vec![MonitorLine {
                t: 1731100000123,
                text: "[BOOT] ok".into(),
            }],
        };
        assert_eq!(
            serde_json::to_value(&lines).unwrap(),
            serde_json::json!({
                "event": "lines",
                "data": { "lines": [{ "t": 1731100000123u64, "text": "[BOOT] ok" }] }
            })
        );

        let disconnected = MonitorEvent::Disconnected {
            reason: "unplugged".into(),
        };
        assert_eq!(
            serde_json::to_value(&disconnected).unwrap(),
            serde_json::json!({ "event": "disconnected", "data": { "reason": "unplugged" } })
        );
    }
}
