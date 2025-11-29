//! HCI-based DFU Protocol implementation for Adafruit nRF52 bootloader.
//!
//! Orchestrates the complete DFU process using HCI-framed packets:
//! 1. StartDfu - Initialize with image type and sizes
//! 2. InitPacket - Send init data (firmware.dat)
//! 3. Firmware transfer - Send data packets
//! 4. StopDataPacket - End transfer
//! 5. Role configuration (post-reboot)

use std::path::Path;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::config::{
    calculate_erase_wait_time, BOOTLOADER_TIMEOUT_MS, FLASH_PAGE_WRITE_TIME_MS,
    FRAMES_PER_FLASH_PAGE, REBOOT_TIMEOUT_MS, ROLE_CONFIG_TIMEOUT_MS, ROLE_PRIMARY_COMMAND,
    ROLE_SECONDARY_COMMAND,
};
use super::device::{
    get_device_by_port, wait_for_application_by_serial, wait_for_bootloader_by_serial,
};
use super::error::{DfuError, DfuResult};
use super::firmware_reader::read_firmware_zip;
use super::packet::{
    build_firmware_data_packet, build_init_packet, build_start_dfu_packet, build_stop_data_packet,
    reset_sequence_number, HciAck, HciSlipDecoder, FIRMWARE_CHUNK_SIZE, IMAGE_TYPE_APPLICATION,
};
use super::transport::{DfuTransport, SerialTransport};

/// Timeout for waiting for ACK response (milliseconds).
const ACK_TIMEOUT_MS: u64 = 5000;

/// DFU progress stages for UI feedback.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "stage", content = "data")]
pub enum DfuStage {
    /// Reading firmware package.
    ReadingPackage,
    /// Device mode detected (for debugging/transparency).
    DetectedDevice { pid: u16, in_bootloader: bool },
    /// Triggering bootloader mode.
    EnteringBootloader,
    /// Waiting for bootloader to appear.
    WaitingForBootloader,
    /// Connecting to bootloader.
    Connecting,
    /// Starting DFU transfer.
    Starting,
    /// Sending init packet.
    SendingInit,
    /// Uploading firmware data.
    Uploading { sent: usize, total: usize },
    /// Finalizing transfer.
    Finalizing,
    /// Waiting for device to reboot.
    WaitingForReboot,
    /// Configuring device role.
    ConfiguringRole,
    /// DFU process complete.
    Complete,
    /// Debug log message.
    Log { message: String },
}

impl DfuStage {
    /// Get a percentage estimate for this stage.
    pub fn percent(&self) -> f32 {
        match self {
            DfuStage::ReadingPackage => 0.0,
            DfuStage::DetectedDevice { .. } => 1.0,
            DfuStage::EnteringBootloader => 2.0,
            DfuStage::WaitingForBootloader => 5.0,
            DfuStage::Connecting => 8.0,
            DfuStage::Starting => 10.0,
            DfuStage::SendingInit => 12.0,
            DfuStage::Uploading { sent, total } => {
                if *total == 0 {
                    12.0
                } else {
                    12.0 + (*sent as f32 / *total as f32) * 78.0
                }
            }
            DfuStage::Finalizing => 92.0,
            DfuStage::WaitingForReboot => 94.0,
            DfuStage::ConfiguringRole => 97.0,
            DfuStage::Complete => 100.0,
            // Log messages don't affect progress percentage
            DfuStage::Log { .. } => -1.0,
        }
    }

    /// Get a human-readable message for this stage.
    pub fn message(&self) -> String {
        match self {
            DfuStage::ReadingPackage => "Reading firmware package...".into(),
            DfuStage::DetectedDevice { pid, in_bootloader } => {
                let mode = if *in_bootloader {
                    "BOOTLOADER"
                } else {
                    "APPLICATION"
                };
                format!("Detected device: PID=0x{:04X}, mode={}", pid, mode)
            }
            DfuStage::EnteringBootloader => "Entering bootloader mode...".into(),
            DfuStage::WaitingForBootloader => "Waiting for bootloader...".into(),
            DfuStage::Connecting => "Connecting to bootloader...".into(),
            DfuStage::Starting => "Starting firmware transfer...".into(),
            DfuStage::SendingInit => "Sending initialization data...".into(),
            DfuStage::Uploading { sent, total } => {
                let percent = if *total == 0 {
                    0
                } else {
                    (sent * 100) / total
                };
                format!("Uploading firmware... {}%", percent)
            }
            DfuStage::Finalizing => "Finalizing transfer...".into(),
            DfuStage::WaitingForReboot => "Waiting for device to restart...".into(),
            DfuStage::ConfiguringRole => "Configuring device role...".into(),
            DfuStage::Complete => "Update complete!".into(),
            DfuStage::Log { message } => message.clone(),
        }
    }
}

/// HCI-based DFU protocol handler.
pub struct HciDfuProtocol<T: DfuTransport, L: Fn(&str)> {
    transport: T,
    slip_decoder: HciSlipDecoder,
    log: L,
}

impl<T: DfuTransport, L: Fn(&str)> HciDfuProtocol<T, L> {
    /// Create a new HCI DFU protocol handler with the given transport and logger.
    pub fn new(transport: T, log: L) -> Self {
        // Reset sequence number for new DFU session
        reset_sequence_number();

        Self {
            transport,
            slip_decoder: HciSlipDecoder::new(),
            log,
        }
    }

    /// Clear any pending input data and reset decoder state.
    pub fn clear_input(&mut self) -> DfuResult<()> {
        self.slip_decoder.reset();
        self.transport.clear_input()
    }

    /// Wait for a specified duration while keeping the serial port active.
    ///
    /// This periodically reads from the port to drain any incoming data
    /// and prevent the port handle from going stale on macOS.
    pub fn wait_with_drain(&mut self, total_ms: u64) -> DfuResult<()> {
        const POLL_INTERVAL_MS: u64 = 100;
        let mut buffer = [0u8; 256];
        let mut elapsed = 0u64;

        while elapsed < total_ms {
            // Try to read any pending data (with short timeout)
            let _ = self.transport.read(&mut buffer, POLL_INTERVAL_MS);

            // Small sleep to prevent busy-waiting
            std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
            elapsed += POLL_INTERVAL_MS;
        }

        // Clear decoder state after wait
        self.slip_decoder.reset();
        Ok(())
    }

    /// Send a packet and wait for ACK.
    ///
    /// Matches nrfutil behavior: accept any ACK without sequence validation.
    /// The bootloader handles sequencing internally.
    fn send_and_wait_ack(&mut self, packet: &[u8]) -> DfuResult<()> {
        // Debug: log packet being sent
        (self.log)(&format!("Sending data ({} bytes)", packet.len()));

        // Send the packet (no explicit flush - pyserial doesn't flush either)
        self.transport.write(packet)?;

        // Wait for ACK - nrfutil doesn't validate sequence numbers
        let ack = self.wait_for_ack()?;
        (self.log)(&format!("Received ACK: seq={}", ack.ack_number));

        Ok(())
    }

    /// Wait for an ACK response from the bootloader.
    fn wait_for_ack(&mut self) -> DfuResult<HciAck> {
        let timeout = Duration::from_millis(ACK_TIMEOUT_MS);
        let start = Instant::now();
        let mut buffer = [0u8; 512];

        self.slip_decoder.reset();

        while start.elapsed() < timeout {
            let remaining = timeout.saturating_sub(start.elapsed());
            let bytes_read = self
                .transport
                .read(&mut buffer, remaining.as_millis() as u64)?;

            if bytes_read == 0 {
                continue;
            }

            for &byte in &buffer[..bytes_read] {
                if let Some(result) = self.slip_decoder.feed(byte) {
                    let frame = result?;
                    return HciAck::parse(&frame);
                }
            }
        }

        Err(DfuError::Timeout)
    }

    /// Send StartDfu command.
    pub fn send_start_dfu(&mut self, firmware_size: u32) -> DfuResult<()> {
        let packet = build_start_dfu_packet(IMAGE_TYPE_APPLICATION, 0, 0, firmware_size);
        self.send_and_wait_ack(&packet)
    }

    /// Send init packet (firmware.dat).
    pub fn send_init_packet(&mut self, init_data: &[u8]) -> DfuResult<()> {
        let packet = build_init_packet(init_data);
        self.send_and_wait_ack(&packet)
    }

    /// Send firmware data in chunks.
    ///
    /// Matches nrfutil behavior: after every 8 frames (4096 bytes = 1 flash page),
    /// wait for the bootloader to finish erasing/writing to flash.
    pub fn send_firmware<F>(&mut self, firmware: &[u8], on_progress: F) -> DfuResult<()>
    where
        F: Fn(usize, usize),
    {
        let total = firmware.len();
        let mut sent = 0;
        let mut frames = 0;

        for chunk in firmware.chunks(FIRMWARE_CHUNK_SIZE) {
            let packet = build_firmware_data_packet(chunk);
            self.send_and_wait_ack(&packet)?;

            sent += chunk.len();
            frames += 1;
            on_progress(sent, total);

            // After 8 frames (4096 bytes), the nRF52 will erase and write to flash.
            // While erasing/writing to flash, the CPU is blocked.
            // Wait for flash page write to complete (matches nrfutil exactly).
            if frames == FRAMES_PER_FLASH_PAGE {
                frames = 0;
                (self.log)(&format!(
                    "Flash page complete ({}/{} bytes), waiting {}ms for write...",
                    sent, total, FLASH_PAGE_WRITE_TIME_MS
                ));
                std::thread::sleep(Duration::from_millis(FLASH_PAGE_WRITE_TIME_MS));
            }
        }

        Ok(())
    }

    /// Send StopDataPacket to finalize the transfer.
    pub fn send_stop_data(&mut self) -> DfuResult<()> {
        let packet = build_stop_data_packet();
        self.send_and_wait_ack(&packet)
    }
}

/// Upload firmware to a device via DFU.
///
/// This is the high-level function that orchestrates the complete DFU process.
/// Supports devices in both application mode and bootloader mode.
///
/// # Arguments
/// * `port_name` - Serial port of the device (application OR bootloader mode)
/// * `firmware_zip_path` - Path to the firmware.zip file
/// * `device_role` - Role to configure ("PRIMARY" or "SECONDARY")
/// * `on_progress` - Callback for progress updates
pub fn upload_firmware<P, F>(
    port_name: &str,
    firmware_zip_path: P,
    device_role: &str,
    on_progress: F,
) -> DfuResult<()>
where
    P: AsRef<Path>,
    F: Fn(DfuStage),
{
    // Step 1: Read firmware package
    on_progress(DfuStage::ReadingPackage);
    let firmware = read_firmware_zip(firmware_zip_path)?;

    // Step 2: Get device info and serial number for tracking
    let device = get_device_by_port(port_name).ok_or(DfuError::NoDeviceFound)?;

    let serial_number = device
        .serial_number
        .clone()
        .ok_or(DfuError::NoSerialNumber)?;

    let already_in_bootloader = device.in_bootloader;

    // Report detected device mode to UI
    on_progress(DfuStage::DetectedDevice {
        pid: device.pid,
        in_bootloader: already_in_bootloader,
    });

    // Step 3: Enter Serial DFU mode
    on_progress(DfuStage::EnteringBootloader);

    let bootloader_port = if already_in_bootloader {
        // Device is already in bootloader - reset it to clear any stale state
        // from previous failed DFU attempts
        SerialTransport::reset_bootloader(port_name)?;

        on_progress(DfuStage::WaitingForBootloader);
        let bootloader_device =
            wait_for_bootloader_by_serial(&serial_number, BOOTLOADER_TIMEOUT_MS)?;
        bootloader_device.port
    } else {
        // Device is in application mode - use 1200 baud touch to enter bootloader
        SerialTransport::touch_reset(port_name)?;

        on_progress(DfuStage::WaitingForBootloader);
        let bootloader_device =
            wait_for_bootloader_by_serial(&serial_number, BOOTLOADER_TIMEOUT_MS)?;
        bootloader_device.port
    };

    // Step 4: Connect to bootloader
    on_progress(DfuStage::Connecting);
    let transport = SerialTransport::open(&bootloader_port)?;

    // Create a logging closure that sends Log events through the progress channel
    let log = |msg: &str| {
        on_progress(DfuStage::Log {
            message: msg.to_string(),
        });
    };

    let mut protocol = HciDfuProtocol::new(transport, log);

    // Step 5: Start DFU
    on_progress(DfuStage::Starting);
    let firmware_size = firmware.firmware_data.len();
    on_progress(DfuStage::Log {
        message: format!("Sending START DFU for {} bytes firmware", firmware_size),
    });
    protocol.send_start_dfu(firmware_size as u32)?;
    on_progress(DfuStage::Log {
        message: "START DFU sent and ACKed successfully".to_string(),
    });

    // Wait for flash erase to complete (bootloader erases pages after START)
    // Use wait_with_drain to keep the serial port active on macOS
    let erase_wait_ms = calculate_erase_wait_time(firmware_size);
    on_progress(DfuStage::Log {
        message: format!("Waiting {}ms for flash erase...", erase_wait_ms),
    });
    protocol.wait_with_drain(erase_wait_ms)?;
    on_progress(DfuStage::Log {
        message: "Erase wait complete, sending INIT packet...".to_string(),
    });

    // Step 6: Send init packet (firmware.dat)
    on_progress(DfuStage::SendingInit);
    on_progress(DfuStage::Log {
        message: format!("Init data size: {} bytes", firmware.init_data.len()),
    });
    protocol.send_init_packet(&firmware.init_data)?;
    on_progress(DfuStage::Log {
        message: "INIT packet sent and ACKed successfully".to_string(),
    });

    on_progress(DfuStage::Log {
        message: "Starting firmware data transfer...".to_string(),
    });

    // Step 7: Send firmware data
    let total = firmware.firmware_data.len();
    protocol.send_firmware(&firmware.firmware_data, |sent, _| {
        on_progress(DfuStage::Uploading { sent, total });
    })?;

    // Step 8: Send stop data packet to finalize
    on_progress(DfuStage::Finalizing);
    protocol.send_stop_data()?;

    // Close serial port to allow device to reboot
    drop(protocol);

    // Step 9: Wait for device to reboot into application mode
    on_progress(DfuStage::WaitingForReboot);
    std::thread::sleep(Duration::from_millis(2000)); // Give device time to boot
    let app_device = wait_for_application_by_serial(&serial_number, REBOOT_TIMEOUT_MS)?;

    // Step 10: Configure device role
    on_progress(DfuStage::ConfiguringRole);
    configure_device_role(&app_device.port, device_role)?;

    on_progress(DfuStage::Complete);
    Ok(())
}

/// Configure the device role via serial command.
fn configure_device_role(port_name: &str, role: &str) -> DfuResult<()> {
    let command = match role.to_uppercase().as_str() {
        "PRIMARY" => ROLE_PRIMARY_COMMAND,
        "SECONDARY" => ROLE_SECONDARY_COMMAND,
        _ => {
            return Err(DfuError::RoleConfigFailed {
                reason: format!("Invalid role: {}", role),
            })
        }
    };

    // Open port and send command
    let mut transport = SerialTransport::open(port_name)?;

    // Wait for device to finish booting and drain boot log output.
    // The device outputs initialization logs on boot which can contain
    // "ERROR" from hardware init - we need to drain these first.
    let mut buffer = [0u8; 256];
    let drain_timeout = Duration::from_millis(3000);
    let drain_start = Instant::now();

    while drain_start.elapsed() < drain_timeout {
        let bytes_read = transport.read(&mut buffer, 200)?;
        if bytes_read == 0 {
            // No more data - device has finished booting
            break;
        }
        // Keep draining boot output
    }

    // Clear any remaining input
    transport.clear_input().ok();

    // Small delay then send command
    std::thread::sleep(Duration::from_millis(100));
    transport.write(command.as_bytes())?;
    transport.flush()?;

    // Wait for acknowledgment (or timeout)
    let timeout = Duration::from_millis(ROLE_CONFIG_TIMEOUT_MS);
    let start = Instant::now();
    let mut response = Vec::new();

    while start.elapsed() < timeout {
        let remaining = timeout.saturating_sub(start.elapsed());
        let bytes_read = transport.read(&mut buffer, remaining.as_millis() as u64)?;

        if bytes_read > 0 {
            response.extend_from_slice(&buffer[..bytes_read]);

            // Check for role-specific acknowledgment patterns
            let response_str = String::from_utf8_lossy(&response);
            if response_str.contains("ROLE:") || response_str.contains("OK") {
                return Ok(());
            }
            // Only fail on NAK - device boot logs contain ERROR which we should ignore
            if response_str.contains("NAK") || response_str.contains("INVALID") {
                return Err(DfuError::RoleConfigFailed {
                    reason: response_str.to_string(),
                });
            }
        }
    }

    // If we got here without an explicit error, assume success
    // (device may not echo back a response)
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dfu_stage_percent() {
        assert_eq!(DfuStage::ReadingPackage.percent(), 0.0);
        assert_eq!(DfuStage::Complete.percent(), 100.0);

        // Test uploading progress
        let stage = DfuStage::Uploading {
            sent: 50000,
            total: 100000,
        };
        let percent = stage.percent();
        assert!(percent > 12.0 && percent < 92.0);
    }

    #[test]
    fn test_dfu_stage_message() {
        assert!(DfuStage::ReadingPackage.message().contains("Reading"));
        assert!(DfuStage::Complete.message().contains("complete"));

        let stage = DfuStage::Uploading {
            sent: 75000,
            total: 100000,
        };
        assert!(stage.message().contains("75%"));
    }
}
