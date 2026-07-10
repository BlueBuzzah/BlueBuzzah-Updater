//! v3 firmware zip reader.
//!
//! Reads the v3 (ESP32-S3 / PentaBuzzer) firmware package: a zip archive
//! produced by BlueBuzzah-Firmware `scripts/package_penta.py`: prebuilt
//! flash images plus a flat `manifest.json` with `manifest_version`, `board`,
//! `chip`, `flash{mode,freq,size}`, `application_version`, and
//! `parts[{path, offset, sha256}]`.

use std::io::Read;
use std::path::Path;

use serde::Deserialize;
use sha2::{Digest, Sha256};

const EXPECTED_MANIFEST_VERSION: u32 = 1;
const EXPECTED_CHIP: &str = "esp32s3";
const EXPECTED_BOARD: &str = "pentabuzzer_esp32s3";

/// Flash timing/size parameters from the manifest.
#[derive(Debug, Clone, Deserialize)]
pub struct FlashParams {
    pub mode: String,
    pub freq: String,
    pub size: String,
}

/// Raw part metadata as it appears in `manifest.json`.
#[derive(Debug, Clone, Deserialize)]
pub struct V3PartMeta {
    pub path: String,
    pub offset: String,
    pub sha256: String,
}

/// Parsed `manifest.json` for a v3 firmware package.
#[derive(Debug, Clone, Deserialize)]
pub struct V3Manifest {
    pub manifest_version: u32,
    pub board: String,
    pub chip: String,
    pub flash: FlashParams,
    pub application_version: String,
    pub parts: Vec<V3PartMeta>,
}

/// A single flash image loaded into memory, ready to write at `offset`.
#[derive(Debug, Clone)]
pub struct LoadedPart {
    pub name: String,
    pub offset: u32,
    pub data: Vec<u8>,
}

/// A fully read and validated v3 firmware package.
#[derive(Debug, Clone)]
pub struct V3Package {
    pub manifest: V3Manifest,
    pub parts: Vec<LoadedPart>,
}

/// Parse a flash offset that may be written as a hex string (`"0x8000"`,
/// `"0X8000"`) or as a plain decimal string (`"57344"`).
pub(crate) fn parse_offset(s: &str) -> Result<u32, String> {
    let s = s.trim();
    let parsed = if let Some(hex) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        u32::from_str_radix(hex, 16)
    } else {
        s.parse::<u32>()
    };
    parsed.map_err(|_| format!("unparsable offset: {s}"))
}

/// Read and validate a v3 firmware zip package from disk.
///
/// Errors on: missing `manifest.json`, JSON without `manifest_version`
/// (not a v3 firmware package), `manifest_version != 1`, unexpected
/// `chip`/`board`, empty `parts`, a missing part file, a SHA256 mismatch,
/// or an unparsable offset.
pub fn read_v3_zip<P: AsRef<Path>>(path: P) -> Result<V3Package, String> {
    let path = path.as_ref();
    let file = std::fs::File::open(path).map_err(|e| format!("failed to open {path:?}: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("failed to read zip archive: {e}"))?;

    let mut manifest_json = String::new();
    archive
        .by_name("manifest.json")
        .map_err(|_| "zip package is missing manifest.json".to_string())?
        .read_to_string(&mut manifest_json)
        .map_err(|e| format!("failed to read manifest.json: {e}"))?;

    let raw: serde_json::Value = serde_json::from_str(&manifest_json)
        .map_err(|e| format!("manifest.json is not valid JSON: {e}"))?;

    if raw.get("manifest_version").is_none() {
        return Err("manifest.json is not a v3 firmware package (missing manifest_version)".to_string());
    }

    let manifest: V3Manifest = serde_json::from_value(raw)
        .map_err(|e| format!("manifest.json does not match the v3 schema: {e}"))?;

    if manifest.manifest_version != EXPECTED_MANIFEST_VERSION {
        return Err(format!(
            "unsupported manifest_version {} (expected {EXPECTED_MANIFEST_VERSION})",
            manifest.manifest_version
        ));
    }

    if manifest.chip != EXPECTED_CHIP {
        return Err(format!(
            "unexpected chip \"{}\" (expected \"{EXPECTED_CHIP}\")",
            manifest.chip
        ));
    }

    if manifest.board != EXPECTED_BOARD {
        return Err(format!(
            "unexpected board \"{}\" (expected \"{EXPECTED_BOARD}\")",
            manifest.board
        ));
    }

    if manifest.parts.is_empty() {
        return Err("manifest.json has no parts".to_string());
    }

    let mut parts = Vec::with_capacity(manifest.parts.len());
    for meta in &manifest.parts {
        let offset = parse_offset(&meta.offset)?;

        let mut data = Vec::new();
        archive
            .by_name(&meta.path)
            .map_err(|_| format!("zip package is missing part file \"{}\"", meta.path))?
            .read_to_end(&mut data)
            .map_err(|e| format!("failed to read part file \"{}\": {e}", meta.path))?;

        let actual_sha256 = format!("{:x}", Sha256::digest(&data));
        if actual_sha256 != meta.sha256 {
            return Err(format!(
                "SHA256 mismatch for part \"{}\": expected {}, got {actual_sha256}",
                meta.path, meta.sha256
            ));
        }

        parts.push(LoadedPart {
            name: meta.path.clone(),
            offset,
            data,
        });
    }

    parts.sort_by_key(|p| p.offset);

    Ok(V3Package { manifest, parts })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::io::Write;
    use tempfile::TempDir;

    fn sha_hex(data: &[u8]) -> String {
        format!("{:x}", Sha256::digest(data))
    }

    /// Build a v3 zip on disk; `mutate` edits the manifest JSON before writing.
    fn make_v3_zip(dir: &TempDir, mutate: impl Fn(&mut serde_json::Value)) -> std::path::PathBuf {
        let parts: Vec<(&str, &str, &[u8])> = vec![
            ("bootloader.bin", "0x0", b"boot"),
            ("partitions.bin", "0x8000", b"parts"),
            ("boot_app0.bin", "0xE000", b"app0"),
            ("firmware.bin", "0x10000", b"fw"),
        ];
        let mut manifest = serde_json::json!({
            "manifest_version": 1,
            "board": "pentabuzzer_esp32s3",
            "chip": "esp32s3",
            "flash": {"mode": "dio", "freq": "80m", "size": "8MB"},
            "application_version": "2.0.0",
            "parts": parts.iter().map(|(p, o, d)| serde_json::json!({
                "path": p, "offset": o, "sha256": sha_hex(d)
            })).collect::<Vec<_>>(),
        });
        mutate(&mut manifest);

        let path = dir.path().join("fw-v3.zip");
        let file = std::fs::File::create(&path).unwrap();
        let mut zf = zip::ZipWriter::new(file);
        let opts: zip::write::FileOptions = Default::default();
        zf.start_file("manifest.json", opts).unwrap();
        zf.write_all(manifest.to_string().as_bytes()).unwrap();
        for (name, _, data) in &parts {
            zf.start_file(*name, opts).unwrap();
            zf.write_all(data).unwrap();
        }
        zf.finish().unwrap();
        path
    }

    #[test]
    fn reads_valid_package_with_sorted_offsets() {
        let dir = TempDir::new().unwrap();
        let path = make_v3_zip(&dir, |_| {});
        let pkg = read_v3_zip(&path).unwrap();
        assert_eq!(pkg.manifest.chip, "esp32s3");
        assert_eq!(pkg.parts.len(), 4);
        assert_eq!(pkg.parts[0].offset, 0x0);
        assert_eq!(pkg.parts[3].offset, 0x10000);
        assert_eq!(pkg.parts[3].data, b"fw");
    }

    #[test]
    fn rejects_wrong_chip() {
        let dir = TempDir::new().unwrap();
        let path = make_v3_zip(&dir, |m| m["chip"] = "esp32c3".into());
        let err = read_v3_zip(&path).unwrap_err();
        assert!(err.contains("esp32c3"), "error should name the found chip: {err}");
    }

    #[test]
    fn rejects_wrong_board() {
        let dir = TempDir::new().unwrap();
        let path = make_v3_zip(&dir, |m| m["board"] = "some_other_board".into());
        assert!(read_v3_zip(&path).is_err());
    }

    #[test]
    fn rejects_sha256_mismatch() {
        let dir = TempDir::new().unwrap();
        let path = make_v3_zip(&dir, |m| {
            m["parts"][3]["sha256"] = sha_hex(b"tampered").into();
        });
        let err = read_v3_zip(&path).unwrap_err();
        assert!(err.contains("firmware.bin"), "error should name the part: {err}");
    }

    #[test]
    fn rejects_nordic_package_cleanly() {
        // A Nordic manifest has a top-level "manifest" key, no "manifest_version".
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nordic.zip");
        let file = std::fs::File::create(&path).unwrap();
        let mut zf = zip::ZipWriter::new(file);
        let opts: zip::write::FileOptions = Default::default();
        zf.start_file("manifest.json", opts).unwrap();
        zf.write_all(br#"{"manifest":{"application":{}}}"#).unwrap();
        zf.finish().unwrap();
        let err = read_v3_zip(&path).unwrap_err();
        assert!(err.contains("not a v3"), "{err}");
    }

    #[test]
    fn parses_hex_and_decimal_offsets() {
        assert_eq!(parse_offset("0x10000").unwrap(), 0x10000);
        assert_eq!(parse_offset("0X8000").unwrap(), 0x8000);
        assert_eq!(parse_offset("57344").unwrap(), 57344);
        assert!(parse_offset("bogus").is_err());
    }
}
