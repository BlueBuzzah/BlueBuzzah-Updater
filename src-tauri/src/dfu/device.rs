//! Device detection for nRF52 devices.
//!
//! Detects Adafruit Feather nRF52840 devices by USB VID/PID.

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
/// # Arguments
/// * `serial` - Device serial number to match
/// * `timeout_ms` - Maximum time to wait in milliseconds
///
/// # Returns
/// The detected bootloader device, or an error if timeout expires
pub fn wait_for_bootloader_by_serial(serial: &str, timeout_ms: u64) -> DfuResult<Nrf52Device> {
    let timeout = Duration::from_millis(timeout_ms);
    let start = Instant::now();

    while start.elapsed() < timeout {
        if let Some(device) = find_nrf52_devices()
            .into_iter()
            .find(|d| d.in_bootloader && d.serial_number.as_deref() == Some(serial))
        {
            return Ok(device);
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
    let timeout = Duration::from_millis(timeout_ms);
    let start = Instant::now();

    while start.elapsed() < timeout {
        if let Some(device) = find_nrf52_devices()
            .into_iter()
            .find(|d| !d.in_bootloader && d.serial_number.as_deref() == Some(serial))
        {
            return Ok(device);
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
}
