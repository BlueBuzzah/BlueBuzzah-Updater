//! Nordic DFU (Device Firmware Update) module for nRF52 devices.
//!
//! This module provides a complete Rust implementation of the Nordic DFU
//! protocol over serial, enabling firmware updates for Adafruit Feather
//! nRF52840 devices.
//!
//! # Protocol Overview
//!
//! The DFU process consists of:
//! 1. **Device Detection** - Find nRF52 devices by USB VID/PID
//! 2. **Bootloader Entry** - Trigger bootloader via 1200 baud touch
//! 3. **Init Transfer** - Send firmware.dat (init packet)
//! 4. **Firmware Transfer** - Send firmware.bin in chunks
//! 5. **Validation** - Device validates the firmware CRC
//! 6. **Activation** - Device applies and boots new firmware
//! 7. **Configuration** - Send role configuration command
//!
//! # Example
//!
//! ```ignore
//! use dfu::{device, protocol, DfuStage};
//!
//! // Find connected devices
//! let devices = device::find_nrf52_devices();
//! if let Some(device) = devices.first() {
//!     // Upload firmware with progress callback
//!     protocol::upload_firmware(
//!         &device.port,
//!         "firmware.zip",
//!         "PRIMARY",
//!         |stage| println!("{}: {:.0}%", stage.message(), stage.percent()),
//!     )?;
//! }
//! ```

mod config;
mod device;
mod error;
mod firmware_reader;
mod menu;
mod packet;
mod protocol;
mod slip;
mod transport;

// Re-export public types and functions
// Only exports what's actually used by the Tauri commands

// Device detection and tracking
pub use device::{find_nrf52_devices, find_supported_devices, Nrf52Device};

// Flexible device tracking through mode changes / reboots — used by both the
// Nordic DFU path and the v3 (ESP32-S3) flasher.
pub(crate) use device::wait_for_application_flexible;

// Device identifier (for flexible tracking through reboots)
pub mod device_pub {
    pub use super::device::DeviceIdentifier;
}
pub use device_pub::*;

// Reboot timing helpers — shared with the v3 (ESP32-S3) flasher.
pub(crate) use config::{get_reboot_settle_delay, get_reboot_timeout};

// Protocol
pub use protocol::{configure_device_with_settings, upload_firmware, DfuStage};
pub(crate) use protocol::configure_device_role_flexible;
pub(crate) use protocol::configure_custom_profile;

// Error types — re-exported for use in tests outside this module and by the
// command boundary (missing-parameters branch of set_device_profile).
pub(crate) use error::DfuError;

// Firmware reading
pub use firmware_reader::read_firmware_zip;

// Firmware menu protocol — used by the Custom therapy profile flow.
pub(crate) use menu::{read_custom_profile_from, CustomProfileRead, ProfileConfigOutcome};

// Serial transport — the Tauri command boundary opens ports directly for the
// Custom profile prefill read.
pub(crate) use transport::{DfuTransport, SerialTransport};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_module_exports() {
        // Verify key types are accessible
        let _ = std::any::type_name::<Nrf52Device>();
        let _ = std::any::type_name::<DfuStage>();
    }
}
