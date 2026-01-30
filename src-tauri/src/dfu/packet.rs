//! HCI-based DFU packet encoding for Nordic/Adafruit bootloader.
//!
//! Implements the DFU Serial Transport protocol used by adafruit-nrfutil.
//! Each DFU command is wrapped in an HCI packet with header, CRC16, and SLIP encoding.

// Allow unused items - PRN support and other protocol features may be used later
#![allow(dead_code)]

use std::sync::atomic::{AtomicU8, Ordering};

use super::config::{SLIP_END, SLIP_ESC, SLIP_ESC_END, SLIP_ESC_ESC};
use super::error::{DfuError, DfuResult};

/// Default chunk size for firmware data (BLE-compatible).
pub const FIRMWARE_CHUNK_SIZE: usize = 512;

/// Maximum allowed SLIP frame size (2x max valid frame: 4+512+2 = 518 bytes).
/// Prevents OOM from malformed or corrupted data streams.
pub const MAX_SLIP_FRAME_SIZE: usize = 1536;

/// HCI packet type for DFU commands.
const HCI_PACKET_TYPE: u8 = 14;

/// Data integrity check present flag.
const DATA_INTEGRITY_CHECK_PRESENT: u8 = 1;

/// Reliable packet flag (requires ACK).
const RELIABLE_PACKET: u8 = 1;

// ============================================================================
// DFU Command Opcodes (as 4-byte integers, per nrfutil)
// ============================================================================

/// Start DFU packet command.
pub const DFU_START_PACKET: u32 = 3;

/// Init DFU packet command.
pub const DFU_INIT_PACKET: u32 = 1;

/// Stop data packet (end of firmware transfer).
pub const DFU_STOP_DATA_PACKET: u32 = 5;

/// Firmware data packet command.
pub const DFU_DATA_PACKET: u32 = 4;

// DFU Image Types (as program modes)
/// Application firmware image.
pub const IMAGE_TYPE_APPLICATION: u32 = 4;

/// SoftDevice image.
pub const IMAGE_TYPE_SOFTDEVICE: u32 = 1;

/// Bootloader image.
pub const IMAGE_TYPE_BOOTLOADER: u32 = 2;

/// Combined SoftDevice + Bootloader image.
pub const IMAGE_TYPE_SD_BL: u32 = 3;

// ============================================================================
// Sequence Number Management
// ============================================================================

/// Global sequence number for HCI packets (0-7, wraps around).
static SEQUENCE_NUMBER: AtomicU8 = AtomicU8::new(0);

/// Get the next sequence number (1-7, wrapping).
///
/// Sequences start at 1, not 0. The bootloader expects the first packet
/// to have sequence number 1.
fn next_sequence_number() -> u8 {
    // Pre-increment: return (current + 1), then store the incremented value.
    // Use wrapping_add to handle overflow when counter exceeds u8::MAX.
    SEQUENCE_NUMBER.fetch_add(1, Ordering::SeqCst).wrapping_add(1) & 0x07
}

/// Reset the sequence number to 0 (for starting a new DFU session).
pub fn reset_sequence_number() {
    SEQUENCE_NUMBER.store(0, Ordering::SeqCst);
}

// ============================================================================
// CRC16 Calculation (Nordic's custom algorithm)
// ============================================================================

/// Calculate CRC16 using Nordic's custom algorithm.
///
/// This matches the Python implementation in nordicsemi/dfu/crc16.py
pub fn calc_crc16(data: &[u8], initial: u16) -> u16 {
    let mut crc = initial;

    for &byte in data {
        // XOR byte into low byte of CRC
        crc = (crc >> 8) | ((crc & 0xFF) << 8);
        crc ^= byte as u16;
        crc ^= (crc & 0xFF) >> 4;
        crc ^= (crc << 8) << 4;
        crc ^= ((crc & 0xFF) << 4) << 1;
    }

    crc
}

// ============================================================================
// SLIP Encoding (with escape characters)
// ============================================================================

/// SLIP encode data with escape character handling.
///
/// Unlike the simple SLIP encode, this matches nrfutil's slip_encode_esc_chars().
fn slip_encode_esc_chars(data: &[u8]) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(data.len() * 2);

    for &byte in data {
        match byte {
            SLIP_END => {
                encoded.push(SLIP_ESC);
                encoded.push(SLIP_ESC_END);
            }
            SLIP_ESC => {
                encoded.push(SLIP_ESC);
                encoded.push(SLIP_ESC_ESC);
            }
            _ => encoded.push(byte),
        }
    }

    encoded
}

// ============================================================================
// HCI Packet Builder
// ============================================================================

/// Build an HCI packet header.
///
/// Format (4 bytes):
/// - Byte 0: seq(3) | next_seq(3) | data_integrity(1) | reliable(1)
/// - Byte 1: pkt_type(4) | len_low(4)
/// - Byte 2: len_high(8)
/// - Byte 3: header_checksum
fn build_hci_header(seq: u8, payload_len: usize) -> [u8; 4] {
    let next_seq = (seq + 1) & 0x07;
    let len = payload_len as u16;

    // Byte 0: seq | (next_seq << 3) | (data_integrity << 6) | (reliable << 7)
    let byte0 = seq
        | (next_seq << 3)
        | (DATA_INTEGRITY_CHECK_PRESENT << 6)
        | (RELIABLE_PACKET << 7);

    // Byte 1: packet_type | ((len & 0x0F) << 4)
    let byte1 = HCI_PACKET_TYPE | (((len & 0x000F) as u8) << 4);

    // Byte 2: (len >> 4) & 0xFF
    let byte2 = ((len & 0x0FF0) >> 4) as u8;

    // Byte 3: header checksum (two's complement of sum of bytes 0-2)
    let sum = (byte0 as u16 + byte1 as u16 + byte2 as u16) & 0xFF;
    let byte3 = ((!sum).wrapping_add(1) & 0xFF) as u8;

    [byte0, byte1, byte2, byte3]
}

/// Build a complete HCI-framed DFU packet.
///
/// Structure: [0xC0] + SLIP_ENCODE(header + payload + crc16_le) + [0xC0]
pub fn build_hci_packet(payload: &[u8]) -> Vec<u8> {
    let seq = next_sequence_number();
    let header = build_hci_header(seq, payload.len());

    // Combine header and payload for CRC calculation
    let mut data = Vec::with_capacity(4 + payload.len());
    data.extend_from_slice(&header);
    data.extend_from_slice(payload);

    // Calculate CRC16 over header + payload
    let crc = calc_crc16(&data, 0xFFFF);

    // Add CRC as little-endian bytes
    data.push((crc & 0xFF) as u8);
    data.push((crc >> 8) as u8);

    // SLIP encode the complete packet
    let encoded = slip_encode_esc_chars(&data);

    // Build final packet with SLIP delimiters
    let mut packet = Vec::with_capacity(encoded.len() + 2);
    packet.push(SLIP_END);
    packet.extend_from_slice(&encoded);
    packet.push(SLIP_END);

    packet
}

// ============================================================================
// DFU Command Builders
// ============================================================================

/// Build image size data for StartDfu command.
fn build_image_size_packet(softdevice_size: u32, bootloader_size: u32, app_size: u32) -> Vec<u8> {
    let mut data = Vec::with_capacity(12);
    data.extend_from_slice(&softdevice_size.to_le_bytes());
    data.extend_from_slice(&bootloader_size.to_le_bytes());
    data.extend_from_slice(&app_size.to_le_bytes());
    data
}

/// Build a StartDfu packet.
///
/// Payload: [DFU_START_PACKET(4), image_type(4), sd_size(4), bl_size(4), app_size(4)]
pub fn build_start_dfu_packet(
    image_type: u32,
    softdevice_size: u32,
    bootloader_size: u32,
    app_size: u32,
) -> Vec<u8> {
    let mut payload = Vec::with_capacity(20);
    payload.extend_from_slice(&DFU_START_PACKET.to_le_bytes());
    payload.extend_from_slice(&image_type.to_le_bytes());
    payload.extend_from_slice(&build_image_size_packet(
        softdevice_size,
        bootloader_size,
        app_size,
    ));

    build_hci_packet(&payload)
}

/// Build an InitDfuParams packet.
///
/// Payload: [DFU_INIT_PACKET(4), init_data..., 0x0000(2)]
///
/// Note: Unlike Legacy protocol, HCI sends init data in a single packet.
/// The 2-byte 0x0000 padding at the end is required by the bootloader.
pub fn build_init_packet(init_data: &[u8]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(4 + init_data.len() + 2);
    payload.extend_from_slice(&DFU_INIT_PACKET.to_le_bytes());
    payload.extend_from_slice(init_data);
    // Add 2-byte padding as per nrfutil (int16_to_bytes(0x0000))
    payload.extend_from_slice(&[0x00, 0x00]);

    build_hci_packet(&payload)
}

/// Build a firmware data packet.
///
/// Payload: [DFU_DATA_PACKET(4), chunk...]
pub fn build_firmware_data_packet(chunk: &[u8]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(4 + chunk.len());
    payload.extend_from_slice(&DFU_DATA_PACKET.to_le_bytes());
    payload.extend_from_slice(chunk);

    build_hci_packet(&payload)
}

/// Build a StopDataPacket (end of firmware transfer).
///
/// Payload: [DFU_STOP_DATA_PACKET(4)]
pub fn build_stop_data_packet() -> Vec<u8> {
    let payload = DFU_STOP_DATA_PACKET.to_le_bytes();
    build_hci_packet(&payload)
}

// ============================================================================
// Response Parsing
// ============================================================================

/// An ACK response from the DFU bootloader.
///
/// HCI ACK format: header byte contains ack_number in bits 3-5
#[derive(Debug, Clone)]
pub struct HciAck {
    /// The sequence number being acknowledged.
    pub ack_number: u8,
}

impl HciAck {
    /// Parse an ACK from decoded HCI packet bytes.
    ///
    /// The ACK is a minimal packet with just a header.
    pub fn parse(data: &[u8]) -> DfuResult<Self> {
        if data.is_empty() {
            return Err(DfuError::IncompleteSlipFrame);
        }

        // ACK number is in bits 3-5 of byte 0
        let ack_number = (data[0] >> 3) & 0x07;

        Ok(Self { ack_number })
    }
}

/// A DFU response from the bootloader.
///
/// Response payload format varies by operation type.
#[derive(Debug, Clone)]
pub struct DfuResponse {
    /// The operation this response is for.
    pub operation: u32,
    /// The status/result code.
    pub status: u32,
}

impl DfuResponse {
    /// Parse a DFU response from decoded payload bytes.
    pub fn parse(data: &[u8]) -> DfuResult<Self> {
        if data.len() < 8 {
            return Err(DfuError::IncompleteSlipFrame);
        }

        let operation = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
        let status = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);

        Ok(Self { operation, status })
    }

    /// Check if the response indicates success.
    pub fn is_success(&self) -> bool {
        self.status == 1 // SUCCESS in nrfutil
    }

    /// Get an error message if not successful.
    pub fn error_message(&self) -> Option<String> {
        if self.is_success() {
            None
        } else {
            Some(format!(
                "DFU operation {} failed with status {}",
                self.operation, self.status
            ))
        }
    }
}

// ============================================================================
// SLIP Decoder for incoming packets
// ============================================================================

/// Streaming SLIP decoder for HCI packets.
#[derive(Debug, Default)]
pub struct HciSlipDecoder {
    buffer: Vec<u8>,
    escape_next: bool,
    in_frame: bool,
}

impl HciSlipDecoder {
    /// Create a new SLIP decoder.
    pub fn new() -> Self {
        Self {
            buffer: Vec::with_capacity(1024),
            escape_next: false,
            in_frame: false,
        }
    }

    /// Feed a byte to the decoder.
    ///
    /// Returns Some(data) when a complete frame is received.
    pub fn feed(&mut self, byte: u8) -> Option<DfuResult<Vec<u8>>> {
        if byte == SLIP_END {
            if self.in_frame && !self.buffer.is_empty() {
                let frame = std::mem::take(&mut self.buffer);
                self.in_frame = false;
                self.escape_next = false;
                return Some(Ok(frame));
            } else {
                self.buffer.clear();
                self.in_frame = true;
                self.escape_next = false;
                return None;
            }
        }

        if !self.in_frame {
            self.in_frame = true;
        }

        // Check buffer overflow before adding any byte
        if self.buffer.len() >= MAX_SLIP_FRAME_SIZE {
            let size = self.buffer.len();
            self.reset();
            return Some(Err(DfuError::SlipBufferOverflow {
                size,
                max_size: MAX_SLIP_FRAME_SIZE,
            }));
        }

        if self.escape_next {
            match byte {
                SLIP_ESC_END => self.buffer.push(SLIP_END),
                SLIP_ESC_ESC => self.buffer.push(SLIP_ESC),
                _ => {
                    self.reset();
                    return Some(Err(DfuError::InvalidSlipEscape));
                }
            }
            self.escape_next = false;
        } else if byte == SLIP_ESC {
            self.escape_next = true;
        } else {
            self.buffer.push(byte);
        }

        None
    }

    /// Reset the decoder state.
    pub fn reset(&mut self) {
        self.buffer.clear();
        self.escape_next = false;
        self.in_frame = false;
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calc_crc16() {
        // Test with known values from nrfutil
        let data = [0x01, 0x02, 0x03, 0x04];
        let crc = calc_crc16(&data, 0xFFFF);
        // The actual CRC value depends on Nordic's algorithm
        assert!(crc != 0); // Just verify it produces a non-zero result
    }

    #[test]
    fn test_build_hci_header() {
        let header = build_hci_header(0, 16);

        // Byte 0: seq=0, next_seq=1, data_integrity=1, reliable=1
        // = 0 | (1 << 3) | (1 << 6) | (1 << 7) = 0 | 8 | 64 | 128 = 200 = 0xC8
        assert_eq!(header[0], 0xC8);

        // Byte 1: pkt_type=14, len_low=0 (16 & 0xF = 0)
        // = 14 | (0 << 4) = 14 = 0x0E
        assert_eq!(header[1], 0x0E);

        // Byte 2: len_high = (16 >> 4) = 1
        assert_eq!(header[2], 0x01);

        // Byte 3: checksum = two's complement of (0xC8 + 0x0E + 0x01)
        let sum = 0xC8u16 + 0x0Eu16 + 0x01u16;
        let expected_checksum = ((!sum).wrapping_add(1) & 0xFF) as u8;
        assert_eq!(header[3], expected_checksum);
    }

    #[test]
    fn test_build_hci_packet_structure() {
        reset_sequence_number();
        let payload = [0x03, 0x00, 0x00, 0x00]; // DFU_START_PACKET
        let packet = build_hci_packet(&payload);

        // Should start and end with SLIP_END
        assert_eq!(packet[0], SLIP_END);
        assert_eq!(packet[packet.len() - 1], SLIP_END);

        // Length should be: 2 (delimiters) + 4 (header) + 4 (payload) + 2 (CRC) + escapes
        // Minimum: 2 + 4 + 4 + 2 = 12 bytes (may be more with escapes)
        assert!(packet.len() >= 12);
    }

    #[test]
    fn test_build_start_dfu_packet() {
        reset_sequence_number();
        let packet = build_start_dfu_packet(IMAGE_TYPE_APPLICATION, 0, 0, 180_000);

        // Should be a valid SLIP packet
        assert_eq!(packet[0], SLIP_END);
        assert_eq!(packet[packet.len() - 1], SLIP_END);
    }

    #[test]
    fn test_build_init_packet() {
        reset_sequence_number();
        let init_data = vec![0x01, 0x02, 0x03, 0x04];
        let packet = build_init_packet(&init_data);

        assert_eq!(packet[0], SLIP_END);
        assert_eq!(packet[packet.len() - 1], SLIP_END);
    }

    #[test]
    fn test_build_firmware_data_packet() {
        reset_sequence_number();
        let chunk = vec![0xAA; 512];
        let packet = build_firmware_data_packet(&chunk);

        assert_eq!(packet[0], SLIP_END);
        assert_eq!(packet[packet.len() - 1], SLIP_END);
    }

    #[test]
    fn test_sequence_number_wraps() {
        reset_sequence_number();

        // Sequence starts at 1, not 0. Pattern: 1,2,3,4,5,6,7,0,1,2,...
        for i in 0..16 {
            let seq = next_sequence_number();
            assert_eq!(seq, (i + 1) & 0x07);
        }
    }

    #[test]
    fn test_slip_encode_esc_chars() {
        let data = [0x01, SLIP_END, 0x02, SLIP_ESC, 0x03];
        let encoded = slip_encode_esc_chars(&data);

        assert_eq!(
            encoded,
            vec![0x01, SLIP_ESC, SLIP_ESC_END, 0x02, SLIP_ESC, SLIP_ESC_ESC, 0x03]
        );
    }

    #[test]
    fn test_hci_slip_decoder() {
        let mut decoder = HciSlipDecoder::new();

        // Feed a complete SLIP frame
        assert!(decoder.feed(SLIP_END).is_none());
        assert!(decoder.feed(0x01).is_none());
        assert!(decoder.feed(0x02).is_none());

        let result = decoder.feed(SLIP_END);
        assert!(result.is_some());
        assert_eq!(result.unwrap().unwrap(), vec![0x01, 0x02]);
    }

    #[test]
    fn test_hci_ack_parse() {
        // ACK with ack_number = 3 (bits 3-5 = 011 = 3)
        // Byte 0: xxxx x011 x = xxx 011 xx = 0x18 (just the ack portion)
        let data = [0x18]; // ack_number in bits 3-5
        let ack = HciAck::parse(&data).unwrap();
        assert_eq!(ack.ack_number, 3);
    }

    #[test]
    fn test_hci_slip_decoder_buffer_overflow() {
        let mut decoder = HciSlipDecoder::new();

        // Start a frame
        assert!(decoder.feed(SLIP_END).is_none());

        // Feed MAX_SLIP_FRAME_SIZE bytes of data
        for _ in 0..MAX_SLIP_FRAME_SIZE {
            assert!(decoder.feed(0x42).is_none());
        }

        // The next byte should trigger overflow
        let result = decoder.feed(0x42);
        assert!(result.is_some());
        let err = result.unwrap().unwrap_err();
        assert!(
            matches!(err, DfuError::SlipBufferOverflow { size, max_size }
                if size == MAX_SLIP_FRAME_SIZE && max_size == MAX_SLIP_FRAME_SIZE),
            "Expected SlipBufferOverflow error, got: {:?}",
            err
        );
    }

    #[test]
    fn test_hci_slip_decoder_recovers_after_overflow() {
        let mut decoder = HciSlipDecoder::new();

        // Trigger overflow
        assert!(decoder.feed(SLIP_END).is_none());
        for _ in 0..MAX_SLIP_FRAME_SIZE {
            decoder.feed(0x42);
        }
        let result = decoder.feed(0x42);
        assert!(result.is_some()); // overflow error

        // Decoder should recover and handle a new valid frame
        assert!(decoder.feed(SLIP_END).is_none());
        assert!(decoder.feed(0x01).is_none());
        assert!(decoder.feed(0x02).is_none());
        let result = decoder.feed(SLIP_END);
        assert!(result.is_some());
        assert_eq!(result.unwrap().unwrap(), vec![0x01, 0x02]);
    }

    #[test]
    fn test_dfu_response_parse() {
        // Response for DFU_START_PACKET with success status
        let data = [
            0x03, 0x00, 0x00, 0x00, // operation = 3 (START)
            0x01, 0x00, 0x00, 0x00, // status = 1 (SUCCESS)
        ];
        let response = DfuResponse::parse(&data).unwrap();

        assert_eq!(response.operation, DFU_START_PACKET);
        assert!(response.is_success());
        assert!(response.error_message().is_none());
    }
}
