// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cache;
mod commands;
mod dfu;

use commands::dfu::{
    cancel_dfu_flash,
    detect_dfu_devices,
    flash_dfu_firmware,
    is_device_in_bootloader,
    set_device_profile,
    validate_firmware_package,
};
use commands::firmware::{
    calculate_sha256,
    clear_all_cache,
    delete_cached_firmware,
    download_firmware,
    get_cache_index,
    get_cached_firmware,
    verify_and_clean_cache,
    verify_cached_firmware,
};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // DFU commands
            detect_dfu_devices,
            flash_dfu_firmware,
            cancel_dfu_flash,
            is_device_in_bootloader,
            validate_firmware_package,
            set_device_profile,
            // Firmware cache commands
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
