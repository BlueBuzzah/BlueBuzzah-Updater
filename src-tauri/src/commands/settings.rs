//! Tauri commands for advanced settings management.
//!
//! Provides get/save operations for advanced therapy settings,
//! persisting to a JSON file in the app data directory.

use crate::settings::{AdvancedSettings, SettingsManager};
use tauri::Manager;

/// Get current advanced settings from disk.
///
/// Returns default settings if no settings file exists yet.
#[tauri::command]
pub async fn get_advanced_settings(
    app_handle: tauri::AppHandle,
) -> Result<AdvancedSettings, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let manager = SettingsManager::new(&app_data_dir);
    manager.load()
}

/// Save advanced settings to disk.
///
/// This persists settings across app restarts.
#[tauri::command]
pub async fn save_advanced_settings(
    settings: AdvancedSettings,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let manager = SettingsManager::new(&app_data_dir);
    manager.save(&settings)?;

    // Log for debugging
    if settings.has_non_default_settings() {
        println!(
            "[Settings] Saved non-default settings: {:?}",
            settings.to_pre_profile_commands()
        );
    }

    Ok(())
}
