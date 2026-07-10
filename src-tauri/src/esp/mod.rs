//! v3 (ESP32-S3 / PentaBuzzer) firmware package handling and flashing.
//!
//! Kept fully separate from the Nordic DFU path in `crate::dfu`.

mod manifest;

pub use manifest::{read_v3_zip, LoadedPart, V3Manifest, V3Package};
