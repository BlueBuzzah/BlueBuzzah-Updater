//! HCI-based DFU Protocol implementation for Adafruit nRF52 bootloader.
//!
//! Orchestrates the complete DFU process using HCI-framed packets:
//! 1. StartDfu - Initialize with image type and sizes
//! 2. InitPacket - Send init data (firmware.dat)
//! 3. Firmware transfer - Send data packets
//! 4. StopDataPacket - End transfer
//! 5. Role configuration (post-reboot)

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::config::{
    calculate_erase_wait_time, get_bootloader_timeout, get_reboot_settle_delay, get_reboot_timeout,
    ACK_TIMEOUT_MS, BOOT_DRAIN_MAX_MS, BOOT_DRAIN_SILENCE_MS, BOOT_READY_MARKER,
    CONFIG_RETRY_DELAY_MS, FIRMWARE_TRANSFER_TIMEOUT_SECS, FLASH_PAGE_WRITE_TIME_MS,
    FRAMES_PER_FLASH_PAGE, MAX_CONFIG_RETRIES, MAX_PACKET_RETRIES, PROFILE_CONFIG_TIMEOUT_MS,
    PROFILE_GENTLE_COMMAND, PROFILE_HYBRID_COMMAND, PROFILE_NOISY_COMMAND, PROFILE_REGULAR_COMMAND,
    RETRY_BASE_DELAY_MS, ROLE_CONFIG_DEADLINE_MS, ROLE_CONFIG_TIMEOUT_MS, ROLE_PRIMARY_COMMAND,
    ROLE_SECONDARY_COMMAND, SERIAL_READY_TIMEOUT_MS,
};
use super::device::{
    find_nrf52_devices, get_device_by_port, snapshot_ports, wait_for_application_by_serial,
    wait_for_application_flexible, wait_for_bootloader_flexible, DeviceIdentifier, Nrf52Device,
};
use super::error::{DfuError, DfuResult};
use super::firmware_reader::read_firmware_zip;
use super::menu::{
    parse_menu_frames, preflight_primary_check, send_menu_command, write_custom_params,
    ProfileConfigOutcome, MENU_READY_PROBE_MS,
};
use super::packet::{
    build_firmware_data_packet, build_init_packet, build_start_dfu_packet, build_stop_data_packet,
    reset_sequence_number, HciAck, HciSlipDecoder, FIRMWARE_CHUNK_SIZE, IMAGE_TYPE_APPLICATION,
};
use super::transport::{DfuTransport, SerialTransport};
use crate::settings::CustomProfileParams;

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
    /// Something after the firmware write went wrong (a hardware fault the
    /// device reported, or the role step). The update still completes.
    Warning { message: String },
    /// Operation cancelled by user.
    Cancelled,
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
            // Warnings don't affect progress percentage
            DfuStage::Warning { .. } => -1.0,
            // Cancelled doesn't affect progress percentage
            DfuStage::Cancelled => -1.0,
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
                let percent = if *total == 0 { 0 } else { (sent * 100) / total };
                format!("Uploading firmware... {}%", percent)
            }
            DfuStage::Finalizing => "Finalizing transfer...".into(),
            DfuStage::WaitingForReboot => "Waiting for device to restart...".into(),
            DfuStage::ConfiguringRole => "Configuring device role...".into(),
            DfuStage::Complete => "Update complete!".into(),
            DfuStage::Log { message } => message.clone(),
            DfuStage::Warning { message } => message.clone(),
            DfuStage::Cancelled => "Cancelled by user".into(),
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

    /// Verify the connection is still healthy before a critical operation.
    ///
    /// Returns an error if the connection appears to be stale or disconnected.
    /// This helps detect issues early rather than waiting for a timeout.
    pub fn verify_connection(&mut self) -> DfuResult<()> {
        if !self.transport.is_healthy() {
            return Err(DfuError::DeviceDisconnected {
                operation: "connection health check".to_string(),
            });
        }
        Ok(())
    }

    /// Wait for a specified duration while keeping the serial port active.
    ///
    /// This periodically reads from the port to drain any incoming data
    /// and uses the keep_alive method to prevent the port handle from
    /// going stale on macOS.
    pub fn wait_with_drain(&mut self, total_ms: u64) -> DfuResult<()> {
        const POLL_INTERVAL_MS: u64 = 100;
        const KEEPALIVE_INTERVAL_MS: u64 = 500; // Send keep-alive every 500ms
        let mut buffer = [0u8; 256];
        let mut elapsed = 0u64;
        let mut since_keepalive = 0u64;

        while elapsed < total_ms {
            // Try to read any pending data (with short timeout)
            let _ = self.transport.read(&mut buffer, POLL_INTERVAL_MS);

            // Periodically send keep-alive to prevent port from going stale
            since_keepalive += POLL_INTERVAL_MS;
            if since_keepalive >= KEEPALIVE_INTERVAL_MS {
                self.transport.keep_alive()?;
                since_keepalive = 0;
            }

            // Small sleep to prevent busy-waiting
            std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
            elapsed += POLL_INTERVAL_MS;
        }

        // Clear decoder state after wait
        self.slip_decoder.reset();
        Ok(())
    }

    /// Send a packet and wait for ACK (single attempt, no retry).
    ///
    /// Matches nrfutil behavior: accept any ACK without sequence validation.
    /// The bootloader handles sequencing internally.
    fn send_and_wait_ack_once(&mut self, packet: &[u8]) -> DfuResult<HciAck> {
        // Send the packet (no explicit flush - pyserial doesn't flush either)
        self.transport.write(packet)?;

        // Wait for ACK - nrfutil doesn't validate sequence numbers
        self.wait_for_ack()
    }

    /// Send a packet and wait for ACK with automatic retry on transient failures.
    ///
    /// Uses exponential backoff: 100ms, 200ms, 400ms between retries.
    /// Retries on timeout, CRC mismatch, and sequence mismatch errors.
    /// All retry attempts are logged transparently for debugging.
    fn send_and_wait_ack(&mut self, packet: &[u8]) -> DfuResult<()> {
        // Debug: log packet being sent
        (self.log)(&format!("Sending data ({} bytes)", packet.len()));

        for attempt in 0..=MAX_PACKET_RETRIES {
            match self.send_and_wait_ack_once(packet) {
                Ok(ack) => {
                    // Log recovery if we had to retry
                    if attempt > 0 {
                        (self.log)(&format!("Recovered after {} retry attempt(s)", attempt));
                    }
                    (self.log)(&format!("Received ACK: seq={}", ack.ack_number));
                    return Ok(());
                }
                Err(e) if e.is_retriable() && attempt < MAX_PACKET_RETRIES => {
                    // Calculate exponential backoff delay: 100ms, 200ms, 400ms
                    let delay_ms = RETRY_BASE_DELAY_MS * 2u64.pow(attempt);

                    (self.log)(&format!(
                        "Retry {}/{}: {}, waiting {}ms...",
                        attempt + 1,
                        MAX_PACKET_RETRIES,
                        e,
                        delay_ms
                    ));

                    // Wait before retry
                    std::thread::sleep(Duration::from_millis(delay_ms));

                    // Clear any partial SLIP frames from the decoder
                    self.slip_decoder.reset();

                    // Re-send the packet on next iteration
                }
                Err(e) => {
                    // Non-retriable error, or max retries exhausted
                    if attempt > 0 {
                        (self.log)(&format!("Failed after {} retry attempt(s): {}", attempt, e));
                    }
                    return Err(e);
                }
            }
        }

        // This should be unreachable due to the loop logic, but satisfy the compiler
        Err(DfuError::MaxRetriesExceeded {
            operation: "send_and_wait_ack".to_string(),
        })
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
    ///
    /// Checks for cancellation before each chunk to allow graceful interruption.
    pub fn send_firmware<F, C>(
        &mut self,
        firmware: &[u8],
        on_progress: F,
        is_cancelled: C,
    ) -> DfuResult<()>
    where
        F: Fn(usize, usize),
        C: Fn() -> bool,
    {
        let total = firmware.len();
        let mut sent = 0;
        let mut frames = 0;
        let transfer_start = Instant::now();
        let transfer_timeout = Duration::from_secs(FIRMWARE_TRANSFER_TIMEOUT_SECS);

        for chunk in firmware.chunks(FIRMWARE_CHUNK_SIZE) {
            // Check for cancellation before each chunk
            if is_cancelled() {
                return Err(DfuError::Cancelled);
            }

            // Check overall transfer timeout
            if transfer_start.elapsed() > transfer_timeout {
                return Err(DfuError::Timeout);
            }

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
/// * `is_cancelled` - Closure that returns true if cancellation was requested
pub fn upload_firmware<P, F, C>(
    port_name: &str,
    firmware_zip_path: P,
    device_role: &str,
    on_progress: F,
    is_cancelled: C,
) -> DfuResult<()>
where
    P: AsRef<Path>,
    F: Fn(DfuStage),
    C: Fn() -> bool,
{
    // Step 1: Read firmware package
    on_progress(DfuStage::ReadingPackage);
    let firmware = read_firmware_zip(firmware_zip_path)?;

    // Check for cancellation after reading package
    if is_cancelled() {
        on_progress(DfuStage::Cancelled);
        return Err(DfuError::Cancelled);
    }

    // Step 2: Get device info and create identifier for tracking
    // Supports both serial number (preferred) and VID/PID+port pattern (fallback)
    let device = get_device_by_port(port_name).ok_or(DfuError::NoDeviceFound)?;

    let device_identifier = DeviceIdentifier::from_device(&device);
    let already_in_bootloader = device.in_bootloader;

    // Log tracking method for debugging
    if device_identifier.has_serial() {
        on_progress(DfuStage::Log {
            message: "Tracking device by serial number".to_string(),
        });
    } else {
        on_progress(DfuStage::Log {
            message: "Device has no serial number - using VID/PID+port pattern for tracking"
                .to_string(),
        });
    }

    // Report detected device mode to UI
    on_progress(DfuStage::DetectedDevice {
        pid: device.pid,
        in_bootloader: already_in_bootloader,
    });

    // Check for cancellation before entering bootloader
    if is_cancelled() {
        on_progress(DfuStage::Cancelled);
        return Err(DfuError::Cancelled);
    }

    // Step 3: Enter Serial DFU mode
    on_progress(DfuStage::EnteringBootloader);

    let bootloader_device = if already_in_bootloader {
        // Device is already in bootloader - reset it to clear any stale state
        // from previous failed DFU attempts
        SerialTransport::reset_bootloader(port_name)?;

        on_progress(DfuStage::WaitingForBootloader);
        wait_for_bootloader_flexible(&device_identifier, get_bootloader_timeout())?
    } else {
        // Device is in application mode - use 1200 baud touch to enter bootloader
        // On Windows, add a brief delay between the port enumeration scan
        // (get_device_by_port above) and the touch_reset open to let the USB
        // CDC ACM driver settle after SetupDi API queries.
        #[cfg(target_os = "windows")]
        std::thread::sleep(Duration::from_millis(200));

        SerialTransport::touch_reset(port_name)?;

        on_progress(DfuStage::WaitingForBootloader);
        wait_for_bootloader_flexible(&device_identifier, get_bootloader_timeout())?
    };
    let bootloader_port = bootloader_device.port.clone();

    // Check for cancellation before connecting to bootloader
    if is_cancelled() {
        on_progress(DfuStage::Cancelled);
        return Err(DfuError::Cancelled);
    }

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

    // Check for cancellation before starting DFU
    if is_cancelled() {
        on_progress(DfuStage::Cancelled);
        return Err(DfuError::Cancelled);
    }

    // Step 5: Start DFU
    on_progress(DfuStage::Starting);

    // Verify connection is healthy before starting the critical DFU process
    protocol.verify_connection()?;

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
        message: "Waiting for flash erase...".to_string(),
    });
    protocol.wait_with_drain(erase_wait_ms)?;
    on_progress(DfuStage::Log {
        message: "Erase complete, sending INIT...".to_string(),
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
    let result = protocol.send_firmware(
        &firmware.firmware_data,
        |sent, _| {
            on_progress(DfuStage::Uploading { sent, total });
        },
        &is_cancelled,
    );

    // Handle cancellation during firmware upload
    if let Err(DfuError::Cancelled) = &result {
        on_progress(DfuStage::Cancelled);
    }
    result?;

    // Step 8: Send stop data packet to finalize
    on_progress(DfuStage::Finalizing);
    protocol.send_stop_data()?;

    // Close serial port to allow device to reboot
    drop(protocol);
    on_progress(DfuStage::Log {
        message: "Transfer complete, waiting for device to reboot...".to_string(),
    });

    // Step 9: Wait for device to reboot into application mode. From here on
    // only a stop or a device left in bootloader mode can fail the update.
    on_progress(DfuStage::WaitingForReboot);
    std::thread::sleep(Duration::from_millis(get_reboot_settle_delay()));
    on_progress(DfuStage::Log {
        message: format!("Post-reboot port snapshot: {}", snapshot_ports()),
    });
    on_progress(DfuStage::Log {
        message: format!(
            "Scanning for device in application mode (timeout: {}ms)...",
            get_reboot_timeout()
        ),
    });
    let post_write = match wait_for_application_flexible(&device_identifier, get_reboot_timeout()) {
        // The stop-data ack is link-level only: a device still in bootloader
        // mode rejected the image, so the flash fails (and retries).
        Err(e) if left_in_bootloader(&bootloader_device, &find_nrf52_devices()) => {
            on_progress(DfuStage::Log {
                message: format!("{} | snapshot: {}", e, snapshot_ports()),
            });
            return Err(DfuError::FirmwareRejected);
        }
        Err(e) => Err(e),
        Ok(app_device) => {
            on_progress(DfuStage::Log {
                message: format!(
                    "Device found on port {} | snapshot: {}",
                    app_device.port,
                    snapshot_ports()
                ),
            });

            // Step 10: Configure device role (instrumented)
            on_progress(DfuStage::ConfiguringRole);
            let role_started = std::time::Instant::now();
            let role_result = configure_role_with_deadline(
                &app_device.port,
                device_role,
                &device_identifier,
                |m| {
                    on_progress(DfuStage::Log {
                        message: m.to_string(),
                    })
                },
                |w| {
                    on_progress(DfuStage::Warning {
                        message: w.to_string(),
                    })
                },
                &is_cancelled,
            );
            on_progress(DfuStage::Log {
                message: format!(
                    "Role config finished in {}ms (ok={}) | snapshot: {}",
                    role_started.elapsed().as_millis(),
                    role_result.is_ok(),
                    snapshot_ports()
                ),
            });
            role_result
        }
    };

    finish_after_write(post_write, &on_progress)
}

/// Whether the bootloader this flash wrote to (`written`) is still enumerated
/// in bootloader mode, on its port or by its serial number. Another glove in
/// bootloader mode doesn't count.
fn left_in_bootloader(written: &Nrf52Device, devices: &[Nrf52Device]) -> bool {
    devices.iter().any(|d| {
        d.in_bootloader
            && (d.port == written.port
                || (written.serial_number.is_some() && d.serial_number == written.serial_number))
    })
}

/// Warning shown when the device was flashed but its role step didn't finish.
const ROLE_NOT_SET_WARNING: &str = "The role wasn't set. Update this device again to set it.";

/// Warning shown when the device wasn't detected again after the update's reboot.
const DEVICE_NOT_BACK_WARNING: &str =
    "The device didn't come back after the update. Unplug it, plug it back in, then update it again.";

/// Warning shown when the role was acknowledged but the device wasn't detected
/// again after the restart that follows.
const ROLE_SET_DEVICE_NOT_FOUND_WARNING: &str =
    "The role is set, but the device wasn't found after it restarted. Unplug it and plug it back in.";

/// End an update whose firmware write succeeded. Only a stop fails it: any
/// other error after the write becomes a warning, and the update completes.
/// The role step only fails with `RoleConfigFailed`; any other error is the
/// reboot wait, so the device didn't come back.
pub(crate) fn finish_after_write<F: Fn(DfuStage)>(
    post_write: DfuResult<()>,
    on_progress: &F,
) -> DfuResult<()> {
    match post_write {
        Ok(()) => {}
        Err(DfuError::Cancelled) => {
            on_progress(DfuStage::Cancelled);
            return Err(DfuError::Cancelled);
        }
        Err(e) => {
            on_progress(DfuStage::Log {
                message: format!("After the firmware write: {}", e),
            });
            let warning = match e {
                DfuError::RoleConfigFailed { .. } => ROLE_NOT_SET_WARNING,
                _ => DEVICE_NOT_BACK_WARNING,
            };
            on_progress(DfuStage::Warning {
                message: warning.to_string(),
            });
        }
    }
    on_progress(DfuStage::Complete);
    Ok(())
}

/// Configure the device role via serial command (serial number tracking).
///
/// After receiving SET_ROLE, the device responds with:
/// - Success: "[CONFIG] Role set to PRIMARY - restarting..." (then reboots)
/// - Success: "[CONFIG] Role set to SECONDARY - restarting..." (then reboots)
/// - Error: "[ERROR] Invalid role. Use: SET_ROLE:PRIMARY or SET_ROLE:SECONDARY"
///
/// Since the device reboots after a successful role change, we need to:
/// 1. Send the command and wait for the [CONFIG] acknowledgment
/// 2. Wait for the device to reboot and reappear
///
/// Note: For flexible device tracking, use `configure_device_role_flexible()` instead.
#[allow(dead_code)]
fn configure_device_role(port_name: &str, role: &str, serial_number: &str) -> DfuResult<()> {
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
    // We wait for a period of silence (no data for 500ms) to indicate boot complete.
    let mut buffer = [0u8; 256];
    let drain_timeout = Duration::from_millis(5000);
    let drain_start = Instant::now();
    let mut last_data_time = Instant::now();
    const SILENCE_THRESHOLD_MS: u64 = 500;

    while drain_start.elapsed() < drain_timeout {
        let bytes_read = transport.read(&mut buffer, 200)?;
        if bytes_read > 0 {
            last_data_time = Instant::now();
            // Keep draining boot output
        } else if last_data_time.elapsed() > Duration::from_millis(SILENCE_THRESHOLD_MS) {
            // No data for 500ms - device has likely finished booting
            break;
        }
    }

    // Clear any remaining input
    transport.clear_input().ok();

    // Small delay then send command
    std::thread::sleep(Duration::from_millis(100));
    transport.write(command.as_bytes())?;
    transport.flush()?;

    // Wait for acknowledgment - device sends [CONFIG] on success, [ERROR] on failure
    // After [CONFIG], the device will reboot, so we may lose the connection
    let timeout = Duration::from_millis(ROLE_CONFIG_TIMEOUT_MS);
    let start = Instant::now();
    let mut response = Vec::new();

    while start.elapsed() < timeout {
        let remaining = timeout.saturating_sub(start.elapsed());
        let bytes_read = transport.read(&mut buffer, remaining.as_millis() as u64)?;

        if bytes_read > 0 {
            response.extend_from_slice(&buffer[..bytes_read]);

            let response_str = String::from_utf8_lossy(&response);

            // Check for success - device confirmed role change
            if response_str.contains("[CONFIG]") && response_str.contains("Role set to") {
                // Success! Device will now reboot.
                // Close the transport before device disconnects
                drop(transport);

                // Wait for device to reboot and reappear
                std::thread::sleep(Duration::from_millis(get_reboot_settle_delay()));
                wait_for_application_by_serial(serial_number, get_reboot_timeout())?;

                return Ok(());
            }

            // Check for explicit error from firmware
            if response_str.contains("[ERROR]") {
                return Err(DfuError::RoleConfigFailed {
                    reason: response_str.to_string(),
                });
            }
        }
    }

    // Timeout without receiving [CONFIG] or [ERROR] - this is a failure
    let response_str = String::from_utf8_lossy(&response);
    Err(DfuError::RoleConfigFailed {
        reason: format!(
            "Timeout waiting for role configuration acknowledgment. Received: {}",
            if response_str.is_empty() {
                "(no response)"
            } else {
                &response_str
            }
        ),
    })
}

/// Configure the device role using flexible device tracking with retry logic.
///
/// Works with both serial number and VID/PID+port pattern tracking.
/// Includes automatic retry for timing-related failures. Hardware-fault lines
/// read before each `SET_ROLE` go to `warn` as soon as they are found.
pub(crate) fn configure_device_role_flexible<L: Fn(&str), W: Fn(&str), C: Fn() -> bool>(
    port_name: &str,
    role: &str,
    identifier: &DeviceIdentifier,
    log: L,
    warn: W,
    is_cancelled: C,
) -> DfuResult<()> {
    let mut last_error: Option<DfuError> = None;
    let mut current_port = port_name.to_string();

    for attempt in 0..=MAX_CONFIG_RETRIES {
        if is_cancelled() {
            return Err(DfuError::Cancelled);
        }

        // On retry, wait for device to stabilize and update port
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(CONFIG_RETRY_DELAY_MS));
            // Re-wait for device and capture updated port
            if let Ok(device) = wait_for_application_flexible(identifier, 5000) {
                if device.port != current_port {
                    eprintln!(
                        "[configure_device_role] Device reappeared on new port: {}",
                        device.port
                    );
                }
                current_port = device.port;
            }
        }

        log(&format!(
            "Role config attempt {}/{} on {}",
            attempt + 1,
            MAX_CONFIG_RETRIES + 1,
            current_port
        ));
        match configure_device_role_flexible_inner(
            &current_port,
            role,
            identifier,
            &log,
            &warn,
            &is_cancelled,
        ) {
            Ok(()) => return Ok(()),
            Err(e) if e.is_retriable() && attempt < MAX_CONFIG_RETRIES => {
                log(&format!(
                    "Role config attempt {} failed: {}",
                    attempt + 1,
                    e
                ));
                last_error = Some(e);
            }
            Err(e) => return Err(e),
        }
    }

    // All retries exhausted
    Err(last_error.unwrap_or(DfuError::RoleConfigFailed {
        reason: "Max retries exceeded".to_string(),
    }))
}

/// Wrap a role-step error as `RoleConfigFailed` so it never triggers a re-flash.
/// `Cancelled` passes through so a stopped run reads as cancelled.
pub(crate) fn wrap_role_error(e: DfuError) -> DfuError {
    match e {
        DfuError::Cancelled | DfuError::RoleConfigFailed { .. } => e,
        other => DfuError::RoleConfigFailed {
            reason: other.to_string(),
        },
    }
}

enum RoleMsg {
    Log(String),
    Warning(String),
    Done(DfuResult<()>),
}

/// Run `work` on a worker thread, forwarding its log lines and warnings, and
/// give up when cancelled or at `deadline`. A serial call stuck in the kernel
/// then costs a bounded wait instead of freezing the install. The worker is
/// never joined: it exits when its blocked call returns or at its next stop check.
fn run_with_deadline<W, L, A, C>(
    work: W,
    log: L,
    on_warning: A,
    is_cancelled: C,
    deadline: Duration,
) -> DfuResult<()>
where
    W: FnOnce(&dyn Fn(&str), &dyn Fn(&str), &dyn Fn() -> bool) -> DfuResult<()> + Send + 'static,
    L: Fn(&str),
    A: Fn(&str),
    C: Fn() -> bool,
{
    let (tx, rx) = mpsc::channel();
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = Arc::clone(&stop);
    std::thread::spawn(move || {
        let log_tx = tx.clone();
        let warn_tx = tx.clone();
        let result = work(
            &|m: &str| {
                let _ = log_tx.send(RoleMsg::Log(m.to_string()));
            },
            &|w: &str| {
                let _ = warn_tx.send(RoleMsg::Warning(w.to_string()));
            },
            &|| worker_stop.load(Ordering::SeqCst),
        );
        let _ = tx.send(RoleMsg::Done(result));
    });

    // Warnings already sent still count when the run is cut short.
    let forward_pending_warnings = || {
        for msg in rx.try_iter() {
            if let RoleMsg::Warning(w) = msg {
                on_warning(&w);
            }
        }
    };

    let start = Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(RoleMsg::Log(m)) => log(&m),
            Ok(RoleMsg::Warning(w)) => on_warning(&w),
            Ok(RoleMsg::Done(result)) => return result,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                // The worker panicked before reporting.
                return Err(DfuError::RoleConfigFailed {
                    reason: "role configuration stopped unexpectedly".to_string(),
                });
            }
        }
        if is_cancelled() {
            stop.store(true, Ordering::SeqCst);
            forward_pending_warnings();
            return Err(DfuError::Cancelled);
        }
        if start.elapsed() >= deadline {
            stop.store(true, Ordering::SeqCst);
            forward_pending_warnings();
            return Err(DfuError::RoleConfigFailed {
                reason: format!(
                    "role configuration did not finish within {}s",
                    deadline.as_secs()
                ),
            });
        }
    }
}

/// Configure the device role under one overall deadline (`ROLE_CONFIG_DEADLINE_MS`),
/// honoring cancel. Errors other than `Cancelled` come back as `RoleConfigFailed`.
///
/// Hardware-fault lines read from the device go to `on_warning` as they arrive,
/// once each across all attempts, whether or not the role step succeeds.
pub(crate) fn configure_role_with_deadline<L: Fn(&str), A: Fn(&str), C: Fn() -> bool>(
    port_name: &str,
    role: &str,
    identifier: &DeviceIdentifier,
    log: L,
    on_warning: A,
    is_cancelled: C,
) -> DfuResult<()> {
    let (port, role, identifier) = (port_name.to_string(), role.to_string(), identifier.clone());
    let seen = std::cell::RefCell::new(Vec::<String>::new());
    run_with_deadline(
        move |log, warn, stop| {
            configure_device_role_flexible(&port, &role, &identifier, log, warn, stop)
        },
        log,
        |w: &str| {
            let mut seen = seen.borrow_mut();
            if !seen.iter().any(|s| s == w) {
                seen.push(w.to_string());
                on_warning(w);
            }
        },
        is_cancelled,
        Duration::from_millis(ROLE_CONFIG_DEADLINE_MS),
    )
    .map_err(wrap_role_error)
}

/// Inner implementation of role configuration without retry logic.
///
/// Checks `is_cancelled` between steps so a stopped attempt releases the port
/// and never sends SET_ROLE after the run has ended.
fn configure_device_role_flexible_inner<L: Fn(&str), W: Fn(&str), C: Fn() -> bool>(
    port_name: &str,
    role: &str,
    identifier: &DeviceIdentifier,
    log: &L,
    warn: &W,
    is_cancelled: &C,
) -> DfuResult<()> {
    let command = match role.to_uppercase().as_str() {
        "PRIMARY" => ROLE_PRIMARY_COMMAND,
        "SECONDARY" => ROLE_SECONDARY_COMMAND,
        _ => {
            return Err(DfuError::RoleConfigFailed {
                reason: format!("Invalid role: {}", role),
            })
        }
    };

    // Opening pulses DTR, which resets the glove: never do it once stopped.
    if is_cancelled() {
        return Err(DfuError::Cancelled);
    }
    let transport = SerialTransport::open(port_name)?;
    send_role_command(transport, command, identifier, log, warn, is_cancelled)
}

/// Send one role command on an open port, wait for the ack, then for the reboot.
fn send_role_command<L: Fn(&str), W: Fn(&str), C: Fn() -> bool>(
    mut transport: SerialTransport,
    command: &str,
    identifier: &DeviceIdentifier,
    log: &L,
    warn: &W,
    is_cancelled: &C,
) -> DfuResult<()> {
    send_role_and_await_ack(&mut transport, command, log, warn, is_cancelled)?;

    // Success! Device will now reboot.
    // Close the transport before device disconnects
    drop(transport);
    log("Role acknowledged, waiting for device to restart");

    // Wait for device to reboot and reappear. The role is set either way, so
    // a device that isn't detected again is a warning, not a role failure.
    std::thread::sleep(Duration::from_millis(get_reboot_settle_delay()));
    if let Err(e) = wait_for_application_flexible(identifier, get_reboot_timeout()) {
        log(&format!("Device not detected after the role restart: {}", e));
        warn(ROLE_SET_DEVICE_NOT_FOUND_WARNING);
    }

    Ok(())
}

/// Drain boot output, wait for the device to answer `GET_ROLE`, then send one
/// role command and wait for its acknowledgment.
///
/// Hardware-fault lines found before the command goes out are passed to `warn`
/// right away, so a later failure doesn't lose them, and are also returned.
fn send_role_and_await_ack<T: DfuTransport, L: Fn(&str), W: Fn(&str), C: Fn() -> bool>(
    transport: &mut T,
    command: &str,
    log: &L,
    warn: &W,
    is_cancelled: &C,
) -> DfuResult<Vec<String>> {
    if is_cancelled() {
        return Err(DfuError::Cancelled);
    }

    // Drain boot output using enhanced detection
    let drain = drain_boot_output_until(transport, is_cancelled)?;
    log_boot_drain(log, drain.found_ready);
    for w in &drain.warnings {
        warn(w);
    }
    let mut warnings = drain.warnings;

    let before = warnings.len();
    extend_unique(
        &mut warnings,
        wait_for_serial_ready(transport, log, is_cancelled, drain.tail)?,
    );
    for w in &warnings[before..] {
        warn(w);
    }

    // Clear any remaining input
    transport.clear_input().ok();

    // Small delay then send command
    std::thread::sleep(Duration::from_millis(100));
    if is_cancelled() {
        return Err(DfuError::Cancelled);
    }
    log(&format!("Sending {}", command.trim_end()));
    transport.write(command.as_bytes())?;
    transport.flush()?;

    // Wait for acknowledgment - device sends [CONFIG] on success, [ERROR] on failure
    // After [CONFIG], the device will reboot, so we may lose the connection
    let timeout = Duration::from_millis(ROLE_CONFIG_TIMEOUT_MS);
    let start = Instant::now();
    let mut response = Vec::new();
    let mut buffer = [0u8; 256];

    while start.elapsed() < timeout {
        if is_cancelled() {
            return Err(DfuError::Cancelled);
        }
        // Read in short slices so a stop is noticed while waiting for the ack.
        let wait = timeout
            .saturating_sub(start.elapsed())
            .min(Duration::from_millis(100));
        let bytes_read = transport.read(&mut buffer, wait.as_millis() as u64)?;

        if bytes_read > 0 {
            response.extend_from_slice(&buffer[..bytes_read]);

            let response_str = String::from_utf8_lossy(&response);

            // Check for success - device confirmed role change
            if response_str.contains("[CONFIG]") && response_str.contains("Role set to") {
                return Ok(warnings);
            }

            // Check for explicit error from firmware
            if response_str.contains("[ERROR]") {
                return Err(DfuError::RoleConfigFailed {
                    reason: response_str.to_string(),
                });
            }
        }
    }

    // Timeout without receiving [CONFIG] or [ERROR] - this is a failure
    let response_str = String::from_utf8_lossy(&response);
    Err(DfuError::RoleConfigFailed {
        reason: format!(
            "Timeout waiting for role configuration acknowledgment. Received: {}",
            if response_str.is_empty() {
                "(no response)"
            } else {
                &response_str
            }
        ),
    })
}

/// Collects hardware-fault lines from serial output, one complete line at a time.
///
/// Boot `[ERROR]` lines and a failed v3 motor check (`[WARN] Motor check:`) are
/// kept, de-duplicated in order. A skipped motor check (`[WARN] Motor check
/// skipped:`) is not a fault and doesn't match, because of the colon.
#[derive(Default)]
struct BootLines {
    partial: String,
    warnings: Vec<String>,
}

impl BootLines {
    /// Add a chunk of output. Returns the complete lines it finished, trimmed;
    /// a trailing partial line waits for the next chunk.
    fn push(&mut self, chunk: &str) -> Vec<String> {
        self.partial.push_str(chunk);
        let mut lines = Vec::new();
        while let Some(end) = self.partial.find('\n') {
            let line: String = self.partial.drain(..=end).collect();
            let line = line.trim().to_string();
            self.collect(&line);
            lines.push(line);
        }
        lines
    }

    /// Process the trailing partial line and return the warnings found. For
    /// an exit on silence or timeout, when no more of that line is coming.
    fn finish(mut self) -> Vec<String> {
        let tail = std::mem::take(&mut self.partial);
        self.collect(tail.trim());
        self.warnings
    }

    /// Return the warnings found and the unterminated trailing line, not yet
    /// processed. For an exit on a marker, when the rest of that line hasn't
    /// been read: carry it on, or drop it if the input is cleared next.
    fn split_tail(self) -> (Vec<String>, String) {
        (self.warnings, self.partial)
    }

    /// Start from a partial line an earlier reader left unfinished.
    fn with_tail(tail: String) -> Self {
        Self {
            partial: tail,
            warnings: Vec::new(),
        }
    }

    fn collect(&mut self, line: &str) {
        let is_fault = line.starts_with("[ERROR]") || line.starts_with("[WARN] Motor check:");
        if is_fault && !self.warnings.iter().any(|w| w == line) {
            self.warnings.push(line.to_string());
        }
    }
}

/// Append `more` to `warnings`, skipping lines already there.
fn extend_unique(warnings: &mut Vec<String>, more: Vec<String>) {
    for w in more {
        if !warnings.contains(&w) {
            warnings.push(w);
        }
    }
}

/// How a boot drain ended, and the hardware-fault lines it saw.
#[derive(Debug)]
struct BootDrain {
    found_ready: bool,
    warnings: Vec<String>,
    /// The unterminated line after `[READY]`, for the next reader to finish.
    tail: String,
}

/// Drain boot output until the firmware prints `[READY]`, falling back to
/// `BOOT_DRAIN_SILENCE_MS` of silence (firmware without `[READY]`), capped at
/// `BOOT_DRAIN_MAX_MS`.
fn drain_boot_output<T: DfuTransport>(transport: &mut T) -> DfuResult<BootDrain> {
    drain_boot_output_until(transport, &|| false)
}

/// Log how the boot drain ended, so a log shows whether `[READY]` arrived.
fn log_boot_drain<L: Fn(&str)>(log: &L, found_ready: bool) {
    if found_ready {
        log("[READY] seen");
    } else {
        log(&format!(
            "No [READY]; boot drain ended on silence or the {} s cap",
            BOOT_DRAIN_MAX_MS / 1000
        ));
    }
}

/// `drain_boot_output` that returns `Cancelled` between reads once stopped.
fn drain_boot_output_until<T: DfuTransport, C: Fn() -> bool>(
    transport: &mut T,
    is_cancelled: &C,
) -> DfuResult<BootDrain> {
    drain_boot_output_with(
        transport,
        is_cancelled,
        BOOT_DRAIN_SILENCE_MS,
        BOOT_DRAIN_MAX_MS,
    )
}

/// `drain_boot_output_until` with its silence threshold and cap as arguments.
fn drain_boot_output_with<T: DfuTransport, C: Fn() -> bool>(
    transport: &mut T,
    is_cancelled: &C,
    silence_ms: u64,
    max_ms: u64,
) -> DfuResult<BootDrain> {
    let mut buffer = [0u8; 256];
    let drain_timeout = Duration::from_millis(max_ms);
    let drain_start = Instant::now();
    let mut last_data_time = Instant::now();
    let mut accumulated = String::new();
    let mut lines = BootLines::default();

    while drain_start.elapsed() < drain_timeout {
        if is_cancelled() {
            return Err(DfuError::Cancelled);
        }
        let bytes_read = transport.read(&mut buffer, 200)?;
        if bytes_read > 0 {
            last_data_time = Instant::now();

            // Lossy, so one bad byte can't discard the chunk holding the marker
            let chunk = String::from_utf8_lossy(&buffer[..bytes_read]);
            lines.push(&chunk);
            accumulated.push_str(&chunk);
            if accumulated.contains(BOOT_READY_MARKER) {
                // Extra safety wait after the marker
                std::thread::sleep(Duration::from_millis(200));
                let (warnings, tail) = lines.split_tail();
                return Ok(BootDrain {
                    found_ready: true,
                    warnings,
                    tail,
                });
            }
            // Truncate to prevent unbounded growth, keeping a marker split
            // across reads; cut on a char boundary
            if accumulated.len() > 1024 {
                let mut cut = accumulated.len() - 512;
                while !accumulated.is_char_boundary(cut) {
                    cut += 1;
                }
                accumulated.drain(..cut);
            }
        } else if last_data_time.elapsed() > Duration::from_millis(silence_ms) {
            // No data for the silence threshold - boot likely complete
            break;
        }
    }

    Ok(BootDrain {
        found_ready: false,
        warnings: lines.finish(),
        tail: String::new(),
    })
}

/// Probe with `GET_ROLE` until the firmware answers with a `[CONFIG]` line,
/// so the next command isn't sent while it is still booting. Gives up after
/// `SERIAL_READY_TIMEOUT_MS` and lets the caller send anyway.
///
/// `tail` is the boot drain's unfinished last line, so a fault line split
/// across the two reads is still collected whole. Returns the hardware-fault
/// lines read while waiting.
fn wait_for_serial_ready<T: DfuTransport, L: Fn(&str), C: Fn() -> bool>(
    transport: &mut T,
    log: &L,
    is_cancelled: &C,
    tail: String,
) -> DfuResult<Vec<String>> {
    wait_for_serial_ready_with(
        transport,
        log,
        is_cancelled,
        tail,
        SERIAL_READY_TIMEOUT_MS,
        MENU_READY_PROBE_MS,
    )
}

/// `wait_for_serial_ready` with its timeout and probe interval as arguments.
fn wait_for_serial_ready_with<T: DfuTransport, L: Fn(&str), C: Fn() -> bool>(
    transport: &mut T,
    log: &L,
    is_cancelled: &C,
    tail: String,
    timeout_ms: u64,
    probe_ms: u64,
) -> DfuResult<Vec<String>> {
    let timeout = Duration::from_millis(timeout_ms);
    let probe = Duration::from_millis(probe_ms);
    let start = Instant::now();
    let mut last_probe: Option<Instant> = None;
    let mut lines = BootLines::with_tail(tail);
    let mut buffer = [0u8; 256];

    while start.elapsed() < timeout {
        if is_cancelled() {
            return Err(DfuError::Cancelled);
        }
        if last_probe.is_none_or(|at| at.elapsed() >= probe) {
            transport.write(b"GET_ROLE\n")?;
            transport.flush()?;
            last_probe = Some(Instant::now());
        }
        let bytes_read = transport.read(&mut buffer, 100)?;
        if bytes_read > 0 {
            let chunk = String::from_utf8_lossy(&buffer[..bytes_read]);
            if lines.push(&chunk).iter().any(|l| l.contains("[CONFIG]")) {
                // The caller clears input next, so the unread rest of the
                // last line is gone: drop its start too.
                return Ok(lines.split_tail().0);
            }
        }
    }

    log("Device didn't answer GET_ROLE, sending anyway");
    Ok(lines.finish())
}

/// Configure the device therapy profile via serial command (serial number tracking).
///
/// After receiving SET_PROFILE, the device responds with:
/// - Success: "[CONFIG] Profile set to REGULAR - restarting..." (then reboots)
/// - Success: "[CONFIG] Profile set to NOISY - restarting..." (then reboots)
/// - Success: "[CONFIG] Profile set to HYBRID - restarting..." (then reboots)
/// - Success: "[CONFIG] Profile set to GENTLE - restarting..." (then reboots)
/// - Error: "[ERROR] Invalid profile..."
///
/// Profile mappings:
/// - REGULAR → regular_vcr: Default vCR, non-mirrored, no jitter
/// - NOISY → noisy_vcr: Mirrored with 23.5% jitter
/// - HYBRID → hybrid_vcr: Non-mirrored with 23.5% jitter
/// - GENTLE → gentle: Lower amplitude, sequential pattern
///
/// Since the device reboots after a successful profile change, we need to:
/// 1. Send the command and wait for the [CONFIG] acknowledgment
/// 2. Wait for the device to reboot and reappear
///
/// Note: For flexible device tracking, use `configure_device_profile_flexible()` instead.
#[allow(dead_code)]
pub fn configure_device_profile(
    port_name: &str,
    profile: &str,
    serial_number: &str,
) -> DfuResult<()> {
    let identifier = DeviceIdentifier::Serial {
        serial: serial_number.to_string(),
        vid: super::config::ADAFRUIT_VID,
        pid: 0x8029,
        port_pattern: String::new(),
    };
    configure_device_profile_flexible(port_name, profile, &identifier, |_| {})
}

/// Configure the device therapy profile using flexible device tracking.
///
/// Works with both serial number and VID/PID+port pattern tracking.
/// Includes enhanced boot detection and detailed logging.
///
/// # Arguments
/// * `port_name` - Serial port of the device
/// * `profile` - Profile to set ("REGULAR", "NOISY", "HYBRID", or "GENTLE")
/// * `identifier` - Device identifier for tracking through reboot
/// * `log` - Callback for debug log messages
pub fn configure_device_profile_flexible<L: Fn(&str)>(
    port_name: &str,
    profile: &str,
    identifier: &DeviceIdentifier,
    log: L,
) -> DfuResult<()> {
    let command = match profile.to_uppercase().as_str() {
        "REGULAR" => PROFILE_REGULAR_COMMAND,
        "NOISY" => PROFILE_NOISY_COMMAND,
        "HYBRID" => PROFILE_HYBRID_COMMAND,
        "GENTLE" => PROFILE_GENTLE_COMMAND,
        _ => {
            return Err(DfuError::ProfileConfigFailed {
                reason: format!(
                    "Invalid profile: {}. Valid profiles: REGULAR, NOISY, HYBRID, GENTLE",
                    profile
                ),
            })
        }
    };

    log(&format!("Opening serial port: {}", port_name));

    // Open port and send command
    let mut transport = SerialTransport::open(port_name)?;

    // Verify connection is healthy before proceeding
    if !transport.is_healthy() {
        return Err(DfuError::DeviceDisconnected {
            operation: "profile configuration health check".to_string(),
        });
    }

    log("Draining boot output...");

    // Use enhanced boot detection with marker support
    let drain = drain_boot_output(&mut transport)?;
    log_boot_drain(&log, drain.found_ready);

    // Clear any remaining input
    transport.clear_input().ok();

    // Small delay then send command
    std::thread::sleep(Duration::from_millis(100));
    log(&format!("Sending profile command: {}", profile));
    transport.write(command.as_bytes())?;
    transport.flush()?;

    // Wait for acknowledgment - device sends [CONFIG] on success, [ERROR] on failure
    // After [CONFIG], the device will reboot, so we may lose the connection
    let timeout = Duration::from_millis(PROFILE_CONFIG_TIMEOUT_MS);
    let start = Instant::now();
    let mut response = Vec::new();
    let mut buffer = [0u8; 256];

    while start.elapsed() < timeout {
        let remaining = timeout.saturating_sub(start.elapsed());
        let bytes_read = transport.read(&mut buffer, remaining.as_millis() as u64)?;

        if bytes_read > 0 {
            response.extend_from_slice(&buffer[..bytes_read]);

            let response_str = String::from_utf8_lossy(&response);

            // Check for success - device confirmed profile change
            if response_str.contains("[CONFIG]") && response_str.contains("Profile set to") {
                log("Profile configuration acknowledged");
                // Success! Device will now reboot.
                // Close the transport before device disconnects
                drop(transport);

                // Wait for device to reboot and reappear
                log("Waiting for device to reboot...");
                std::thread::sleep(Duration::from_millis(get_reboot_settle_delay()));
                wait_for_application_flexible(identifier, get_reboot_timeout())?;
                log("Device reappeared after reboot");

                return Ok(());
            }

            // Check for explicit error from firmware
            if response_str.contains("[ERROR]") {
                log(&format!("Device returned error: {}", response_str));
                return Err(DfuError::ProfileConfigFailed {
                    reason: response_str.to_string(),
                });
            }
        }
    }

    // Timeout without receiving [CONFIG] or [ERROR] - this is a failure
    let response_str = String::from_utf8_lossy(&response);
    log(&format!(
        "Timeout waiting for acknowledgment. Received: {}",
        if response_str.is_empty() {
            "(no response)"
        } else {
            &response_str
        }
    ));
    Err(DfuError::ProfileConfigFailed {
        reason: format!(
            "Timeout waiting for profile configuration acknowledgment. Received: {}",
            if response_str.is_empty() {
                "(no response)"
            } else {
                &response_str
            }
        ),
    })
}

// =============================================================================
// Advanced Settings Configuration
// =============================================================================

/// Timeout for setting command acknowledgment (shorter than profile commands).
const SETTING_CONFIG_TIMEOUT_MS: u64 = 2000;

/// Send a single setting command and wait for acknowledgment.
///
/// Unlike profile commands, setting commands do NOT trigger a device reboot.
/// They configure device behavior that takes effect on the next therapy session.
///
/// Expected responses:
/// - Success: this command's menu frame echoing the setting,
///   `[MENU-TX] CMD:THERAPY_LED_OFF\nTHERAPY_LED_OFF:true\n\x04` (`[SETTING] ...` is
///   still accepted), or no reply at all (older firmware, or a SECONDARY glove,
///   which ignores menu commands)
/// - Error: this command's frame carrying `ERROR:...` only. A bare `[ERROR]`
///   line (say, the PRIMARY reporting a SECONDARY fault) is added to
///   `warnings`, not read as the answer.
///
/// # Arguments
/// * `transport` - Open serial transport
/// * `command` - Command string to send (should include newline)
/// * `log` - Callback for debug log messages
/// * `warnings` - Fault lines read while waiting are added here, even on failure
fn send_setting_command<T: DfuTransport, L: Fn(&str)>(
    transport: &mut T,
    command: &str,
    log: &L,
    warnings: &mut Vec<String>,
) -> DfuResult<()> {
    // Parse command to create human-readable log message
    let trimmed = command.trim();
    let (setting_name, setting_value) = trimmed.split_once(':').unwrap_or((trimmed, "unknown"));

    let friendly_name = match setting_name {
        "THERAPY_LED_OFF" => "Disable LED During Sessions",
        "DEBUG" => "Debug Mode",
        _ => setting_name,
    };

    log(&format!("Setting {} = {}", friendly_name, setting_value));

    // Replies carry no request ID: drop stale input so it isn't read as ours.
    transport.clear_input().ok();
    transport.write(command.as_bytes())?;
    transport.flush()?;

    // Wait for acknowledgment (shorter timeout than profile commands)
    let timeout = Duration::from_millis(SETTING_CONFIG_TIMEOUT_MS);
    let start = Instant::now();
    let mut response = Vec::new();
    let mut buffer = [0u8; 256];
    let mut lines = BootLines::default();
    let mut answered = false;

    let result = loop {
        if start.elapsed() >= timeout {
            // Timeout - treat as success for backwards compatibility with older
            // firmware that doesn't respond to setting commands
            log("Setting command timeout - device may not support this setting (continuing)");
            break Ok(());
        }
        let remaining = timeout.saturating_sub(start.elapsed());
        let bytes_read = match transport.read(&mut buffer, remaining.as_millis() as u64) {
            Ok(n) => n,
            Err(e) => break Err(e),
        };
        if bytes_read == 0 {
            continue;
        }
        response.extend_from_slice(&buffer[..bytes_read]);
        lines.push(&String::from_utf8_lossy(&buffer[..bytes_read]));
        let response_str = String::from_utf8_lossy(&response);

        // The menu answers with a frame naming the command (`CMD:<name>`)
        // that echoes the setting's key, or carries ERROR. Frames for other
        // commands are ignored. Older firmware sends no `CMD`: such a frame
        // counts if it carries the setting's key or an ERROR.
        let ours = parse_menu_frames(&response_str).into_iter().find(|frame| {
            match frame.get("CMD") {
                Some(cmd) => cmd == setting_name,
                None => frame.get(setting_name).is_some() || frame.error().is_some(),
            }
        });
        if let Some(frame) = ours {
            answered = true;
            break match frame.error() {
                Some(message) => Err(DfuError::SettingConfigFailed {
                    reason: format!("Device rejected {}: {}", trimmed, message),
                }),
                None => {
                    log(&format!("Setting acknowledged: {}", response_str.trim()));
                    Ok(())
                }
            };
        }

        // Check for success acknowledgment
        if response_str.contains("[SETTING]") {
            answered = true;
            log(&format!("Setting acknowledged: {}", response_str.trim()));
            break Ok(());
        }
    };

    // Fault lines that arrived while waiting are warnings, whatever the
    // answer. After an answer the rest of an unfinished line is unread: drop it.
    let found = if answered {
        lines.split_tail().0
    } else {
        lines.finish()
    };
    extend_unique(warnings, found);
    result
}

/// Configure device with advanced settings and therapy profile.
///
/// This is the main entry point for therapy configuration that supports
/// advanced settings. It:
/// 1. Opens the serial connection
/// 2. Drains boot output (waits for device ready)
/// 3. Sends each advanced setting command (no reboot triggered)
/// 4. Sends the profile command (triggers reboot)
/// 5. Waits for device to reappear
///
/// Includes automatic retry logic for timing-related failures.
///
/// Returns the hardware-fault lines the device printed before the first
/// command (boot `[ERROR]`s, a failed motor check), de-duplicated.
///
/// # Arguments
/// * `port_name` - Serial port of the device
/// * `profile` - Profile to set ("REGULAR", "NOISY", "HYBRID", or "GENTLE")
/// * `pre_profile_commands` - Commands to send before SET_PROFILE (from AdvancedSettings)
/// * `identifier` - Device identifier for tracking through reboot
/// * `log` - Callback for debug log messages
pub fn configure_device_with_settings<L: Fn(&str) + Clone>(
    port_name: &str,
    profile: &str,
    pre_profile_commands: &[String],
    identifier: &DeviceIdentifier,
    log: L,
) -> DfuResult<Vec<String>> {
    retry_configure(port_name, identifier, &log, |port, warnings| {
        configure_device_with_settings_inner(
            port,
            profile,
            pre_profile_commands,
            identifier,
            log.clone(),
            warnings,
        )
    })
}

/// Run `attempt` on the device's current port, retrying timing failures.
/// `warnings` collects fault lines across attempts; if every attempt fails
/// they're logged before the error is returned.
fn retry_configure<L, A>(
    port_name: &str,
    identifier: &DeviceIdentifier,
    log: &L,
    mut attempt_on: A,
) -> DfuResult<Vec<String>>
where
    L: Fn(&str),
    A: FnMut(&str, &mut Vec<String>) -> DfuResult<()>,
{
    let mut last_error: Option<DfuError> = None;
    let mut current_port = port_name.to_string();
    let mut warnings = Vec::new();

    for attempt in 0..=MAX_CONFIG_RETRIES {
        // On retry, wait for device to stabilize and update port
        if attempt > 0 {
            log(&format!(
                "Profile configuration retry {}/{}",
                attempt, MAX_CONFIG_RETRIES
            ));
            std::thread::sleep(Duration::from_millis(CONFIG_RETRY_DELAY_MS));
            // Re-wait for device and capture updated port
            if let Ok(device) = wait_for_application_flexible(identifier, 5000) {
                log(&format!("Device reappeared on port: {}", device.port));
                current_port = device.port;
            }
        }

        match attempt_on(&current_port, &mut warnings) {
            Ok(()) => return Ok(warnings),
            Err(e) if e.is_retriable() && attempt < MAX_CONFIG_RETRIES => {
                log(&format!("Profile configuration failed: {}, will retry", e));
                last_error = Some(e);
            }
            Err(e) => {
                log_device_warnings(log, &warnings);
                return Err(e);
            }
        }
    }

    // All retries exhausted
    log_device_warnings(log, &warnings);
    Err(last_error.unwrap_or(DfuError::ProfileConfigFailed {
        reason: "Max retries exceeded".to_string(),
    }))
}

/// Log hardware-fault lines read before a Configure failure, so the failure
/// doesn't hide them.
fn log_device_warnings<L: Fn(&str)>(log: &L, warnings: &[String]) {
    for w in warnings {
        log(&format!("Device reported: {}", w));
    }
}

/// Inner implementation of settings/profile configuration without retry logic.
/// Adds the fault lines it reads to `warnings`, so a failure keeps them.
fn configure_device_with_settings_inner<L: Fn(&str)>(
    port_name: &str,
    profile: &str,
    pre_profile_commands: &[String],
    identifier: &DeviceIdentifier,
    log: L,
    warnings: &mut Vec<String>,
) -> DfuResult<()> {
    let profile_command = match profile.to_uppercase().as_str() {
        "REGULAR" => PROFILE_REGULAR_COMMAND,
        "NOISY" => PROFILE_NOISY_COMMAND,
        "HYBRID" => PROFILE_HYBRID_COMMAND,
        "GENTLE" => PROFILE_GENTLE_COMMAND,
        _ => {
            return Err(DfuError::ProfileConfigFailed {
                reason: format!(
                    "Invalid profile: {}. Valid profiles: REGULAR, NOISY, HYBRID, GENTLE",
                    profile
                ),
            })
        }
    };

    log(&format!("Opening serial port: {}", port_name));
    let mut transport = SerialTransport::open(port_name)?;

    // Verify connection is healthy
    if !transport.is_healthy() {
        return Err(DfuError::DeviceDisconnected {
            operation: "settings configuration health check".to_string(),
        });
    }

    send_settings_and_profile(
        &mut transport,
        profile,
        profile_command,
        pre_profile_commands,
        &log,
        warnings,
    )?;
    drop(transport);

    log("Waiting for device to reboot...");
    std::thread::sleep(Duration::from_millis(get_reboot_settle_delay()));
    wait_for_application_flexible(identifier, get_reboot_timeout())?;
    log("Device reappeared after reboot");
    Ok(())
}

/// Drain boot output, wait for the device to answer, send the setting
/// commands, then the profile command, and wait for its acknowledgment. The
/// device reboots after it. Adds the fault lines it reads to `warnings`.
fn send_settings_and_profile<T: DfuTransport, L: Fn(&str)>(
    transport: &mut T,
    profile: &str,
    profile_command: &str,
    pre_profile_commands: &[String],
    log: &L,
    warnings: &mut Vec<String>,
) -> DfuResult<()> {
    log("Draining boot output...");
    let drain = drain_boot_output(transport)?;
    log_boot_drain(log, drain.found_ready);
    extend_unique(warnings, drain.warnings);
    extend_unique(
        warnings,
        wait_for_serial_ready(transport, log, &|| false, drain.tail)?,
    );

    transport.clear_input().ok();
    std::thread::sleep(Duration::from_millis(100));

    // Phase 1: Send all advanced setting commands
    if !pre_profile_commands.is_empty() {
        log(&format!(
            "Sending {} advanced setting command(s)...",
            pre_profile_commands.len()
        ));
        for command in pre_profile_commands {
            send_setting_command(transport, command, log, warnings)?;
            // Small delay between commands
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    // Phase 2: Send profile command (this triggers reboot)
    log(&format!("Sending profile command: {}", profile));
    transport.write(profile_command.as_bytes())?;
    transport.flush()?;

    // Wait for profile acknowledgment
    let timeout = Duration::from_millis(PROFILE_CONFIG_TIMEOUT_MS);
    let start = Instant::now();
    let mut response = Vec::new();
    let mut buffer = [0u8; 256];

    while start.elapsed() < timeout {
        let remaining = timeout.saturating_sub(start.elapsed());
        let bytes_read = transport.read(&mut buffer, remaining.as_millis() as u64)?;

        if bytes_read > 0 {
            response.extend_from_slice(&buffer[..bytes_read]);
            let response_str = String::from_utf8_lossy(&response);

            if response_str.contains("[CONFIG]") && response_str.contains("Profile set to") {
                log("Profile configuration acknowledged");
                return Ok(());
            }

            if response_str.contains("[ERROR]") {
                log(&format!("Device returned error: {}", response_str));
                return Err(DfuError::ProfileConfigFailed {
                    reason: response_str.to_string(),
                });
            }
        }
    }

    let response_str = String::from_utf8_lossy(&response);
    log(&format!(
        "Timeout waiting for acknowledgment. Received: {}",
        if response_str.is_empty() {
            "(no response)"
        } else {
            &response_str
        }
    ));
    Err(DfuError::ProfileConfigFailed {
        reason: format!(
            "Timeout waiting for profile configuration acknowledgment. Received: {}",
            if response_str.is_empty() {
                "(no response)"
            } else {
                &response_str
            }
        ),
    })
}

// =============================================================================
// Custom Profile Configuration (two-phase)
// =============================================================================

/// Load the Custom profile and write its parameters.
///
/// Two phases are unavoidable: `PROFILE_CUSTOM` is rejected unless Custom is
/// already the loaded profile (menu_controller.cpp:664) and `PROFILE_LOAD`
/// reboots the device (menu_controller.cpp:597).
///
/// 1. the advanced-settings pre-commands, exactly as the preset path sends them
/// 2. `PROFILE_LOAD:4` — the device answers STATUS:REBOOTING, then resets
/// 3. `wait_for_application_flexible` reacquires it on its (possibly new) port
/// 4. `write_custom_params` handles INFO / role gating / write / verify
///
/// Step 3 is where Windows COM renumbering lives, and it reuses the existing
/// re-enumeration handling unchanged — nothing new to build here.
///
/// Every outcome carries the hardware-fault lines read from both boots and
/// the readiness wait in `warnings`.
pub fn configure_custom_profile<L: Fn(&str) + Clone>(
    port_name: &str,
    params: &CustomProfileParams,
    pre_profile_commands: &[String],
    identifier: &DeviceIdentifier,
    log: L,
) -> DfuResult<ProfileConfigOutcome> {
    let mut warnings = Vec::new();
    match configure_custom_profile_steps(
        port_name,
        params,
        pre_profile_commands,
        identifier,
        log.clone(),
        &mut warnings,
    ) {
        Ok(mut outcome) => {
            outcome.warnings = warnings;
            Ok(outcome)
        }
        Err(e) => {
            log_device_warnings(&log, &warnings);
            Err(e)
        }
    }
}

/// `configure_custom_profile`'s steps, adding fault lines to `warnings` as read.
fn configure_custom_profile_steps<L: Fn(&str) + Clone>(
    port_name: &str,
    params: &CustomProfileParams,
    pre_profile_commands: &[String],
    identifier: &DeviceIdentifier,
    log: L,
    warnings: &mut Vec<String>,
) -> DfuResult<ProfileConfigOutcome> {
    log(&format!("Opening serial port: {}", port_name));
    let mut transport = SerialTransport::open(port_name)?;

    if !transport.is_healthy() {
        return Err(DfuError::DeviceDisconnected {
            operation: "custom profile configuration health check".to_string(),
        });
    }

    log("Draining boot output...");
    let drain = drain_boot_output(&mut transport)?;
    log_boot_drain(&log, drain.found_ready);
    extend_unique(warnings, drain.warnings);
    extend_unique(
        warnings,
        wait_for_serial_ready(&mut transport, &log, &|| false, drain.tail)?,
    );
    transport.clear_input().ok();
    std::thread::sleep(Duration::from_millis(100));

    if !pre_profile_commands.is_empty() {
        log(&format!(
            "Sending {} advanced setting command(s)...",
            pre_profile_commands.len()
        ));
        for command in pre_profile_commands {
            send_setting_command(&mut transport, command, &log, warnings)?;
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    // Role first, before anything is changed. PROFILE_LOAD:4 is itself a menu
    // command and main.cpp gates menu dispatch on PRIMARY, so a SECONDARY glove
    // ignores it and answers nothing — asking the role afterwards would mean
    // the load times out before we ever learn we were talking to a secondary.
    if let Some(outcome) = preflight_primary_check(&mut transport) {
        // Not logged here: the caller reports every outcome once, and echoing
        // it from inside the flow duplicated every line in the user's log.
        return Ok(outcome);
    }

    log("Loading Custom profile (device will reboot)...");
    send_menu_command(&mut transport, "PROFILE_LOAD:4", PROFILE_CONFIG_TIMEOUT_MS)?;
    drop(transport);

    // Point of no return: the device has ACKed PROFILE_LOAD and is now
    // irrevocably rebooting onto the Custom profile, carrying whatever
    // parameter override it held before. From here on the profile change has
    // landed on the device whether or not anything below succeeds, so no
    // failure may escape as `Err` — that would tell the caller the operation
    // failed when the glove has, in fact, already changed profiles. Every
    // failure from here on must become `Ok(partial)` instead.
    log("Waiting for device to reboot...");
    std::thread::sleep(Duration::from_millis(get_reboot_settle_delay()));

    let device = match wait_for_application_flexible(identifier, get_reboot_timeout()) {
        Ok(device) => device,
        Err(e) => {
            return Ok(ProfileConfigOutcome::partial_with_detail(
                "Profile loaded, but the device did not reappear after rebooting. \
                 It may still be running its previous custom settings.",
                e.to_string(),
            ))
        }
    };
    log(&format!("Device reappeared on port: {}", device.port));

    let mut transport = match SerialTransport::open(&device.port) {
        Ok(transport) => transport,
        Err(e) => {
            return Ok(ProfileConfigOutcome::partial_with_detail(
                "Profile loaded, but its port could not be reopened to confirm the \
                 parameters. It may still be running its previous custom settings.",
                e.to_string(),
            ))
        }
    };

    match drain_boot_output(&mut transport) {
        Ok(drain) => {
            log_boot_drain(&log, drain.found_ready);
            extend_unique(warnings, drain.warnings);
        }
        Err(e) => {
            return Ok(ProfileConfigOutcome::partial_with_detail(
                "Profile loaded, but its boot output could not be read to confirm the \
                 parameters. It may still be running its previous custom settings.",
                e.to_string(),
            ))
        }
    }
    transport.clear_input().ok();
    std::thread::sleep(Duration::from_millis(100));

    log("Writing custom parameters...");
    let outcome = write_custom_params(&mut transport, params)?;
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::super::menu::ScriptedTransport;
    use super::*;

    /// Opening the port pulses DTR (resets the glove), so a stopped attempt must
    /// not open it at all: a new flash may already be restarting that glove.
    #[test]
    fn stopped_role_attempt_never_opens_port() {
        let id = DeviceIdentifier::Serial {
            serial: "X".into(),
            vid: 0x239A,
            pid: 0x8029,
            port_pattern: String::new(),
        };
        let start = Instant::now();
        let stop = || true;
        let err = configure_device_role_flexible_inner(
            "/dev/cu.does-not-exist",
            "PRIMARY",
            &id,
            &|_: &str| {},
            &|_: &str| {},
            &stop,
        )
        .unwrap_err();
        assert!(matches!(err, DfuError::Cancelled), "got {err:?}");
        assert!(start.elapsed() < Duration::from_millis(100));
    }

    /// A stop during the boot-output drain must release the port promptly, not
    /// after the drain's 20 s budget, or a quick Try Again finds the port busy.
    /// The chatter pauses longer than the old 500 ms silence threshold (v3
    /// motor diagnostics do), and SET_ROLE must not go out in that pause.
    #[cfg(unix)]
    #[test]
    fn stop_during_boot_drain_returns_promptly() {
        use serialport::SerialPort;
        use std::io::{Read, Write};
        let (mut master, slave) = serialport::TTYPort::pair().unwrap();
        let mut reader = master.try_clone().unwrap();
        let transport = SerialTransport::from_port(Box::new(slave));
        let noisy = Arc::new(AtomicBool::new(true));
        let still_noisy = Arc::clone(&noisy);
        std::thread::spawn(move || {
            while still_noisy.load(Ordering::SeqCst) {
                let _ = master.write_all(b"[BOOT] diagnostics\n");
                std::thread::sleep(Duration::from_millis(1500));
            }
        });
        let id = DeviceIdentifier::Serial {
            serial: "X".into(),
            vid: 0x239A,
            pid: 0x8029,
            port_pattern: String::new(),
        };
        // Not stopped until well into the first pause in the chatter.
        let start = Instant::now();
        let stop = || start.elapsed() > Duration::from_millis(1200);
        let err = send_role_command(
            transport,
            ROLE_PRIMARY_COMMAND,
            &id,
            &|_: &str| {},
            &|_: &str| {},
            &stop,
        )
        .unwrap_err();
        noisy.store(false, Ordering::SeqCst);
        assert!(matches!(err, DfuError::Cancelled), "got {err:?}");
        assert!(
            start.elapsed() < Duration::from_millis(2000),
            "took {:?}",
            start.elapsed()
        );
        reader.set_timeout(Duration::from_millis(200)).unwrap();
        let mut buf = [0u8; 64];
        let sent = reader.read(&mut buf).unwrap_or(0);
        assert_eq!(
            sent,
            0,
            "sent {:?} during a pause in boot output",
            String::from_utf8_lossy(&buf[..sent])
        );
    }

    /// A stopped role attempt must let go of the port without sending SET_ROLE,
    /// or Try Again finds the port busy and the stopped role still gets written.
    #[cfg(unix)]
    #[test]
    fn stopped_role_attempt_sends_nothing() {
        use serialport::SerialPort;
        use std::io::Read;
        let (mut master, slave) = serialport::TTYPort::pair().unwrap();
        let transport = SerialTransport::from_port(Box::new(slave));
        let id = DeviceIdentifier::Serial {
            serial: "X".into(),
            vid: 0x239A,
            pid: 0x8029,
            port_pattern: String::new(),
        };
        let stop = || true;
        let err = send_role_command(
            transport,
            ROLE_PRIMARY_COMMAND,
            &id,
            &|_: &str| {},
            &|_: &str| {},
            &stop,
        )
        .unwrap_err();
        assert!(matches!(err, DfuError::Cancelled), "got {err:?}");
        master.set_timeout(Duration::from_millis(200)).unwrap();
        let mut buf = [0u8; 64];
        let sent = master.read(&mut buf).unwrap_or(0);
        assert_eq!(sent, 0, "SET_ROLE was written after stop");
    }

    /// Replays boot output on a clock: each chunk arrives at its offset from
    /// creation. Reads honor `timeout_ms`, so gaps look like real serial silence.
    struct TimedTransport {
        start: Instant,
        chunks: std::collections::VecDeque<(u64, Vec<u8>)>,
    }

    impl TimedTransport {
        fn new(chunks: Vec<(u64, &[u8])>) -> Self {
            Self {
                start: Instant::now(),
                chunks: chunks.into_iter().map(|(at, b)| (at, b.to_vec())).collect(),
            }
        }
    }

    impl DfuTransport for TimedTransport {
        fn write(&mut self, _data: &[u8]) -> DfuResult<()> {
            Ok(())
        }

        fn read(&mut self, buffer: &mut [u8], timeout_ms: u64) -> DfuResult<usize> {
            let deadline = Instant::now() + Duration::from_millis(timeout_ms);
            let due = match self.chunks.front() {
                Some((at, _)) => self.start + Duration::from_millis(*at),
                None => deadline,
            };
            if due >= deadline {
                std::thread::sleep(deadline.saturating_duration_since(Instant::now()));
                return Ok(0);
            }
            std::thread::sleep(due.saturating_duration_since(Instant::now()));
            let (at, mut bytes) = self.chunks.pop_front().unwrap();
            let len = bytes.len().min(buffer.len());
            buffer[..len].copy_from_slice(&bytes[..len]);
            // Like a real port, leave what didn't fit queued for the next read.
            if len < bytes.len() {
                self.chunks.push_front((at, bytes.split_off(len)));
            }
            Ok(len)
        }

        fn flush(&mut self) -> DfuResult<()> {
            Ok(())
        }

        fn clear_input(&mut self) -> DfuResult<()> {
            Ok(())
        }

        fn keep_alive(&mut self) -> DfuResult<()> {
            Ok(())
        }

        fn is_healthy(&mut self) -> bool {
            true
        }
    }

    /// v3 boot chatter comes in bursts with pauses (scaled down here: 150 ms
    /// pauses, 250 ms silence threshold). `[READY]` ends the drain at once,
    /// even though the chatter carries on after it.
    #[test]
    fn boot_drain_ends_at_ready_despite_chatter() {
        let mut chunks: Vec<(u64, &[u8])> = (0..5)
            .map(|i| (i * 150, &b"[DIAG] silk port 3 (F2): MOTOR PRESENT\n"[..]))
            .collect();
        chunks.push((750, b"[READY]\n"));
        chunks.extend((6..26).map(|i| (i * 150, &b"[DIAG] later\n"[..])));
        let mut transport = TimedTransport::new(chunks);
        let start = Instant::now();
        let found = drain_boot_output_with(&mut transport, &|| false, 250, 10_000)
            .unwrap()
            .found_ready;
        let took = start.elapsed();
        assert!(found, "[READY] not detected");
        assert!(
            took >= Duration::from_millis(750) && took < Duration::from_millis(1500),
            "took {took:?}"
        );
    }

    /// A stop mid-chatter ends the drain with `Cancelled` within one read, even
    /// though neither silence nor the cap would end it yet.
    #[test]
    fn boot_drain_returns_cancelled_when_stopped_mid_chatter() {
        let chunks: Vec<(u64, &[u8])> = (0..20)
            .map(|i| (i * 150, &b"[DIAG] silk port 3 (F2): MOTOR PRESENT\n"[..]))
            .collect();
        let mut transport = TimedTransport::new(chunks);
        let start = Instant::now();
        let stop = || start.elapsed() > Duration::from_millis(400);
        let err = drain_boot_output_with(&mut transport, &stop, 250, 10_000).unwrap_err();
        let took = start.elapsed();
        assert!(matches!(err, DfuError::Cancelled), "got {err:?}");
        assert!(
            took >= Duration::from_millis(400) && took < Duration::from_millis(1000),
            "took {took:?}"
        );
    }

    /// Without `[READY]` (older firmware), silence ends the drain, not the cap.
    /// The old markers no longer count.
    #[test]
    fn boot_drain_without_ready_ends_on_silence() {
        let mut transport = TimedTransport::new(vec![
            (0, b"[BOOT] BlueBuzzah v2.2.0\n"),
            (150, b"[INIT] motors\n"),
            (300, b"[DIAG] done\n"),
        ]);
        let start = Instant::now();
        let found = drain_boot_output_with(&mut transport, &|| false, 250, 10_000)
            .unwrap()
            .found_ready;
        let took = start.elapsed();
        assert!(!found, "an old boot marker ended the drain");
        assert!(
            took >= Duration::from_millis(550) && took < Duration::from_millis(3000),
            "took {took:?}"
        );
    }

    /// `[READY]` split across two reads is still found, and a stray invalid
    /// byte in the chunk does not throw the chunk away.
    #[test]
    fn boot_drain_finds_ready_split_across_reads() {
        let mut transport = TimedTransport::new(vec![(0, b"boot done [RE"), (50, b"ADY]\n\xff")]);
        let found = drain_boot_output_with(&mut transport, &|| false, 250, 10_000)
            .unwrap()
            .found_ready;
        assert!(found, "split [READY] not detected");
    }

    /// Trimming the accumulated text must land on a char boundary, or
    /// multibyte boot output panics the drain.
    #[test]
    fn boot_drain_trims_multibyte_output_safely() {
        let mut text = "\u{e9}".repeat(600).into_bytes();
        text.push(b'x');
        let mut transport = TimedTransport::new(vec![(0, &text), (50, b"[READY]\n")]);
        let found = drain_boot_output_with(&mut transport, &|| false, 250, 10_000)
            .unwrap()
            .found_ready;
        assert!(found);
    }

    #[test]
    fn deadline_runner_forwards_logs_and_result() {
        let logged = std::cell::RefCell::new(Vec::<String>::new());
        let warned = std::cell::RefCell::new(Vec::<String>::new());
        let r = run_with_deadline(
            |log, warn, _stop| {
                log("hello");
                warn("[ERROR] boot fault");
                Ok(())
            },
            |m| logged.borrow_mut().push(m.into()),
            |w| warned.borrow_mut().push(w.into()),
            || false,
            Duration::from_secs(2),
        );
        assert!(r.is_ok());
        assert_eq!(*logged.borrow(), vec!["hello".to_string()]);
        assert_eq!(*warned.borrow(), vec!["[ERROR] boot fault".to_string()]);
    }

    #[test]
    fn never_finishing_work_hits_deadline() {
        let start = Instant::now();
        let err = run_with_deadline(
            |_log, _warn, _stop| {
                std::thread::sleep(Duration::from_secs(30));
                Ok(())
            },
            |_| {},
            |_| {},
            || false,
            Duration::from_millis(300),
        )
        .unwrap_err();
        assert!(matches!(err, DfuError::RoleConfigFailed { .. }));
        assert!(start.elapsed() < Duration::from_millis(800));
    }

    #[test]
    fn cancel_returns_promptly_while_work_is_stuck() {
        let start = Instant::now();
        let err = run_with_deadline(
            |_log, _warn, _stop| {
                std::thread::sleep(Duration::from_secs(30));
                Ok(())
            },
            |_| {},
            |_| {},
            || true,
            Duration::from_secs(60),
        )
        .unwrap_err();
        assert!(matches!(err, DfuError::Cancelled));
        assert!(start.elapsed() < Duration::from_millis(400));
    }

    /// A warning still queued when the stop lands is forwarded, not lost.
    #[test]
    fn cancel_forwards_a_warning_sent_before_it() {
        let (warned_tx, warned_rx) = mpsc::channel::<()>();
        let warned = std::cell::RefCell::new(Vec::<String>::new());
        let err = run_with_deadline(
            move |log, warn, _stop| {
                log("start");
                warn("[ERROR] boot fault");
                let _ = warned_tx.send(());
                std::thread::sleep(Duration::from_secs(30));
                Ok(())
            },
            |_| {},
            |w| warned.borrow_mut().push(w.into()),
            // The first check (after "start" is read) waits for the warning, so
            // it is still queued when the stop is seen.
            || warned_rx.recv_timeout(Duration::from_secs(5)).is_ok(),
            Duration::from_secs(60),
        )
        .unwrap_err();
        assert!(matches!(err, DfuError::Cancelled), "got {err:?}");
        assert_eq!(*warned.borrow(), vec!["[ERROR] boot fault".to_string()]);
    }

    #[test]
    fn role_config_cancelled_before_touching_port() {
        let id = DeviceIdentifier::Serial {
            serial: "X".into(),
            vid: 0x239A,
            pid: 0x8029,
            port_pattern: String::new(),
        };
        let logged = std::cell::RefCell::new(Vec::<String>::new());
        let err = configure_device_role_flexible(
            "/dev/does-not-exist",
            "PRIMARY",
            &id,
            |m| logged.borrow_mut().push(m.into()),
            |_| {},
            || true,
        )
        .unwrap_err();
        assert!(matches!(err, DfuError::Cancelled));
        assert!(logged.borrow().iter().all(|m| !m.starts_with("Sending")));
    }

    #[test]
    fn wrap_role_error_keeps_cancel_distinct() {
        assert!(matches!(
            wrap_role_error(DfuError::Cancelled),
            DfuError::Cancelled
        ));
        let wrapped = wrap_role_error(DfuError::Timeout);
        assert!(matches!(wrapped, DfuError::RoleConfigFailed { .. }));
        assert!(wrapped
            .to_string()
            .to_lowercase()
            .contains("failed to configure device role"));
    }

    // Older firmware's motor-check failure line; current firmware prints
    // `[WARN] Motor check:` instead.
    const MOTOR_ERROR: &str =
        "[ERROR] Missing/failed motor(s): 2/5 detected (minimum 4) - check JST connections";

    #[test]
    fn boot_lines_collect_motor_check_failure() {
        let mut lines = BootLines::default();
        lines.push("[WARN] Motor check: 3/5 motors responded - check JST connections\r\n");
        assert_eq!(
            lines.finish(),
            vec!["[WARN] Motor check: 3/5 motors responded - check JST connections".to_string()]
        );
    }

    #[test]
    fn boot_lines_ignore_skipped_motor_check_and_diag() {
        let mut lines = BootLines::default();
        lines.push("[WARN] Motor check skipped: supply dipped during probe (USB-only power?)\n");
        lines.push("[DIAG] silk port 3 (F2): MOTOR PRESENT\n");
        assert!(lines.finish().is_empty());
    }

    #[test]
    fn boot_lines_collect_a_line_split_across_reads_once() {
        let mut lines = BootLines::default();
        lines.push("[BOOT] ok\n[ERROR] Missing/failed motor(s): 2/5 ");
        lines.push("detected (minimum 4) - check JST connections\n");
        assert_eq!(lines.finish(), vec![MOTOR_ERROR.to_string()]);
    }

    #[test]
    fn boot_lines_dedupe_repeated_lines() {
        let mut lines = BootLines::default();
        lines.push("[ERROR] DRV2605 finger 2 initialization failed\n");
        lines.push("[ERROR] DRV2605 finger 2 initialization failed\n");
        lines.push("[ERROR] DRV2605 finger 2 initialization failed");
        assert_eq!(
            lines.finish(),
            vec!["[ERROR] DRV2605 finger 2 initialization failed".to_string()]
        );
    }

    #[test]
    fn boot_drain_returns_fault_lines() {
        let line = format!("{}\n", MOTOR_ERROR);
        let mut transport = TimedTransport::new(vec![(0, line.as_bytes()), (50, b"[READY]\n")]);
        let drain = drain_boot_output_with(&mut transport, &|| false, 250, 10_000).unwrap();
        assert!(drain.found_ready);
        assert_eq!(drain.warnings, vec![MOTOR_ERROR.to_string()]);
    }

    #[test]
    fn serial_ready_returns_on_config_after_boot_chatter() {
        let mut transport = ScriptedTransport::new(vec![
            "[DIAG] silk port 3 (F2): MOTOR PRESENT\n",
            "[BOOT] done\n",
            "[CONFIG] Current role: SECONDARY\n",
            "[CONFIG] Current role: SECONDARY\n",
        ]);
        let warnings =
            wait_for_serial_ready_with(&mut transport, &|_: &str| {}, &|| false, String::new(), 5_000, 1_500)
                .unwrap();
        assert!(warnings.is_empty());
        assert_eq!(transport.written(), ["GET_ROLE\n"]);
    }

    #[test]
    fn serial_ready_returns_fault_line_read_while_waiting() {
        let line = format!("{}\n", MOTOR_ERROR);
        let mut transport = ScriptedTransport::new(vec![&line, "[CONFIG] Current role: PRIMARY\n"]);
        let warnings =
            wait_for_serial_ready_with(&mut transport, &|_: &str| {}, &|| false, String::new(), 5_000, 1_500)
                .unwrap();
        assert_eq!(warnings, vec![MOTOR_ERROR.to_string()]);
    }

    /// `[CONFIG]` ends the wait before the rest of a later line arrives: that
    /// partial line is dropped, not read as a whole fault line.
    #[test]
    fn serial_ready_drops_unterminated_tail_after_config() {
        let mut transport = ScriptedTransport::new(vec![
            "[CONFIG] Current role: PRIMARY\r\n[ERROR] SECONDARY rep",
        ]);
        let warnings =
            wait_for_serial_ready_with(&mut transport, &|_: &str| {}, &|| false, String::new(), 5_000, 1_500)
                .unwrap();
        assert!(warnings.is_empty(), "{warnings:?}");
    }

    #[test]
    fn boot_drain_hands_on_unterminated_tail_after_ready() {
        let mut transport = TimedTransport::new(vec![(0, b"[READY]\n[ERROR] SECONDARY rep")]);
        let drain = drain_boot_output_with(&mut transport, &|| false, 250, 10_000).unwrap();
        assert!(drain.found_ready);
        assert!(drain.warnings.is_empty(), "{:?}", drain.warnings);
        assert_eq!(drain.tail, "[ERROR] SECONDARY rep");
    }

    /// A fault line split across the end of the boot drain and the readiness
    /// probe is collected whole, not dropped or cut short.
    #[test]
    fn role_ack_collects_fault_line_split_after_ready() {
        let mut transport = ScriptedTransport::new(vec![
            "[READY]\n[ERROR] SECONDARY rep",
            "orts a hardware fault - sessions refused\n",
            "[CONFIG] Current role: PRIMARY\n",
            "[CONFIG] Role set to PRIMARY - restarting...\n",
        ]);
        let warned = std::cell::RefCell::new(Vec::<String>::new());
        let warnings = send_role_and_await_ack(
            &mut transport,
            ROLE_PRIMARY_COMMAND,
            &|_: &str| {},
            &|w: &str| warned.borrow_mut().push(w.into()),
            &|| false,
        )
        .unwrap();
        let line = "[ERROR] SECONDARY reports a hardware fault - sessions refused".to_string();
        assert_eq!(warnings, vec![line.clone()]);
        assert_eq!(*warned.borrow(), vec![line]);
    }

    #[test]
    fn serial_ready_falls_through_on_silence() {
        let mut transport = ScriptedTransport::new(vec![]);
        let logged = std::cell::RefCell::new(Vec::<String>::new());
        let warnings = wait_for_serial_ready_with(
            &mut transport,
            &|m: &str| logged.borrow_mut().push(m.into()),
            &|| false,
            String::new(),
            200,
            50,
        )
        .unwrap();
        assert!(warnings.is_empty());
        assert!(transport.written().len() > 1, "GET_ROLE was not re-sent");
        assert!(logged.borrow().iter().any(|m| m.contains("sending anyway")));
    }

    #[test]
    fn serial_ready_stops_without_writing_once_cancelled() {
        let mut transport = ScriptedTransport::new(vec![]);
        let err = wait_for_serial_ready_with(&mut transport, &|_: &str| {}, &|| true, String::new(), 5_000, 50)
            .unwrap_err();
        assert!(matches!(err, DfuError::Cancelled), "got {err:?}");
        assert!(transport.written().is_empty());
    }

    /// A boot fault read before the role ack is a warning, not a failure: it
    /// reaches the sink before SET_ROLE goes out, and the ack still counts.
    #[test]
    fn role_ack_succeeds_with_boot_fault_as_warning() {
        let line = format!("{}\n", MOTOR_ERROR);
        let mut transport = ScriptedTransport::new(vec![
            "[BOOT] v3\n",
            "[READY]\n",
            &line,
            "[CONFIG] Current role: PRIMARY\n",
            "[CONFIG] Role set to PRIMARY - restarting...\n",
        ]);
        let warned = std::cell::RefCell::new(Vec::<String>::new());
        let warnings = send_role_and_await_ack(
            &mut transport,
            ROLE_PRIMARY_COMMAND,
            &|_: &str| {},
            &|w: &str| warned.borrow_mut().push(w.into()),
            &|| false,
        )
        .unwrap();
        assert_eq!(warnings, vec![MOTOR_ERROR.to_string()]);
        assert_eq!(*warned.borrow(), vec![MOTOR_ERROR.to_string()]);
        assert_role_sent_after_clear(&transport);
    }

    /// GET_ROLE once, then SET_ROLE right after the input is cleared.
    fn assert_role_sent_after_clear(transport: &ScriptedTransport) {
        assert_eq!(transport.written(), ["GET_ROLE\n", ROLE_PRIMARY_COMMAND]);
        let ops = transport.ops();
        let last_write = ops.iter().rposition(|op| *op == "write").unwrap();
        assert_eq!(ops[last_write - 1], "clear", "{ops:?}");
    }

    /// The real path: the fault line is printed before `[READY]`, so the boot
    /// drain finds it.
    #[test]
    fn role_ack_succeeds_with_boot_fault_before_ready() {
        let line = format!("{}\n", MOTOR_ERROR);
        let mut transport = ScriptedTransport::new(vec![
            "[BOOT] v3\n",
            &line,
            "[READY]\n",
            "[CONFIG] Current role: PRIMARY\n",
            "[CONFIG] Role set to PRIMARY - restarting...\n",
        ]);
        let warned = std::cell::RefCell::new(Vec::<String>::new());
        let warnings = send_role_and_await_ack(
            &mut transport,
            ROLE_PRIMARY_COMMAND,
            &|_: &str| {},
            &|w: &str| warned.borrow_mut().push(w.into()),
            &|| false,
        )
        .unwrap();
        assert_eq!(warnings, vec![MOTOR_ERROR.to_string()]);
        assert_eq!(*warned.borrow(), vec![MOTOR_ERROR.to_string()]);
        assert_role_sent_after_clear(&transport);
    }

    /// A line read by both the drain and the readiness probe is warned once.
    #[test]
    fn role_ack_warns_once_for_a_line_seen_twice() {
        let line = format!("{}\n", MOTOR_ERROR);
        let mut transport = ScriptedTransport::new(vec![
            &line,
            "[READY]\n",
            &line,
            "[CONFIG] Current role: PRIMARY\n",
            "[CONFIG] Role set to PRIMARY - restarting...\n",
        ]);
        let warned = std::cell::RefCell::new(Vec::<String>::new());
        let warnings = send_role_and_await_ack(
            &mut transport,
            ROLE_PRIMARY_COMMAND,
            &|_: &str| {},
            &|w: &str| warned.borrow_mut().push(w.into()),
            &|| false,
        )
        .unwrap();
        assert_eq!(warnings, vec![MOTOR_ERROR.to_string()]);
        assert_eq!(*warned.borrow(), vec![MOTOR_ERROR.to_string()]);
        assert_role_sent_after_clear(&transport);
    }

    #[test]
    fn role_rejection_after_readiness_fails() {
        let mut transport = ScriptedTransport::new(vec![
            "[READY]\n",
            "[CONFIG] Current role: PRIMARY\n",
            "[ERROR] Invalid role. Use: SET_ROLE:PRIMARY or SET_ROLE:SECONDARY\n",
        ]);
        let err = send_role_and_await_ack(
            &mut transport,
            ROLE_PRIMARY_COMMAND,
            &|_: &str| {},
            &|_: &str| {},
            &|| false,
        )
        .unwrap_err();
        let DfuError::RoleConfigFailed { reason } = err else {
            panic!("got {err:?}");
        };
        assert!(reason.contains("Invalid role"), "{reason}");
        assert!(!reason.contains("Timeout"), "{reason}");
    }

    #[test]
    fn setting_acked_by_menu_frame() {
        let mut transport = ScriptedTransport::new(vec![
            "[MENU-TX] CMD:THERAPY_LED_OFF\nTHERAPY_LED_OFF:true\n\u{4}",
        ]);
        let logged = std::cell::RefCell::new(Vec::<String>::new());
        let mut warnings = Vec::new();
        send_setting_command(
            &mut transport,
            "THERAPY_LED_OFF:true\n",
            &|m: &str| logged.borrow_mut().push(m.into()),
            &mut warnings,
        )
        .unwrap();
        assert!(
            logged.borrow().iter().any(|m| m.starts_with("Setting acknowledged")),
            "{:?}",
            logged.borrow()
        );
        assert_eq!(transport.ops()[..2], ["clear", "write"]);
    }

    /// Replies have no request IDs: another command's ERROR frame (a stale
    /// probe reply) must not fail this setting, and its own ack still counts.
    #[test]
    fn setting_ignores_error_frame_for_another_command() {
        let mut transport = ScriptedTransport::new(vec![
            "[MENU-TX] CMD:INFO\nERROR:Busy\n\u{4}",
            "[MENU-TX] CMD:THERAPY_LED_OFF\nTHERAPY_LED_OFF:true\n\u{4}",
        ]);
        let logged = std::cell::RefCell::new(Vec::<String>::new());
        let mut warnings = Vec::new();
        send_setting_command(
            &mut transport,
            "THERAPY_LED_OFF:true\n",
            &|m: &str| logged.borrow_mut().push(m.into()),
            &mut warnings,
        )
        .unwrap();
        assert!(logged
            .borrow()
            .iter()
            .any(|m| m.starts_with("Setting acknowledged")));
    }

    #[test]
    fn setting_rejected_by_menu_error_frame() {
        let mut transport =
            ScriptedTransport::new(vec!["[MENU-TX] CMD:THERAPY_LED_OFF\nERROR:Invalid value\n\u{4}"]);
        let err = send_setting_command(
            &mut transport,
            "THERAPY_LED_OFF:maybe\n",
            &|_: &str| {},
            &mut Vec::new(),
        )
        .unwrap_err();
        assert!(
            matches!(err, DfuError::SettingConfigFailed { .. }),
            "got {err:?}"
        );
    }

    #[test]
    fn setting_without_reply_still_succeeds() {
        let mut transport = ScriptedTransport::new(vec![]);
        send_setting_command(&mut transport, "DEBUG:false\n", &|_: &str| {}, &mut Vec::new())
            .unwrap();
    }

    /// Older firmware sends no `CMD`, so its ERROR frame can only be ours.
    #[test]
    fn setting_rejected_by_error_frame_without_cmd() {
        let mut transport = ScriptedTransport::new(vec!["[MENU-TX] ERROR:Invalid value\n\u{4}"]);
        let err = send_setting_command(
            &mut transport,
            "THERAPY_LED_OFF:maybe\n",
            &|_: &str| {},
            &mut Vec::new(),
        )
        .unwrap_err();
        assert!(
            matches!(err, DfuError::SettingConfigFailed { .. }),
            "got {err:?}"
        );
    }

    const SECONDARY_FAULT: &str = "[ERROR] SECONDARY reports a hardware fault - sessions refused";

    /// A bare `[ERROR]` line during the wait is a warning, not the answer: the
    /// setting's own ack still counts, and the line is kept.
    #[test]
    fn setting_keeps_bare_error_line_as_warning() {
        let line = format!("{}\r\n", SECONDARY_FAULT);
        let mut transport = ScriptedTransport::new(vec![
            &line,
            "[MENU-TX] CMD:THERAPY_LED_OFF\nTHERAPY_LED_OFF:true\n\u{4}",
        ]);
        let mut warnings = Vec::new();
        send_setting_command(
            &mut transport,
            "THERAPY_LED_OFF:true\n",
            &|_: &str| {},
            &mut warnings,
        )
        .unwrap();
        assert_eq!(warnings, vec![SECONDARY_FAULT.to_string()]);
    }

    /// With no answer at all, the bare `[ERROR]` line is still only a warning.
    #[test]
    fn setting_bare_error_line_then_silence_succeeds_with_warning() {
        let line = format!("{}\n", SECONDARY_FAULT);
        let mut transport = ScriptedTransport::new(vec![&line]);
        let mut warnings = Vec::new();
        send_setting_command(&mut transport, "DEBUG:false\n", &|_: &str| {}, &mut warnings)
            .unwrap();
        assert_eq!(warnings, vec![SECONDARY_FAULT.to_string()]);
    }

    /// A Configure that fails still logs the fault lines drained before it.
    #[test]
    fn configure_failure_logs_drained_fault_lines() {
        let line = format!("{}\n", MOTOR_ERROR);
        let mut transport = ScriptedTransport::new(vec![
            &line,
            "[READY]\n",
            "[CONFIG] Current role: PRIMARY\n",
            "[ERROR] Invalid profile\n",
        ]);
        let id = DeviceIdentifier::Serial {
            serial: "X".into(),
            vid: 0x239A,
            pid: 0x8029,
            port_pattern: String::new(),
        };
        let logged = std::cell::RefCell::new(Vec::<String>::new());
        let log = |m: &str| logged.borrow_mut().push(m.into());
        let err = retry_configure("/dev/cu.test", &id, &log, |_, warnings| {
            send_settings_and_profile(
                &mut transport,
                "REGULAR",
                PROFILE_REGULAR_COMMAND,
                &[],
                &log,
                warnings,
            )
        })
        .unwrap_err();
        assert!(
            matches!(err, DfuError::ProfileConfigFailed { .. }),
            "got {err:?}"
        );
        let expected = format!("Device reported: {}", MOTOR_ERROR);
        assert!(logged.borrow().contains(&expected), "{:?}", logged.borrow());
    }

    fn stage_names(stages: &[DfuStage]) -> Vec<&'static str> {
        stages
            .iter()
            .map(|s| match s {
                DfuStage::Log { .. } => "log",
                DfuStage::Warning { .. } => "warning",
                DfuStage::Complete => "complete",
                DfuStage::Cancelled => "cancelled",
                _ => "other",
            })
            .collect()
    }

    fn warning_messages(stages: &[DfuStage]) -> Vec<String> {
        stages
            .iter()
            .filter_map(|s| match s {
                DfuStage::Warning { message } => Some(message.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn role_failure_after_write_completes_with_warning() {
        let stages = std::cell::RefCell::new(Vec::new());
        let result = finish_after_write(
            Err(DfuError::RoleConfigFailed {
                reason: "Timeout waiting for role configuration acknowledgment".into(),
            }),
            &|s| stages.borrow_mut().push(s),
        );
        assert!(result.is_ok());
        assert_eq!(
            stage_names(&stages.borrow()),
            ["log", "warning", "complete"]
        );
        assert_eq!(warning_messages(&stages.borrow()), [ROLE_NOT_SET_WARNING]);
    }

    #[test]
    fn reboot_wait_failure_after_write_warns_device_did_not_come_back() {
        let stages = std::cell::RefCell::new(Vec::new());
        let result = finish_after_write(
            Err(DfuError::BootloaderTimeout { timeout_ms: 30_000 }),
            &|s| stages.borrow_mut().push(s),
        );
        assert!(result.is_ok());
        assert_eq!(
            stage_names(&stages.borrow()),
            ["log", "warning", "complete"]
        );
        assert_eq!(warning_messages(&stages.borrow()), [DEVICE_NOT_BACK_WARNING]);
    }

    fn nrf_device(port: &str, pid: u16, serial: Option<&str>, in_bootloader: bool) -> Nrf52Device {
        Nrf52Device {
            port: port.to_string(),
            vid: 0x239A,
            pid,
            serial_number: serial.map(String::from),
            in_bootloader,
            product_name: None,
            manufacturer: None,
            board: "nrf52".to_string(),
        }
    }

    /// A rejected v2 image leaves the glove in bootloader mode: that must fail
    /// the flash, while an app-mode or missing device is only a warning.
    #[test]
    fn left_in_bootloader_only_for_the_bootloader_written_to() {
        let written = nrf_device("/dev/cu.usbmodem14203", 0x0029, Some("BOOT1"), true);
        assert!(left_in_bootloader(&written, &[written.clone()]));
        // The same bootloader, renumbered onto another port.
        assert!(left_in_bootloader(
            &written,
            &[nrf_device("/dev/cu.usbmodem14205", 0x0029, Some("BOOT1"), true)]
        ));
        // Back in app mode on the same port: the image was accepted.
        assert!(!left_in_bootloader(
            &written,
            &[nrf_device("/dev/cu.usbmodem14203", 0x8029, Some("APP1"), false)]
        ));
        assert!(!left_in_bootloader(&written, &[]));
    }

    /// Another glove of the same family sitting in bootloader mode must not
    /// fail a good flash.
    #[test]
    fn left_in_bootloader_ignores_another_same_family_bootloader() {
        let written = nrf_device("/dev/cu.usbmodem14203", 0x0029, Some("BOOT1"), true);
        assert!(!left_in_bootloader(
            &written,
            &[
                nrf_device("/dev/cu.usbmodem14203", 0x8029, Some("APP1"), false),
                nrf_device("/dev/cu.usbmodem14301", 0x0029, Some("BOOT2"), true),
            ]
        ));
        // Without serial numbers only the port identifies it.
        let unnamed = nrf_device("/dev/cu.usbmodem14203", 0x0029, None, true);
        assert!(!left_in_bootloader(
            &unnamed,
            &[nrf_device("/dev/cu.usbmodem14301", 0x0029, None, true)]
        ));
    }

    #[test]
    fn stop_after_write_is_cancelled() {
        let stages = std::cell::RefCell::new(Vec::new());
        let result = finish_after_write(Err(DfuError::Cancelled), &|s| stages.borrow_mut().push(s));
        assert!(matches!(result, Err(DfuError::Cancelled)));
        assert_eq!(stage_names(&stages.borrow()), ["cancelled"]);
    }

    #[test]
    fn test_dfu_stage_percent() {
        assert_eq!(DfuStage::ReadingPackage.percent(), 0.0);
        assert_eq!(DfuStage::Complete.percent(), 100.0);
        let warning = DfuStage::Warning {
            message: "w".into(),
        };
        assert_eq!(warning.percent(), -1.0);
        assert_eq!(warning.message(), "w");

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
