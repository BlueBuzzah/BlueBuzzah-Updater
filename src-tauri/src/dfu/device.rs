//! Device detection for nRF52 devices.
//!
//! Detects Adafruit Feather nRF52840 devices by USB VID/PID.
//! Provides flexible device tracking via serial number or VID/PID+port pattern.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serialport::{available_ports, SerialPortType};

use super::config::{is_bootloader_pid, is_compatible_device, PORT_SCAN_INTERVAL};
use super::error::{DfuError, DfuResult};

/// Information about a detected nRF52 device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Nrf52Device {
    /// Serial port path (e.g., "/dev/cu.usbmodem1234" or "COM3").
    pub port: String,
    /// USB Vendor ID.
    pub vid: u16,
    /// USB Product ID.
    pub pid: u16,
    /// Device serial number (if available).
    pub serial_number: Option<String>,
    /// Whether the device is currently in bootloader mode.
    pub in_bootloader: bool,
    /// Product name (if available).
    pub product_name: Option<String>,
    /// Manufacturer name (if available).
    pub manufacturer: Option<String>,
}

impl Nrf52Device {
    /// Get a display label for this device.
    pub fn display_label(&self) -> String {
        if let Some(ref name) = self.product_name {
            name.clone()
        } else if self.in_bootloader {
            format!("nRF52840 Bootloader ({})", self.port)
        } else {
            format!("BlueBuzzah ({})", self.port)
        }
    }
}

/// Device identifier for tracking devices through mode changes.
///
/// Devices can be tracked by serial number (preferred) or by VID/PID + port pattern
/// (fallback for devices without serial numbers).
#[derive(Debug, Clone)]
pub enum DeviceIdentifier {
    /// Track by USB serial number (preferred method).
    Serial(String),
    /// Track by VID/PID and port pattern (fallback for devices without serial).
    VidPidPort {
        vid: u16,
        pid: u16,
        port_pattern: String,
    },
}

impl DeviceIdentifier {
    /// Create a device identifier from a detected device.
    ///
    /// Prefers serial number tracking if available, falls back to VID/PID+port pattern.
    pub fn from_device(device: &Nrf52Device) -> Self {
        if let Some(ref serial) = device.serial_number {
            DeviceIdentifier::Serial(serial.clone())
        } else {
            let pattern = extract_port_pattern(&device.port);
            DeviceIdentifier::VidPidPort {
                vid: device.vid,
                pid: device.pid,
                port_pattern: pattern,
            }
        }
    }

    /// Check if this identifier matches a given device.
    pub fn matches(&self, device: &Nrf52Device) -> bool {
        match self {
            DeviceIdentifier::Serial(serial) => {
                device.serial_number.as_deref() == Some(serial.as_str())
            }
            DeviceIdentifier::VidPidPort {
                vid,
                pid,
                port_pattern,
            } => {
                // Match by VID and device family (app/bootloader pair)
                device.vid == *vid
                    && is_same_device_family(device.pid, *pid)
                    && device.port.contains(port_pattern)
            }
        }
    }

    /// Check if this identifier uses serial number tracking.
    pub fn has_serial(&self) -> bool {
        matches!(self, DeviceIdentifier::Serial(_))
    }
}

/// Extract a stable portion of the port name for matching.
///
/// On macOS, extracts the base portion (e.g., "usbmodem142" from "/dev/cu.usbmodem14201").
/// On Windows, keeps the full COM port name.
fn extract_port_pattern(port: &str) -> String {
    // macOS: Extract base portion of usbmodem name
    // Port names like /dev/cu.usbmodem14201 can change slightly (14201 -> 14203)
    // but the base "usbmodem142" stays consistent for the same device
    if let Some(idx) = port.rfind("usbmodem") {
        let start = idx;
        // Take "usbmodem" + first 3 digits (12 chars total)
        let end = (start + 11).min(port.len());
        return port[start..end].to_string();
    }

    // Windows: COM port names are usually stable
    if port.starts_with("COM") {
        return port.to_string();
    }

    // Linux: Extract ttyACM or ttyUSB base
    if let Some(idx) = port.rfind("ttyACM") {
        let start = idx;
        let end = (start + 7).min(port.len()); // "ttyACM" + 1 digit
        return port[start..end].to_string();
    }
    if let Some(idx) = port.rfind("ttyUSB") {
        let start = idx;
        let end = (start + 7).min(port.len());
        return port[start..end].to_string();
    }

    // Fallback: use full port name
    port.to_string()
}

/// Check if two PIDs represent the same device in different modes.
///
/// Adafruit uses a consistent pattern:
/// - Application mode: 0x80XX (high byte = 0x80)
/// - Bootloader mode: 0x00XX (high byte = 0x00)
///
/// The low byte identifies the device variant.
fn is_same_device_family(pid1: u16, pid2: u16) -> bool {
    (pid1 & 0x00FF) == (pid2 & 0x00FF)
}

/// Find all connected nRF52 devices.
///
/// Scans available serial ports and returns those matching
/// Adafruit nRF52840 VID/PID combinations.
///
/// On macOS, filters out `tty.*` ports to avoid duplicates (each device
/// appears as both `cu.*` and `tty.*`). The `cu.*` variant is preferred
/// as it doesn't block waiting for DCD.
pub fn find_nrf52_devices() -> Vec<Nrf52Device> {
    let mut devices = Vec::new();

    let ports = match available_ports() {
        Ok(ports) => ports,
        Err(_) => return devices,
    };

    for port in ports {
        // On macOS, skip tty.* ports to avoid duplicates
        // Each USB serial device appears as both /dev/cu.* and /dev/tty.*
        #[cfg(target_os = "macos")]
        if port.port_name.contains("/dev/tty.") {
            continue;
        }

        if let SerialPortType::UsbPort(usb_info) = &port.port_type {
            if is_compatible_device(usb_info.vid, usb_info.pid) {
                devices.push(Nrf52Device {
                    port: port.port_name.clone(),
                    vid: usb_info.vid,
                    pid: usb_info.pid,
                    serial_number: usb_info.serial_number.clone(),
                    in_bootloader: is_bootloader_pid(usb_info.pid),
                    product_name: usb_info.product.clone(),
                    manufacturer: usb_info.manufacturer.clone(),
                });
            }
        }
    }

    devices
}

/// Get device info for a specific port.
///
/// Returns the device connected to the specified port, if any.
/// Useful for checking device state before starting DFU.
pub fn get_device_by_port(port_name: &str) -> Option<Nrf52Device> {
    find_nrf52_devices()
        .into_iter()
        .find(|d| d.port == port_name)
}

/// Wait for a specific device (by serial number) to appear in bootloader mode.
///
/// After triggering bootloader mode, the device re-enumerates and may appear
/// on a different port. This function tracks the device by serial number to
/// ensure we find the correct device.
///
/// Note: For devices without serial numbers, use `wait_for_bootloader_flexible()` instead.
///
/// # Arguments
/// * `serial` - Device serial number to match
/// * `timeout_ms` - Maximum time to wait in milliseconds
///
/// # Returns
/// The detected bootloader device, or an error if timeout expires
#[allow(dead_code)]
pub fn wait_for_bootloader_by_serial(serial: &str, timeout_ms: u64) -> DfuResult<Nrf52Device> {
    const REQUIRED_CONSECUTIVE: u32 = 2;
    let timeout = Duration::from_millis(timeout_ms);
    let start = Instant::now();
    let mut consecutive_detections: u32 = 0;

    while start.elapsed() < timeout {
        if let Some(device) = find_nrf52_devices()
            .into_iter()
            .find(|d| d.in_bootloader && d.serial_number.as_deref() == Some(serial))
        {
            consecutive_detections += 1;
            if consecutive_detections >= REQUIRED_CONSECUTIVE {
                return Ok(device);
            }
        } else {
            consecutive_detections = 0;
        }
        std::thread::sleep(PORT_SCAN_INTERVAL);
    }

    Err(DfuError::BootloaderTimeout { timeout_ms })
}

/// Wait for a specific device (by serial number) to appear in application mode.
///
/// After flashing, the device reboots into application mode and may appear
/// on a different port. This function tracks the device by serial number to
/// ensure we configure the correct device.
///
/// # Arguments
/// * `serial` - Device serial number to match
/// * `timeout_ms` - Maximum time to wait in milliseconds
///
/// # Returns
/// The detected application device, or an error if timeout expires
pub fn wait_for_application_by_serial(serial: &str, timeout_ms: u64) -> DfuResult<Nrf52Device> {
    const REQUIRED_CONSECUTIVE: u32 = 2;
    let timeout = Duration::from_millis(timeout_ms);
    let start = Instant::now();
    let mut consecutive_detections: u32 = 0;

    while start.elapsed() < timeout {
        if let Some(device) = find_nrf52_devices()
            .into_iter()
            .find(|d| !d.in_bootloader && d.serial_number.as_deref() == Some(serial))
        {
            consecutive_detections += 1;
            if consecutive_detections >= REQUIRED_CONSECUTIVE {
                return Ok(device);
            }
        } else {
            consecutive_detections = 0;
        }
        std::thread::sleep(PORT_SCAN_INTERVAL);
    }

    Err(DfuError::BootloaderTimeout { timeout_ms })
}

/// Wait for a device to appear in bootloader mode using flexible tracking.
///
/// This function supports both serial number and VID/PID+port pattern tracking,
/// making it work with devices that don't have a serial number.
///
/// # Arguments
/// * `identifier` - Device identifier (serial or VID/PID+port)
/// * `timeout_ms` - Maximum time to wait in milliseconds
///
/// # Returns
/// The detected bootloader device, or an error if timeout expires
pub fn wait_for_bootloader_flexible(
    identifier: &DeviceIdentifier,
    timeout_ms: u64,
) -> DfuResult<Nrf52Device> {
    const REQUIRED_CONSECUTIVE: u32 = 2;
    let timeout = Duration::from_millis(timeout_ms);
    let start = Instant::now();
    let mut consecutive_detections: u32 = 0;

    while start.elapsed() < timeout {
        if let Some(device) = find_nrf52_devices()
            .into_iter()
            .find(|d| d.in_bootloader && identifier.matches(d))
        {
            consecutive_detections += 1;
            if consecutive_detections >= REQUIRED_CONSECUTIVE {
                return Ok(device);
            }
        } else {
            consecutive_detections = 0;
        }
        std::thread::sleep(PORT_SCAN_INTERVAL);
    }

    Err(DfuError::BootloaderTimeout { timeout_ms })
}

/// Wait for a device to appear in application mode using flexible tracking.
///
/// This function supports both serial number and VID/PID+port pattern tracking,
/// making it work with devices that don't have a serial number.
///
/// # Arguments
/// * `identifier` - Device identifier (serial or VID/PID+port)
/// * `timeout_ms` - Maximum time to wait in milliseconds
///
/// # Returns
/// The detected application device, or an error if timeout expires
pub fn wait_for_application_flexible(
    identifier: &DeviceIdentifier,
    timeout_ms: u64,
) -> DfuResult<Nrf52Device> {
    const REQUIRED_CONSECUTIVE: u32 = 2;
    let timeout = Duration::from_millis(timeout_ms);
    let start = Instant::now();
    let mut consecutive_detections: u32 = 0;

    while start.elapsed() < timeout {
        if let Some(device) = find_nrf52_devices()
            .into_iter()
            .find(|d| !d.in_bootloader && identifier.matches(d))
        {
            consecutive_detections += 1;
            if consecutive_detections >= REQUIRED_CONSECUTIVE {
                return Ok(device);
            }
        } else {
            consecutive_detections = 0;
        }
        std::thread::sleep(PORT_SCAN_INTERVAL);
    }

    Err(DfuError::BootloaderTimeout { timeout_ms })
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::config::ADAFRUIT_VID;

    #[test]
    fn test_display_label_with_product_name() {
        let device = Nrf52Device {
            port: "/dev/cu.usbmodem1234".to_string(),
            vid: ADAFRUIT_VID,
            pid: 0x8029,
            serial_number: None,
            in_bootloader: false,
            product_name: Some("Adafruit Feather nRF52840".to_string()),
            manufacturer: None,
        };

        assert_eq!(device.display_label(), "Adafruit Feather nRF52840");
    }

    #[test]
    fn test_display_label_bootloader_no_name() {
        let device = Nrf52Device {
            port: "COM3".to_string(),
            vid: ADAFRUIT_VID,
            pid: 0x0029,
            serial_number: None,
            in_bootloader: true,
            product_name: None,
            manufacturer: None,
        };

        assert_eq!(device.display_label(), "nRF52840 Bootloader (COM3)");
    }

    #[test]
    fn test_display_label_application_no_name() {
        let device = Nrf52Device {
            port: "/dev/cu.usbmodem5678".to_string(),
            vid: ADAFRUIT_VID,
            pid: 0x8029,
            serial_number: None,
            in_bootloader: false,
            product_name: None,
            manufacturer: None,
        };

        assert_eq!(
            device.display_label(),
            "BlueBuzzah (/dev/cu.usbmodem5678)"
        );
    }

    #[test]
    fn test_device_identifier_from_device_with_serial() {
        let device = Nrf52Device {
            port: "/dev/cu.usbmodem1234".to_string(),
            vid: ADAFRUIT_VID,
            pid: 0x8029,
            serial_number: Some("ABC123".to_string()),
            in_bootloader: false,
            product_name: None,
            manufacturer: None,
        };

        let identifier = DeviceIdentifier::from_device(&device);
        assert!(identifier.has_serial());
        assert!(matches!(identifier, DeviceIdentifier::Serial(s) if s == "ABC123"));
    }

    #[test]
    fn test_device_identifier_from_device_without_serial() {
        let device = Nrf52Device {
            port: "/dev/cu.usbmodem14201".to_string(),
            vid: ADAFRUIT_VID,
            pid: 0x8029,
            serial_number: None,
            in_bootloader: false,
            product_name: None,
            manufacturer: None,
        };

        let identifier = DeviceIdentifier::from_device(&device);
        assert!(!identifier.has_serial());
        assert!(matches!(
            identifier,
            DeviceIdentifier::VidPidPort { vid, pid, port_pattern }
                if vid == ADAFRUIT_VID && pid == 0x8029 && port_pattern == "usbmodem142"
        ));
    }

    #[test]
    fn test_device_identifier_matches_serial() {
        let identifier = DeviceIdentifier::Serial("ABC123".to_string());

        let device_match = Nrf52Device {
            port: "/dev/cu.usbmodem9999".to_string(),
            vid: ADAFRUIT_VID,
            pid: 0x0029, // Different PID (bootloader mode)
            serial_number: Some("ABC123".to_string()),
            in_bootloader: true,
            product_name: None,
            manufacturer: None,
        };

        let device_no_match = Nrf52Device {
            port: "/dev/cu.usbmodem9999".to_string(),
            vid: ADAFRUIT_VID,
            pid: 0x0029,
            serial_number: Some("XYZ789".to_string()),
            in_bootloader: true,
            product_name: None,
            manufacturer: None,
        };

        assert!(identifier.matches(&device_match));
        assert!(!identifier.matches(&device_no_match));
    }

    #[test]
    fn test_device_identifier_matches_vid_pid_port() {
        let identifier = DeviceIdentifier::VidPidPort {
            vid: ADAFRUIT_VID,
            pid: 0x8029, // Application mode
            port_pattern: "usbmodem142".to_string(),
        };

        // Same device in bootloader mode (PID 0x0029 instead of 0x8029)
        let device_bootloader = Nrf52Device {
            port: "/dev/cu.usbmodem14203".to_string(), // Slightly different port
            vid: ADAFRUIT_VID,
            pid: 0x0029, // Bootloader mode
            serial_number: None,
            in_bootloader: true,
            product_name: None,
            manufacturer: None,
        };

        // Different device (different port pattern)
        let device_different = Nrf52Device {
            port: "/dev/cu.usbmodem99901".to_string(),
            vid: ADAFRUIT_VID,
            pid: 0x0029,
            serial_number: None,
            in_bootloader: true,
            product_name: None,
            manufacturer: None,
        };

        assert!(identifier.matches(&device_bootloader));
        assert!(!identifier.matches(&device_different));
    }

    #[test]
    fn test_extract_port_pattern_macos() {
        assert_eq!(
            extract_port_pattern("/dev/cu.usbmodem14201"),
            "usbmodem142"
        );
        assert_eq!(
            extract_port_pattern("/dev/cu.usbmodem99901"),
            "usbmodem999"
        );
    }

    #[test]
    fn test_extract_port_pattern_windows() {
        assert_eq!(extract_port_pattern("COM3"), "COM3");
        assert_eq!(extract_port_pattern("COM15"), "COM15");
    }

    #[test]
    fn test_extract_port_pattern_linux() {
        assert_eq!(extract_port_pattern("/dev/ttyACM0"), "ttyACM0");
        assert_eq!(extract_port_pattern("/dev/ttyUSB1"), "ttyUSB1");
    }

    #[test]
    fn test_is_same_device_family() {
        // Application mode 0x8029 and bootloader mode 0x0029 are same family
        assert!(is_same_device_family(0x8029, 0x0029));
        assert!(is_same_device_family(0x802A, 0x002A));

        // Different device variants
        assert!(!is_same_device_family(0x8029, 0x002A));
        assert!(!is_same_device_family(0x8029, 0x0052));
    }
}
