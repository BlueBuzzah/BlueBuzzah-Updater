//! Read-only serial monitor: streams a device's serial output to the frontend
//! line by line.
//!
//! The read loop only ever reads: it never writes, flushes, clears input or
//! toggles DTR/RTS, so viewing a glove's log can't change what the glove is
//! doing. Opening the port is the one exception: it uses
//! `SerialTransport::open_for_monitor`, which sets RTS low, then sets DTR for
//! the board (high on v2, low on v3), and discards input once.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;

use crate::dfu::{find_supported_devices, DfuTransport, SerialTransport};

/// How long one read waits for bytes before checking the stop flag again.
const READ_TIMEOUT_MS: u64 = 200;

/// A read that returns no bytes faster than this didn't wait for its timeout,
/// which is what a hung-up port does (POSIX EOF, or a 0-byte Windows read).
const FAST_EOF: Duration = Duration::from_millis(20);

/// Consecutive fast empty reads before the port is treated as gone.
const FAST_EOF_LIMIT: u32 = 20;

/// Longest unterminated line kept in memory. Longer runs are emitted as a
/// line of their own so a device that never sends `\n` can't grow the buffer.
const MAX_LINE_BYTES: usize = 4096;

/// How long `stop_serial_monitor` waits for the reader to close the port.
/// One read timeout plus margin is enough in practice.
const STOP_WAIT: Duration = Duration::from_secs(1);
const STOP_POLL: Duration = Duration::from_millis(50);

/// Live monitors, keyed by the port string the frontend passed, each with its
/// stop flag. The reader thread removes its own entry after closing the port.
static MONITORS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

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
/// U+FFFD rather than dropping the line. An unterminated run longer than
/// `MAX_LINE_BYTES` is emitted as a line and the buffer cleared.
#[derive(Default)]
struct LineSplitter {
    buf: Vec<u8>,
}

impl LineSplitter {
    /// Adds bytes and returns every line they complete, without the `\n` or a
    /// trailing `\r`.
    fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        // Earlier bytes hold no '\n', so only the new ones need scanning.
        let scan_from = self.buf.len();
        self.buf.extend_from_slice(bytes);
        let mut lines = Vec::new();
        let mut start = 0;
        for i in scan_from..self.buf.len() {
            if self.buf[i] == b'\n' {
                lines.push(decode_line(&self.buf[start..i]));
                start = i + 1;
            }
        }
        self.buf.drain(..start);
        if self.buf.len() > MAX_LINE_BYTES {
            lines.push(decode_line(&std::mem::take(&mut self.buf)));
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
        lines: texts
            .into_iter()
            .map(|text| MonitorLine { t, text })
            .collect(),
    }
}

/// Counts consecutive empty reads that returned well before their timeout.
#[derive(Default)]
struct FastEofDetector {
    run: u32,
}

impl FastEofDetector {
    /// Records one read of `n` bytes that took `elapsed`. Returns true once
    /// `FAST_EOF_LIMIT` fast empty reads have happened in a row. Data or an
    /// empty read that waited out its timeout resets the count.
    fn observe(&mut self, n: usize, elapsed: Duration) -> bool {
        if n == 0 && elapsed < FAST_EOF {
            self.run += 1;
        } else {
            self.run = 0;
        }
        self.run >= FAST_EOF_LIMIT
    }
}

/// Emits the unterminated partial line, if any, then `Disconnected`.
fn disconnect(
    splitter: &mut LineSplitter,
    reason: String,
    emit: &mut dyn FnMut(MonitorEvent) -> bool,
) {
    if let Some(partial) = splitter.finish() {
        if !emit(lines_event(vec![partial])) {
            return;
        }
    }
    emit(MonitorEvent::Disconnected { reason });
}

/// Reads until `stop` is set, `emit` returns false (frontend gone), or the
/// port fails. Emits one `Lines` event per read that completes any lines.
/// On a port error, or a port that keeps returning nothing without waiting
/// (hung up), the unterminated partial line is emitted first, then
/// `Disconnected`.
fn run_monitor(
    transport: &mut dyn DfuTransport,
    stop: &AtomicBool,
    emit: &mut dyn FnMut(MonitorEvent) -> bool,
) {
    let mut splitter = LineSplitter::default();
    let mut fast_eof = FastEofDetector::default();
    let mut buf = [0u8; 1024];

    while !stop.load(Ordering::SeqCst) {
        let started = Instant::now();
        match transport.read(&mut buf, READ_TIMEOUT_MS) {
            Ok(n) => {
                if fast_eof.observe(n, started.elapsed()) {
                    disconnect(&mut splitter, "The port stopped responding".into(), emit);
                    return;
                }
                let lines = splitter.push(&buf[..n]);
                if !lines.is_empty() && !emit(lines_event(lines)) {
                    return;
                }
            }
            Err(e) => {
                disconnect(&mut splitter, e.to_string(), emit);
                return;
            }
        }
    }
}

/// Whether to raise DTR when opening a monitor. v2 (TinyUSB CDC) only sends
/// while DTR is set; v3 doesn't need it, and an unknown device gets the
/// lines-low posture.
fn monitor_dtr(board: Option<&str>) -> bool {
    board == Some("nrf52")
}

fn monitors() -> std::sync::MutexGuard<'static, HashMap<String, Arc<AtomicBool>>> {
    MONITORS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Claims `port` for a new monitor. Fails if one is already running on it.
fn try_register(port: &str) -> Result<Arc<AtomicBool>, String> {
    let mut map = monitors();
    if map.contains_key(port) {
        return Err("This device is already being viewed".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    map.insert(port.to_string(), stop.clone());
    Ok(stop)
}

/// Removes the port's map entry on drop, so it's released on every exit path
/// (open failure, disconnect, frontend gone, stop, panic).
struct Registration {
    port: String,
    stop: Arc<AtomicBool>,
}

impl Drop for Registration {
    fn drop(&mut self) {
        let mut map = monitors();
        if map
            .get(&self.port)
            .is_some_and(|s| Arc::ptr_eq(s, &self.stop))
        {
            map.remove(&self.port);
        }
    }
}

/// Asks the monitor on `port` to stop, then blocks until its reader has
/// closed the port (or `timeout` passes), so a restart can reopen it.
fn stop_and_wait(port: &str, timeout: Duration) {
    match monitors().get(port) {
        Some(stop) => stop.store(true, Ordering::SeqCst),
        None => return,
    }
    let deadline = Instant::now() + timeout;
    while monitors().contains_key(port) && Instant::now() < deadline {
        std::thread::sleep(STOP_POLL);
    }
}

/// Starts streaming `port`'s serial output to `on_event`.
///
/// Opens with `open_for_monitor`, which doesn't pulse DTR/RTS, so starting a
/// view doesn't reset the glove. DTR is raised only for a v2 device, which
/// otherwise prints nothing. Returns once the port is open; lines then arrive
/// on the channel until the port fails or `stop_serial_monitor` runs.
#[tauri::command]
pub async fn start_serial_monitor(
    port: String,
    on_event: Channel<MonitorEvent>,
) -> Result<(), String> {
    let stop = try_register(&port)?;
    let registration = Registration {
        port: port.clone(),
        stop: stop.clone(),
    };

    let transport = tokio::task::spawn_blocking(move || {
        let board = find_supported_devices()
            .into_iter()
            .find(|d| d.port == port)
            .map(|d| d.board);
        if board.is_none() {
            // DTR stays low, so a v2 glove opened this way prints nothing.
            eprintln!(
                "[monitor] {} not in device list; opening with DTR low",
                port
            );
        }
        SerialTransport::open_for_monitor(&port, monitor_dtr(board.as_deref()))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        let _registration = registration;
        // Declared after `_registration`, so it drops first: the port is
        // closed before the entry is removed and a restart can reopen it.
        let mut transport = transport;
        run_monitor(&mut transport, &stop, &mut |ev| on_event.send(ev).is_ok());
    });

    Ok(())
}

/// Stops the monitor on `port` and waits for its port to close. A port that
/// isn't being monitored is not an error.
#[tauri::command]
pub async fn stop_serial_monitor(port: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || stop_and_wait(&port, STOP_WAIT))
        .await
        .map_err(|e| e.to_string())
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
        assert_eq!(
            splitter.push(&[b'a', 0xFF, b'b', b'\n']),
            vec!["a\u{FFFD}b"]
        );
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
        match &events[0] {
            MonitorEvent::Lines { lines } => assert!(lines[0].t > 0),
            other => panic!("expected Lines, got {other:?}"),
        }
        match &events[2] {
            MonitorEvent::Disconnected { reason } => assert!(!reason.is_empty()),
            other => panic!("expected Disconnected, got {other:?}"),
        }
    }

    #[test]
    fn hung_up_port_disconnects_instead_of_spinning() {
        let mut transport = ScriptedTransport::new(vec!["part"]).with_instant_eof();
        let stop = AtomicBool::new(false);
        let mut events = Vec::new();

        run_monitor(&mut transport, &stop, &mut |ev| {
            events.push(ev);
            true
        });

        assert_eq!(events.len(), 2, "{events:?}");
        assert_eq!(texts(&events[0]), vec!["part"]);
        assert_eq!(
            events[1],
            MonitorEvent::Disconnected {
                reason: "The port stopped responding".into()
            }
        );
        assert!(
            transport.ops().iter().all(|&op| op == "read"),
            "{:?}",
            transport.ops()
        );
    }

    #[test]
    fn fast_eof_needs_an_unbroken_run_of_fast_empty_reads() {
        let fast = Duration::ZERO;
        let slow = Duration::from_millis(READ_TIMEOUT_MS);

        let mut detector = FastEofDetector::default();
        for _ in 0..1000 {
            assert!(
                !detector.observe(0, slow),
                "a timed-out read is just silence"
            );
        }

        let mut detector = FastEofDetector::default();
        for _ in 0..FAST_EOF_LIMIT - 1 {
            assert!(!detector.observe(0, fast));
        }
        assert!(!detector.observe(5, fast), "data resets the run");
        for _ in 0..FAST_EOF_LIMIT - 1 {
            assert!(!detector.observe(0, fast));
        }
        assert!(
            !detector.observe(0, slow),
            "a slow empty read resets the run"
        );
        for _ in 0..FAST_EOF_LIMIT - 1 {
            assert!(!detector.observe(0, fast));
        }
        assert!(detector.observe(0, fast));
    }

    #[test]
    fn caps_an_unterminated_line() {
        let mut splitter = LineSplitter::default();
        let full = vec![b'a'; MAX_LINE_BYTES];
        assert!(
            splitter.push(&full).is_empty(),
            "at the cap it stays buffered"
        );

        let lines = splitter.push(b"b");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].len(), MAX_LINE_BYTES + 1);
        assert!(lines[0].ends_with('b'));
        assert_eq!(splitter.finish(), None);

        assert_eq!(splitter.push(b"c\n"), vec!["c"]);
    }

    #[test]
    fn completed_lines_come_before_a_capped_tail() {
        let mut splitter = LineSplitter::default();
        let mut bytes = b"x\n".to_vec();
        bytes.extend(vec![b'z'; MAX_LINE_BYTES + 1]);

        let lines = splitter.push(&bytes);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0], "x");
        assert_eq!(lines[1].len(), MAX_LINE_BYTES + 1);
    }

    #[test]
    fn monitor_raises_dtr_only_for_v2() {
        assert!(monitor_dtr(Some("nrf52")));
        assert!(!monitor_dtr(Some("esp32s3")));
        assert!(!monitor_dtr(None));
    }

    #[test]
    fn session_never_writes_or_flushes() {
        let mut transport = ScriptedTransport::new(vec!["x\n", "part"]).with_error_at_end();
        let stop = AtomicBool::new(false);

        run_monitor(&mut transport, &stop, &mut |_| true);

        assert!(transport.written().is_empty());
        assert!(
            transport.ops().iter().all(|&op| op == "read"),
            "{:?}",
            transport.ops()
        );
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

    #[test]
    fn second_start_on_same_port_errors() {
        let port = "test-second-start";
        let _first = Registration {
            port: port.into(),
            stop: try_register(port).unwrap(),
        };

        assert_eq!(
            try_register(port).unwrap_err(),
            "This device is already being viewed"
        );
    }

    #[test]
    fn registration_releases_the_port_on_drop() {
        let port = "test-release-on-drop";
        drop(Registration {
            port: port.into(),
            stop: try_register(port).unwrap(),
        });

        assert!(try_register(port).is_ok());
        monitors().remove(port);
    }

    #[test]
    fn stop_waits_for_reader_exit() {
        let port = "test-stop-waits";
        let stop = try_register(port).unwrap();
        let reader = std::thread::spawn({
            let stop = stop.clone();
            move || {
                while !stop.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(5));
                }
                std::thread::sleep(Duration::from_millis(100));
                monitors().remove(port);
            }
        });

        let started = Instant::now();
        stop_and_wait(port, Duration::from_secs(5));

        assert!(stop.load(Ordering::SeqCst));
        assert!(
            !monitors().contains_key(port),
            "returned before the reader exited"
        );
        assert!(started.elapsed() >= Duration::from_millis(100));
        reader.join().unwrap();
    }

    #[test]
    fn stop_on_an_unmonitored_port_returns_at_once() {
        let started = Instant::now();
        stop_and_wait("test-not-monitored", Duration::from_secs(5));
        assert!(started.elapsed() < Duration::from_millis(500));
    }
}
