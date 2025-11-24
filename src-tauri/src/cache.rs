use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedFirmwareMetadata {
    pub version: String,
    pub tag_name: String,
    pub sha256_hash: String,
    pub zip_path: String,
    pub extracted_path: String,
    pub downloaded_at: String,
    pub file_size: u64,
    pub published_at: String,
    pub release_notes: String,
}

pub type FirmwareCacheIndex = HashMap<String, CachedFirmwareMetadata>;

pub struct CacheManager {
    cache_file_path: PathBuf,
}

impl CacheManager {
    pub fn new(app_data_dir: &Path) -> Result<Self, String> {
        let cache_file_path = app_data_dir.join("firmware_cache.json");
        Ok(Self { cache_file_path })
    }

    /// Calculate SHA256 hash of a file
    pub fn calculate_sha256(file_path: &Path) -> Result<String, String> {
        let mut file = fs::File::open(file_path)
            .map_err(|e| format!("Failed to open file for hashing: {}", e))?;

        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 8192];

        loop {
            let bytes_read = file
                .read(&mut buffer)
                .map_err(|e| format!("Failed to read file for hashing: {}", e))?;

            if bytes_read == 0 {
                break;
            }

            hasher.update(&buffer[..bytes_read]);
        }

        let hash = hasher.finalize();
        Ok(format!("{:x}", hash))
    }

    /// Load the cache index from disk
    pub fn load_index(&self) -> Result<FirmwareCacheIndex, String> {
        if !self.cache_file_path.exists() {
            return Ok(HashMap::new());
        }

        let contents = fs::read_to_string(&self.cache_file_path)
            .map_err(|e| format!("Failed to read cache index: {}", e))?;

        let index: FirmwareCacheIndex = serde_json::from_str(&contents)
            .map_err(|e| format!("Failed to parse cache index: {}", e))?;

        Ok(index)
    }

    /// Save the cache index to disk
    pub fn save_index(&self, index: &FirmwareCacheIndex) -> Result<(), String> {
        let contents = serde_json::to_string_pretty(index)
            .map_err(|e| format!("Failed to serialize cache index: {}", e))?;

        // Ensure parent directory exists
        if let Some(parent) = self.cache_file_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create cache directory: {}", e))?;
        }

        fs::write(&self.cache_file_path, contents)
            .map_err(|e| format!("Failed to write cache index: {}", e))?;

        Ok(())
    }

    /// Add or update a firmware entry in the cache index
    pub fn update_entry(&self, metadata: CachedFirmwareMetadata) -> Result<(), String> {
        let mut index = self.load_index()?;
        index.insert(metadata.version.clone(), metadata);
        self.save_index(&index)?;
        Ok(())
    }

    /// Remove a firmware entry from the cache index
    pub fn remove_entry(&self, version: &str) -> Result<(), String> {
        let mut index = self.load_index()?;
        index.remove(version);
        self.save_index(&index)?;
        Ok(())
    }

    /// Get a specific firmware entry from the cache
    pub fn get_entry(&self, version: &str) -> Result<Option<CachedFirmwareMetadata>, String> {
        let index = self.load_index()?;
        Ok(index.get(version).cloned())
    }

    /// Clear all entries from the cache index
    pub fn clear_index(&self) -> Result<(), String> {
        let empty_index: FirmwareCacheIndex = HashMap::new();
        self.save_index(&empty_index)?;
        Ok(())
    }

    /// Verify that cached files still exist on disk
    pub fn verify_cache_integrity(&self) -> Result<Vec<String>, String> {
        let index = self.load_index()?;
        let mut missing_versions = Vec::new();

        for (version, metadata) in index.iter() {
            let zip_exists = Path::new(&metadata.zip_path).exists();
            let extracted_exists = Path::new(&metadata.extracted_path).exists();

            if !zip_exists || !extracted_exists {
                missing_versions.push(version.clone());
            }
        }

        Ok(missing_versions)
    }

    /// Verify SHA256 hash of a cached firmware file
    pub fn verify_hash(&self, version: &str) -> Result<bool, String> {
        let entry = self.get_entry(version)?;

        match entry {
            Some(metadata) => {
                let zip_path = Path::new(&metadata.zip_path);
                if !zip_path.exists() {
                    return Ok(false);
                }

                let calculated_hash = Self::calculate_sha256(zip_path)?;
                Ok(calculated_hash == metadata.sha256_hash)
            }
            None => Ok(false),
        }
    }

    /// Migrate existing cached firmware to the index
    /// Scans firmware directory for existing files and adds them to cache index
    pub fn migrate_existing_cache(&self, firmware_dir: &Path) -> Result<Vec<String>, String> {
        if !firmware_dir.exists() {
            return Ok(Vec::new());
        }

        let mut migrated_versions = Vec::new();
        let mut index = self.load_index()?;

        // Read firmware directory entries
        let entries = fs::read_dir(firmware_dir)
            .map_err(|e| format!("Failed to read firmware directory: {}", e))?;

        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
            let path = entry.path();

            // Look for .zip files
            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("zip") {
                if let Some(version) = path.file_stem().and_then(|s| s.to_str()) {
                    // Skip if already in index
                    if index.contains_key(version) {
                        continue;
                    }

                    // Check if corresponding extracted directory exists
                    let extracted_dir = firmware_dir.join(version);
                    if !extracted_dir.exists() {
                        continue;
                    }

                    // Calculate hash
                    let sha256_hash = match Self::calculate_sha256(&path) {
                        Ok(hash) => hash,
                        Err(_) => continue,
                    };

                    // Get file size
                    let file_size = match fs::metadata(&path) {
                        Ok(metadata) => metadata.len(),
                        Err(_) => continue,
                    };

                    // Get file modified time as fallback for download date
                    let downloaded_at = match fs::metadata(&path) {
                        Ok(metadata) => match metadata.modified() {
                            Ok(time) => {
                                let datetime: chrono::DateTime<chrono::Utc> = time.into();
                                datetime.to_rfc3339()
                            }
                            Err(_) => chrono::Utc::now().to_rfc3339(),
                        },
                        Err(_) => chrono::Utc::now().to_rfc3339(),
                    };

                    // Create metadata entry
                    let metadata = CachedFirmwareMetadata {
                        version: version.to_string(),
                        tag_name: version.to_string(),
                        sha256_hash,
                        zip_path: path.to_string_lossy().to_string(),
                        extracted_path: extracted_dir.to_string_lossy().to_string(),
                        downloaded_at,
                        file_size,
                        published_at: "".to_string(), // Unknown for migrated cache
                        release_notes: "Migrated from existing cache".to_string(),
                    };

                    index.insert(version.to_string(), metadata);
                    migrated_versions.push(version.to_string());
                }
            }
        }

        // Save updated index if we migrated anything
        if !migrated_versions.is_empty() {
            self.save_index(&index)?;
        }

        Ok(migrated_versions)
    }
}
