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
mod packet;
mod protocol;
mod slip;
mod transport;

// Re-export public types and functions
// Only exports what's actually used by the Tauri commands

// Device detection
pub use device::{find_nrf52_devices, Nrf52Device};

// Protocol
pub use protocol::{upload_firmware, DfuStage};

// Firmware reading
pub use firmware_reader::read_firmware_zip;

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
