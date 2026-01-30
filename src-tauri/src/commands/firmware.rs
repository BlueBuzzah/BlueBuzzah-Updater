use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::Manager;
use crate::cache::{CacheManager, CachedFirmwareMetadata, FirmwareCacheIndex};
use chrono;
use std::time::Duration;
use tauri_plugin_http::reqwest;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirmwareInfo {
    pub version: String,
    pub path: String,
}

#[tauri::command]
pub async fn download_firmware(
    url: String,
    version: String,
    tag_name: String,
    published_at: String,
    release_notes: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    // Get app data directory
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let firmware_dir = app_data_dir.join("firmware");
    fs::create_dir_all(&firmware_dir)
        .map_err(|e| format!("Failed to create firmware directory: {}", e))?;

    let firmware_file = firmware_dir.join(format!("{}.zip", version));
    let tmp_file = firmware_dir.join(format!("{}.zip.tmp", version));

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
    };
    cache_manager.update_entry(metadata)?;

    // Return the zip path for DFU flashing
    Ok(firmware_file.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_cached_firmware(
    version: String,
    app_handle: tauri::AppHandle,
) -> Result<Option<String>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    // Check cache index first
    let cache_manager = CacheManager::new(&app_data_dir)?;
    let entry = cache_manager.get_entry(&version)?;

    match entry {
        Some(metadata) => {
            // Verify zip file still exists (DFU needs the zip, not extracted)
            let zip_path = Path::new(&metadata.zip_path);

            if zip_path.exists() {
                // Return zip path for DFU flashing
                Ok(Some(metadata.zip_path))
            } else {
                // Files missing, remove from cache index
                cache_manager.remove_entry(&version)?;
                Ok(None)
            }
        }
        None => {
            // Fallback: check if zip file exists (for backwards compatibility)
            let firmware_zip = app_data_dir.join("firmware").join(format!("{}.zip", version));
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
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let firmware_dir = app_data_dir.join("firmware");

    // Delete zip file
    let zip_file = firmware_dir.join(format!("{}.zip", version));
    if zip_file.exists() {
        fs::remove_file(&zip_file)
            .map_err(|e| format!("Failed to delete zip file: {}", e))?;
    }

    // Remove from cache index
    let cache_manager = CacheManager::new(&app_data_dir)?;
    cache_manager.remove_entry(&version)?;

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
    app_handle: tauri::AppHandle,
) -> Result<bool, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let cache_manager = CacheManager::new(&app_data_dir)?;
    cache_manager.verify_hash(&version)
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

    // Then, get list of versions with missing files
    let missing_versions = cache_manager.verify_cache_integrity()?;

    // Remove stale entries from cache index
    for version in &missing_versions {
        cache_manager.remove_entry(version)?;
    }

    Ok(missing_versions)
}

// Tests moved to src-tauri/src/dfu/firmware_reader.rs for DFU zip reading
