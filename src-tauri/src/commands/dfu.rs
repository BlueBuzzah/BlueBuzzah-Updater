//! Tauri commands for DFU (Device Firmware Update) operations.
//!
//! These commands expose the DFU functionality to the frontend.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::ipc::Channel;

/// Maximum number of operation-level retries for complete DFU failure.
/// This catches high-level failures like bootloader entry timeout or device disconnect.
/// Increased from 1 to 2 (3 total attempts) for better reliability on Windows.
const MAX_OPERATION_RETRIES: u32 = 2;

/// Global cancellation flag for DFU operations.
static DFU_CANCELLED: AtomicBool = AtomicBool::new(false);

/// Global guard to prevent concurrent flash operations.
static DFU_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

/// RAII guard that resets DFU_IN_PROGRESS when dropped.
struct DfuGuard;

impl Drop for DfuGuard {
    fn drop(&mut self) {
        DFU_IN_PROGRESS.store(false, Ordering::SeqCst);
    }
}

/// Check if cancellation was requested.
pub fn is_dfu_cancelled() -> bool {
    DFU_CANCELLED.load(Ordering::SeqCst)
}

/// Check if an operation-level error is retriable.
///
/// These are high-level failures that may succeed on a full retry,
/// such as bootloader entry timeout or device disconnection.
/// Extended to catch more Windows-specific transient errors.
fn is_operation_retriable(error: &str) -> bool {
    let e = error.to_lowercase();
    e.contains("timeout")
        || e.contains("bootloader")
        || e.contains("disconnected")
        || e.contains("health check")
        || e.contains("no compatible device")
        || e.contains("not found")
        // Windows driver transient issues
        || e.contains("not functioning")
        || e.contains("access denied")
        // macOS transient issues
        || e.contains("device not configured")
        // Generic transient issues
        || e.contains("i/o error")
        || e.contains("connection reset")
        || e.contains("temporarily unavailable")
}

use crate::dfu::{
    configure_device_with_settings, find_nrf52_devices, upload_firmware, DeviceIdentifier,
    DfuStage, Nrf52Device,
};
use crate::settings::AdvancedSettings;

/// Device information for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DfuDevice {
    /// Serial port path.
    pub port: String,
    /// Display label for the device.
    pub label: String,
    /// USB Vendor ID.
    pub vid: u16,
    /// USB Product ID.
    pub pid: u16,
    /// Whether the device is in bootloader mode.
    pub in_bootloader: bool,
    /// Device serial number (if available).
    pub serial_number: Option<String>,
}

impl From<Nrf52Device> for DfuDevice {
    fn from(device: Nrf52Device) -> Self {
        Self {
            port: device.port.clone(),
            label: device.display_label(),
            vid: device.vid,
            pid: device.pid,
            in_bootloader: device.in_bootloader,
            serial_number: device.serial_number,
        }
    }
}

/// Progress event sent to the frontend during DFU.
#[derive(Debug, Clone, Serialize)]
pub struct DfuProgressEvent {
    /// Current stage name.
    pub stage: String,
    /// Bytes sent (for uploading stage).
    pub sent: Option<usize>,
    /// Total bytes (for uploading stage).
    pub total: Option<usize>,
    /// Progress percentage (0-100).
    pub percent: f32,
    /// Human-readable message.
    pub message: String,
}

impl From<DfuStage> for DfuProgressEvent {
    fn from(stage: DfuStage) -> Self {
        let (stage_name, sent, total) = match &stage {
            DfuStage::ReadingPackage => ("reading", None, None),
            DfuStage::DetectedDevice { .. } => ("detected", None, None),
            DfuStage::EnteringBootloader => ("bootloader", None, None),
            DfuStage::WaitingForBootloader => ("waiting", None, None),
            DfuStage::Connecting => ("connecting", None, None),
            DfuStage::SendingInit => ("init", None, None),
            DfuStage::Starting => ("starting", None, None),
            DfuStage::Uploading { sent, total } => ("uploading", Some(*sent), Some(*total)),
            DfuStage::Finalizing => ("finalizing", None, None),
            DfuStage::WaitingForReboot => ("rebooting", None, None),
            DfuStage::ConfiguringRole => ("configuring", None, None),
            DfuStage::Complete => ("complete", None, None),
            DfuStage::Log { .. } => ("log", None, None),
            DfuStage::Cancelled => ("cancelled", None, None),
        };

        Self {
            stage: stage_name.to_string(),
            sent,
            total,
            percent: stage.percent(),
            message: stage.message(),
        }
    }
}

/// Detect connected nRF52 DFU-capable devices.
///
/// Returns a list of devices that can be updated via DFU.
/// Devices with duplicate labels are automatically numbered (e.g., "Device #1", "Device #2").
#[tauri::command]
pub async fn detect_dfu_devices() -> Result<Vec<DfuDevice>, String> {
    // Run device detection in a blocking task
    let devices = tokio::task::spawn_blocking(|| {
        let mut devices: Vec<DfuDevice> = find_nrf52_devices()
            .into_iter()
            .map(DfuDevice::from)
            .collect();

        // Count occurrences of each label
        let mut label_counts: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        for device in &devices {
            *label_counts.entry(device.label.clone()).or_insert(0) += 1;
        }

        // Add numbers to duplicate labels
        let mut label_indices: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        for device in &mut devices {
            if let Some(&count) = label_counts.get(&device.label) {
                if count > 1 {
                    let index = label_indices.entry(device.label.clone()).or_insert(0);
                    *index += 1;
                    device.label = format!("{} #{}", device.label, index);
                }
            }
        }

        devices
    })
    .await
    .map_err(|e| format!("Failed to detect devices: {}", e))?;

    Ok(devices)
}

/// Flash firmware to a device via DFU.
///
/// # Arguments
/// * `serial_port` - Serial port of the device
/// * `firmware_path` - Path to the firmware.zip file
/// * `device_role` - Role to configure ("PRIMARY" or "SECONDARY")
/// * `progress` - Channel for progress updates
///
/// This command includes automatic retry logic for transient failures.
/// If the operation fails with a retriable error (timeout, device disconnect, etc.),
/// it will wait and retry up to MAX_OPERATION_RETRIES times with progressive delays.
#[tauri::command]
pub async fn flash_dfu_firmware(
    serial_port: String,
    firmware_path: String,
    device_role: String,
    progress: Channel<DfuProgressEvent>,
) -> Result<(), String> {
    // Prevent concurrent flash operations
    if DFU_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return Err("A firmware installation is already in progress".into());
    }
    let _guard = DfuGuard;

    // Reset cancellation flag at start of new operation
    DFU_CANCELLED.store(false, Ordering::SeqCst);

    for attempt in 0..=MAX_OPERATION_RETRIES {
        // Check for cancellation before each attempt
        if is_dfu_cancelled() {
            return Err("Operation cancelled by user".to_string());
        }

        // Report retry attempt to frontend (except for first attempt)
        if attempt > 0 {
            let _ = progress.send(DfuProgressEvent {
                stage: "retrying".to_string(),
                sent: None,
                total: None,
                percent: -1.0,
                message: format!(
                    "Retrying firmware installation (attempt {}/{})...",
                    attempt + 1,
                    MAX_OPERATION_RETRIES + 1
                ),
            });
        }

        let result = flash_dfu_firmware_inner(
            serial_port.clone(),
            firmware_path.clone(),
            device_role.clone(),
            progress.clone(),
        )
        .await;

        match result {
            Ok(()) => return Ok(()),
            Err(e) if is_operation_retriable(&e) && attempt < MAX_OPERATION_RETRIES => {
                // Progressive delay: 3s for first retry, 5s for second
                let delay_secs = 3 + (attempt as u64 * 2);

                // Log the retry attempt
                let _ = progress.send(DfuProgressEvent {
                    stage: "log".to_string(),
                    sent: None,
                    total: None,
                    percent: -1.0,
                    message: format!(
                        "Attempt {} failed: {}. Waiting {} seconds before retry...",
                        attempt + 1,
                        e,
                        delay_secs
                    ),
                });

                // Wait before retry to allow device to stabilize
                tokio::time::sleep(Duration::from_secs(delay_secs)).await;

                // Reset cancellation flag for retry
                DFU_CANCELLED.store(false, Ordering::SeqCst);
            }
            Err(e) => {
                // Non-retriable error or max retries exceeded
                if attempt > 0 {
                    let _ = progress.send(DfuProgressEvent {
                        stage: "log".to_string(),
                        sent: None,
                        total: None,
                        percent: -1.0,
                        message: format!(
                            "Installation failed after {} attempt(s): {}",
                            attempt + 1,
                            e
                        ),
                    });
                }
                return Err(e);
            }
        }
    }

    // This shouldn't be reached, but just in case
    Err("Maximum retry attempts exceeded".to_string())
}

/// Inner implementation of flash_dfu_firmware without retry logic.
async fn flash_dfu_firmware_inner(
    serial_port: String,
    firmware_path: String,
    device_role: String,
    progress: Channel<DfuProgressEvent>,
) -> Result<(), String> {
    // Create a channel for progress updates from the blocking thread
    let (tx, rx) = mpsc::channel::<DfuStage>();

    // Spawn a task to forward progress updates
    let progress_channel = progress.clone();
    let progress_task = thread::spawn(move || {
        while let Ok(stage) = rx.recv() {
            let event = DfuProgressEvent::from(stage);
            if progress_channel.send(event).is_err() {
                // Frontend disconnected — cancel the DFU operation
                eprintln!("[DFU] Warning: progress channel disconnected, cancelling operation");
                DFU_CANCELLED.store(true, Ordering::SeqCst);
                break;
            }
        }
    });

    // Run DFU in a blocking task with cancellation support
    let result = tokio::task::spawn_blocking(move || {
        upload_firmware(
            &serial_port,
            &firmware_path,
            &device_role,
            |stage| {
                let _ = tx.send(stage);
            },
            is_dfu_cancelled,
        )
    })
    .await
    .map_err(|e| format!("DFU task panicked: {}", e))?;

    // Wait for progress forwarding to complete
    let _ = progress_task.join();

    result.map_err(|e| format!("{}", e))
}

/// Check if a device is in bootloader mode.
#[tauri::command]
pub async fn is_device_in_bootloader(serial_port: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        find_nrf52_devices()
            .into_iter()
            .find(|d| d.port == serial_port)
            .map(|d| d.in_bootloader)
            .unwrap_or(false)
    })
    .await
    .map_err(|e| format!("Failed to check device: {}", e))
}

/// Validate that a firmware zip file is valid.
#[tauri::command]
pub async fn validate_firmware_package(firmware_path: String) -> Result<FirmwareInfo, String> {
    use crate::dfu::read_firmware_zip;

    tokio::task::spawn_blocking(move || {
        let package = read_firmware_zip(&firmware_path).map_err(|e| format!("{}", e))?;

        Ok(FirmwareInfo {
            firmware_size: package.firmware_data.len(),
            init_size: package.init_data.len(),
            firmware_crc16: package.manifest.firmware_crc16,
            device_type: package.manifest.device_type,
            dfu_version: package.manifest.dfu_version,
        })
    })
    .await
    .map_err(|e| format!("Validation failed: {}", e))?
}

/// Cancel any in-progress DFU flash operation.
///
/// Sets a global cancellation flag that is checked during the DFU process.
/// The operation will stop at the next safe point.
#[tauri::command]
pub async fn cancel_dfu_flash() -> Result<(), String> {
    DFU_CANCELLED.store(true, Ordering::SeqCst);
    Ok(())
}

/// Progress event sent to the frontend during profile configuration.
#[derive(Debug, Clone, Serialize)]
pub struct ProfileProgressEvent {
    /// Current stage name: "connecting", "sending", "rebooting", "complete", "error"
    pub stage: String,
    /// Progress percentage (0-100).
    pub percent: f32,
    /// Human-readable message.
    pub message: String,
}

/// Set the therapy profile for a device with optional advanced settings.
///
/// This command configures a device's therapy profile by sending serial commands.
/// The device must be in APPLICATION mode (not bootloader mode).
/// After configuration, the device will automatically reboot.
///
/// If `advanced_settings` is provided, setting commands are sent BEFORE the
/// profile command. This allows configuring device behavior like LED state.
///
/// # Arguments
/// * `serial_port` - Serial port of the device
/// * `profile` - Profile to set ("REGULAR", "NOISY", "HYBRID", or "GENTLE")
/// * `advanced_settings` - Optional advanced settings (LED off, etc.)
/// * `progress` - Channel for progress updates
#[tauri::command]
pub async fn set_device_profile(
    serial_port: String,
    profile: String,
    advanced_settings: Option<AdvancedSettings>,
    progress: Channel<ProfileProgressEvent>,
) -> Result<(), String> {
    // Get device info and create identifier for tracking
    let device = tokio::task::spawn_blocking({
        let port = serial_port.clone();
        move || {
            find_nrf52_devices()
                .into_iter()
                .find(|d| d.port == port)
        }
    })
    .await
    .map_err(|e| format!("Failed to find device: {}", e))?
    .ok_or_else(|| "Device not found".to_string())?;

    let device_identifier = DeviceIdentifier::from_device(&device);

    // Log tracking method for diagnostics
    if device_identifier.has_serial() {
        eprintln!("[set_device_profile] Tracking device by serial number");
    } else {
        eprintln!("[set_device_profile] Device has no serial number - using VID/PID+port pattern");
    }

    // Verify device is in application mode (not bootloader)
    if device.in_bootloader {
        return Err(
            "Device is in bootloader mode. Please wait for it to boot into application mode."
                .to_string(),
        );
    }

    // Send progress: connecting
    let _ = progress.send(ProfileProgressEvent {
        stage: "connecting".to_string(),
        percent: 10.0,
        message: "Connecting to device...".to_string(),
    });

    // Create a channel for status updates from the blocking thread
    let (tx, rx) = mpsc::channel::<ProfileProgressEvent>();

    // Spawn a task to forward progress updates
    let progress_channel = progress.clone();
    let progress_task = thread::spawn(move || {
        while let Ok(event) = rx.recv() {
            if progress_channel.send(event).is_err() {
                eprintln!("[DFU] Warning: profile progress channel disconnected");
                break;
            }
        }
    });

    // Get pre-profile commands from advanced settings
    let pre_commands = advanced_settings
        .as_ref()
        .map(|s| s.to_pre_profile_commands())
        .unwrap_or_default();

    let has_settings = !pre_commands.is_empty()
        && advanced_settings
            .as_ref()
            .map(|s| s.has_non_default_settings())
            .unwrap_or(false);

    // Run profile configuration in a blocking task
    let result = tokio::task::spawn_blocking({
        let serial_port = serial_port.clone();
        let profile = profile.clone();
        let tx = tx.clone();

        move || {
            // Send progress: sending command
            let message = if has_settings {
                format!("Applying settings and {} profile...", profile)
            } else {
                format!("Sending {} profile command...", profile)
            };
            let _ = tx.send(ProfileProgressEvent {
                stage: "sending".to_string(),
                percent: 30.0,
                message,
            });

            // Create a logger that forwards to the progress channel
            let tx_log = tx.clone();
            let log = move |msg: &str| {
                let _ = tx_log.send(ProfileProgressEvent {
                    stage: "log".to_string(),
                    percent: -1.0, // Log messages don't affect progress
                    message: msg.to_string(),
                });
            };

            // Configure the profile (with or without advanced settings)
            let config_result = if pre_commands.is_empty() {
                // No advanced settings - use original function with logging
                let identifier = device_identifier.clone();
                configure_device_with_settings(&serial_port, &profile, &[], &identifier, log)
            } else {
                // Has advanced settings - use new function with logging
                let identifier = device_identifier.clone();
                configure_device_with_settings(
                    &serial_port,
                    &profile,
                    &pre_commands,
                    &identifier,
                    log,
                )
            };

            match &config_result {
                Ok(()) => {
                    // Send progress: rebooting (already handled internally, but we signal it)
                    let _ = tx.send(ProfileProgressEvent {
                        stage: "rebooting".to_string(),
                        percent: 70.0,
                        message: "Waiting for device to restart...".to_string(),
                    });

                    // Send progress: complete
                    let _ = tx.send(ProfileProgressEvent {
                        stage: "complete".to_string(),
                        percent: 100.0,
                        message: format!("Profile set to {}", profile),
                    });
                }
                Err(e) => {
                    let _ = tx.send(ProfileProgressEvent {
                        stage: "error".to_string(),
                        percent: 0.0,
                        message: format!("{}", e),
                    });
                }
            }

            config_result
        }
    })
    .await
    .map_err(|e| format!("Profile configuration task panicked: {}", e))?;

    // Wait for progress forwarding to complete
    drop(tx); // Close the sender to signal completion
    let _ = progress_task.join();

    result.map_err(|e| format!("{}", e))
}

/// Information about a firmware package.
#[derive(Debug, Clone, Serialize)]
pub struct FirmwareInfo {
    /// Size of the firmware binary in bytes.
    pub firmware_size: usize,
    /// Size of the init packet in bytes.
    pub init_size: usize,
    /// CRC16 of the firmware.
    pub firmware_crc16: u16,
    /// Target device type.
    pub device_type: u16,
    /// DFU protocol version.
    pub dfu_version: f32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dfu_progress_event_from_stage() {
        let stage = DfuStage::Uploading {
            sent: 50000,
            total: 100000,
        };
        let event = DfuProgressEvent::from(stage);

        assert_eq!(event.stage, "uploading");
        assert_eq!(event.sent, Some(50000));
        assert_eq!(event.total, Some(100000));
        assert!(event.percent > 0.0);
    }

    #[test]
    fn test_dfu_guard_resets_on_drop() {
        // Ensure clean state
        DFU_IN_PROGRESS.store(false, Ordering::SeqCst);

        {
            // Simulate acquiring the guard
            assert!(!DFU_IN_PROGRESS.swap(true, Ordering::SeqCst));
            let _guard = DfuGuard;
            assert!(DFU_IN_PROGRESS.load(Ordering::SeqCst));
        }
        // Guard dropped — should be reset
        assert!(!DFU_IN_PROGRESS.load(Ordering::SeqCst));
    }

    #[test]
    fn test_dfu_device_from_nrf52device() {
        let nrf_device = Nrf52Device {
            port: "/dev/cu.usbmodem1234".to_string(),
            vid: 0x239A,
            pid: 0x8029,
            serial_number: Some("ABC123".to_string()),
            in_bootloader: false,
            product_name: Some("Test Device".to_string()),
            manufacturer: None,
        };

        let dfu_device = DfuDevice::from(nrf_device);

        assert_eq!(dfu_device.port, "/dev/cu.usbmodem1234");
        assert_eq!(dfu_device.label, "Test Device");
        assert_eq!(dfu_device.vid, 0x239A);
        assert!(!dfu_device.in_bootloader);
    }
}
