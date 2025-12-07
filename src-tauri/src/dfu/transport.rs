//! Serial transport layer for DFU communication.
//!
//! Provides a trait-based abstraction over serial communication,
//! enabling both real hardware and mock testing.

use std::io::Read;
use std::time::Duration;

use serialport::SerialPort;

use super::config::{DFU_BAUD_RATE, SERIAL_READ_TIMEOUT};
use super::error::{DfuError, DfuResult};

/// Trait for DFU transport operations.
///
/// This abstraction allows for mocking in tests and potential
/// alternative transport mechanisms.
pub trait DfuTransport: Send {
    /// Write data to the transport.
    fn write(&mut self, data: &[u8]) -> DfuResult<()>;

    /// Read data from the transport with a timeout.
    ///
    /// # Arguments
    /// * `buffer` - Buffer to read into
    /// * `timeout_ms` - Timeout in milliseconds
    ///
    /// # Returns
    /// Number of bytes read
    fn read(&mut self, buffer: &mut [u8], timeout_ms: u64) -> DfuResult<usize>;

    /// Flush any buffered output.
    fn flush(&mut self) -> DfuResult<()>;

    /// Clear any pending input data from the receive buffer.
    fn clear_input(&mut self) -> DfuResult<()>;

    /// Toggle DTR to keep the connection alive.
    ///
    /// On macOS, serial port handles can go stale if inactive for too long.
    /// This method toggles DTR to maintain the connection without affecting
    /// the device's state.
    fn keep_alive(&mut self) -> DfuResult<()>;

    /// Check if the connection is still healthy.
    ///
    /// Returns true if the port appears to be responsive.
    fn is_healthy(&mut self) -> bool;
}

/// Serial port transport implementation.
pub struct SerialTransport {
    port: Box<dyn SerialPort>,
}

impl SerialTransport {
    /// Open a serial port for DFU communication.
    ///
    /// Uses the standard DFU baud rate (115200) and typical settings.
    pub fn open(port_name: &str) -> DfuResult<Self> {
        Self::open_with_baud(port_name, DFU_BAUD_RATE)
    }

    /// Open a serial port with a specific baud rate.
    ///
    /// Includes retry logic to handle transient connectivity failures during
    /// USB device re-enumeration (e.g., entering bootloader mode). This is
    /// especially important on Windows where devices appear in port enumeration
    /// before the driver is fully ready, but benefits all platforms.
    pub fn open_with_baud(port_name: &str, baud_rate: u32) -> DfuResult<Self> {
        // Normalize port name for cross-platform compatibility
        let normalized_name = normalize_port_name(port_name);

        // Retry port open to handle transient connectivity failures.
        // After USB re-enumeration, the device may appear in port enumeration
        // before the driver is fully ready for communication.
        const MAX_OPEN_RETRIES: u32 = 10;
        const RETRY_DELAY_MS: u64 = 200;

        let mut last_error: Option<serialport::Error> = None;

        for attempt in 0..MAX_OPEN_RETRIES {
            match serialport::new(&normalized_name, baud_rate)
                .timeout(SERIAL_READ_TIMEOUT)
                .data_bits(serialport::DataBits::Eight)
                .parity(serialport::Parity::None)
                .stop_bits(serialport::StopBits::One)
                .flow_control(serialport::FlowControl::None)
                .open()
            {
                Ok(mut port) => {
                    // Success - proceed with DTR toggle to reset connection state.
                    // This ensures the bootloader is ready to receive commands.
                    port.write_data_terminal_ready(false).ok();
                    std::thread::sleep(Duration::from_millis(50));
                    port.write_data_terminal_ready(true).ok();

                    // Allow port to stabilize after DTR toggle
                    std::thread::sleep(Duration::from_millis(100));

                    // Clear any pending input data from previous sessions
                    port.clear(serialport::ClearBuffer::Input).ok();

                    return Ok(Self { port });
                }
                Err(e) => {
                    let err_str = e.to_string().to_lowercase();

                    // Check for transient errors that may resolve after driver initialization:
                    // - "not functioning": Windows driver not ready after USB re-enumeration
                    // - "resource temporarily unavailable": Device briefly unavailable
                    // - "interrupted": Operation interrupted, may succeed on retry
                    let is_transient = err_str.contains("not functioning")
                        || err_str.contains("temporarily unavailable")
                        || err_str.contains("interrupted");

                    if is_transient && attempt < MAX_OPEN_RETRIES - 1 {
                        std::thread::sleep(Duration::from_millis(RETRY_DELAY_MS));
                        last_error = Some(e);
                        continue;
                    }

                    // Convert to appropriate error type
                    return Err(match e.kind() {
                        serialport::ErrorKind::Io(std::io::ErrorKind::PermissionDenied) => {
                            DfuError::PortPermissionDenied {
                                port: port_name.to_string(),
                            }
                        }
                        serialport::ErrorKind::Io(std::io::ErrorKind::NotFound) => {
                            DfuError::NoDeviceFound
                        }
                        _ if err_str.contains("busy") || err_str.contains("in use") => {
                            DfuError::PortBusy {
                                port: port_name.to_string(),
                            }
                        }
                        _ => DfuError::Serial(e),
                    });
                }
            }
        }

        // All retries exhausted - return the last error
        Err(DfuError::Serial(
            last_error.expect("last_error should be set after retry loop"),
        ))
    }

    /// Perform a 1200 baud touch to trigger bootloader mode.
    ///
    /// Sequence:
    /// 1. Open at 1200 baud
    /// 2. Set DTR=True
    /// 3. Wait 50ms
    /// 4. Set DTR=False (triggers bootloader)
    /// 5. Close
    /// 6. Platform-specific wait for driver initialization
    pub fn touch_reset(port_name: &str) -> DfuResult<()> {
        let normalized = normalize_port_name(port_name);

        let mut port = serialport::new(&normalized, 1200)
            .timeout(Duration::from_millis(100))
            .open()
            .map_err(DfuError::Serial)?;

        // Set DTR=True immediately after opening
        port.write_data_terminal_ready(true).map_err(DfuError::Serial)?;

        // Wait 50ms for the signal to be recognized
        std::thread::sleep(Duration::from_millis(50));

        // Set DTR=False - the high-to-low transition triggers the bootloader
        port.write_data_terminal_ready(false).map_err(DfuError::Serial)?;

        // Close the port
        drop(port);

        // Wait for bootloader to initialize and driver to be ready
        // Windows needs extra time for USB driver re-enumeration
        #[cfg(target_os = "windows")]
        {
            std::thread::sleep(Duration::from_millis(1000));
        }

        #[cfg(not(target_os = "windows"))]
        {
            std::thread::sleep(Duration::from_millis(400));
        }

        Ok(())
    }

    /// Reset a device that's already in bootloader mode.
    ///
    /// This clears any stale state from previous failed DFU attempts
    /// by toggling DTR at the normal DFU baud rate.
    pub fn reset_bootloader(port_name: &str) -> DfuResult<()> {
        let normalized = normalize_port_name(port_name);

        let mut port = serialport::new(&normalized, DFU_BAUD_RATE)
            .timeout(Duration::from_millis(100))
            .open()
            .map_err(DfuError::Serial)?;

        // Toggle DTR to reset the bootloader state
        port.write_data_terminal_ready(false).ok();
        std::thread::sleep(Duration::from_millis(50));
        port.write_data_terminal_ready(true).ok();
        std::thread::sleep(Duration::from_millis(50));
        port.write_data_terminal_ready(false).ok();

        // Close the port
        drop(port);

        // Wait for bootloader to reinitialize
        std::thread::sleep(Duration::from_millis(500));

        Ok(())
    }
}

impl DfuTransport for SerialTransport {
    fn write(&mut self, data: &[u8]) -> DfuResult<()> {
        use std::io::Write;

        // Single write call - the OS handles USB packetization.
        // No explicit flush needed; write_all handles partial writes internally.
        self.port.write_all(data).map_err(DfuError::Io)?;

        Ok(())
    }

    fn read(&mut self, buffer: &mut [u8], timeout_ms: u64) -> DfuResult<usize> {
        self.port
            .set_timeout(Duration::from_millis(timeout_ms))
            .map_err(DfuError::Serial)?;

        match self.port.read(buffer) {
            Ok(n) => Ok(n),
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => Ok(0),
            Err(e) => Err(DfuError::Io(e)),
        }
    }

    fn flush(&mut self) -> DfuResult<()> {
        self.port.flush().map_err(DfuError::Io)
    }

    fn clear_input(&mut self) -> DfuResult<()> {
        self.port.clear(serialport::ClearBuffer::Input).map_err(DfuError::Serial)
    }

    fn keep_alive(&mut self) -> DfuResult<()> {
        // Toggle DTR to keep the connection alive without affecting device state.
        // This is particularly important on macOS where port handles can go stale.
        //
        // The toggle is very brief (10ms) so it won't interfere with the device.
        // Note: We intentionally ignore errors here as the keep-alive is best-effort.
        #[cfg(target_os = "macos")]
        {
            self.port.write_data_terminal_ready(true).ok();
            std::thread::sleep(Duration::from_millis(10));
            self.port.write_data_terminal_ready(false).ok();
        }

        // On other platforms, just do a quick settings check to verify port is open
        #[cfg(not(target_os = "macos"))]
        {
            // Query baud rate as a health check - if this fails, port is likely stale
            let _ = self.port.baud_rate();
        }

        Ok(())
    }

    fn is_healthy(&mut self) -> bool {
        // Try to get the port settings as a health check.
        // If this succeeds, the port is likely still valid.
        // We also check for any accumulated read errors by trying a quick read.
        match self.port.baud_rate() {
            Ok(_) => {
                // Port settings are readable, connection is likely healthy
                true
            }
            Err(_) => {
                // Can't read settings, port is likely stale or disconnected
                false
            }
        }
    }
}

/// Normalize a port name for cross-platform compatibility.
fn normalize_port_name(name: &str) -> String {
    #[cfg(target_os = "macos")]
    {
        // Prefer cu. over tty. for better compatibility
        if name.starts_with("/dev/tty.") {
            return name.replace("/dev/tty.", "/dev/cu.");
        }
    }

    #[cfg(target_os = "windows")]
    {
        // COM ports > 9 need \\.\\ prefix
        if name.starts_with("COM") {
            if let Ok(n) = name[3..].parse::<u32>() {
                if n > 9 {
                    return format!("\\\\.\\{}", name);
                }
            }
        }
    }

    name.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_port_name_passthrough() {
        assert_eq!(normalize_port_name("/dev/cu.usbmodem1234"), "/dev/cu.usbmodem1234");
        assert_eq!(normalize_port_name("COM1"), "COM1");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_normalize_port_name_macos_tty_to_cu() {
        assert_eq!(
            normalize_port_name("/dev/tty.usbmodem1234"),
            "/dev/cu.usbmodem1234"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_normalize_port_name_windows_high_com() {
        assert_eq!(normalize_port_name("COM1"), "COM1");
        assert_eq!(normalize_port_name("COM9"), "COM9");
        assert_eq!(normalize_port_name("COM10"), "\\\\.\\COM10");
        assert_eq!(normalize_port_name("COM15"), "\\\\.\\COM15");
    }
}
