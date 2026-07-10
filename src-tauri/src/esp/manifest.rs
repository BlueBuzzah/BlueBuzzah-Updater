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

/// Upper bound on manifest part count (real packages have 4).
const MAX_PARTS: usize = 16;

/// Upper bound on a single part's decompressed size. The largest ESP32-S3
/// flash we ship is 8 MB, so 16 MiB is generous while still preventing a
/// crafted zip from inflating to gigabytes in memory.
const MAX_PART_BYTES: usize = 16 * 1024 * 1024;
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

    if manifest.parts.len() > MAX_PARTS {
        return Err(format!(
            "manifest.json lists {} parts (limit {MAX_PARTS})",
            manifest.parts.len()
        ));
    }

    let mut parts = Vec::with_capacity(manifest.parts.len());
    for meta in &manifest.parts {
        let offset = parse_offset(&meta.offset)?;

        let mut data = Vec::new();
        // Bounded read: a crafted zip can DEFLATE-inflate a tiny entry to
        // gigabytes; never allocate more than a real flash image could be.
        let entry = archive
            .by_name(&meta.path)
            .map_err(|_| format!("zip package is missing part file \"{}\"", meta.path))?;
        entry
            .take(MAX_PART_BYTES as u64 + 1)
            .read_to_end(&mut data)
            .map_err(|e| format!("failed to read part file \"{}\": {e}", meta.path))?;
        if data.len() > MAX_PART_BYTES {
            return Err(format!(
                "part file \"{}\" exceeds the {} MiB size limit",
                meta.path,
                MAX_PART_BYTES / (1024 * 1024)
            ));
        }

        let actual_sha256 = format!("{:x}", Sha256::digest(&data));
        if !actual_sha256.eq_ignore_ascii_case(&meta.sha256) {
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

    // Reject duplicate or overlapping flash regions before anything reaches
    // the flasher — a package that would write the same address twice is
    // malformed, and failing here beats failing mid-flash.
    for pair in parts.windows(2) {
        let end = pair[0].offset as u64 + pair[0].data.len() as u64;
        if end > pair[1].offset as u64 {
            return Err(format!(
                "parts \"{}\" (0x{:X}+{}) and \"{}\" (0x{:X}) overlap",
                pair[0].name,
                pair[0].offset,
                pair[0].data.len(),
                pair[1].name,
                pair[1].offset
            ));
        }
    }

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
        let err = read_v3_zip(&path).unwrap_err();
        assert!(err.contains("some_other_board"), "error should name the found board: {err}");
    }

    #[test]
    fn accepts_uppercase_sha256_in_manifest() {
        let dir = TempDir::new().unwrap();
        let path = make_v3_zip(&dir, |m| {
            m["parts"][3]["sha256"] = sha_hex(b"fw").to_uppercase().into();
        });
        read_v3_zip(&path).unwrap();
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
    fn rejects_overlapping_parts() {
        let dir = TempDir::new().unwrap();
        // bootloader.bin is 4 bytes at 0x0 (ends at 0x4); move partitions.bin
        // to 0x1 so the two regions collide.
        let path = make_v3_zip(&dir, |m| {
            m["parts"][1]["offset"] = "0x1".into();
        });
        let err = read_v3_zip(&path).unwrap_err();
        assert!(err.contains("overlap"), "{err}");
    }

    #[test]
    fn rejects_too_many_parts() {
        let dir = TempDir::new().unwrap();
        // Part-count check fires before part files are read, so dummy
        // entries pointing at nonexistent files are fine here.
        let path = make_v3_zip(&dir, |m| {
            let parts = m["parts"].as_array_mut().unwrap();
            for i in 0..20 {
                parts.push(serde_json::json!({
                    "path": format!("extra{i}.bin"),
                    "offset": format!("0x{:X}", 0x100000 + i * 0x1000),
                    "sha256": "00",
                }));
            }
        });
        let err = read_v3_zip(&path).unwrap_err();
        assert!(err.contains("limit"), "{err}");
    }

    #[test]
    fn rejects_oversized_part() {
        let dir = TempDir::new().unwrap();
        let big = vec![0u8; MAX_PART_BYTES + 1];
        let manifest = serde_json::json!({
            "manifest_version": 1,
            "board": "pentabuzzer_esp32s3",
            "chip": "esp32s3",
            "flash": {"mode": "dio", "freq": "80m", "size": "8MB"},
            "application_version": "2.0.0",
            "parts": [{"path": "firmware.bin", "offset": "0x10000", "sha256": sha_hex(&big)}],
        });

        let path = dir.path().join("big-v3.zip");
        let file = std::fs::File::create(&path).unwrap();
        let mut zf = zip::ZipWriter::new(file);
        let opts: zip::write::FileOptions = Default::default();
        zf.start_file("manifest.json", opts).unwrap();
        zf.write_all(manifest.to_string().as_bytes()).unwrap();
        zf.start_file("firmware.bin", opts).unwrap();
        zf.write_all(&big).unwrap();
        zf.finish().unwrap();

        let err = read_v3_zip(&path).unwrap_err();
        assert!(err.contains("size limit"), "{err}");
    }

    #[test]
    fn parses_hex_and_decimal_offsets() {
        assert_eq!(parse_offset("0x10000").unwrap(), 0x10000);
        assert_eq!(parse_offset("0X8000").unwrap(), 0x8000);
        assert_eq!(parse_offset("57344").unwrap(), 57344);
        assert!(parse_offset("bogus").is_err());
    }
}
