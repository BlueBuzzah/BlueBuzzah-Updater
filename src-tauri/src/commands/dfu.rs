//! Tauri commands for DFU (Device Firmware Update) operations.
//!
//! These commands expose the DFU functionality to the frontend.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use tauri::ipc::Channel;

/// Global cancellation flag for DFU operations.
static DFU_CANCELLED: AtomicBool = AtomicBool::new(false);

/// Check if cancellation was requested.
pub fn is_dfu_cancelled() -> bool {
    DFU_CANCELLED.load(Ordering::SeqCst)
}

use crate::dfu::{
    configure_device_profile, find_nrf52_devices, upload_firmware, DfuStage, Nrf52Device,
};

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
#[tauri::command]
pub async fn flash_dfu_firmware(
    serial_port: String,
    firmware_path: String,
    device_role: String,
    progress: Channel<DfuProgressEvent>,
) -> Result<(), String> {
    // Reset cancellation flag at start of new operation
    DFU_CANCELLED.store(false, Ordering::SeqCst);

    // Create a channel for progress updates from the blocking thread
    let (tx, rx) = mpsc::channel::<DfuStage>();

    // Spawn a task to forward progress updates
    let progress_channel = progress.clone();
    let progress_task = thread::spawn(move || {
        while let Ok(stage) = rx.recv() {
            let event = DfuProgressEvent::from(stage);
            let _ = progress_channel.send(event);
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

/// Set the therapy profile for a device.
///
/// This command configures a device's therapy profile by sending a serial command.
/// The device must be in APPLICATION mode (not bootloader mode).
/// After configuration, the device will automatically reboot.
///
/// # Arguments
/// * `serial_port` - Serial port of the device
/// * `profile` - Profile to set ("NOISY", "STANDARD", or "GENTLE")
/// * `progress` - Channel for progress updates
#[tauri::command]
pub async fn set_device_profile(
    serial_port: String,
    profile: String,
    progress: Channel<ProfileProgressEvent>,
) -> Result<(), String> {
    // Get device info to retrieve serial number
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

    let serial_number = device
        .serial_number
        .clone()
        .ok_or_else(|| "Device has no serial number".to_string())?;

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
            let _ = progress_channel.send(event);
        }
    });

    // Run profile configuration in a blocking task
    let result = tokio::task::spawn_blocking({
        let serial_port = serial_port.clone();
        let profile = profile.clone();
        let tx = tx.clone();

        move || {
            // Send progress: sending command
            let _ = tx.send(ProfileProgressEvent {
                stage: "sending".to_string(),
                percent: 30.0,
                message: format!("Sending {} profile command...", profile),
            });

            // Configure the profile
            let config_result = configure_device_profile(&serial_port, &profile, &serial_number);

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
