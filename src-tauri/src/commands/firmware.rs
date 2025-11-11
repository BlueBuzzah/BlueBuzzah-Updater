use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirmwareInfo {
    pub version: String,
    pub path: String,
}

#[tauri::command]
pub async fn download_firmware(
    url: String,
    version: String,
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

    // Extract the zip file
    let extract_dir = firmware_dir.join(&version);
    extract_zip(&firmware_file, &extract_dir)?;

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

    let firmware_dir = app_data_dir.join("firmware").join(&version);

    if firmware_dir.exists() {
        Ok(Some(firmware_dir.to_string_lossy().to_string()))
    } else {
        Ok(None)
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
