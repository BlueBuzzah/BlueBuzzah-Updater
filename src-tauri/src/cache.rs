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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_metadata(version: &str) -> CachedFirmwareMetadata {
        CachedFirmwareMetadata {
            version: version.to_string(),
            tag_name: format!("v{}", version),
            sha256_hash: "abc123def456".to_string(),
            zip_path: "/path/to/zip".to_string(),
            extracted_path: "/path/to/extracted".to_string(),
            downloaded_at: "2024-01-01T00:00:00Z".to_string(),
            file_size: 1024,
            published_at: "2024-01-01T00:00:00Z".to_string(),
            release_notes: "Test release".to_string(),
        }
    }

    #[test]
    fn test_calculate_sha256_valid_file() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        fs::write(&file_path, "hello world").unwrap();

        let hash = CacheManager::calculate_sha256(&file_path).unwrap();
        // SHA256 of "hello world"
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    #[test]
    fn test_calculate_sha256_empty_file() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("empty.txt");
        fs::write(&file_path, "").unwrap();

        let hash = CacheManager::calculate_sha256(&file_path).unwrap();
        // SHA256 of empty string
        assert_eq!(
            hash,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn test_calculate_sha256_missing_file() {
        let result = CacheManager::calculate_sha256(Path::new("/nonexistent/file.txt"));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to open file"));
    }

    #[test]
    fn test_load_index_missing_file() {
        let temp_dir = TempDir::new().unwrap();
        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();

        let index = cache_manager.load_index().unwrap();
        assert!(index.is_empty());
    }

    #[test]
    fn test_save_and_load_index() {
        let temp_dir = TempDir::new().unwrap();
        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();

        let mut index: FirmwareCacheIndex = HashMap::new();
        index.insert("v1.0.0".to_string(), create_test_metadata("1.0.0"));

        cache_manager.save_index(&index).unwrap();
        let loaded = cache_manager.load_index().unwrap();

        assert_eq!(loaded.len(), 1);
        assert!(loaded.contains_key("v1.0.0"));
        assert_eq!(loaded.get("v1.0.0").unwrap().sha256_hash, "abc123def456");
    }

    #[test]
    fn test_update_entry() {
        let temp_dir = TempDir::new().unwrap();
        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();

        let metadata = create_test_metadata("2.0.0");
        cache_manager.update_entry(metadata).unwrap();

        let index = cache_manager.load_index().unwrap();
        assert!(index.contains_key("2.0.0"));
        assert_eq!(index.get("2.0.0").unwrap().version, "2.0.0");
    }

    #[test]
    fn test_update_entry_overwrites() {
        let temp_dir = TempDir::new().unwrap();
        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();

        let metadata1 = CachedFirmwareMetadata {
            release_notes: "First version".to_string(),
            ..create_test_metadata("1.0.0")
        };
        cache_manager.update_entry(metadata1).unwrap();

        let metadata2 = CachedFirmwareMetadata {
            release_notes: "Updated version".to_string(),
            ..create_test_metadata("1.0.0")
        };
        cache_manager.update_entry(metadata2).unwrap();

        let index = cache_manager.load_index().unwrap();
        assert_eq!(index.len(), 1);
        assert_eq!(
            index.get("1.0.0").unwrap().release_notes,
            "Updated version"
        );
    }

    #[test]
    fn test_remove_entry() {
        let temp_dir = TempDir::new().unwrap();
        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();

        // Add an entry
        cache_manager
            .update_entry(create_test_metadata("1.0.0"))
            .unwrap();

        // Remove it
        cache_manager.remove_entry("1.0.0").unwrap();

        let index = cache_manager.load_index().unwrap();
        assert!(!index.contains_key("1.0.0"));
    }

    #[test]
    fn test_remove_nonexistent_entry() {
        let temp_dir = TempDir::new().unwrap();
        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();

        // Should not error when removing nonexistent entry
        let result = cache_manager.remove_entry("nonexistent");
        assert!(result.is_ok());
    }

    #[test]
    fn test_get_entry_exists() {
        let temp_dir = TempDir::new().unwrap();
        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();

        cache_manager
            .update_entry(create_test_metadata("1.0.0"))
            .unwrap();

        let entry = cache_manager.get_entry("1.0.0").unwrap();
        assert!(entry.is_some());
        assert_eq!(entry.unwrap().version, "1.0.0");
    }

    #[test]
    fn test_get_entry_not_exists() {
        let temp_dir = TempDir::new().unwrap();
        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();

        let entry = cache_manager.get_entry("nonexistent").unwrap();
        assert!(entry.is_none());
    }

    #[test]
    fn test_clear_index() {
        let temp_dir = TempDir::new().unwrap();
        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();

        // Add entries
        cache_manager
            .update_entry(create_test_metadata("1.0.0"))
            .unwrap();
        cache_manager
            .update_entry(create_test_metadata("2.0.0"))
            .unwrap();

        // Clear
        cache_manager.clear_index().unwrap();

        let index = cache_manager.load_index().unwrap();
        assert!(index.is_empty());
    }

    #[test]
    fn test_verify_cache_integrity_missing_files() {
        let temp_dir = TempDir::new().unwrap();
        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();

        // Add entry pointing to non-existent files
        let metadata = CachedFirmwareMetadata {
            zip_path: "/nonexistent/path.zip".to_string(),
            extracted_path: "/nonexistent/extracted".to_string(),
            ..create_test_metadata("1.0.0")
        };
        cache_manager.update_entry(metadata).unwrap();

        let missing = cache_manager.verify_cache_integrity().unwrap();
        assert_eq!(missing, vec!["1.0.0"]);
    }

    #[test]
    fn test_verify_cache_integrity_valid_files() {
        let temp_dir = TempDir::new().unwrap();
        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();

        // Create actual files
        let zip_path = temp_dir.path().join("v1.0.0.zip");
        let extracted_path = temp_dir.path().join("v1.0.0");
        fs::write(&zip_path, "test zip content").unwrap();
        fs::create_dir(&extracted_path).unwrap();

        let metadata = CachedFirmwareMetadata {
            zip_path: zip_path.to_string_lossy().to_string(),
            extracted_path: extracted_path.to_string_lossy().to_string(),
            ..create_test_metadata("1.0.0")
        };
        cache_manager.update_entry(metadata).unwrap();

        let missing = cache_manager.verify_cache_integrity().unwrap();
        assert!(missing.is_empty());
    }

    #[test]
    fn test_verify_hash_valid() {
        let temp_dir = TempDir::new().unwrap();
        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();

        // Create zip file and calculate its hash
        let zip_path = temp_dir.path().join("v1.0.0.zip");
        fs::write(&zip_path, "test content").unwrap();
        let hash = CacheManager::calculate_sha256(&zip_path).unwrap();

        let metadata = CachedFirmwareMetadata {
            sha256_hash: hash,
            zip_path: zip_path.to_string_lossy().to_string(),
            ..create_test_metadata("1.0.0")
        };
        cache_manager.update_entry(metadata).unwrap();

        assert!(cache_manager.verify_hash("1.0.0").unwrap());
    }

    #[test]
    fn test_verify_hash_invalid() {
        let temp_dir = TempDir::new().unwrap();
        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();

        // Create zip file with different content than hash
        let zip_path = temp_dir.path().join("v1.0.0.zip");
        fs::write(&zip_path, "actual content").unwrap();

        let metadata = CachedFirmwareMetadata {
            sha256_hash: "wrong_hash_value".to_string(),
            zip_path: zip_path.to_string_lossy().to_string(),
            ..create_test_metadata("1.0.0")
        };
        cache_manager.update_entry(metadata).unwrap();

        assert!(!cache_manager.verify_hash("1.0.0").unwrap());
    }

    #[test]
    fn test_verify_hash_missing_file() {
        let temp_dir = TempDir::new().unwrap();
        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();

        let metadata = CachedFirmwareMetadata {
            zip_path: "/nonexistent/file.zip".to_string(),
            ..create_test_metadata("1.0.0")
        };
        cache_manager.update_entry(metadata).unwrap();

        assert!(!cache_manager.verify_hash("1.0.0").unwrap());
    }

    #[test]
    fn test_verify_hash_nonexistent_version() {
        let temp_dir = TempDir::new().unwrap();
        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();

        assert!(!cache_manager.verify_hash("nonexistent").unwrap());
    }

    // ==================== Additional cache tests ====================

    #[test]
    fn test_migrate_existing_cache_valid_pair() {
        let temp_dir = TempDir::new().unwrap();
        let firmware_dir = temp_dir.path().join("firmware");
        fs::create_dir_all(&firmware_dir).unwrap();

        // Create zip file and extracted directory
        let zip_path = firmware_dir.join("v1.0.0.zip");
        let extracted_path = firmware_dir.join("v1.0.0");
        fs::write(&zip_path, "fake zip content").unwrap();
        fs::create_dir(&extracted_path).unwrap();

        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();
        let migrated = cache_manager.migrate_existing_cache(&firmware_dir).unwrap();

        assert_eq!(migrated.len(), 1);
        assert!(migrated.contains(&"v1.0.0".to_string()));

        // Verify it's in the index
        let entry = cache_manager.get_entry("v1.0.0").unwrap();
        assert!(entry.is_some());
    }

    #[test]
    fn test_migrate_existing_cache_skips_indexed() {
        let temp_dir = TempDir::new().unwrap();
        let firmware_dir = temp_dir.path().join("firmware");
        fs::create_dir_all(&firmware_dir).unwrap();

        // Create zip and extracted dir
        let zip_path = firmware_dir.join("v1.0.0.zip");
        let extracted_path = firmware_dir.join("v1.0.0");
        fs::write(&zip_path, "fake zip content").unwrap();
        fs::create_dir(&extracted_path).unwrap();

        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();

        // Pre-add to index
        cache_manager.update_entry(create_test_metadata("v1.0.0")).unwrap();

        // Migrate should skip already indexed
        let migrated = cache_manager.migrate_existing_cache(&firmware_dir).unwrap();
        assert!(migrated.is_empty());
    }

    #[test]
    fn test_migrate_existing_cache_requires_both_files() {
        let temp_dir = TempDir::new().unwrap();
        let firmware_dir = temp_dir.path().join("firmware");
        fs::create_dir_all(&firmware_dir).unwrap();

        // Create only zip file (no extracted dir)
        let zip_path = firmware_dir.join("v1.0.0.zip");
        fs::write(&zip_path, "fake zip content").unwrap();

        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();
        let migrated = cache_manager.migrate_existing_cache(&firmware_dir).unwrap();

        // Should not migrate without both files
        assert!(migrated.is_empty());
    }

    #[test]
    fn test_load_index_invalid_json() {
        let temp_dir = TempDir::new().unwrap();
        let cache_file = temp_dir.path().join("firmware_cache.json");

        // Write invalid JSON
        fs::write(&cache_file, "{ this is not valid json }").unwrap();

        let cache_manager = CacheManager::new(temp_dir.path()).unwrap();
        let result = cache_manager.load_index();

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to parse cache index"));
    }

    #[test]
    fn test_save_index_creates_parent_dirs() {
        let temp_dir = TempDir::new().unwrap();
        let nested_path = temp_dir.path().join("nested/deep/path");

        let cache_manager = CacheManager::new(&nested_path).unwrap();

        let mut index = std::collections::HashMap::new();
        index.insert("v1.0.0".to_string(), create_test_metadata("1.0.0"));

        let result = cache_manager.save_index(&index);

        assert!(result.is_ok());
        assert!(nested_path.join("firmware_cache.json").exists());
    }

    #[test]
    fn test_calculate_sha256_large_file() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("large.bin");

        // Create a file larger than the 8192 byte buffer
        let large_content: Vec<u8> = (0..16384).map(|i| (i % 256) as u8).collect();
        fs::write(&file_path, &large_content).unwrap();

        let result = CacheManager::calculate_sha256(&file_path);

        assert!(result.is_ok());
        // Just verify we get a valid 64-char hex hash
        let hash = result.unwrap();
        assert_eq!(hash.len(), 64);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
