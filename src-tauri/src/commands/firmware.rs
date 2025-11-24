use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::Manager;
use crate::cache::{CacheManager, CachedFirmwareMetadata, FirmwareCacheIndex};
use chrono;

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

    // Download the file
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to download firmware: {}", e))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read firmware data: {}", e))?;

    fs::write(&firmware_file, &bytes)
        .map_err(|e| format!("Failed to write firmware file: {}", e))?;

    // Calculate SHA256 hash
    let sha256_hash = CacheManager::calculate_sha256(&firmware_file)?;

    // Get file size
    let file_size = fs::metadata(&firmware_file)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?
        .len();

    // Extract the zip file
    let extract_dir = firmware_dir.join(&version);
    extract_zip(&firmware_file, &extract_dir)?;

    // Update cache index
    let cache_manager = CacheManager::new(&app_data_dir)?;
    let metadata = CachedFirmwareMetadata {
        version: version.clone(),
        tag_name,
        sha256_hash,
        zip_path: firmware_file.to_string_lossy().to_string(),
        extracted_path: extract_dir.to_string_lossy().to_string(),
        downloaded_at: chrono::Utc::now().to_rfc3339(),
        file_size,
        published_at,
        release_notes,
    };
    cache_manager.update_entry(metadata)?;

    Ok(extract_dir.to_string_lossy().to_string())
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
            // Verify files still exist
            let zip_path = Path::new(&metadata.zip_path);
            let extracted_path = Path::new(&metadata.extracted_path);

            if zip_path.exists() && extracted_path.exists() {
                Ok(Some(metadata.extracted_path))
            } else {
                // Files missing, remove from cache index
                cache_manager.remove_entry(&version)?;
                Ok(None)
            }
        }
        None => {
            // Fallback: check if directory exists (for backwards compatibility)
            let firmware_dir = app_data_dir.join("firmware").join(&version);
            if firmware_dir.exists() {
                Ok(Some(firmware_dir.to_string_lossy().to_string()))
            } else {
                Ok(None)
            }
        }
    }
}

fn extract_zip(zip_path: &Path, extract_to: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path)
        .map_err(|e| format!("Failed to open zip file: {}", e))?;

    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Failed to read zip archive: {}", e))?;

    fs::create_dir_all(extract_to)
        .map_err(|e| format!("Failed to create extract directory: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read file from archive: {}", e))?;

        let outpath = match file.enclosed_name() {
            Some(path) => extract_to.join(path),
            None => continue,
        };

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p)
                        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                }
            }
            let mut outfile = fs::File::create(&outpath)
                .map_err(|e| format!("Failed to create output file: {}", e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }

    Ok(())
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

    // Delete extracted directory
    let extracted_dir = firmware_dir.join(&version);
    if extracted_dir.exists() {
        fs::remove_dir_all(&extracted_dir)
            .map_err(|e| format!("Failed to delete extracted directory: {}", e))?;
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
