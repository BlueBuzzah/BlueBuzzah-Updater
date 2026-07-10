//! ESP32-S3 (PentaBuzzer / v3) flashing via `espflash`.
//!
//! Mirrors the stage/progress/cancellation idioms of `crate::dfu::protocol::upload_firmware`
//! so the existing frontend progress pipeline (built around `DfuStage`) works unchanged.
//! Writes the prebuilt v3 image parts at their manifest-specified offsets as raw bytes —
//! it does not patch flash mode/frequency/size headers baked into the images.

use std::time::Duration;

use espflash::connection::{Connection, ResetAfterOperation, ResetBeforeOperation};
use espflash::flasher::Flasher;
use espflash::target::{Chip, ProgressCallbacks};

use super::read_v3_zip;
use crate::dfu::{
    configure_device_role_flexible, find_supported_devices, get_reboot_settle_delay,
    get_reboot_timeout, wait_for_application_flexible, DeviceIdentifier, DfuStage,
};

/// `ProgressCallbacks` adapter that folds per-part progress into an overall
/// `DfuStage::Uploading { sent, total }` stream across the whole package.
struct StageProgress<'a> {
    emit: &'a dyn Fn(DfuStage),
    total: usize,
    done_before_part: usize,
    part_len: usize,
}

impl ProgressCallbacks for StageProgress<'_> {
    fn init(&mut self, _addr: u32, total: usize) {
        self.part_len = total;
        (self.emit)(DfuStage::Uploading {
            sent: self.done_before_part,
            total: self.total,
        });
    }

    fn update(&mut self, current: usize) {
        let sent = self.done_before_part + current.min(self.part_len);
        (self.emit)(DfuStage::Uploading {
            sent,
            total: self.total,
        });
    }

    fn verifying(&mut self) {
        // No dedicated stage for per-part verification; progress percentage
        // stays where it is until the next init()/update() call.
    }

    fn finish(&mut self, _skipped: bool) {}
}

/// Flash a v3 (ESP32-S3 / PentaBuzzer) firmware package to a device.
///
/// # Arguments
/// * `port_name` - Serial port of the device (must currently enumerate as `esp32s3`)
/// * `zip_path` - Path to the v3 firmware zip (see `crate::esp::read_v3_zip`)
/// * `device_role` - Role to configure after flashing ("PRIMARY" or "SECONDARY")
/// * `on_progress` - Progress callback, fed `DfuStage` values
/// * `is_cancelled` - Polled between parts and before long waits; returns `true` to abort
pub fn flash_v3<F: Fn(DfuStage), C: Fn() -> bool>(
    port_name: &str,
    zip_path: &str,
    device_role: &str,
    on_progress: F,
    is_cancelled: C,
) -> Result<(), String> {
    on_progress(DfuStage::ReadingPackage);
    let package = read_v3_zip(zip_path)?;

    let device = find_supported_devices()
        .into_iter()
        .find(|d| d.port == port_name)
        .ok_or_else(|| format!("Device not found on port {}", port_name))?;

    if device.board != "esp32s3" {
        return Err(format!(
            "Device on {} is not an ESP32-S3 (v3) device (board={})",
            port_name, device.board
        ));
    }

    on_progress(DfuStage::DetectedDevice {
        pid: device.pid,
        in_bootloader: device.in_bootloader,
    });

    let identifier = DeviceIdentifier::from_device(&device);

    if is_cancelled() {
        on_progress(DfuStage::Cancelled);
        return Err("Cancelled".to_string());
    }

    on_progress(DfuStage::Log {
        message: format!(
            "Flashing v3 application {} — manifest flash params: mode={} freq={} size={} (informational only; images are prebuilt)",
            package.manifest.application_version,
            package.manifest.flash.mode,
            package.manifest.flash.freq,
            package.manifest.flash.size
        ),
    });

    on_progress(DfuStage::Connecting);
    let connection = open_connection(port_name)?;

    // use_stub=true (faster transfer), verify=false (images are pre-validated via
    // SHA256 in read_v3_zip), skip=false (always write — offsets are absolute).
    let mut flasher = Flasher::connect(connection, true, false, false, Some(Chip::Esp32s3), None)
        .map_err(|e| format!("Failed to connect to ESP32-S3 bootloader: {}", e))?;

    on_progress(DfuStage::Starting);

    let total: usize = package.parts.iter().map(|p| p.data.len()).sum();
    let mut done_before_part = 0usize;

    for part in &package.parts {
        if is_cancelled() {
            on_progress(DfuStage::Cancelled);
            return Err("Cancelled".to_string());
        }

        let mut progress = StageProgress {
            emit: &on_progress,
            total,
            done_before_part,
            part_len: part.data.len(),
        };

        flasher
            .write_bin_to_flash(part.offset, &part.data, &mut progress)
            .map_err(|e| {
                format!(
                    "Failed to write \"{}\" at offset 0x{:X}: {}",
                    part.name, part.offset, e
                )
            })?;

        done_before_part += part.data.len();
    }

    on_progress(DfuStage::Finalizing);

    // The connection was opened with ResetAfterOperation::NoReset so each
    // per-part write_bin_to_flash() call leaves the device in the bootloader
    // instead of rebooting mid-package. Now that every part is written,
    // trigger the real hard reset into the application unconditionally.
    flasher
        .connection()
        .reset()
        .map_err(|e| format!("Failed to reset device after flashing: {}", e))?;

    on_progress(DfuStage::WaitingForReboot);
    std::thread::sleep(Duration::from_millis(get_reboot_settle_delay()));

    if is_cancelled() {
        on_progress(DfuStage::Cancelled);
        return Err("Cancelled".to_string());
    }

    let device = wait_for_application_flexible(&identifier, get_reboot_timeout())
        .map_err(|e| format!("Device did not come back up after flashing: {}", e))?;

    on_progress(DfuStage::ConfiguringRole);
    configure_device_role_flexible(&device.port, device_role, &identifier)
        .map_err(|e| format!("Failed to configure device role: {}", e))?;

    on_progress(DfuStage::Complete);
    Ok(())
}

/// Open a serial connection to an ESP32-S3 device ready for `Flasher::connect`.
///
/// `ResetAfterOperation::NoReset` keeps the device in the bootloader after each
/// `write_bin_to_flash()` call so parts can be flashed one at a time; the caller
/// triggers the real post-flash reset explicitly via `Connection::reset()`.
///
/// `ResetBeforeOperation::default()` (`DefaultReset`) is used for entering the
/// bootloader, but PentaBuzzer's USB-Serial/JTAG peripheral (PID 0x1001) is
/// auto-detected by `espflash` and always uses its dedicated JTAG-serial reset
/// sequence regardless of this setting (see `construct_reset_strategy_sequence`
/// in `espflash::connection::reset`).
fn open_connection(port_name: &str) -> Result<Connection, String> {
    let serial = serialport::new(port_name, 115_200)
        .timeout(Duration::from_millis(3000))
        .open_native()
        .map_err(|e| format!("Failed to open {}: {}", port_name, e))?;
    let port_info = find_usb_port_info(port_name)?;
    Ok(Connection::new(
        serial,
        port_info,
        ResetAfterOperation::NoReset,
        ResetBeforeOperation::default(),
        115_200,
    ))
}

fn find_usb_port_info(port_name: &str) -> Result<serialport::UsbPortInfo, String> {
    let ports = serialport::available_ports()
        .map_err(|e| format!("Failed to enumerate serial ports: {}", e))?;
    ports
        .into_iter()
        .find(|p| p.port_name == port_name)
        .and_then(|p| match p.port_type {
            serialport::SerialPortType::UsbPort(info) => Some(info),
            _ => None,
        })
        .ok_or_else(|| format!("USB info not found for {}", port_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stage_progress_reports_overall_percentage_across_parts() {
        let events: std::cell::RefCell<Vec<DfuStage>> = std::cell::RefCell::new(Vec::new());
        let emit = |stage: DfuStage| events.borrow_mut().push(stage);

        {
            let mut progress = StageProgress {
                emit: &emit,
                total: 100,
                done_before_part: 0,
                part_len: 40,
            };
            progress.init(0x0, 40);
            progress.update(40);
        }
        {
            let mut progress = StageProgress {
                emit: &emit,
                total: 100,
                done_before_part: 40,
                part_len: 60,
            };
            progress.init(0x10000, 60);
            progress.update(60);
        }

        let sent_values: Vec<usize> = events
            .borrow()
            .iter()
            .filter_map(|s| match s {
                DfuStage::Uploading { sent, .. } => Some(*sent),
                _ => None,
            })
            .collect();

        assert_eq!(sent_values, vec![0, 40, 40, 100]);
    }

    #[test]
    fn find_usb_port_info_errors_for_unknown_port() {
        let err = find_usb_port_info("/dev/definitely-not-a-real-port").unwrap_err();
        assert!(err.contains("USB info not found"), "{err}");
    }

    #[test]
    fn flash_v3_rejects_missing_zip_before_touching_hardware() {
        let result = flash_v3(
            "/dev/definitely-not-a-real-port",
            "/definitely/not/a/real/path.zip",
            "PRIMARY",
            |_| {},
            || false,
        );
        let err = result.unwrap_err();
        assert!(err.contains("failed to open"), "{err}");
    }
}
