//! Firmware menu protocol over USB serial.
//!
//! The menu controller answers every command with a single framed response:
//! `[MENU-TX] KEY:VALUE\nKEY:VALUE…\x04`. It reaches serial regardless of
//! whether a phone is connected (`menu_controller.cpp` `sendResponse` always
//! prints, and the BLE send callback no-ops when nothing is attached), so the
//! desktop Updater gets the firmware's bounds checking, session gating, and
//! persistence for free — there is one implementation of the rules, not two.
//!
//! A SECONDARY glove silently ignores menu commands: `main.cpp` gates dispatch
//! on `deviceRole == PRIMARY`. Silence is therefore a valid signal, and callers
//! must treat a timeout as "not a primary" rather than a hard failure.

use std::time::{Duration, Instant};

use super::error::{DfuError, DfuResult};
use super::transport::DfuTransport;

/// End-of-transmission byte that terminates every menu frame.
const EOT: char = '\u{4}';

/// Serial prefix the menu controller prints before each frame.
const MENU_TX_PREFIX: &str = "[MENU-TX] ";

/// A parsed menu response: ordered KEY/VALUE pairs from one frame.
#[derive(Debug, Clone, PartialEq)]
pub struct MenuResponse {
    pairs: Vec<(String, String)>,
}

impl MenuResponse {
    /// Look up a key's value. Case-sensitive; the firmware always sends uppercase.
    pub fn get(&self, key: &str) -> Option<&str> {
        self.pairs
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    /// The ERROR value if the device rejected the command.
    pub fn error(&self) -> Option<&str> {
        self.get("ERROR")
    }
}

/// Parse the first complete menu frame out of raw serial output.
///
/// Boot logs and other chatter before the `[MENU-TX] ` prefix are ignored.
/// Returns `None` when no complete frame (prefix through EOT) is present.
pub fn parse_menu_response(raw: &str) -> Option<MenuResponse> {
    let start = raw.find(MENU_TX_PREFIX)? + MENU_TX_PREFIX.len();
    let rest = &raw[start..];
    let end = rest.find(EOT)?;
    let body = &rest[..end];

    let pairs = body
        .split('\n')
        .filter_map(|line| {
            let line = line.trim_end_matches('\r').trim();
            if line.is_empty() {
                return None;
            }
            // Only the FIRST colon splits: PROFILE's value is itself "4:custom_vcr".
            let (key, value) = line.split_once(':')?;
            Some((key.trim().to_string(), value.trim().to_string()))
        })
        .collect();

    Some(MenuResponse { pairs })
}

/// Send one menu command and read its framed response.
///
/// The command is written with a trailing newline. Reads accumulate until an
/// EOT byte completes a frame or the timeout expires.
///
/// # Errors
/// - `ProfileConfigFailed` with the device's own text when the frame carries ERROR
/// - `ProfileConfigFailed` mentioning "Timeout" when no frame arrives in time
pub fn send_menu_command<T: DfuTransport>(
    transport: &mut T,
    command: &str,
    timeout_ms: u64,
) -> DfuResult<MenuResponse> {
    let line = format!("{}\n", command);
    transport.write(line.as_bytes())?;
    transport.flush()?;

    let timeout = Duration::from_millis(timeout_ms);
    let start = Instant::now();
    let mut accumulated = Vec::new();
    let mut buffer = [0u8; 256];

    while start.elapsed() < timeout {
        let remaining = timeout.saturating_sub(start.elapsed());
        let bytes_read = transport.read(&mut buffer, remaining.as_millis() as u64)?;

        if bytes_read > 0 {
            accumulated.extend_from_slice(&buffer[..bytes_read]);
            let text = String::from_utf8_lossy(&accumulated);

            if let Some(response) = parse_menu_response(&text) {
                if let Some(message) = response.error() {
                    return Err(DfuError::ProfileConfigFailed {
                        reason: format!("Device rejected {}: {}", command, message),
                    });
                }
                return Ok(response);
            }
        }
    }

    Err(DfuError::ProfileConfigFailed {
        reason: format!(
            "Timeout waiting for menu response to {}. Received: {}",
            command,
            if accumulated.is_empty() {
                "(no response)".to_string()
            } else {
                String::from_utf8_lossy(&accumulated).to_string()
            }
        ),
    })
}

/// Transport double that replays canned menu frames, one per read.
///
/// Every later Rust task tests its flow against this instead of hardware.
/// Reads past the end of the script return 0 bytes, which is how a timeout
/// (and therefore a SECONDARY glove's silence) is simulated.
#[cfg(test)]
pub struct ScriptedTransport {
    replies: std::collections::VecDeque<String>,
    written: Vec<String>,
}

#[cfg(test)]
impl ScriptedTransport {
    pub fn new(replies: Vec<&str>) -> Self {
        Self {
            replies: replies.into_iter().map(String::from).collect(),
            written: Vec::new(),
        }
    }

    /// Every command written so far, in order, newline included.
    pub fn written(&self) -> &[String] {
        &self.written
    }
}

#[cfg(test)]
impl DfuTransport for ScriptedTransport {
    fn write(&mut self, data: &[u8]) -> DfuResult<()> {
        self.written.push(String::from_utf8_lossy(data).to_string());
        Ok(())
    }

    fn read(&mut self, buffer: &mut [u8], _timeout_ms: u64) -> DfuResult<usize> {
        match self.replies.pop_front() {
            Some(reply) => {
                let bytes = reply.as_bytes();
                let len = bytes.len().min(buffer.len());
                buffer[..len].copy_from_slice(&bytes[..len]);
                // A real serial port only delivers up to the buffer size and
                // leaves the remainder queued for the next read — split an
                // oversized reply the same way instead of truncating it, or
                // callers testing frames near/over the 256-byte read buffer
                // would silently lose bytes (possibly the EOT itself).
                if len < bytes.len() {
                    let remainder = String::from_utf8_lossy(&bytes[len..]).into_owned();
                    self.replies.push_front(remainder);
                }
                Ok(len)
            }
            None => {
                // Silence. Keeps the caller's timeout loop from spinning hot.
                std::thread::sleep(Duration::from_millis(10));
                Ok(0)
            }
        }
    }

    fn flush(&mut self) -> DfuResult<()> {
        Ok(())
    }

    fn clear_input(&mut self) -> DfuResult<()> {
        Ok(())
    }

    fn keep_alive(&mut self) -> DfuResult<()> {
        Ok(())
    }

    fn is_healthy(&mut self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_multi_line_menu_frame() {
        let raw = "[MENU-TX] ROLE:PRIMARY\nMOTORS:4\nPROFILE:4:custom_vcr\u{4}\n";
        let response = parse_menu_response(raw).expect("frame should parse");
        assert_eq!(response.get("ROLE"), Some("PRIMARY"));
        assert_eq!(response.get("MOTORS"), Some("4"));
        // Only the FIRST colon separates key from value.
        assert_eq!(response.get("PROFILE"), Some("4:custom_vcr"));
        assert_eq!(response.get("MISSING"), None);
    }

    #[test]
    fn ignores_boot_noise_before_the_frame() {
        let raw = "[BOOT] BlueBuzzah v3\n[INIT] ok\n[MENU-TX] ROLE:SECONDARY\u{4}";
        let response = parse_menu_response(raw).expect("frame should parse");
        assert_eq!(response.get("ROLE"), Some("SECONDARY"));
    }

    #[test]
    fn returns_none_without_a_complete_frame() {
        assert!(parse_menu_response("[MENU-TX] ROLE:PRIMARY").is_none());
        assert!(parse_menu_response("nothing here at all").is_none());
    }

    #[test]
    fn exposes_the_error_key() {
        let raw = "[MENU-TX] ERROR:Custom profile must be loaded before editing parameters\u{4}";
        let response = parse_menu_response(raw).unwrap();
        assert_eq!(
            response.error(),
            Some("Custom profile must be loaded before editing parameters")
        );
    }

    #[test]
    fn send_menu_command_writes_the_command_with_a_newline() {
        let mut transport = ScriptedTransport::new(vec!["[MENU-TX] ROLE:PRIMARY\u{4}"]);
        let response = send_menu_command(&mut transport, "INFO", 500).unwrap();
        assert_eq!(response.get("ROLE"), Some("PRIMARY"));
        assert_eq!(transport.written(), &["INFO\n".to_string()]);
    }

    #[test]
    fn scripted_transport_splits_an_oversized_reply_across_reads() {
        // Longer than the 16-byte buffer below, so it can't fit in one read.
        let frame = "[MENU-TX] ROLE:PRIMARY\nMOTORS:4\u{4}";
        assert!(frame.len() > 16);
        let mut transport = ScriptedTransport::new(vec![frame]);

        let mut accumulated = Vec::new();
        let mut buffer = [0u8; 16];
        loop {
            let n = transport.read(&mut buffer, 0).unwrap();
            if n == 0 {
                break;
            }
            accumulated.extend_from_slice(&buffer[..n]);
        }

        // Nothing was dropped: the full frame reassembles across multiple reads.
        let text = String::from_utf8_lossy(&accumulated);
        let response = parse_menu_response(&text).expect("frame should parse");
        assert_eq!(response.get("ROLE"), Some("PRIMARY"));
        assert_eq!(response.get("MOTORS"), Some("4"));
    }

    #[test]
    fn send_menu_command_surfaces_a_device_error_as_err() {
        let mut transport = ScriptedTransport::new(vec!["[MENU-TX] ERROR:Invalid profile ID\u{4}"]);
        let err = send_menu_command(&mut transport, "PROFILE_LOAD:9", 500).unwrap_err();
        assert!(format!("{}", err).contains("Invalid profile ID"));
    }

    #[test]
    fn send_menu_command_times_out_without_a_frame() {
        let mut transport = ScriptedTransport::new(vec![]);
        let err = send_menu_command(&mut transport, "INFO", 50).unwrap_err();
        assert!(format!("{}", err).to_lowercase().contains("timeout"));
    }
}
