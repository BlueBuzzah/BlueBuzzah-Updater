use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[cfg(target_os = "windows")]
use std::path::PathBuf;

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
                    if label.contains("CIRCUITPY") || label.contains("BLUEBUZZAH") || is_circuit_py {
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
        use std::os::windows::ffi::OsStrExt;
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

                        if label.contains("CIRCUITPY") || label.contains("BLUEBUZZAH") || is_circuit_py {
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
    let entries = fs::read_dir(path)
        .map_err(|e| format!("Failed to read device directory {:?}: {}. Check permissions and ensure the device is mounted.", device_path, e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let entry_path = entry.path();
        let file_name = entry_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        // Skip system files on macOS and hidden files
        if file_name.starts_with('.') {
            continue;
        }

        // Attempt to remove, but gracefully handle files that no longer exist
        if entry_path.is_dir() {
            if let Err(e) = fs::remove_dir_all(&entry_path) {
                // Ignore "not found" errors - if it's already gone, that's fine
                if e.kind() != std::io::ErrorKind::NotFound {
                    return Err(format!("Failed to remove directory {:?}: {}. The file may be in use or you may lack permissions.", entry_path, e));
                }
            }
        } else {
            if let Err(e) = fs::remove_file(&entry_path) {
                // Ignore "not found" errors - if it's already gone, that's fine
                if e.kind() != std::io::ErrorKind::NotFound {
                    return Err(format!("Failed to remove file {:?}: {}. The file may be in use or read-only.", entry_path, e));
                }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationInfo {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub available_space_mb: Option<f64>,
    pub required_space_mb: Option<f64>,
}

#[tauri::command]
pub async fn validate_device(device_path: String) -> Result<ValidationInfo, String> {
    let mut validation = ValidationInfo {
        valid: true,
        errors: Vec::new(),
        warnings: Vec::new(),
        available_space_mb: None,
        required_space_mb: Some(10.0), // Typical firmware is ~5-10MB
    };

    let path = Path::new(&device_path);

    // Check 1: Device path exists
    if !path.exists() {
        validation.valid = false;
        validation.errors.push(format!(
            "Device not found at {}. Please ensure the device is connected and mounted.",
            device_path
        ));
        return Ok(validation);
    }

    // Check 2: Device path is a directory
    if !path.is_dir() {
        validation.valid = false;
        validation.errors.push(format!(
            "Device path {} is not a directory.",
            device_path
        ));
        return Ok(validation);
    }

    // Check 3: Device is writable (test write)
    let test_file = path.join(".bluebuzzah_test_write");
    match fs::write(&test_file, "test") {
        Ok(_) => {
            // Clean up test file
            let _ = fs::remove_file(&test_file);
        }
        Err(e) => {
            validation.valid = false;
            validation.errors.push(format!(
                "Device is not writable: {}. Check if the device is write-protected or you lack permissions.",
                e
            ));
            return Ok(validation);
        }
    }

    // Check 4: Available disk space
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::MetadataExt;
        if let Ok(metadata) = fs::metadata(path) {
            // On macOS, we can get block size and blocks available
            let block_size = metadata.blksize();
            let blocks = metadata.blocks();
            let available_bytes = block_size * blocks;
            let available_mb = (available_bytes as f64) / (1024.0 * 1024.0);
            validation.available_space_mb = Some(available_mb);

            if available_mb < 10.0 {
                validation.valid = false;
                validation.errors.push(format!(
                    "Insufficient disk space. Available: {:.1} MB, Required: 10 MB",
                    available_mb
                ));
            } else if available_mb < 20.0 {
                validation.warnings.push(format!(
                    "Low disk space. Available: {:.1} MB. Consider freeing up space.",
                    available_mb
                ));
            }
        }
    }

    // Check 5: Verify it's likely a CircuitPython device
    let boot_out = path.join("boot_out.txt");
    if !boot_out.exists() {
        validation.warnings.push(
            "boot_out.txt not found. This may not be a CircuitPython device.".to_string()
        );
    }

    Ok(validation)
}

#[tauri::command]
pub async fn rename_volume(device_path: String, new_name: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        let output = Command::new("diskutil")
            .args(&["rename", &device_path, &new_name])
            .output()
            .map_err(|e| format!("Failed to execute diskutil: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "Failed to rename volume: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStrExt;
        use winapi::um::fileapi::SetVolumeLabelW;

        let drive_root: Vec<u16> = OsString::from(&device_path)
            .encode_wide()
            .chain(Some(0))
            .collect();

        let label: Vec<u16> = OsString::from(&new_name)
            .encode_wide()
            .chain(Some(0))
            .collect();

        unsafe {
            if SetVolumeLabelW(drive_root.as_ptr(), label.as_ptr()) == 0 {
                return Err("Failed to set volume label. May require administrator privileges.".to_string());
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn find_renamed_volume(_old_path: String, expected_name: String) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let volumes = Path::new("/Volumes");

        // First try the expected name
        let expected_path = volumes.join(&expected_name);
        if expected_path.exists() {
            // Verify it has boot_out.txt to confirm it's our device
            if expected_path.join("boot_out.txt").exists() {
                return Ok(expected_path.to_string_lossy().to_string());
            }
        }

        // Try variations with numbers (BLUEBUZZAH 1, BLUEBUZZAH 2, etc.)
        for i in 1..10 {
            let variant_name = format!("{} {}", expected_name, i);
            let variant_path = volumes.join(&variant_name);
            if variant_path.exists() && variant_path.join("boot_out.txt").exists() {
                return Ok(variant_path.to_string_lossy().to_string());
            }
        }

        // Fallback: return the expected path even if not found
        return Ok(expected_path.to_string_lossy().to_string());
    }

    #[cfg(target_os = "windows")]
    {
        // On Windows, the path doesn't change (drive letter stays same)
        return Ok(_old_path);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(_old_path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_count_files_empty_dir() {
        let temp_dir = TempDir::new().unwrap();
        let count = count_files(temp_dir.path()).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_count_files_single_file() {
        let temp_dir = TempDir::new().unwrap();
        fs::write(temp_dir.path().join("file.txt"), "content").unwrap();

        let count = count_files(temp_dir.path()).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_count_files_multiple_files() {
        let temp_dir = TempDir::new().unwrap();
        fs::write(temp_dir.path().join("file1.txt"), "content").unwrap();
        fs::write(temp_dir.path().join("file2.txt"), "content").unwrap();
        fs::write(temp_dir.path().join("file3.txt"), "content").unwrap();

        let count = count_files(temp_dir.path()).unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn test_count_files_nested_directories() {
        let temp_dir = TempDir::new().unwrap();

        // Create nested structure
        fs::write(temp_dir.path().join("root.txt"), "content").unwrap();
        fs::create_dir(temp_dir.path().join("subdir")).unwrap();
        fs::write(temp_dir.path().join("subdir/nested.txt"), "content").unwrap();
        fs::create_dir(temp_dir.path().join("subdir/deep")).unwrap();
        fs::write(temp_dir.path().join("subdir/deep/deep.txt"), "content").unwrap();

        let count = count_files(temp_dir.path()).unwrap();
        // Should count only files, not directories: root.txt, nested.txt, deep.txt
        assert_eq!(count, 3);
    }

    #[test]
    fn test_count_files_only_directories() {
        let temp_dir = TempDir::new().unwrap();
        fs::create_dir(temp_dir.path().join("dir1")).unwrap();
        fs::create_dir(temp_dir.path().join("dir2")).unwrap();

        let count = count_files(temp_dir.path()).unwrap();
        // Directories should not be counted
        assert_eq!(count, 0);
    }

    #[test]
    fn test_count_files_single_file_path() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("single.txt");
        fs::write(&file_path, "content").unwrap();

        // Counting a single file should return 1
        let count = count_files(&file_path).unwrap();
        assert_eq!(count, 1);
    }
}
