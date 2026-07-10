use std::fs;
use std::path::Path;
use tauri::Manager;
use crate::cache::{CacheManager, CachedFirmwareMetadata, FirmwareCacheIndex};
use chrono;
use std::time::Duration;
use tauri_plugin_http::reqwest;

/// nrf52 keeps the legacy bare filename so existing caches stay valid.
fn firmware_filename(version: &str, board: &str) -> String {
    if board == "nrf52" {
        format!("{}.zip", version)
    } else {
        format!("{}-{}.zip", version, board)
    }
}

/// Reject `version`/`board` values that could escape the firmware cache
/// directory or corrupt cache keys. Both arrive over the IPC boundary; the
/// bundled frontend only sends well-formed values, so this is defense in
/// depth against a compromised webview or upstream release feed.
fn validate_cache_params(version: &str, board: &str) -> Result<(), String> {
    if !matches!(board, "nrf52" | "esp32s3") {
        return Err(format!("Unknown board \"{}\"", board));
    }
    if version.is_empty()
        || version.contains('/')
        || version.contains('\\')
        || version.contains("..")
        || version.contains("::")
    {
        return Err(format!("Invalid firmware version \"{}\"", version));
    }
    Ok(())
}

#[tauri::command]
pub async fn download_firmware(
    url: String,
    version: String,
    tag_name: String,
    published_at: String,
    release_notes: String,
    board: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    validate_cache_params(&version, &board)?;

    // Get app data directory
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let firmware_dir = app_data_dir.join("firmware");
    fs::create_dir_all(&firmware_dir)
        .map_err(|e| format!("Failed to create firmware directory: {}", e))?;

    let firmware_file = firmware_dir.join(firmware_filename(&version, &board));
    let tmp_file = firmware_dir.join(format!("{}.tmp", firmware_filename(&version, &board)));

    // Download the file with connect and total timeouts
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to download firmware: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Firmware download failed with HTTP status {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read firmware data: {}", e))?;

    // Write to temp file first to prevent partial downloads from corrupting cache
    fs::write(&tmp_file, &bytes).map_err(|e| {
        let _ = fs::remove_file(&tmp_file);
        format!("Failed to write firmware file: {}", e)
    })?;

    // Calculate SHA256 hash on the temp file
    let sha256_hash = CacheManager::calculate_sha256(&tmp_file).map_err(|e| {
        let _ = fs::remove_file(&tmp_file);
        format!("Failed to calculate hash: {}", e)
    })?;

    // Atomic rename from temp to final path
    fs::rename(&tmp_file, &firmware_file).map_err(|e| {
        let _ = fs::remove_file(&tmp_file);
        format!("Failed to finalize firmware file: {}", e)
    })?;

    // Get file size
    let file_size = fs::metadata(&firmware_file)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?
        .len();

    // Update cache index (no extraction needed - DFU reads directly from zip)
    let cache_manager = CacheManager::new(&app_data_dir)?;
    let metadata = CachedFirmwareMetadata {
        version: version.clone(),
        tag_name,
        sha256_hash,
        zip_path: firmware_file.to_string_lossy().to_string(),
        downloaded_at: chrono::Utc::now().to_rfc3339(),
        file_size,
        published_at,
        release_notes,
        board: board.clone(),
    };
    cache_manager.update_entry(metadata)?;

    // Return the zip path for DFU flashing
    Ok(firmware_file.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_cached_firmware(
    version: String,
    board: String,
    app_handle: tauri::AppHandle,
) -> Result<Option<String>, String> {
    validate_cache_params(&version, &board)?;

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    // Check cache index first
    let cache_manager = CacheManager::new(&app_data_dir)?;
    let entry = cache_manager.get_entry(&version, &board)?;

    match entry {
        Some(metadata) => {
            // Verify zip file still exists (DFU needs the zip, not extracted)
            let zip_path = Path::new(&metadata.zip_path);

            if zip_path.exists() {
                // Return zip path for DFU flashing
                Ok(Some(metadata.zip_path))
            } else {
                // Files missing, remove from cache index
                cache_manager.remove_entry(&version, &board)?;
                Ok(None)
            }
        }
        None => {
            // Fallback: check if zip file exists (for backwards compatibility)
            let firmware_zip = app_data_dir
                .join("firmware")
                .join(firmware_filename(&version, &board));
            if firmware_zip.exists() {
                Ok(Some(firmware_zip.to_string_lossy().to_string()))
            } else {
                Ok(None)
            }
        }
    }
}

#[tauri::command]
pub async fn calculate_sha256(
    file_path: String,
) -> Result<String, String> {
    let path = Path::new(&file_path);
    CacheManager::calculate_sha256(path)
}

#[tauri::command]
pub async fn get_cache_index(
    app_handle: tauri::AppHandle,
) -> Result<FirmwareCacheIndex, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let cache_manager = CacheManager::new(&app_data_dir)?;
    cache_manager.load_index()
}

#[tauri::command]
pub async fn delete_cached_firmware(
    version: String,
    board: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    validate_cache_params(&version, &board)?;

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let firmware_dir = app_data_dir.join("firmware");

    // Delete zip file
    let zip_file = firmware_dir.join(firmware_filename(&version, &board));
    if zip_file.exists() {
        fs::remove_file(&zip_file)
            .map_err(|e| format!("Failed to delete zip file: {}", e))?;
    }

    // Remove from cache index
    let cache_manager = CacheManager::new(&app_data_dir)?;
    cache_manager.remove_entry(&version, &board)?;

    Ok(())
}

#[tauri::command]
pub async fn clear_all_cache(
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let firmware_dir = app_data_dir.join("firmware");

    // Delete entire firmware directory
    if firmware_dir.exists() {
        fs::remove_dir_all(&firmware_dir)
            .map_err(|e| format!("Failed to delete firmware directory: {}", e))?;
    }

    // Clear cache index
    let cache_manager = CacheManager::new(&app_data_dir)?;
    cache_manager.clear_index()?;

    Ok(())
}

#[tauri::command]
pub async fn verify_cached_firmware(
    version: String,
    board: String,
    app_handle: tauri::AppHandle,
) -> Result<bool, String> {
    validate_cache_params(&version, &board)?;

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let cache_manager = CacheManager::new(&app_data_dir)?;
    cache_manager.verify_hash(&version, &board)
}

#[tauri::command]
pub async fn verify_and_clean_cache(
    app_handle: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let firmware_dir = app_data_dir.join("firmware");
    let cache_manager = CacheManager::new(&app_data_dir)?;

    // First, migrate any existing cached firmware not in the index
    let migrated = cache_manager.migrate_existing_cache(&firmware_dir)?;
    if !migrated.is_empty() {
        println!("Migrated {} existing cached firmware versions", migrated.len());
    }

    // Then, get list of (version, board) pairs with missing files
    let missing = cache_manager.verify_cache_integrity()?;

    // Remove stale entries from cache index
    for (version, board) in &missing {
        cache_manager.remove_entry(version, board)?;
    }

    Ok(missing
        .into_iter()
        .map(|(v, b)| CacheManager::cache_key(&v, &b))
        .collect())
}

// DFU zip reading tests live in src-tauri/src/dfu/firmware_reader.rs

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_cache_params_accepts_known_boards() {
        assert!(validate_cache_params("v1.2.0", "nrf52").is_ok());
        assert!(validate_cache_params("v1.2.0", "esp32s3").is_ok());
    }

    #[test]
    fn test_validate_cache_params_rejects_unknown_or_miscased_board() {
        assert!(validate_cache_params("v1.2.0", "NRF52").is_err());
        assert!(validate_cache_params("v1.2.0", "../../evil").is_err());
        assert!(validate_cache_params("v1.2.0", "").is_err());
    }

    #[test]
    fn test_validate_cache_params_rejects_path_and_key_metacharacters() {
        assert!(validate_cache_params("", "nrf52").is_err());
        assert!(validate_cache_params("../escape", "nrf52").is_err());
        assert!(validate_cache_params("a/b", "nrf52").is_err());
        assert!(validate_cache_params("a\\b", "nrf52").is_err());
        assert!(validate_cache_params("1.0.0::nrf52", "nrf52").is_err());
    }

    #[test]
    fn test_firmware_filename_conventions() {
        assert_eq!(firmware_filename("v1.2.0", "nrf52"), "v1.2.0.zip");
        assert_eq!(firmware_filename("v1.2.0", "esp32s3"), "v1.2.0-esp32s3.zip");
    }
}
