use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    pub path: String,
    pub label: String,
    pub is_circuit_py: bool,
}

#[tauri::command]
pub async fn detect_devices() -> Result<Vec<Device>, String> {
    let mut devices = Vec::new();

    #[cfg(target_os = "macos")]
    {
        let volumes = Path::new("/Volumes");
        if let Ok(entries) = fs::read_dir(volumes) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let label = path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Unknown")
                        .to_string();

                    // Check if this is a CircuitPython device
                    let boot_out = path.join("boot_out.txt");
                    let is_circuit_py = boot_out.exists();

                    // Only include if it looks like a CircuitPython device
                    if label.contains("CIRCUITPY") || is_circuit_py {
                        devices.push(Device {
                            path: path.to_string_lossy().to_string(),
                            label,
                            is_circuit_py,
                        });
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;
        use winapi::um::fileapi::GetLogicalDrives;
        use winapi::um::fileapi::GetVolumeInformationW;

        unsafe {
            let drives = GetLogicalDrives();
            for i in 0..26 {
                if drives & (1 << i) != 0 {
                    let drive_letter = (b'A' + i as u8) as char;
                    let drive_path = format!("{}:\\", drive_letter);

                    let mut volume_name = [0u16; 261];
                    let drive_path_wide: Vec<u16> =
                        OsString::from(&drive_path).encode_wide().chain(Some(0)).collect();

                    let result = GetVolumeInformationW(
                        drive_path_wide.as_ptr(),
                        volume_name.as_mut_ptr(),
                        volume_name.len() as u32,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        0,
                    );

                    if result != 0 {
                        let label = String::from_utf16_lossy(&volume_name)
                            .trim_end_matches('\0')
                            .to_string();

                        let boot_out = PathBuf::from(&drive_path).join("boot_out.txt");
                        let is_circuit_py = boot_out.exists();

                        if label.contains("CIRCUITPY") || is_circuit_py {
                            devices.push(Device {
                                path: drive_path,
                                label: if label.is_empty() {
                                    "Unknown".to_string()
                                } else {
                                    label
                                },
                                is_circuit_py,
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(devices)
}

#[tauri::command]
pub async fn wipe_device(device_path: String) -> Result<(), String> {
    let path = Path::new(&device_path);

    if !path.exists() {
        return Err(format!("Device path does not exist: {}", device_path));
    }

    // Read directory and remove all files/folders except the volume root
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let file_name = entry_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");

            // Skip system files on macOS
            if file_name.starts_with('.') {
                continue;
            }

            if entry_path.is_dir() {
                fs::remove_dir_all(&entry_path)
                    .map_err(|e| format!("Failed to remove directory {:?}: {}", entry_path, e))?;
            } else {
                fs::remove_file(&entry_path)
                    .map_err(|e| format!("Failed to remove file {:?}: {}", entry_path, e))?;
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn copy_firmware(
    firmware_path: String,
    device_path: String,
    progress_callback: tauri::ipc::Channel<CopyProgress>,
) -> Result<(), String> {
    let source = Path::new(&firmware_path);
    let destination = Path::new(&device_path);

    if !source.exists() {
        return Err(format!("Firmware path does not exist: {}", firmware_path));
    }

    if !destination.exists() {
        return Err(format!("Device path does not exist: {}", device_path));
    }

    copy_dir_recursive(source, destination, &progress_callback)?;

    Ok(())
}

#[derive(Clone, Serialize)]
pub struct CopyProgress {
    pub current_file: String,
    pub total_files: usize,
    pub completed_files: usize,
}

fn copy_dir_recursive(
    source: &Path,
    destination: &Path,
    progress_callback: &tauri::ipc::Channel<CopyProgress>,
) -> Result<(), String> {
    // Count total files first
    let total_files = count_files(source)?;
    let mut completed_files = 0;

    copy_dir_recursive_impl(
        source,
        destination,
        progress_callback,
        &mut completed_files,
        total_files,
    )
}

fn copy_dir_recursive_impl(
    source: &Path,
    destination: &Path,
    progress_callback: &tauri::ipc::Channel<CopyProgress>,
    completed_files: &mut usize,
    total_files: usize,
) -> Result<(), String> {
    if source.is_dir() {
        if !destination.exists() {
            fs::create_dir_all(destination)
                .map_err(|e| format!("Failed to create directory {:?}: {}", destination, e))?;
        }

        for entry in fs::read_dir(source)
            .map_err(|e| format!("Failed to read directory {:?}: {}", source, e))?
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();
            let file_name = path.file_name().unwrap();
            let dest_path = destination.join(file_name);

            copy_dir_recursive_impl(&path, &dest_path, progress_callback, completed_files, total_files)?;
        }
    } else {
        fs::copy(source, destination)
            .map_err(|e| format!("Failed to copy {:?} to {:?}: {}", source, destination, e))?;

        *completed_files += 1;

        let _ = progress_callback.send(CopyProgress {
            current_file: source
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown")
                .to_string(),
            total_files,
            completed_files: *completed_files,
        });
    }

    Ok(())
}

fn count_files(path: &Path) -> Result<usize, String> {
    let mut count = 0;

    if path.is_dir() {
        for entry in fs::read_dir(path)
            .map_err(|e| format!("Failed to read directory {:?}: {}", path, e))?
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            count += count_files(&entry.path())?;
        }
    } else {
        count += 1;
    }

    Ok(count)
}

#[tauri::command]
pub async fn write_config(device_path: String, _role: String, config_content: String) -> Result<(), String> {
    let config_path = Path::new(&device_path).join("config.py");

    fs::write(&config_path, config_content)
        .map_err(|e| format!("Failed to write config.py: {}", e))?;

    Ok(())
}
