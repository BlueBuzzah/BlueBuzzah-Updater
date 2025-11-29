//! Configuration constants for the Nordic DFU protocol.

// Allow unused items - these are part of the protocol spec and may be used for
// future features like PRN support, retry logic, etc.
#![allow(dead_code)]

use std::time::Duration;

// ============================================================================
// USB Device Identifiers
// ============================================================================

/// Adafruit USB Vendor ID.
pub const ADAFRUIT_VID: u16 = 0x239A;

/// Product IDs for Feather nRF52840 in application mode.
pub const FEATHER_APP_PIDS: &[u16] = &[
    0x8029, // Feather nRF52840 Express (application mode)
    0x802A, // Feather nRF52840 Sense (application mode)
];

/// Product IDs for Feather nRF52840 in bootloader mode.
pub const FEATHER_BOOTLOADER_PIDS: &[u16] = &[
    0x0029, // Feather nRF52840 Express (bootloader mode)
    0x002A, // Feather nRF52840 Sense (bootloader mode)
];

// ============================================================================
// Serial Communication
// ============================================================================

/// Baud rate for DFU communication with bootloader.
pub const DFU_BAUD_RATE: u32 = 115_200;

/// Serial read timeout for individual read operations.
/// Matches nrfutil's 1.0 second timeout.
pub const SERIAL_READ_TIMEOUT: Duration = Duration::from_millis(1000);

/// Serial write timeout for individual write operations.
/// Matches nrfutil's 1.0 second timeout.
pub const SERIAL_WRITE_TIMEOUT: Duration = Duration::from_millis(1000);

// ============================================================================
// DFU Protocol Timeouts
// ============================================================================

/// Timeout waiting for ACK after sending a packet.
pub const ACK_TIMEOUT_MS: u64 = 1000;

/// Timeout waiting for bootloader to appear after 1200 baud touch.
pub const BOOTLOADER_TIMEOUT_MS: u64 = 10_000;

/// Interval between port scans when waiting for bootloader.
pub const PORT_SCAN_INTERVAL: Duration = Duration::from_millis(500);

/// Timeout waiting for device to reboot into application mode.
pub const REBOOT_TIMEOUT_MS: u64 = 10_000;

/// Timeout for role configuration command.
pub const ROLE_CONFIG_TIMEOUT_MS: u64 = 5000;

// ============================================================================
// Retry Configuration
// ============================================================================

/// Maximum number of retries for packet transmission.
pub const MAX_PACKET_RETRIES: u8 = 3;

// ============================================================================
// DFU Packet Configuration
// ============================================================================

/// Maximum payload size for DFU data packets (per Nordic DFU spec).
pub const MAX_PACKET_SIZE: usize = 512;

/// Maximum sequence number (0-7, wraps around).
pub const SEQUENCE_NUMBER_MAX: u8 = 7;

/// Delay between packets to avoid buffer overflow.
pub const INTER_PACKET_DELAY: Duration = Duration::from_millis(5);

// ============================================================================
// SLIP Protocol Constants
// ============================================================================

/// SLIP frame delimiter (END byte).
pub const SLIP_END: u8 = 0xC0;

/// SLIP escape byte.
pub const SLIP_ESC: u8 = 0xDB;

/// SLIP escaped END (0xC0 encoded as 0xDB 0xDC).
pub const SLIP_ESC_END: u8 = 0xDC;

/// SLIP escaped ESC (0xDB encoded as 0xDB 0xDD).
pub const SLIP_ESC_ESC: u8 = 0xDD;

// ============================================================================
// HCI Packet Constants (Adafruit nrfutil protocol)
// ============================================================================

/// Bit position for data integrity check flag in header byte 0.
pub const HCI_DATA_INTEGRITY_CHECK_BIT: u8 = 6;

/// Bit position for reliable packet flag in header byte 0.
pub const HCI_RELIABLE_PACKET_BIT: u8 = 7;

/// HCI packet type for DFU data packets (goes in byte 1, bits 0-3).
pub const HCI_PACKET_TYPE_DFU: u8 = 14;

// ============================================================================
// DFU Opcodes (Legacy DFU Protocol v0.5 - used by Adafruit bootloader)
// ============================================================================

/// Legacy DFU operation opcodes.
///
/// These are single-byte opcodes sent directly (no 4-byte framing).
/// The Adafruit nRF52 bootloader uses the legacy serial DFU protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum DfuOpcode {
    /// Start DFU with image type and sizes
    StartDfu = 0x01,
    /// Initialize DFU parameters (send init packet data)
    InitDfuParams = 0x02,
    /// Receive firmware image (data chunks)
    ReceiveFirmwareImage = 0x03,
    /// Validate the received firmware
    ValidateFirmware = 0x04,
    /// Activate firmware and reset device
    ActivateAndReset = 0x05,
    /// System reset
    SystemReset = 0x06,
    /// Report received image size (diagnostic)
    ReportReceivedImageSize = 0x07,
    /// Request packet receipt notification interval
    PacketReceiptNotificationRequest = 0x08,
    /// Response from bootloader
    Response = 0x10,
    /// Packet receipt notification from bootloader
    PacketReceiptNotification = 0x11,
}

/// DFU image type (what firmware component is being updated).
///
/// Sent as a single byte in the StartDfu command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum DfuImageType {
    None = 0x00,
    SoftDevice = 0x01,
    Bootloader = 0x02,
    SoftDeviceBootloader = 0x03,
    Application = 0x04,
}

/// DFU response status codes from the bootloader.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum DfuResponseStatus {
    Success = 0x01,
    InvalidState = 0x02,
    NotSupported = 0x03,
    DataSizeExceedsLimit = 0x04,
    CrcError = 0x05,
    OperationFailed = 0x06,
}

impl DfuResponseStatus {
    /// Parse a status code from a byte value.
    pub fn from_byte(byte: u8) -> Option<Self> {
        match byte {
            0x01 => Some(DfuResponseStatus::Success),
            0x02 => Some(DfuResponseStatus::InvalidState),
            0x03 => Some(DfuResponseStatus::NotSupported),
            0x04 => Some(DfuResponseStatus::DataSizeExceedsLimit),
            0x05 => Some(DfuResponseStatus::CrcError),
            0x06 => Some(DfuResponseStatus::OperationFailed),
            _ => None,
        }
    }

    /// Get a human-readable description.
    pub fn description(&self) -> &'static str {
        match self {
            DfuResponseStatus::Success => "Operation successful",
            DfuResponseStatus::InvalidState => "Invalid state for this operation",
            DfuResponseStatus::NotSupported => "Operation not supported",
            DfuResponseStatus::DataSizeExceedsLimit => "Data size exceeds limit",
            DfuResponseStatus::CrcError => "CRC validation failed",
            DfuResponseStatus::OperationFailed => "Operation failed",
        }
    }
}

// ============================================================================
// Flash Timing Constants (for erase/write wait times)
// ============================================================================

/// Flash page size in bytes.
pub const FLASH_PAGE_SIZE: usize = 4096;

/// Time to erase one flash page (worst case for nRF52840: ~85ms).
pub const FLASH_PAGE_ERASE_TIME_MS: u64 = 90;

/// Time to write one flash page (~45ms per nrfutil).
pub const FLASH_PAGE_WRITE_TIME_MS: u64 = 45;

/// Number of data frames before flash write delay (8 frames = 4096 bytes = 1 page).
pub const FRAMES_PER_FLASH_PAGE: usize = 8;

/// Calculate wait time after START packet for flash erase.
///
/// Returns duration in milliseconds.
pub fn calculate_erase_wait_time(firmware_size: usize) -> u64 {
    let pages = (firmware_size / FLASH_PAGE_SIZE) + 1;
    let wait_ms = (pages as u64) * FLASH_PAGE_ERASE_TIME_MS;
    // Minimum 500ms wait
    std::cmp::max(500, wait_ms)
}

// ============================================================================
// Role Configuration
// ============================================================================

/// Role configuration command for PRIMARY devices.
pub const ROLE_PRIMARY_COMMAND: &str = "SET_ROLE:PRIMARY\n";

/// Role configuration command for SECONDARY devices.
pub const ROLE_SECONDARY_COMMAND: &str = "SET_ROLE:SECONDARY\n";

// ============================================================================
// Helper Functions
// ============================================================================

/// Check if a PID corresponds to a device in bootloader mode.
///
/// Adafruit uses a consistent PID pattern:
/// - Application mode: 0x80XX (high byte = 0x80)
/// - Bootloader mode: 0x00XX (high byte = 0x00)
///
/// This is more robust than maintaining a list of bootloader PIDs.
pub fn is_bootloader_pid(pid: u16) -> bool {
    // Bootloader PIDs have high byte 0x00 (not 0x80)
    // Also check against known list for safety
    (pid & 0xFF00) == 0x0000 || FEATHER_BOOTLOADER_PIDS.contains(&pid)
}

/// Check if a PID corresponds to a device in application mode.
///
/// Adafruit uses a consistent PID pattern:
/// - Application mode: 0x80XX (high byte = 0x80)
/// - Bootloader mode: 0x00XX (high byte = 0x00)
pub fn is_application_pid(pid: u16) -> bool {
    // Application PIDs have high byte 0x80
    // Also check against known list for safety
    (pid & 0xFF00) == 0x8000 || FEATHER_APP_PIDS.contains(&pid)
}

/// Check if a VID/PID combination is a compatible nRF52 device.
pub fn is_compatible_device(vid: u16, pid: u16) -> bool {
    vid == ADAFRUIT_VID && (is_bootloader_pid(pid) || is_application_pid(pid))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_bootloader_pid() {
        // Known bootloader PIDs
        assert!(is_bootloader_pid(0x0029)); // Feather Express
        assert!(is_bootloader_pid(0x002A)); // Feather Sense
        // Any 0x00XX PID should be detected as bootloader (pattern-based)
        assert!(is_bootloader_pid(0x0052)); // ItsyBitsy
        assert!(is_bootloader_pid(0x0045)); // Circuit Playground
        assert!(is_bootloader_pid(0x0071)); // Clue
        // Application PIDs should NOT match
        assert!(!is_bootloader_pid(0x8029));
        assert!(!is_bootloader_pid(0x802A));
        // Random PIDs should NOT match
        assert!(!is_bootloader_pid(0x1234));
    }

    #[test]
    fn test_is_application_pid() {
        // Known application PIDs
        assert!(is_application_pid(0x8029)); // Feather Express
        assert!(is_application_pid(0x802A)); // Feather Sense
        // Any 0x80XX PID should be detected as application (pattern-based)
        assert!(is_application_pid(0x805A)); // ItsyBitsy
        assert!(is_application_pid(0x8045)); // Circuit Playground
        assert!(is_application_pid(0x8071)); // Clue
        // Bootloader PIDs should NOT match
        assert!(!is_application_pid(0x0029));
        assert!(!is_application_pid(0x002A));
    }

    #[test]
    fn test_is_compatible_device() {
        assert!(is_compatible_device(ADAFRUIT_VID, 0x8029));
        assert!(is_compatible_device(ADAFRUIT_VID, 0x0029));
        assert!(!is_compatible_device(0x1234, 0x8029));
        assert!(!is_compatible_device(ADAFRUIT_VID, 0x1234));
    }
}
