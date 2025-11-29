//! Firmware package reader for Nordic DFU.
//!
//! Reads and parses the firmware.zip package containing:
//! - manifest.json - Package metadata
//! - firmware.bin - Application binary
//! - firmware.dat - Init packet (protobuf-encoded)

use std::io::Read;
use std::path::Path;

use serde::Deserialize;

use super::error::{DfuError, DfuResult};

/// Contents of a DFU firmware package.
#[derive(Debug)]
pub struct FirmwarePackage {
    /// Init packet data (firmware.dat contents).
    pub init_data: Vec<u8>,
    /// Firmware binary data (firmware.bin contents).
    pub firmware_data: Vec<u8>,
    /// Parsed manifest metadata.
    pub manifest: ManifestData,
}

/// Parsed manifest.json data.
#[derive(Debug, Clone)]
pub struct ManifestData {
    /// Device type identifier.
    pub device_type: u16,
    /// CRC16 of the firmware.
    pub firmware_crc16: u16,
    /// DFU version from manifest.
    pub dfu_version: f32,
    /// Name of the binary file.
    bin_file: String,
    /// Name of the init packet file.
    dat_file: String,
}

/// Raw manifest.json structure for deserialization.
#[derive(Debug, Deserialize)]
struct RawManifest {
    manifest: ManifestInner,
}

#[derive(Debug, Deserialize)]
struct ManifestInner {
    application: ApplicationManifest,
    dfu_version: f32,
}

#[derive(Debug, Deserialize)]
struct ApplicationManifest {
    bin_file: String,
    dat_file: String,
    init_packet_data: InitPacketData,
}

// Fields required for JSON deserialization but not all are used
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct InitPacketData {
    application_version: u32,
    device_revision: u16,
    device_type: u16,
    firmware_crc16: u16,
    softdevice_req: Vec<u16>,
}


/// Read and parse a firmware.zip package.
///
/// # Arguments
/// * `path` - Path to the firmware.zip file
///
/// # Returns
/// Parsed firmware package with init data, firmware binary, and manifest
pub fn read_firmware_zip<P: AsRef<Path>>(path: P) -> DfuResult<FirmwarePackage> {
    let path = path.as_ref();
    let file = std::fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(file)?;

    // Read and parse manifest.json
    let manifest = read_manifest(&mut archive)?;

    // Read init packet (firmware.dat)
    let init_data = read_file_from_zip(&mut archive, &manifest.dat_file)?;

    // Read firmware binary (firmware.bin)
    let firmware_data = read_file_from_zip(&mut archive, &manifest.bin_file)?;

    Ok(FirmwarePackage {
        init_data,
        firmware_data,
        manifest,
    })
}

/// Read and parse the manifest.json from the archive.
fn read_manifest(archive: &mut zip::ZipArchive<std::fs::File>) -> DfuResult<ManifestData> {
    let mut manifest_file = archive.by_name("manifest.json").map_err(|_| {
        DfuError::MissingFile {
            filename: "manifest.json".to_string(),
        }
    })?;

    let mut contents = String::new();
    manifest_file.read_to_string(&mut contents)?;

    let raw: RawManifest = serde_json::from_str(&contents)?;

    Ok(ManifestData {
        device_type: raw.manifest.application.init_packet_data.device_type,
        firmware_crc16: raw.manifest.application.init_packet_data.firmware_crc16,
        dfu_version: raw.manifest.dfu_version,
        bin_file: raw.manifest.application.bin_file,
        dat_file: raw.manifest.application.dat_file,
    })
}

/// Read a file from the zip archive by name.
fn read_file_from_zip(
    archive: &mut zip::ZipArchive<std::fs::File>,
    name: &str,
) -> DfuResult<Vec<u8>> {
    let mut file = archive.by_name(name).map_err(|_| DfuError::MissingFile {
        filename: name.to_string(),
    })?;

    let mut data = Vec::with_capacity(file.size() as usize);
    file.read_to_end(&mut data)?;

    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;
    use zip::write::FileOptions;
    use zip::ZipWriter;

    fn create_test_zip(
        dir: &TempDir,
        manifest: Option<&str>,
        include_bin: bool,
        include_dat: bool,
    ) -> std::path::PathBuf {
        let zip_path = dir.path().join("firmware.zip");
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = FileOptions::default().compression_method(zip::CompressionMethod::Stored);

        if let Some(manifest_content) = manifest {
            zip.start_file("manifest.json", options).unwrap();
            zip.write_all(manifest_content.as_bytes()).unwrap();
        }

        if include_bin {
            zip.start_file("firmware.bin", options).unwrap();
            zip.write_all(&[0x01, 0x02, 0x03, 0x04]).unwrap();
        }

        if include_dat {
            zip.start_file("firmware.dat", options).unwrap();
            zip.write_all(&[0x0A, 0x0B, 0x0C]).unwrap();
        }

        zip.finish().unwrap();
        zip_path
    }

    const VALID_MANIFEST: &str = r#"{
        "manifest": {
            "application": {
                "bin_file": "firmware.bin",
                "dat_file": "firmware.dat",
                "init_packet_data": {
                    "application_version": 4294967295,
                    "device_revision": 65535,
                    "device_type": 82,
                    "firmware_crc16": 18974,
                    "softdevice_req": [182]
                }
            },
            "dfu_version": 0.5
        }
    }"#;

    #[test]
    fn test_read_valid_firmware_zip() {
        let dir = TempDir::new().unwrap();
        let zip_path = create_test_zip(&dir, Some(VALID_MANIFEST), true, true);

        let package = read_firmware_zip(&zip_path).unwrap();

        assert_eq!(package.firmware_data, vec![0x01, 0x02, 0x03, 0x04]);
        assert_eq!(package.init_data, vec![0x0A, 0x0B, 0x0C]);
        assert_eq!(package.manifest.device_type, 82);
        assert_eq!(package.manifest.firmware_crc16, 18974);
        assert_eq!(package.manifest.dfu_version, 0.5);
    }

    #[test]
    fn test_read_missing_manifest() {
        let dir = TempDir::new().unwrap();
        let zip_path = create_test_zip(&dir, None, true, true);

        let result = read_firmware_zip(&zip_path);

        assert!(matches!(
            result,
            Err(DfuError::MissingFile { filename }) if filename == "manifest.json"
        ));
    }

    #[test]
    fn test_read_missing_firmware_bin() {
        let dir = TempDir::new().unwrap();
        let zip_path = create_test_zip(&dir, Some(VALID_MANIFEST), false, true);

        let result = read_firmware_zip(&zip_path);

        assert!(matches!(
            result,
            Err(DfuError::MissingFile { filename }) if filename == "firmware.bin"
        ));
    }

    #[test]
    fn test_read_missing_firmware_dat() {
        let dir = TempDir::new().unwrap();
        let zip_path = create_test_zip(&dir, Some(VALID_MANIFEST), true, false);

        let result = read_firmware_zip(&zip_path);

        assert!(matches!(
            result,
            Err(DfuError::MissingFile { filename }) if filename == "firmware.dat"
        ));
    }

    #[test]
    fn test_read_invalid_manifest_json() {
        let dir = TempDir::new().unwrap();
        let zip_path = create_test_zip(&dir, Some("{ invalid json }"), true, true);

        let result = read_firmware_zip(&zip_path);

        assert!(matches!(result, Err(DfuError::Json(_))));
    }

    #[test]
    fn test_nonexistent_file() {
        let result = read_firmware_zip("/nonexistent/path/firmware.zip");

        assert!(matches!(result, Err(DfuError::Io(_))));
    }
}
