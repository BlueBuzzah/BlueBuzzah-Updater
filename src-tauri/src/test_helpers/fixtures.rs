use crate::cache::CachedFirmwareMetadata;
use crate::commands::device::Device;

/// Builder for creating test Device instances
pub struct DeviceBuilder {
    path: String,
    label: String,
    is_circuit_py: bool,
}

impl DeviceBuilder {
    pub fn new() -> Self {
        Self {
            path: "/Volumes/CIRCUITPY".to_string(),
            label: "CIRCUITPY".to_string(),
            is_circuit_py: true,
        }
    }

    pub fn path(mut self, path: &str) -> Self {
        self.path = path.to_string();
        self
    }

    pub fn label(mut self, label: &str) -> Self {
        self.label = label.to_string();
        self
    }

    pub fn is_circuit_py(mut self, value: bool) -> Self {
        self.is_circuit_py = value;
        self
    }

    pub fn bluebuzzah(self) -> Self {
        self.label("BLUEBUZZAH").path("/Volumes/BLUEBUZZAH")
    }

    pub fn build(self) -> Device {
        Device {
            path: self.path,
            label: self.label,
            is_circuit_py: self.is_circuit_py,
        }
    }
}

impl Default for DeviceBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Builder for creating test CachedFirmwareMetadata instances
pub struct FirmwareMetadataBuilder {
    version: String,
    tag_name: String,
    sha256_hash: String,
    zip_path: String,
    extracted_path: String,
    downloaded_at: String,
    file_size: u64,
    published_at: String,
    release_notes: String,
}

impl FirmwareMetadataBuilder {
    pub fn new(version: &str) -> Self {
        Self {
            version: version.to_string(),
            tag_name: format!("v{}", version),
            sha256_hash: "abc123def456789012345678901234567890123456789012345678901234".to_string(),
            zip_path: format!("/cache/{}.zip", version),
            extracted_path: format!("/cache/{}", version),
            downloaded_at: "2024-01-01T00:00:00Z".to_string(),
            file_size: 1024,
            published_at: "2024-01-01T00:00:00Z".to_string(),
            release_notes: "Test release".to_string(),
        }
    }

    pub fn tag_name(mut self, tag_name: &str) -> Self {
        self.tag_name = tag_name.to_string();
        self
    }

    pub fn sha256_hash(mut self, hash: &str) -> Self {
        self.sha256_hash = hash.to_string();
        self
    }

    pub fn zip_path(mut self, path: &str) -> Self {
        self.zip_path = path.to_string();
        self
    }

    pub fn extracted_path(mut self, path: &str) -> Self {
        self.extracted_path = path.to_string();
        self
    }

    pub fn downloaded_at(mut self, downloaded_at: &str) -> Self {
        self.downloaded_at = downloaded_at.to_string();
        self
    }

    pub fn file_size(mut self, size: u64) -> Self {
        self.file_size = size;
        self
    }

    pub fn published_at(mut self, published_at: &str) -> Self {
        self.published_at = published_at.to_string();
        self
    }

    pub fn release_notes(mut self, notes: &str) -> Self {
        self.release_notes = notes.to_string();
        self
    }

    pub fn build(self) -> CachedFirmwareMetadata {
        CachedFirmwareMetadata {
            version: self.version,
            tag_name: self.tag_name,
            sha256_hash: self.sha256_hash,
            zip_path: self.zip_path,
            extracted_path: self.extracted_path,
            downloaded_at: self.downloaded_at,
            file_size: self.file_size,
            published_at: self.published_at,
            release_notes: self.release_notes,
        }
    }
}

impl Default for FirmwareMetadataBuilder {
    fn default() -> Self {
        Self::new("1.0.0")
    }
}
