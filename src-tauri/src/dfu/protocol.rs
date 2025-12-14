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
    calculate_erase_wait_time, get_bootloader_timeout, get_reboot_timeout, ACK_TIMEOUT_MS,
    FLASH_PAGE_WRITE_TIME_MS, FRAMES_PER_FLASH_PAGE, MAX_PACKET_RETRIES,
    PROFILE_CONFIG_TIMEOUT_MS, PROFILE_GENTLE_COMMAND, PROFILE_HYBRID_COMMAND,
    PROFILE_NOISY_COMMAND, PROFILE_REGULAR_COMMAND, RETRY_BASE_DELAY_MS, ROLE_CONFIG_TIMEOUT_MS,
    ROLE_PRIMARY_COMMAND, ROLE_SECONDARY_COMMAND,
};
use super::device::{
    get_device_by_port, wait_for_application_by_serial, wait_for_application_flexible,
    wait_for_bootloader_flexible, DeviceIdentifier,
};
use super::error::{DfuError, DfuResult};
use super::firmware_reader::read_firmware_zip;
use super::packet::{
    build_firmware_data_packet, build_init_packet, build_start_dfu_packet, build_stop_data_packet,
    reset_sequence_number, HciAck, HciSlipDecoder, FIRMWARE_CHUNK_SIZE, IMAGE_TYPE_APPLICATION,
};
use super::transport::{DfuTransport, SerialTransport};

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
                        (self.log)(&format!(
                            "Recovered after {} retry attempt(s)",
                            attempt
                        ));
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
                        (self.log)(&format!(
                            "Failed after {} retry attempt(s): {}",
                            attempt, e
                        ));
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

        for chunk in firmware.chunks(FIRMWARE_CHUNK_SIZE) {
            // Check for cancellation before each chunk
            if is_cancelled() {
                return Err(DfuError::Cancelled);
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

    let bootloader_port = if already_in_bootloader {
        // Device is already in bootloader - reset it to clear any stale state
        // from previous failed DFU attempts
        SerialTransport::reset_bootloader(port_name)?;

        on_progress(DfuStage::WaitingForBootloader);
        let bootloader_device =
            wait_for_bootloader_flexible(&device_identifier, get_bootloader_timeout())?;
        bootloader_device.port
    } else {
        // Device is in application mode - use 1200 baud touch to enter bootloader
        SerialTransport::touch_reset(port_name)?;

        on_progress(DfuStage::WaitingForBootloader);
        let bootloader_device =
            wait_for_bootloader_flexible(&device_identifier, get_bootloader_timeout())?;
        bootloader_device.port
    };

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

    // Step 9: Wait for device to reboot into application mode
    on_progress(DfuStage::WaitingForReboot);
    std::thread::sleep(Duration::from_millis(2000)); // Give device time to boot
    let app_device = wait_for_application_flexible(&device_identifier, get_reboot_timeout())?;

    // Step 10: Configure device role
    // Note: This will cause another reboot as the device restarts after role change
    on_progress(DfuStage::ConfiguringRole);
    configure_device_role_flexible(&app_device.port, device_role, &device_identifier)?;

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
                std::thread::sleep(Duration::from_millis(2000));
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

/// Configure the device role using flexible device tracking.
///
/// Works with both serial number and VID/PID+port pattern tracking.
fn configure_device_role_flexible(
    port_name: &str,
    role: &str,
    identifier: &DeviceIdentifier,
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

    // Open port and send command
    let mut transport = SerialTransport::open(port_name)?;

    // Drain boot output using enhanced detection
    drain_boot_output(&mut transport)?;

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
    let mut buffer = [0u8; 256];

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
                std::thread::sleep(Duration::from_millis(2000));
                wait_for_application_flexible(identifier, get_reboot_timeout())?;

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

/// Drain boot output with marker-based and silence-based detection.
///
/// Returns true if a boot completion marker was detected.
fn drain_boot_output(transport: &mut SerialTransport) -> DfuResult<bool> {
    let mut buffer = [0u8; 256];
    let drain_timeout = Duration::from_millis(5000);
    let drain_start = Instant::now();
    let mut last_data_time = Instant::now();
    const SILENCE_THRESHOLD_MS: u64 = 500;

    // Known boot completion markers from BlueBuzzah firmware
    const BOOT_MARKERS: &[&str] = &["[READY]", "[INIT]", "[BOOT]", "BlueBuzzah"];
    let mut found_marker = false;
    let mut accumulated = String::new();

    while drain_start.elapsed() < drain_timeout {
        let bytes_read = transport.read(&mut buffer, 200)?;
        if bytes_read > 0 {
            last_data_time = Instant::now();

            // Accumulate for marker detection
            if let Ok(text) = std::str::from_utf8(&buffer[..bytes_read]) {
                accumulated.push_str(text);
                // Check for boot markers
                for marker in BOOT_MARKERS {
                    if accumulated.contains(marker) {
                        found_marker = true;
                        break;
                    }
                }
            }
            // Truncate to prevent unbounded growth
            if accumulated.len() > 1024 {
                accumulated = accumulated[accumulated.len() - 512..].to_string();
            }
        } else if last_data_time.elapsed() > Duration::from_millis(SILENCE_THRESHOLD_MS) {
            // No data for 500ms - boot likely complete
            break;
        }
    }

    // Extra safety wait after marker detection
    if found_marker {
        std::thread::sleep(Duration::from_millis(200));
    }

    Ok(found_marker)
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
pub fn configure_device_profile(port_name: &str, profile: &str, serial_number: &str) -> DfuResult<()> {
    let identifier = DeviceIdentifier::Serial(serial_number.to_string());
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
    let found_marker = drain_boot_output(&mut transport)?;
    if found_marker {
        log("Boot completion marker detected");
    } else {
        log("Boot detected via silence threshold");
    }

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
                std::thread::sleep(Duration::from_millis(2000));
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
/// - Success: "[SETTING] ..." or device may not respond (backwards compatibility)
/// - Error: "[ERROR] ..."
///
/// # Arguments
/// * `transport` - Open serial transport
/// * `command` - Command string to send (should include newline)
/// * `log` - Callback for debug log messages
fn send_setting_command<L: Fn(&str)>(
    transport: &mut SerialTransport,
    command: &str,
    log: &L,
) -> DfuResult<()> {
    // Parse command to create human-readable log message
    let trimmed = command.trim();
    let (setting_name, setting_value) = trimmed
        .split_once(':')
        .unwrap_or((trimmed, "unknown"));

    let friendly_name = match setting_name {
        "THERAPY_LED_OFF" => "Disable LED During Therapy",
        "DEBUG" => "Debug Mode",
        _ => setting_name,
    };

    log(&format!("Setting {} = {}", friendly_name, setting_value));

    transport.write(command.as_bytes())?;
    transport.flush()?;

    // Wait for acknowledgment (shorter timeout than profile commands)
    let timeout = Duration::from_millis(SETTING_CONFIG_TIMEOUT_MS);
    let start = Instant::now();
    let mut response = Vec::new();
    let mut buffer = [0u8; 256];

    while start.elapsed() < timeout {
        let remaining = timeout.saturating_sub(start.elapsed());
        let bytes_read = transport.read(&mut buffer, remaining.as_millis() as u64)?;

        if bytes_read > 0 {
            response.extend_from_slice(&buffer[..bytes_read]);
            let response_str = String::from_utf8_lossy(&response);

            // Check for success acknowledgment
            if response_str.contains("[SETTING]") {
                log(&format!("Setting acknowledged: {}", response_str.trim()));
                return Ok(());
            }

            // Check for error
            if response_str.contains("[ERROR]") {
                return Err(DfuError::SettingConfigFailed {
                    reason: response_str.to_string(),
                });
            }
        }
    }

    // Timeout - treat as success for backwards compatibility with older firmware
    // that doesn't respond to setting commands
    log("Setting command timeout - device may not support this setting (continuing)");
    Ok(())
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
/// # Arguments
/// * `port_name` - Serial port of the device
/// * `profile` - Profile to set ("REGULAR", "NOISY", "HYBRID", or "GENTLE")
/// * `pre_profile_commands` - Commands to send before SET_PROFILE (from AdvancedSettings)
/// * `identifier` - Device identifier for tracking through reboot
/// * `log` - Callback for debug log messages
pub fn configure_device_with_settings<L: Fn(&str)>(
    port_name: &str,
    profile: &str,
    pre_profile_commands: &[String],
    identifier: &DeviceIdentifier,
    log: L,
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

    log("Draining boot output...");
    let found_marker = drain_boot_output(&mut transport)?;
    if found_marker {
        log("Boot completion marker detected");
    } else {
        log("Boot detected via silence threshold");
    }

    transport.clear_input().ok();
    std::thread::sleep(Duration::from_millis(100));

    // Phase 1: Send all advanced setting commands
    if !pre_profile_commands.is_empty() {
        log(&format!(
            "Sending {} advanced setting command(s)...",
            pre_profile_commands.len()
        ));
        for command in pre_profile_commands {
            send_setting_command(&mut transport, command, &log)?;
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
                drop(transport);

                log("Waiting for device to reboot...");
                std::thread::sleep(Duration::from_millis(2000));
                wait_for_application_flexible(identifier, get_reboot_timeout())?;
                log("Device reappeared after reboot");

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
