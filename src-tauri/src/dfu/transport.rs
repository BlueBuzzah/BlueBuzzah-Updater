//! Serial transport layer for DFU communication.
//!
//! Provides a trait-based abstraction over serial communication,
//! enabling both real hardware and mock testing.

use std::io::Read;
use std::time::Duration;

use serialport::SerialPort;

#[allow(unused_imports)]
use super::config::{
    get_touch_wait_multiplier, DFU_BAUD_RATE, MAX_BOOTLOADER_RESET_RETRIES,
    MAX_PORT_OPEN_RETRIES, MAX_TOUCH_OPEN_RETRIES, MAX_TOUCH_RETRIES,
    PORT_OPEN_BASE_DELAY_MS, PORT_OPEN_MAX_DELAY_MS, PORT_OPEN_TIMEOUT_MS,
    SERIAL_READ_TIMEOUT, TOUCH_RETRY_DELAY_MS, BOOTLOADER_RESET_RETRY_DELAY_MS,
};
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
        let normalized_name = normalize_port_name(port_name);

        let mut port = open_port_with_retry(
            &normalized_name,
            baud_rate,
            Some(SERIAL_READ_TIMEOUT),
            MAX_PORT_OPEN_RETRIES,
            port_name,
        )?;

        // DTR toggle to reset connection state — ensures bootloader is ready
        if let Err(e) = port.write_data_terminal_ready(false) {
            eprintln!("[DFU] Warning: DTR toggle (false) failed during port open: {}", e);
        }
        std::thread::sleep(Duration::from_millis(50));
        if let Err(e) = port.write_data_terminal_ready(true) {
            eprintln!("[DFU] Warning: DTR toggle (true) failed during port open: {}", e);
        }

        // Allow port to stabilize after DTR toggle
        std::thread::sleep(Duration::from_millis(100));

        // Clear any pending input data from previous sessions
        port.clear(serialport::ClearBuffer::Input).ok();

        Ok(Self { port })
    }

    /// Perform a 1200 baud touch to trigger bootloader mode with retry logic.
    ///
    /// Sequence:
    /// 1. Open at 1200 baud
    /// 2. Set DTR=True
    /// 3. Wait 50ms
    /// 4. Set DTR=False (triggers bootloader)
    /// 5. Close
    /// 6. Platform-specific wait for driver initialization
    ///
    /// If the touch fails, it will retry up to MAX_TOUCH_RETRIES times with
    /// progressively longer wait times to allow USB drivers to stabilize.
    pub fn touch_reset(port_name: &str) -> DfuResult<()> {
        let normalized = normalize_port_name(port_name);
        let mut last_error: Option<DfuError> = None;

        for attempt in 0..=MAX_TOUCH_RETRIES {
            match Self::touch_reset_once(&normalized, attempt) {
                Ok(()) => return Ok(()),
                Err(e) => {
                    last_error = Some(e);
                    if attempt < MAX_TOUCH_RETRIES {
                        // Wait before retry to allow USB to stabilize
                        std::thread::sleep(Duration::from_millis(TOUCH_RETRY_DELAY_MS));
                    }
                }
            }
        }

        // All retries exhausted
        Err(last_error.unwrap_or(DfuError::NoDeviceFound))
    }

    /// Single attempt at 1200 baud touch with configurable wait time.
    fn touch_reset_once(normalized_port: &str, attempt: u32) -> DfuResult<()> {
        let mut port = open_port_with_retry(
            normalized_port,
            1200,
            Some(Duration::from_millis(100)),
            MAX_TOUCH_OPEN_RETRIES,
            normalized_port,
        )?;

        // Set DTR=True immediately after opening
        port.write_data_terminal_ready(true).map_err(DfuError::Serial)?;

        // Wait 50ms for the signal to be recognized
        std::thread::sleep(Duration::from_millis(50));

        // Set DTR=False - the high-to-low transition triggers the bootloader
        port.write_data_terminal_ready(false).map_err(DfuError::Serial)?;

        // Close the port
        drop(port);

        // Get wait multiplier for this attempt (increases on retries)
        let multiplier = get_touch_wait_multiplier(attempt);

        // Wait for bootloader to initialize and driver to be ready
        // Windows needs extra time for USB driver re-enumeration
        #[cfg(target_os = "windows")]
        {
            std::thread::sleep(Duration::from_millis(1000 * multiplier));
        }

        #[cfg(not(target_os = "windows"))]
        {
            std::thread::sleep(Duration::from_millis(400 * multiplier));
        }

        Ok(())
    }

    /// Reset a device that's already in bootloader mode with retry logic.
    ///
    /// This clears any stale state from previous failed DFU attempts
    /// by toggling DTR at the normal DFU baud rate.
    ///
    /// Includes retry logic to handle transient port access failures.
    pub fn reset_bootloader(port_name: &str) -> DfuResult<()> {
        let normalized = normalize_port_name(port_name);
        let mut last_error: Option<DfuError> = None;

        for attempt in 0..=MAX_BOOTLOADER_RESET_RETRIES {
            match Self::reset_bootloader_once(&normalized) {
                Ok(()) => return Ok(()),
                Err(e) => {
                    last_error = Some(e);
                    if attempt < MAX_BOOTLOADER_RESET_RETRIES {
                        // Wait before retry
                        std::thread::sleep(Duration::from_millis(BOOTLOADER_RESET_RETRY_DELAY_MS));
                    }
                }
            }
        }

        // All retries exhausted
        Err(last_error.unwrap_or(DfuError::NoDeviceFound))
    }

    /// Single attempt at bootloader reset.
    fn reset_bootloader_once(normalized_port: &str) -> DfuResult<()> {
        let mut port = open_port_with_retry(
            normalized_port,
            DFU_BAUD_RATE,
            Some(Duration::from_millis(100)),
            MAX_TOUCH_OPEN_RETRIES,
            normalized_port,
        )?;

        // Toggle DTR to reset the bootloader state
        if let Err(e) = port.write_data_terminal_ready(false) {
            eprintln!("[DFU] Warning: DTR toggle (false) failed during bootloader reset: {}", e);
        }
        std::thread::sleep(Duration::from_millis(50));
        if let Err(e) = port.write_data_terminal_ready(true) {
            eprintln!("[DFU] Warning: DTR toggle (true) failed during bootloader reset: {}", e);
        }
        std::thread::sleep(Duration::from_millis(50));
        if let Err(e) = port.write_data_terminal_ready(false) {
            eprintln!("[DFU] Warning: DTR toggle (false) failed during bootloader reset: {}", e);
        }

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
            if let Err(e) = self.port.write_data_terminal_ready(true) {
                eprintln!("[DFU] Warning: DTR keep-alive toggle (true) failed: {}", e);
            }
            std::thread::sleep(Duration::from_millis(10));
            if let Err(e) = self.port.write_data_terminal_ready(false) {
                eprintln!("[DFU] Warning: DTR keep-alive toggle (false) failed: {}", e);
            }
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

/// Build a one-line diagnostic for a serial error, preserving the raw OS code.
///
/// `serialport::Error`'s Display drops the numeric OS error (e.g. Windows
/// ERROR_SEM_TIMEOUT = 121). This recovers it for field diagnostics.
fn describe_serial_error(context: &str, err: &serialport::Error) -> String {
    let os_code = match &err.kind() {
        serialport::ErrorKind::Io(_) => std::io::Error::last_os_error()
            .raw_os_error()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "?".to_string()),
        _ => "n/a".to_string(),
    };
    format!(
        "[{context}] kind={:?} os_code={os_code} msg={}",
        err.kind(),
        err
    )
}

/// Check if a serial port error is transient and may resolve on retry.
///
/// Transient errors include:
/// - "not functioning": Windows driver not ready after USB re-enumeration
/// - "device not configured": macOS transient state during USB re-enumeration
/// - "temporarily unavailable": Device briefly unavailable
/// - "interrupted": Operation interrupted, may succeed on retry
/// - "cannot find" / "file not found": Windows ERROR_FILE_NOT_FOUND during USB
///   CDC ACM driver initialization — the port appears in SetupDi enumeration
///   before CreateFileW can access it
fn is_transient_port_error(err_str: &str) -> bool {
    err_str.contains("not functioning")
        || err_str.contains("device not configured")
        || err_str.contains("temporarily unavailable")
        || err_str.contains("interrupted")
        // Windows-specific: ERROR_FILE_NOT_FOUND during USB driver initialization.
        // The port is listed by available_ports() (SetupDi API) but CreateFileW
        // cannot yet open it. This resolves within a few hundred milliseconds.
        || err_str.contains("cannot find")
        || err_str.contains("file not found")
        // Windows ERROR_SEM_TIMEOUT (121): the USB CDC pipe is not yet bound /
        // is being torn down during re-enumeration. Resolves on retry.
        || err_str.contains("semaphore timeout")
        || err_str.contains("timeout period has expired")
}

/// Open a serial port with a timeout to prevent blocking on Windows.
///
/// On Windows, `CreateFile` for COM ports can block for 10-30+ seconds when the
/// USB CDC ACM driver is initializing (especially for first-time device connections).
/// This function wraps the open call in a thread with a timeout.
///
/// On non-Windows platforms, this calls `serialport::new().open()` directly since
/// port opens are non-blocking.
fn open_port_with_timeout(
    port_name: &str,
    baud_rate: u32,
    read_timeout: Duration,
) -> Result<Box<dyn SerialPort>, serialport::Error> {
    #[cfg(target_os = "windows")]
    {
        use std::sync::mpsc;

        let name = port_name.to_string();
        let (tx, rx) = mpsc::channel();

        // Spawn a thread to perform the potentially blocking open.
        // If the open blocks past our timeout, the thread is orphaned but will
        // eventually complete when the OS-level CreateFile returns. At most
        // MAX_PORT_OPEN_RETRIES threads can be orphaned per open_port_with_retry call.
        let _handle = std::thread::spawn(move || {
            let result = serialport::new(&name, baud_rate)
                .timeout(read_timeout)
                .data_bits(serialport::DataBits::Eight)
                .parity(serialport::Parity::None)
                .stop_bits(serialport::StopBits::One)
                .flow_control(serialport::FlowControl::None)
                .open();
            let _ = tx.send(result);
        });

        match rx.recv_timeout(Duration::from_millis(PORT_OPEN_TIMEOUT_MS)) {
            Ok(result) => result,
            Err(_) => {
                Err(serialport::Error::new(
                    serialport::ErrorKind::Io(std::io::ErrorKind::TimedOut),
                    "Port open timed out (Windows driver initialization delay)",
                ))
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        serialport::new(port_name, baud_rate)
            .timeout(read_timeout)
            .data_bits(serialport::DataBits::Eight)
            .parity(serialport::Parity::None)
            .stop_bits(serialport::StopBits::One)
            .flow_control(serialport::FlowControl::None)
            .open()
    }
}

/// Open a serial port with retry logic for transient USB driver errors.
///
/// After USB re-enumeration, the device may appear in port enumeration before
/// the driver is fully ready for communication. This is especially common on
/// Windows where ERROR_FILE_NOT_FOUND occurs transiently during CDC ACM
/// driver initialization.
///
/// Uses exponential backoff between retries and a per-attempt timeout on Windows
/// to prevent blocking on slow driver initialization.
///
/// Worst-case timing (Windows): 15 retries × (3s timeout + 1s delay) = ~60s.
/// Typical timing: 1-3 retries, completing in under 5 seconds.
///
/// Returns the raw `Box<dyn SerialPort>` — callers handle DTR/clear themselves.
fn open_port_with_retry(
    normalized_name: &str,
    baud_rate: u32,
    timeout: Option<Duration>,
    max_retries: u32,
    display_port: &str,
) -> DfuResult<Box<dyn SerialPort>> {
    let read_timeout = timeout.unwrap_or(SERIAL_READ_TIMEOUT);
    let mut last_error: Option<serialport::Error> = None;

    for attempt in 0..max_retries {
        match open_port_with_timeout(normalized_name, baud_rate, read_timeout) {
            Ok(port) => {
                if attempt > 0 {
                    eprintln!(
                        "[DFU] Port {} opened successfully on attempt {}/{}",
                        display_port, attempt + 1, max_retries
                    );
                }
                return Ok(port);
            }
            Err(e) => {
                eprintln!("[DFU] {}", describe_serial_error(&format!("open {display_port} attempt {}/{}", attempt + 1, max_retries), &e));
                let err_str = e.to_string().to_lowercase();

                // Check if error is transient (includes timeout from our wrapper)
                let is_transient = is_transient_port_error(&err_str)
                    || err_str.contains("timed out");

                if is_transient && attempt < max_retries - 1 {
                    // Exponential backoff: 200, 400, 800, 1000, 1000, ...
                    let delay = std::cmp::min(
                        PORT_OPEN_BASE_DELAY_MS * (1u64 << (attempt.min(3) as u64)),
                        PORT_OPEN_MAX_DELAY_MS,
                    );
                    if attempt >= 2 {
                        eprintln!(
                            "[DFU] Port {} open attempt {}/{} failed ({}), retrying in {}ms...",
                            display_port, attempt + 1, max_retries, err_str, delay
                        );
                    }
                    std::thread::sleep(Duration::from_millis(delay));
                    last_error = Some(e);
                    continue;
                }

                // Convert to appropriate error type
                return Err(match e.kind() {
                    serialport::ErrorKind::Io(std::io::ErrorKind::PermissionDenied) => {
                        DfuError::PortPermissionDenied {
                            port: display_port.to_string(),
                        }
                    }
                    serialport::ErrorKind::Io(std::io::ErrorKind::NotFound) => {
                        DfuError::NoDeviceFound
                    }
                    _ if err_str.contains("busy") || err_str.contains("in use") => {
                        DfuError::PortBusy {
                            port: display_port.to_string(),
                        }
                    }
                    _ => DfuError::Serial(e),
                });
            }
        }
    }

    // All retries exhausted
    Err(DfuError::Serial(
        last_error.expect("last_error should be set after retry loop"),
    ))
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
    fn describe_serial_error_includes_context_and_message() {
        let err = serialport::Error::new(
            serialport::ErrorKind::Io(std::io::ErrorKind::TimedOut),
            "The semaphore timeout period has expired",
        );
        let out = describe_serial_error("role-config open", &err);
        assert!(out.contains("role-config open"), "missing context: {out}");
        assert!(out.contains("semaphore timeout period has expired"), "missing msg: {out}");
        assert!(out.contains("kind="), "missing kind: {out}");
    }

    #[test]
    fn semaphore_timeout_is_transient_port_error() {
        // Windows ERROR_SEM_TIMEOUT surfaces as this exact message.
        assert!(is_transient_port_error("the semaphore timeout period has expired"));
    }

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
