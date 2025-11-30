//! DFU error types for the Nordic DFU protocol implementation.

// Allow unused variants/methods - these are part of the error API surface
// and may be used for better error handling in the future.
#![allow(dead_code)]

use thiserror::Error;

/// Result type alias for DFU operations.
pub type DfuResult<T> = Result<T, DfuError>;

/// Errors that can occur during DFU operations.
#[derive(Debug, Error)]
pub enum DfuError {
    /// Serial port error from the serialport crate.
    #[error("Serial port error: {0}")]
    Serial(#[from] serialport::Error),

    /// Standard I/O error.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// ZIP archive error.
    #[error("ZIP error: {0}")]
    Zip(#[from] zip::result::ZipError),

    /// JSON parsing error for manifest.json.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    /// Invalid SLIP escape sequence encountered during decoding.
    #[error("Invalid SLIP escape sequence")]
    InvalidSlipEscape,

    /// SLIP frame is incomplete (no END delimiter found).
    #[error("Incomplete SLIP frame")]
    IncompleteSlipFrame,

    /// CRC checksum mismatch in received packet.
    #[error("CRC mismatch: expected 0x{expected:04X}, got 0x{actual:04X}")]
    CrcMismatch { expected: u16, actual: u16 },

    /// Timeout waiting for ACK from device.
    #[error("Timeout waiting for ACK")]
    Timeout,

    /// Bootloader mode not detected within timeout period.
    #[error("Bootloader not found within {timeout_ms}ms")]
    BootloaderTimeout { timeout_ms: u64 },

    /// Maximum retry attempts exceeded.
    #[error("Max retries exceeded for {operation}")]
    MaxRetriesExceeded { operation: String },

    /// DFU protocol returned an error response.
    #[error("DFU response error: code {code} - {message}")]
    DfuResponse { code: u8, message: String },

    /// Required file missing from firmware.zip.
    #[error("Missing file in firmware.zip: {filename}")]
    MissingFile { filename: String },

    /// Invalid or malformed manifest.json.
    #[error("Invalid manifest: {reason}")]
    InvalidManifest { reason: String },

    /// No compatible nRF52 device found.
    #[error("No compatible device found")]
    NoDeviceFound,

    /// Device was disconnected during operation.
    #[error("Device disconnected during {operation}")]
    DeviceDisconnected { operation: String },

    /// Serial port is busy (in use by another process).
    #[error("Port '{port}' is busy or in use by another application")]
    PortBusy { port: String },

    /// Permission denied accessing serial port.
    #[error("Permission denied for port '{port}'")]
    PortPermissionDenied { port: String },

    /// Sequence number mismatch in ACK response.
    #[error("Sequence mismatch: expected {expected}, got {actual}")]
    SequenceMismatch { expected: u8, actual: u8 },

    /// Packet size exceeds maximum allowed.
    #[error("Packet size {size} exceeds maximum {max_size}")]
    PacketTooLarge { size: usize, max_size: usize },

    /// Role configuration failed.
    #[error("Failed to configure device role: {reason}")]
    RoleConfigFailed { reason: String },

    /// Device has no serial number (required for tracking through mode changes).
    #[error("Device has no serial number - cannot track through mode changes")]
    NoSerialNumber,

    /// Operation was cancelled by user.
    #[error("Operation cancelled by user")]
    Cancelled,
}

impl DfuError {
    /// Check if this error is retriable (transient errors that may succeed on retry).
    pub fn is_retriable(&self) -> bool {
        matches!(
            self,
            DfuError::Timeout
                | DfuError::CrcMismatch { .. }
                | DfuError::SequenceMismatch { .. }
        )
    }

    /// Get a user-friendly error code for support purposes.
    pub fn error_code(&self) -> &'static str {
        match self {
            DfuError::Serial(_) => "DFU-001",
            DfuError::Io(_) => "DFU-002",
            DfuError::Zip(_) => "DFU-003",
            DfuError::Json(_) => "DFU-004",
            DfuError::InvalidSlipEscape => "DFU-010",
            DfuError::IncompleteSlipFrame => "DFU-011",
            DfuError::CrcMismatch { .. } => "DFU-020",
            DfuError::Timeout => "DFU-021",
            DfuError::BootloaderTimeout { .. } => "DFU-022",
            DfuError::MaxRetriesExceeded { .. } => "DFU-023",
            DfuError::DfuResponse { .. } => "DFU-030",
            DfuError::MissingFile { .. } => "DFU-040",
            DfuError::InvalidManifest { .. } => "DFU-041",
            DfuError::NoDeviceFound => "DFU-050",
            DfuError::DeviceDisconnected { .. } => "DFU-051",
            DfuError::PortBusy { .. } => "DFU-052",
            DfuError::PortPermissionDenied { .. } => "DFU-053",
            DfuError::SequenceMismatch { .. } => "DFU-060",
            DfuError::PacketTooLarge { .. } => "DFU-061",
            DfuError::RoleConfigFailed { .. } => "DFU-070",
            DfuError::NoSerialNumber => "DFU-054",
            DfuError::Cancelled => "DFU-099",
        }
    }
}

// Note: DFU response status codes are defined in config.rs as DfuResponseStatus

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_is_retriable() {
        assert!(DfuError::Timeout.is_retriable());
        assert!(DfuError::CrcMismatch {
            expected: 0x1234,
            actual: 0x5678
        }
        .is_retriable());
        assert!(!DfuError::NoDeviceFound.is_retriable());
        assert!(!DfuError::PortBusy {
            port: "COM3".into()
        }
        .is_retriable());
    }

    #[test]
    fn test_error_codes() {
        assert_eq!(DfuError::Timeout.error_code(), "DFU-021");
        assert_eq!(DfuError::NoDeviceFound.error_code(), "DFU-050");
    }
}
