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
    pub fn open_with_baud(port_name: &str, baud_rate: u32) -> DfuResult<Self> {
        // Normalize port name for cross-platform compatibility
        let normalized_name = normalize_port_name(port_name);

        // Minimal setup - just open the port like pyserial does
        let mut port = serialport::new(&normalized_name, baud_rate)
            .timeout(SERIAL_READ_TIMEOUT)
            .data_bits(serialport::DataBits::Eight)
            .parity(serialport::Parity::None)
            .stop_bits(serialport::StopBits::One)
            .flow_control(serialport::FlowControl::None)
            .open()
            .map_err(|e| match e.kind() {
                serialport::ErrorKind::Io(std::io::ErrorKind::PermissionDenied) => {
                    DfuError::PortPermissionDenied {
                        port: port_name.to_string(),
                    }
                }
                serialport::ErrorKind::Io(std::io::ErrorKind::NotFound) => DfuError::NoDeviceFound,
                _ => {
                    let err_str = e.to_string().to_lowercase();
                    if err_str.contains("busy") || err_str.contains("in use") {
                        DfuError::PortBusy {
                            port: port_name.to_string(),
                        }
                    } else {
                        DfuError::Serial(e)
                    }
                }
            })?;

        // DTR reset sequence: toggle DTR to reset the connection state.
        // This ensures the bootloader is ready to receive commands.
        port.write_data_terminal_ready(false).ok();
        std::thread::sleep(Duration::from_millis(50));
        port.write_data_terminal_ready(true).ok();

        // Allow port to stabilize after DTR toggle
        std::thread::sleep(Duration::from_millis(100));

        // Clear any pending input data from previous sessions
        port.clear(serialport::ClearBuffer::Input).ok();

        Ok(Self { port })
    }

    /// Perform a 1200 baud touch to trigger bootloader mode.
    ///
    /// Sequence:
    /// 1. Open at 1200 baud
    /// 2. Set DTR=True
    /// 3. Wait 50ms
    /// 4. Set DTR=False (triggers bootloader)
    /// 5. Close
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

        // Wait for bootloader to initialize
        std::thread::sleep(Duration::from_millis(400));

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
