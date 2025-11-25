// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod cache;
mod traits;

#[cfg(test)]
mod test_helpers;

use commands::device::{detect_devices, wipe_device, copy_firmware, write_config, validate_device, rename_volume, find_renamed_volume};
use commands::firmware::{
    download_firmware,
    get_cached_firmware,
    calculate_sha256,
    get_cache_index,
    delete_cached_firmware,
    clear_all_cache,
    verify_cached_firmware,
    verify_and_clean_cache
};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            detect_devices,
            wipe_device,
            copy_firmware,
            write_config,
            validate_device,
            rename_volume,
            find_renamed_volume,
            download_firmware,
            get_cached_firmware,
            calculate_sha256,
            get_cache_index,
            delete_cached_firmware,
            clear_all_cache,
            verify_cached_firmware,
            verify_and_clean_cache
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
