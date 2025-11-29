# Nordic DFU Module Implementation for BlueBuzzah-Updater

## Overview

Implement a Rust-native Nordic DFU (Device Firmware Update) module for the BlueBuzzah-Updater Tauri application. This replaces the need to bundle PlatformIO or adafruit-nrfutil, providing direct firmware flashing capability for Adafruit Feather nRF52840 devices.

**Target Project:** `/Users/rbonestell/Development/BlueBuzzah/BlueBuzzah-Updater`

**Firmware Source:** `/Users/rbonestell/Development/BlueBuzzah-Firmware` (this repo)

---

## Goals

1. Detect Adafruit Feather nRF52840 devices by USB VID/PID
2. Trigger bootloader mode via 1200 baud serial touch
3. Upload zipped packages using Nordic DFU protocol over serial
4. Provide progress callbacks for UI feedback
5. Cross-platform support (macOS, Windows)

---

## Firmware Distribution

### Release Workflow

The BlueBuzzah-Firmware repository uses GitHub Actions (`.github/workflows/release.yml`) to automatically build and publish firmware packages when a release is created. The firmware zip file is **not** named `firmware.zip` - it follows a versioned naming convention:

```
BlueBuzzah-Firmware-{VERSION}-{SHORT_SHA}.zip
```

**Examples:**
- `BlueBuzzah-Firmware-v1.0.0-abc1234.zip`
- `BlueBuzzah-Firmware-v2.1.0-beta-def5678.zip`

### How the Updater Obtains Firmware

The BlueBuzzah-Updater application **automatically downloads** firmware packages from GitHub releases. The existing `commands/firmware.rs` module handles:

1. Fetching available releases from the GitHub API
2. Downloading the firmware zip asset to local cache
3. Verifying SHA256 checksums
4. Managing cached firmware versions

**The DFU module receives the local path to the cached firmware zip** - it does not need to handle downloading or naming conventions. The path will be something like:

```
~/Library/Caches/com.bluebuzzah.updater/firmware/BlueBuzzah-Firmware-v1.0.0-abc1234.zip
```

---

## Firmware Package Format

Regardless of the outer zip filename, the **internal structure** is always the same (produced by PlatformIO):

```
BlueBuzzah-Firmware-v1.0.0-abc1234.zip
├── firmware.bin     # Application binary (~180KB)
├── firmware.dat     # Init packet (14 bytes, protobuf-encoded)
└── manifest.json    # Metadata
```

### manifest.json Example

```json
{
  "manifest": {
    "application": {
      "bin_file": "firmware.bin",
      "dat_file": "firmware.dat",
      "init_packet_data": {
        "application_version": 4294967295,
        "device_revision": 65535,
        "device_type": 82,
        "firmware_crc16": 18974,
        "softdevice_req": [182]
      }
    },
    "dfu_version": 0.5
  }
}
```

---

## Dependencies

Add to `src-tauri/Cargo.toml`:

```toml
[dependencies]
serialport = "4.7"      # Cross-platform serial communication
crc16 = "0.4"           # CRC16-CCITT for packet checksums
# zip = "0.6"           # Already present - for reading firmware.zip
```

---

## Device Detection

### Adafruit USB Identifiers

```rust
const ADAFRUIT_VID: u16 = 0x239A;

const FEATHER_PIDS: &[u16] = &[
    0x8029,  // Feather nRF52840 Express (application mode)
    0x0029,  // Feather nRF52840 Express (bootloader mode)
    0x802A,  // Feather nRF52840 Sense (application mode)
    0x002A,  // Feather nRF52840 Sense (bootloader mode)
];
```

### Detection Logic

```rust
use serialport::{SerialPortType, available_ports};

pub fn find_nrf52_devices() -> Vec<SerialDevice> {
    let mut devices = Vec::new();

    if let Ok(ports) = available_ports() {
        for port in ports {
            if let SerialPortType::UsbPort(usb_info) = &port.port_type {
                if usb_info.vid == ADAFRUIT_VID && FEATHER_PIDS.contains(&usb_info.pid) {
                    let in_bootloader = usb_info.pid == 0x0029 || usb_info.pid == 0x002A;
                    devices.push(SerialDevice {
                        port: port.port_name,
                        vid: usb_info.vid,
                        pid: usb_info.pid,
                        in_bootloader,
                    });
                }
            }
        }
    }

    devices
}
```

---

## SLIP Protocol

Serial Line Internet Protocol encoding for framing packets.

### Constants

```rust
const SLIP_END: u8 = 0xC0;      // Frame delimiter
const SLIP_ESC: u8 = 0xDB;      // Escape byte
const SLIP_ESC_END: u8 = 0xDC;  // Escaped END (0xC0 -> 0xDB 0xDC)
const SLIP_ESC_ESC: u8 = 0xDD;  // Escaped ESC (0xDB -> 0xDB 0xDD)
```

### Encoding

```rust
pub fn slip_encode(data: &[u8]) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(data.len() * 2 + 2);
    encoded.push(SLIP_END);

    for &byte in data {
        match byte {
            SLIP_END => {
                encoded.push(SLIP_ESC);
                encoded.push(SLIP_ESC_END);
            }
            SLIP_ESC => {
                encoded.push(SLIP_ESC);
                encoded.push(SLIP_ESC_ESC);
            }
            _ => encoded.push(byte),
        }
    }

    encoded.push(SLIP_END);
    encoded
}
```

### Decoding

```rust
pub fn slip_decode(data: &[u8]) -> Result<Vec<u8>, DfuError> {
    let mut decoded = Vec::new();
    let mut escape_next = false;

    for &byte in data {
        if byte == SLIP_END {
            continue; // Skip frame delimiters
        }

        if escape_next {
            match byte {
                SLIP_ESC_END => decoded.push(SLIP_END),
                SLIP_ESC_ESC => decoded.push(SLIP_ESC),
                _ => return Err(DfuError::InvalidSlipEscape),
            }
            escape_next = false;
        } else if byte == SLIP_ESC {
            escape_next = true;
        } else {
            decoded.push(byte);
        }
    }

    Ok(decoded)
}
```

---

## HCI Packet Format

The DFU protocol uses HCI (Host Controller Interface) style packets.

### Packet Structure

```
[Sequence/Control Byte][Payload Length (2 bytes LE)][Payload...][CRC16 (2 bytes LE)]
```

### Control Byte Format

```
Bits 0-2: Sequence number (0-7, wraps)
Bit 3:    Data Integrity Check present (1 = CRC16 included)
Bit 4:    Reliable packet (1 = requires ACK)
Bits 5-7: HCI packet type (14 = DFU packet)
```

### Implementation

```rust
const DATA_INTEGRITY_CHECK_PRESENT: u8 = 1 << 3;
const RELIABLE_PACKET: u8 = 1 << 4;
const HCI_PACKET_TYPE: u8 = 14 << 5;

pub struct HciPacket {
    sequence: u8,
    payload: Vec<u8>,
}

impl HciPacket {
    pub fn new(sequence: u8, payload: Vec<u8>) -> Self {
        Self {
            sequence: sequence & 0x07, // 3 bits
            payload,
        }
    }

    pub fn encode(&self) -> Vec<u8> {
        let control = self.sequence
            | DATA_INTEGRITY_CHECK_PRESENT
            | RELIABLE_PACKET
            | HCI_PACKET_TYPE;

        let len = self.payload.len() as u16;

        let mut packet = Vec::with_capacity(5 + self.payload.len());
        packet.push(control);
        packet.extend_from_slice(&len.to_le_bytes());
        packet.extend_from_slice(&self.payload);

        // Calculate CRC16-CCITT over control + length + payload
        let crc = crc16::State::<crc16::CCITT_FALSE>::calculate(&packet);
        packet.extend_from_slice(&crc.to_le_bytes());

        slip_encode(&packet)
    }
}
```

---

## DFU Commands

### Opcodes

```rust
#[repr(u8)]
pub enum DfuOpcode {
    StartDfu = 1,
    InitDfuParams = 2,
    ReceiveFirmwareImage = 3,
    ValidateFirmware = 4,
    ActivateAndReset = 5,
    SystemReset = 6,
    PacketReceiptNotification = 8,
}

#[repr(u8)]
pub enum DfuUpdateMode {
    None = 0,
    SoftDevice = 1,
    Bootloader = 2,
    Application = 4,
}
```

### Response Codes

```rust
#[repr(u8)]
pub enum DfuResponse {
    Success = 1,
    InvalidState = 2,
    NotSupported = 3,
    DataSizeExceedsLimit = 4,
    CrcError = 5,
    OperationFailed = 6,
}
```

---

## DFU Protocol Flow

### Step 1: Touch Reset (Enter Bootloader)

```rust
pub fn touch_reset(port_name: &str) -> Result<(), DfuError> {
    // Open at 1200 baud and immediately close
    // This triggers the bootloader on Adafruit boards
    let port = serialport::new(port_name, 1200)
        .timeout(Duration::from_millis(100))
        .open()?;

    drop(port); // Close immediately

    // Wait for device to re-enumerate
    std::thread::sleep(Duration::from_millis(1500));

    Ok(())
}
```

### Step 2: Wait for Bootloader

```rust
pub fn wait_for_bootloader(original_port: &str, timeout_ms: u64) -> Result<String, DfuError> {
    let start = std::time::Instant::now();
    let timeout = Duration::from_millis(timeout_ms);

    while start.elapsed() < timeout {
        let devices = find_nrf52_devices();

        // Look for device in bootloader mode
        for device in devices {
            if device.in_bootloader {
                return Ok(device.port);
            }
        }

        std::thread::sleep(Duration::from_millis(100));
    }

    Err(DfuError::BootloaderTimeout)
}
```

### Step 3: Open Serial Connection

```rust
const DFU_BAUD_RATE: u32 = 115200;
const SERIAL_TIMEOUT_MS: u64 = 1000;

pub fn open_dfu_port(port_name: &str) -> Result<Box<dyn SerialPort>, DfuError> {
    let port = serialport::new(port_name, DFU_BAUD_RATE)
        .timeout(Duration::from_millis(SERIAL_TIMEOUT_MS))
        .data_bits(serialport::DataBits::Eight)
        .parity(serialport::Parity::None)
        .stop_bits(serialport::StopBits::One)
        .flow_control(serialport::FlowControl::None)
        .open()?;

    // Small delay for port to stabilize
    std::thread::sleep(Duration::from_millis(100));

    Ok(port)
}
```

### Step 4: Send Init Packet

```rust
pub fn send_init_packet(
    port: &mut Box<dyn SerialPort>,
    init_data: &[u8],  // firmware.dat contents
    seq: &mut u8,
) -> Result<(), DfuError> {
    // Build init packet command
    let mut payload = vec![DfuOpcode::InitDfuParams as u8, 0x00]; // 0x00 = receive init
    payload.extend_from_slice(init_data);

    let packet = HciPacket::new(*seq, payload);
    send_and_wait_ack(port, &packet.encode(), seq)?;

    // Send init complete
    let complete_payload = vec![DfuOpcode::InitDfuParams as u8, 0x01]; // 0x01 = init complete
    let complete_packet = HciPacket::new(*seq, complete_payload);
    send_and_wait_ack(port, &complete_packet.encode(), seq)?;

    Ok(())
}
```

### Step 5: Send Start DFU

```rust
pub fn send_start_dfu(
    port: &mut Box<dyn SerialPort>,
    firmware_size: u32,
    seq: &mut u8,
) -> Result<(), DfuError> {
    let mut payload = vec![DfuOpcode::StartDfu as u8, DfuUpdateMode::Application as u8];

    // Sizes: SoftDevice (0), Bootloader (0), Application (firmware_size)
    payload.extend_from_slice(&0u32.to_le_bytes()); // SoftDevice size
    payload.extend_from_slice(&0u32.to_le_bytes()); // Bootloader size
    payload.extend_from_slice(&firmware_size.to_le_bytes()); // Application size

    let packet = HciPacket::new(*seq, payload);
    send_and_wait_ack(port, &packet.encode(), seq)?;

    Ok(())
}
```

### Step 6: Send Firmware Data

```rust
const DFU_PACKET_MAX_SIZE: usize = 512;

pub fn send_firmware(
    port: &mut Box<dyn SerialPort>,
    firmware: &[u8],
    seq: &mut u8,
    progress_callback: impl Fn(usize, usize),
) -> Result<(), DfuError> {
    let total_size = firmware.len();
    let mut sent = 0;

    for chunk in firmware.chunks(DFU_PACKET_MAX_SIZE) {
        let mut payload = vec![DfuOpcode::ReceiveFirmwareImage as u8];
        payload.extend_from_slice(chunk);

        let packet = HciPacket::new(*seq, payload);
        send_and_wait_ack(port, &packet.encode(), seq)?;

        sent += chunk.len();
        progress_callback(sent, total_size);

        // Flash write delay every 8 packets (or tune as needed)
        if *seq % 8 == 0 {
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    Ok(())
}
```

### Step 7: Validate and Activate

```rust
pub fn validate_and_activate(
    port: &mut Box<dyn SerialPort>,
    seq: &mut u8,
) -> Result<(), DfuError> {
    // Validate firmware
    let validate_payload = vec![DfuOpcode::ValidateFirmware as u8];
    let validate_packet = HciPacket::new(*seq, validate_payload);
    send_and_wait_ack(port, &validate_packet.encode(), seq)?;

    // Activate and reset
    let activate_payload = vec![DfuOpcode::ActivateAndReset as u8];
    let activate_packet = HciPacket::new(*seq, activate_payload);

    // Don't wait for ACK - device will reset
    port.write_all(&activate_packet.encode())?;

    Ok(())
}
```

---

## ACK Handling

```rust
const ACK_TIMEOUT_MS: u64 = 1000;
const MAX_RETRIES: u8 = 3;

fn send_and_wait_ack(
    port: &mut Box<dyn SerialPort>,
    data: &[u8],
    seq: &mut u8,
) -> Result<(), DfuError> {
    for attempt in 0..MAX_RETRIES {
        port.write_all(data)?;
        port.flush()?;

        match wait_for_ack(port, *seq) {
            Ok(()) => {
                *seq = (*seq + 1) % 8; // Sequence wraps at 8
                return Ok(());
            }
            Err(DfuError::Timeout) if attempt < MAX_RETRIES - 1 => {
                continue; // Retry
            }
            Err(e) => return Err(e),
        }
    }

    Err(DfuError::MaxRetriesExceeded)
}

fn wait_for_ack(port: &mut Box<dyn SerialPort>, expected_seq: u8) -> Result<(), DfuError> {
    let mut buffer = [0u8; 64];
    let start = std::time::Instant::now();

    while start.elapsed() < Duration::from_millis(ACK_TIMEOUT_MS) {
        match port.read(&mut buffer) {
            Ok(n) if n > 0 => {
                let decoded = slip_decode(&buffer[..n])?;
                // Parse ACK packet and verify sequence
                // ACK format: [control byte with seq][status]
                if decoded.len() >= 2 {
                    let ack_seq = decoded[0] & 0x07;
                    let status = decoded[1];

                    if ack_seq == expected_seq && status == DfuResponse::Success as u8 {
                        return Ok(());
                    }
                }
            }
            Ok(_) => {}
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(e) => return Err(DfuError::Io(e)),
        }
    }

    Err(DfuError::Timeout)
}
```

---

## Main DFU Function

```rust
pub fn upload_firmware(
    port_name: &str,
    firmware_zip_path: &str,
    progress_callback: impl Fn(DfuProgress),
) -> Result<(), DfuError> {
    // 1. Read firmware.zip
    progress_callback(DfuProgress::ReadingPackage);
    let (init_data, firmware_data) = read_firmware_zip(firmware_zip_path)?;

    // 2. Touch reset to enter bootloader
    progress_callback(DfuProgress::EnteringBootloader);
    touch_reset(port_name)?;

    // 3. Wait for bootloader mode
    progress_callback(DfuProgress::WaitingForBootloader);
    let bootloader_port = wait_for_bootloader(port_name, 5000)?;

    // 4. Open DFU connection
    progress_callback(DfuProgress::Connecting);
    let mut port = open_dfu_port(&bootloader_port)?;
    let mut seq: u8 = 0;

    // 5. Send init packet
    progress_callback(DfuProgress::SendingInit);
    send_init_packet(&mut port, &init_data, &mut seq)?;

    // 6. Send start DFU
    progress_callback(DfuProgress::Starting);
    send_start_dfu(&mut port, firmware_data.len() as u32, &mut seq)?;

    // 7. Send firmware
    let total = firmware_data.len();
    send_firmware(&mut port, &firmware_data, &mut seq, |sent, _total| {
        progress_callback(DfuProgress::Uploading { sent, total });
    })?;

    // 8. Validate and activate
    progress_callback(DfuProgress::Validating);
    validate_and_activate(&mut port, &mut seq)?;

    progress_callback(DfuProgress::Complete);
    Ok(())
}
```

---

## File Structure

```
src-tauri/src/
├── main.rs                 # Add new commands to handler
├── commands/
│   ├── mod.rs              # Add dfu module
│   ├── device.rs           # Existing (keep for CircuitPython)
│   ├── firmware.rs         # Existing
│   └── dfu.rs              # NEW: DFU Tauri commands
└── dfu/
    ├── mod.rs              # Public API exports
    ├── error.rs            # DfuError enum
    ├── slip.rs             # SLIP encode/decode
    ├── packet.rs           # HCI packet builder
    ├── protocol.rs         # DFU state machine
    └── device.rs           # Serial device detection
```

---

## Tauri Commands

```rust
// src-tauri/src/commands/dfu.rs

use crate::dfu::{self, DfuProgress, SerialDevice};
use tauri::ipc::Channel;

#[derive(Clone, serde::Serialize)]
pub struct DfuProgressEvent {
    pub stage: String,
    pub sent: Option<usize>,
    pub total: Option<usize>,
    pub percent: Option<f32>,
}

#[tauri::command]
pub async fn detect_nrf52_devices() -> Result<Vec<SerialDevice>, String> {
    dfu::find_nrf52_devices()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upload_firmware_dfu(
    port: String,
    firmware_zip_path: String,
    progress: Channel<DfuProgressEvent>,
) -> Result<(), String> {
    dfu::upload_firmware(&port, &firmware_zip_path, |p| {
        let event = match p {
            DfuProgress::ReadingPackage => DfuProgressEvent {
                stage: "reading".into(),
                sent: None, total: None, percent: Some(0.0),
            },
            DfuProgress::EnteringBootloader => DfuProgressEvent {
                stage: "bootloader".into(),
                sent: None, total: None, percent: Some(5.0),
            },
            DfuProgress::Uploading { sent, total } => DfuProgressEvent {
                stage: "uploading".into(),
                sent: Some(sent),
                total: Some(total),
                percent: Some(10.0 + (sent as f32 / total as f32) * 80.0),
            },
            DfuProgress::Validating => DfuProgressEvent {
                stage: "validating".into(),
                sent: None, total: None, percent: Some(95.0),
            },
            DfuProgress::Complete => DfuProgressEvent {
                stage: "complete".into(),
                sent: None, total: None, percent: Some(100.0),
            },
            _ => return,
        };
        let _ = progress.send(event);
    })
    .map_err(|e| e.to_string())
}
```

---

## Error Handling

```rust
// src-tauri/src/dfu/error.rs

#[derive(Debug, thiserror::Error)]
pub enum DfuError {
    #[error("Serial port error: {0}")]
    Serial(#[from] serialport::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("ZIP error: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("Invalid SLIP escape sequence")]
    InvalidSlipEscape,

    #[error("Timeout waiting for ACK")]
    Timeout,

    #[error("Bootloader not found within timeout")]
    BootloaderTimeout,

    #[error("Max retries exceeded")]
    MaxRetriesExceeded,

    #[error("DFU response error: {0}")]
    DfuResponse(u8),

    #[error("Missing file in firmware.zip: {0}")]
    MissingFile(String),

    #[error("Invalid manifest")]
    InvalidManifest,
}
```

---

## Reading firmware.zip

```rust
use std::io::Read;
use zip::ZipArchive;

pub fn read_firmware_zip(path: &str) -> Result<(Vec<u8>, Vec<u8>), DfuError> {
    let file = std::fs::File::open(path)?;
    let mut archive = ZipArchive::new(file)?;

    // Read manifest to get file names
    let manifest: serde_json::Value = {
        let mut manifest_file = archive.by_name("manifest.json")?;
        let mut contents = String::new();
        manifest_file.read_to_string(&mut contents)?;
        serde_json::from_str(&contents).map_err(|_| DfuError::InvalidManifest)?
    };

    let app = &manifest["manifest"]["application"];
    let bin_name = app["bin_file"].as_str().ok_or(DfuError::InvalidManifest)?;
    let dat_name = app["dat_file"].as_str().ok_or(DfuError::InvalidManifest)?;

    // Read init packet (firmware.dat)
    let init_data = {
        let mut dat_file = archive.by_name(dat_name)?;
        let mut data = Vec::new();
        dat_file.read_to_end(&mut data)?;
        data
    };

    // Read firmware binary
    let firmware_data = {
        let mut bin_file = archive.by_name(bin_name)?;
        let mut data = Vec::new();
        bin_file.read_to_end(&mut data)?;
        data
    };

    Ok((init_data, firmware_data))
}
```

---

## Testing

### Manual Test Flow

1. Build firmware: `pio run` in BlueBuzzah-Firmware
2. Connect Feather nRF52840
3. Run updater with `firmware.zip` path
4. Verify device flashes and reboots

### Test Commands

```bash
# List devices
cargo run -- detect-devices

# Test upload (dry run without device)
cargo test dfu_tests
```

---

## References

- **Adafruit nrfutil source**: https://github.com/adafruit/Adafruit_nRF52_nrfutil
- **DFU transport serial.py**: https://github.com/adafruit/Adafruit_nRF52_nrfutil/blob/master/nordicsemi/dfu/dfu_transport_serial.py
- **Nordic DFU protocol**: https://infocenter.nordicsemi.com/topic/sdk_nrf5_v17.0.2/lib_bootloader_dfu_validation.html
- **SLIP RFC 1055**: https://datatracker.ietf.org/doc/html/rfc1055
- **serialport crate**: https://docs.rs/serialport/latest/serialport/
- **crc16 crate**: https://docs.rs/crc16/latest/crc16/

---

## Notes

### Firmware Package Integration
- The DFU module does **not** handle firmware downloading - it receives a local file path from the existing firmware cache system
- Firmware zip files are named `BlueBuzzah-Firmware-{VERSION}-{SHORT_SHA}.zip` but internal contents are always `firmware.bin`, `firmware.dat`, and `manifest.json`
- The existing updater has `zip` and `sha2` crates already - reuse them

### Device Handling
- The `deploy.py` script in BlueBuzzah-Firmware shows the existing device detection pattern using VID/PID
- Device may appear on a **different port** after entering bootloader mode (especially on Windows)
- The PID changes when entering bootloader: `0x8029` (app) → `0x0029` (bootloader)

### Platform Considerations
- Windows may need additional USB driver handling (Adafruit provides drivers)
- macOS/Linux typically work out of the box with CDC ACM
- Consider adding a "force bootloader" timeout if device doesn't respond

### Existing Updater Architecture
- `commands/firmware.rs` - Handles GitHub API, downloads, caching, checksums
- `commands/device.rs` - Handles CircuitPython mass-storage devices (keep for legacy support)
- `cache.rs` - Firmware cache management
- The new DFU module adds **serial-based flashing** alongside the existing mass-storage approach
