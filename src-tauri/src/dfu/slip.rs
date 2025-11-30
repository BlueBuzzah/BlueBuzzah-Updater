//! SLIP (Serial Line Internet Protocol) encoding and decoding.
//!
//! Implements RFC 1055 for framing serial data packets.
//! See: https://datatracker.ietf.org/doc/html/rfc1055

#[cfg(test)]
use super::config::{SLIP_END, SLIP_ESC, SLIP_ESC_END, SLIP_ESC_ESC};
#[cfg(test)]
use super::error::{DfuError, DfuResult};

/// Encode data using SLIP framing.
///
/// Wraps the data with END delimiters and escapes any special bytes.
///
/// # Arguments
/// * `data` - Raw bytes to encode
///
/// # Returns
/// SLIP-encoded bytes with frame delimiters
#[cfg(test)]
pub fn encode(data: &[u8]) -> Vec<u8> {
    // Pre-allocate with some extra space for escapes and delimiters
    let mut encoded = Vec::with_capacity(data.len() * 2 + 2);

    // Start with END delimiter
    encoded.push(SLIP_END);

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

    // End with END delimiter
    encoded.push(SLIP_END);

    encoded
}

/// Decode SLIP-framed data.
///
/// Removes frame delimiters and decodes escaped bytes.
///
/// # Arguments
/// * `data` - SLIP-encoded bytes
///
/// # Returns
/// Decoded raw bytes, or an error if the frame is invalid
#[cfg(test)]
pub fn decode(data: &[u8]) -> DfuResult<Vec<u8>> {
    let mut decoded = Vec::with_capacity(data.len());
    let mut escape_next = false;

    for &byte in data {
        if byte == SLIP_END {
            // Skip frame delimiters
            continue;
        }

        if escape_next {
            match byte {
                SLIP_ESC_END => decoded.push(SLIP_END),
                SLIP_ESC_ESC => decoded.push(SLIP_ESC),
                _ => return Err(DfuError::InvalidSlipEscape),
            }
            escape_next = false;
        } else if byte == SLIP_ESC {
            escape_next = true;
        } else {
            decoded.push(byte);
        }
    }

    // If we ended expecting an escape, the frame is incomplete
    if escape_next {
        return Err(DfuError::IncompleteSlipFrame);
    }

    Ok(decoded)
}

/// Streaming SLIP decoder for incremental parsing.
///
/// Useful for reading from a serial port where data arrives in chunks.
#[cfg(test)]
#[derive(Debug, Default)]
pub struct SlipDecoder {
    buffer: Vec<u8>,
    escape_next: bool,
    in_frame: bool,
}

#[cfg(test)]
impl SlipDecoder {
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
    /// # Returns
    /// - `Some(Ok(data))` if a complete frame was received
    /// - `Some(Err(e))` if an error occurred (invalid escape)
    /// - `None` if more data is needed
    pub fn feed(&mut self, byte: u8) -> Option<DfuResult<Vec<u8>>> {
        if byte == SLIP_END {
            if self.in_frame && !self.buffer.is_empty() {
                // End of frame - return the buffered data
                let frame = std::mem::take(&mut self.buffer);
                self.in_frame = false;
                self.escape_next = false;
                return Some(Ok(frame));
            } else {
                // Start of new frame (or empty frame)
                self.buffer.clear();
                self.in_frame = true;
                self.escape_next = false;
                return None;
            }
        }

        if !self.in_frame {
            // Data outside a frame - ignore or consider it the start
            self.in_frame = true;
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

    /// Check if the decoder is currently in a frame.
    #[cfg(test)]
    pub fn in_frame(&self) -> bool {
        self.in_frame
    }

    /// Get the current buffer length.
    #[cfg(test)]
    pub fn buffer_len(&self) -> usize {
        self.buffer.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_simple_data() {
        let data = [0x01, 0x02, 0x03];
        let encoded = encode(&data);

        assert_eq!(encoded, vec![SLIP_END, 0x01, 0x02, 0x03, SLIP_END]);
    }

    #[test]
    fn test_encode_empty() {
        let data: [u8; 0] = [];
        let encoded = encode(&data);

        assert_eq!(encoded, vec![SLIP_END, SLIP_END]);
    }

    #[test]
    fn test_encode_with_end_byte() {
        let data = [0x01, SLIP_END, 0x02];
        let encoded = encode(&data);

        assert_eq!(
            encoded,
            vec![SLIP_END, 0x01, SLIP_ESC, SLIP_ESC_END, 0x02, SLIP_END]
        );
    }

    #[test]
    fn test_encode_with_escape_byte() {
        let data = [0x01, SLIP_ESC, 0x02];
        let encoded = encode(&data);

        assert_eq!(
            encoded,
            vec![SLIP_END, 0x01, SLIP_ESC, SLIP_ESC_ESC, 0x02, SLIP_END]
        );
    }

    #[test]
    fn test_encode_with_both_special_bytes() {
        let data = [SLIP_END, SLIP_ESC];
        let encoded = encode(&data);

        assert_eq!(
            encoded,
            vec![
                SLIP_END,
                SLIP_ESC,
                SLIP_ESC_END,
                SLIP_ESC,
                SLIP_ESC_ESC,
                SLIP_END
            ]
        );
    }

    #[test]
    fn test_decode_simple_data() {
        let encoded = [SLIP_END, 0x01, 0x02, 0x03, SLIP_END];
        let decoded = decode(&encoded).unwrap();

        assert_eq!(decoded, vec![0x01, 0x02, 0x03]);
    }

    #[test]
    fn test_decode_empty() {
        let encoded = [SLIP_END, SLIP_END];
        let decoded = decode(&encoded).unwrap();

        assert_eq!(decoded, Vec::<u8>::new());
    }

    #[test]
    fn test_decode_with_escaped_end() {
        let encoded = [SLIP_END, 0x01, SLIP_ESC, SLIP_ESC_END, 0x02, SLIP_END];
        let decoded = decode(&encoded).unwrap();

        assert_eq!(decoded, vec![0x01, SLIP_END, 0x02]);
    }

    #[test]
    fn test_decode_with_escaped_escape() {
        let encoded = [SLIP_END, 0x01, SLIP_ESC, SLIP_ESC_ESC, 0x02, SLIP_END];
        let decoded = decode(&encoded).unwrap();

        assert_eq!(decoded, vec![0x01, SLIP_ESC, 0x02]);
    }

    #[test]
    fn test_decode_invalid_escape() {
        let encoded = [SLIP_END, 0x01, SLIP_ESC, 0xFF, SLIP_END];
        let result = decode(&encoded);

        assert!(matches!(result, Err(DfuError::InvalidSlipEscape)));
    }

    #[test]
    fn test_decode_incomplete_escape() {
        let encoded = [SLIP_END, 0x01, SLIP_ESC];
        let result = decode(&encoded);

        assert!(matches!(result, Err(DfuError::IncompleteSlipFrame)));
    }

    #[test]
    fn test_encode_decode_roundtrip() {
        let test_cases: Vec<Vec<u8>> = vec![
            vec![],
            vec![0x00],
            vec![0xFF],
            vec![SLIP_END],
            vec![SLIP_ESC],
            vec![SLIP_END, SLIP_ESC, SLIP_END],
            (0..256).map(|i| i as u8).collect(),
        ];

        for original in test_cases {
            let encoded = encode(&original);
            let decoded = decode(&encoded).unwrap();
            assert_eq!(
                decoded, original,
                "Roundtrip failed for {:?}",
                original
            );
        }
    }

    #[test]
    fn test_streaming_decoder_simple() {
        let mut decoder = SlipDecoder::new();

        // Feed a complete frame byte by byte
        assert!(decoder.feed(SLIP_END).is_none()); // Start
        assert!(decoder.feed(0x01).is_none());
        assert!(decoder.feed(0x02).is_none());

        let result = decoder.feed(SLIP_END);
        assert!(result.is_some());
        assert_eq!(result.unwrap().unwrap(), vec![0x01, 0x02]);
    }

    #[test]
    fn test_streaming_decoder_with_escapes() {
        let mut decoder = SlipDecoder::new();

        decoder.feed(SLIP_END);
        decoder.feed(0x01);
        decoder.feed(SLIP_ESC);
        decoder.feed(SLIP_ESC_END);
        decoder.feed(0x02);

        let result = decoder.feed(SLIP_END);
        assert!(result.is_some());
        assert_eq!(result.unwrap().unwrap(), vec![0x01, SLIP_END, 0x02]);
    }

    #[test]
    fn test_streaming_decoder_invalid_escape() {
        let mut decoder = SlipDecoder::new();

        decoder.feed(SLIP_END);
        decoder.feed(SLIP_ESC);

        let result = decoder.feed(0xFF); // Invalid escape sequence
        assert!(result.is_some());
        assert!(matches!(result.unwrap(), Err(DfuError::InvalidSlipEscape)));
    }

    #[test]
    fn test_streaming_decoder_reset() {
        let mut decoder = SlipDecoder::new();

        decoder.feed(SLIP_END);
        decoder.feed(0x01);
        decoder.feed(0x02);

        assert!(decoder.in_frame());
        assert_eq!(decoder.buffer_len(), 2);

        decoder.reset();

        assert!(!decoder.in_frame());
        assert_eq!(decoder.buffer_len(), 0);
    }

    #[test]
    fn test_streaming_decoder_multiple_frames() {
        let mut decoder = SlipDecoder::new();

        // First frame
        decoder.feed(SLIP_END);
        decoder.feed(0x01);
        let result1 = decoder.feed(SLIP_END);
        assert_eq!(result1.unwrap().unwrap(), vec![0x01]);

        // Second frame
        decoder.feed(SLIP_END);
        decoder.feed(0x02);
        decoder.feed(0x03);
        let result2 = decoder.feed(SLIP_END);
        assert_eq!(result2.unwrap().unwrap(), vec![0x02, 0x03]);
    }
}
