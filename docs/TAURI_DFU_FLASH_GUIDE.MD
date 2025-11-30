# Firmware Flashing nRF52840 from Tauri Rust Backend

The Adafruit Feather nRF52840 Express uses Nordic's Serial DFU protocol with a **zip package** containing `firmware.bin`, `firmware.dat`, and `manifest.json`. PlatformIO and Arduino IDE generate these packages during compilation. This guide covers implementing the **upload** portion only — extracting and flashing an existing DFU package from a Tauri Rust backend.

## DFU Package Structure

The DFU zip package contains three files:

| File            | Purpose                                                      |
| --------------- | ------------------------------------------------------------ |
| `firmware.bin`  | Raw binary firmware image (converted from .hex)              |
| `firmware.dat`  | Init packet with metadata (device type, CRC16, version info) |
| `manifest.json` | JSON descriptor linking the above files                      |

Example `manifest.json`:

```json
{
  "manifest": {
    "application": {
      "bin_file": "firmware.bin",
      "dat_file": "firmware.dat",
      "init_packet_data": {
        "application_version": 4294967295,
        "device_revision": 65535,
        "device_type": 65535,
        "firmware_crc16": 11098,
        "softdevice_req": [65534]
      }
    },
    "dfu_version": 0.5
  }
}
```

The `firmware.dat` file is a binary init packet containing device type (2 bytes), device revision (2 bytes), application version (4 bytes), softdevice requirements (2 bytes each), and a CRC16 of the firmware binary.

## PlatformIO's upload mechanism

PlatformIO uses `adafruit-nrfutil` with the `nrfutil` upload protocol. The upload process:

1. **1200bps touch**: Open serial at 1200 baud to trigger bootloader
2. **Serial DFU**: Upload via SLIP-encoded protocol at 115200 baud

```bash
# Serial upload with bootloader trigger
adafruit-nrfutil dfu serial --package firmware.zip \
    -p /dev/ttyACM0 -b 115200 --singlebank --touch 1200
```

The `--touch 1200` flag triggers bootloader mode automatically before upload.

## Bootloader specifications

The Adafruit nRF52 Bootloader USB identification:

| Mode        | VID    | PID    | Interface          |
| ----------- | ------ | ------ | ------------------ |
| Application | 0x239A | 0x8029 | CDC serial         |
| Bootloader  | 0x239A | 0x0029 | Mass storage + CDC |

Bootloader entry methods:

- **1200bps touch**: Open serial at 1200 baud, toggle DTR, close
- **Double-tap reset**: Hardware reset twice within 500ms
- **DFU pin low**: Hold DFU pin during reset

## Rust Implementation

### DFU Package extraction

Extract the three files from the zip package. DFU packages typically use STORED compression (no deflate).

```rust
use std::io::Read;
use zip::ZipArchive;

pub struct DfuPackage {
    pub firmware_bin: Vec<u8>,
    pub firmware_dat: Vec<u8>,
}

impl DfuPackage {
    pub fn from_zip(path: &str) -> Result<Self, String> {
        let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;

        // Read manifest.json to get filenames
        let (bin_name, dat_name) = {
            let mut manifest_file = archive.by_name("manifest.json")
                .map_err(|e| e.to_string())?;
            let mut contents = String::new();
            manifest_file.read_to_string(&mut contents).map_err(|e| e.to_string())?;

            // Parse manifest to get bin_file and dat_file names
            // (implement JSON parsing as needed)
            Self::parse_manifest(&contents)?
        };

        // Read firmware.bin
        let firmware_bin = {
            let mut bin_file = archive.by_name(&bin_name)
                .map_err(|e| e.to_string())?;
            let mut data = Vec::new();
            bin_file.read_to_end(&mut data).map_err(|e| e.to_string())?;
            data
        };

        // Read firmware.dat (init packet)
        let firmware_dat = {
            let mut dat_file = archive.by_name(&dat_name)
                .map_err(|e| e.to_string())?;
            let mut data = Vec::new();
            dat_file.read_to_end(&mut data).map_err(|e| e.to_string())?;
            data
        };

        Ok(Self { firmware_bin, firmware_dat })
    }

    fn parse_manifest(json: &str) -> Result<(String, String), String> {
        // Extract bin_file and dat_file from manifest
        // Implement based on your JSON parsing approach
        todo!("Parse manifest JSON")
    }
}
```

### Device detection and bootloader trigger

```rust
pub enum DeviceState {
    Application { port: String },
    Bootloader { port: String },
    NotFound,
}

pub fn detect_device() -> DeviceState {
    for port in serialport::available_ports().unwrap_or_default() {
        if let SerialPortType::UsbPort(info) = &port.port_type {
            if info.vid == ADAFRUIT_VID {
                return match info.pid {
                    FEATHER_APP_PID => DeviceState::Application {
                        port: port.port_name
                    },
                    FEATHER_BOOT_PID => DeviceState::Bootloader {
                        port: port.port_name
                    },
                    _ => continue,
                };
            }
        }
    }
    DeviceState::NotFound
}

pub fn trigger_bootloader(port_path: &str) -> Result<(), String> {
    // Open at 1200 baud - this triggers the bootloader
    let port = serialport::new(port_path, 1200)
        .timeout(Duration::from_millis(100))
        .open()
        .map_err(|e| format!("Failed to open port: {}", e))?;

    // Toggle DTR to trigger reset
    port.write_data_terminal_ready(false)
        .map_err(|e| e.to_string())?;

    drop(port);

    // Wait for bootloader enumeration
    std::thread::sleep(Duration::from_millis(2000));
    Ok(())
}
```

### SLIP encoding for Serial DFU

The Nordic DFU protocol uses SLIP (Serial Line Internet Protocol) framing:

```rust
const SLIP_END: u8 = 0xC0;
const SLIP_ESC: u8 = 0xDB;
const SLIP_ESC_END: u8 = 0xDC;
const SLIP_ESC_ESC: u8 = 0xDD;

pub fn slip_encode(data: &[u8]) -> Vec<u8> {
    let mut encoded = vec![SLIP_END];
    for &byte in data {
        match byte {
            SLIP_END => { encoded.push(SLIP_ESC); encoded.push(SLIP_ESC_END); }
            SLIP_ESC => { encoded.push(SLIP_ESC); encoded.push(SLIP_ESC_ESC); }
            _ => encoded.push(byte),
        }
    }
    encoded.push(SLIP_END);
    encoded
}

pub fn slip_decode(data: &[u8]) -> Result<Vec<u8>, &'static str> {
    let mut decoded = Vec::new();
    let mut escaped = false;

    for &byte in data.iter().filter(|&&b| b != SLIP_END) {
        if escaped {
            match byte {
                SLIP_ESC_END => decoded.push(SLIP_END),
                SLIP_ESC_ESC => decoded.push(SLIP_ESC),
                _ => return Err("Invalid escape sequence"),
            }
            escaped = false;
        } else if byte == SLIP_ESC {
            escaped = true;
        } else {
            decoded.push(byte);
        }
    }
    Ok(decoded)
}
```

### DFU Protocol Implementation

The legacy DFU protocol (version 0.5) used by adafruit-nrfutil follows this sequence:

```rust
#[repr(u8)]
pub enum DfuOpcode {
    StartDfu = 0x01,
    InitDfuParams = 0x02,
    ReceiveFirmwareImage = 0x03,
    ValidateFirmware = 0x04,
    ActivateAndReset = 0x05,
    SystemReset = 0x06,
    ReportReceivedImageSize = 0x07,
    PacketReceiptNotificationRequest = 0x08,
    Response = 0x10,
    PacketReceiptNotification = 0x11,
}

#[repr(u8)]
pub enum DfuImageType {
    None = 0x00,
    Softdevice = 0x01,
    Bootloader = 0x02,
    SoftdeviceBootloader = 0x03,
    Application = 0x04,
}

pub struct LegacyDfuTransport {
    port: Box<dyn serialport::SerialPort>,
    prn: u16, // Packet Receipt Notification interval
}

impl LegacyDfuTransport {
    pub fn new(port_path: &str) -> Result<Self, String> {
        let port = serialport::new(port_path, 115200)
            .timeout(Duration::from_secs(5))
            .open()
            .map_err(|e| e.to_string())?;

        Ok(Self { port, prn: 0 })
    }

    pub fn send_start_dfu(&mut self, image_type: DfuImageType, image_size: u32)
        -> Result<(), String>
    {
        // Start DFU packet: [opcode, type, softdevice_size(4), bootloader_size(4), app_size(4)]
        let mut packet = vec![DfuOpcode::StartDfu as u8, image_type as u8];

        // For application-only update: sd=0, bl=0, app=size
        packet.extend_from_slice(&0u32.to_le_bytes()); // softdevice size
        packet.extend_from_slice(&0u32.to_le_bytes()); // bootloader size
        packet.extend_from_slice(&image_size.to_le_bytes()); // app size

        self.send_packet(&packet)?;
        self.wait_for_response(DfuOpcode::StartDfu)
    }

    pub fn send_init_packet(&mut self, init_data: &[u8]) -> Result<(), String> {
        // Send init packet in two parts
        // Part 1: Notify init packet incoming
        let packet = vec![DfuOpcode::InitDfuParams as u8, 0x00];
        self.send_packet(&packet)?;

        // Part 2: Send actual init data
        let mut packet = vec![DfuOpcode::InitDfuParams as u8, 0x01];
        packet.extend_from_slice(init_data);
        self.send_packet(&packet)?;

        self.wait_for_response(DfuOpcode::InitDfuParams)
    }

    pub fn send_firmware<F>(&mut self, data: &[u8], progress_cb: F) -> Result<(), String>
    where
        F: Fn(usize, usize),
    {
        const CHUNK_SIZE: usize = 20; // BLE-compatible chunk size

        for (i, chunk) in data.chunks(CHUNK_SIZE).enumerate() {
            self.send_packet(chunk)?;

            // Handle PRN if enabled
            if self.prn > 0 && (i + 1) % (self.prn as usize) == 0 {
                self.wait_for_prn()?;
            }

            progress_cb(i * CHUNK_SIZE + chunk.len(), data.len());
        }

        self.wait_for_response(DfuOpcode::ReceiveFirmwareImage)
    }

    pub fn validate_and_activate(&mut self) -> Result<(), String> {
        let packet = vec![DfuOpcode::ValidateFirmware as u8];
        self.send_packet(&packet)?;
        self.wait_for_response(DfuOpcode::ValidateFirmware)?;

        let packet = vec![DfuOpcode::ActivateAndReset as u8];
        self.send_packet(&packet)?;
        Ok(())
    }

    fn send_packet(&mut self, data: &[u8]) -> Result<(), String> {
        let encoded = slip_encode(data);
        self.port.write_all(&encoded).map_err(|e| e.to_string())
    }

    fn wait_for_response(&mut self, expected_op: DfuOpcode) -> Result<(), String> {
        let response = self.read_slip_packet()?;

        if response.len() < 3 {
            return Err("Response too short".into());
        }

        if response[0] != DfuOpcode::Response as u8 {
            return Err(format!("Unexpected opcode: {}", response[0]));
        }

        if response[1] != expected_op as u8 {
            return Err(format!("Response for wrong operation: {}", response[1]));
        }

        if response[2] != 0x01 { // SUCCESS
            return Err(format!("DFU error: {}", response[2]));
        }

        Ok(())
    }

    fn wait_for_prn(&mut self) -> Result<(), String> {
        let response = self.read_slip_packet()?;
        if response.get(0) != Some(&(DfuOpcode::PacketReceiptNotification as u8)) {
            return Err("Expected PRN".into());
        }
        Ok(())
    }

    fn read_slip_packet(&mut self) -> Result<Vec<u8>, String> {
        let mut buffer = vec![0u8; 512];
        let mut response = Vec::new();

        loop {
            match self.port.read(&mut buffer) {
                Ok(n) if n > 0 => {
                    response.extend_from_slice(&buffer[..n]);
                    // Check for complete SLIP frame
                    if response.len() > 1 &&
                       response[0] == SLIP_END &&
                       response[response.len()-1] == SLIP_END {
                        break;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {
                    if !response.is_empty() { break; }
                }
                Err(e) => return Err(e.to_string()),
                _ => {}
            }
        }

        slip_decode(&response)
    }
}
```

## Tauri Integration

### Backend commands with progress

```rust
use tauri::{AppHandle, Manager};
use serde::Serialize;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Serialize)]
struct FlashProgress {
    stage: String,
    progress: f32,
    message: String,
}

#[derive(Default)]
pub struct FlashState {
    cancel_requested: AtomicBool,
}

#[tauri::command]
async fn flash_firmware(
    app: AppHandle,
    package_path: String,
    state: tauri::State<'_, Arc<FlashState>>,
) -> Result<String, String> {
    state.cancel_requested.store(false, Ordering::SeqCst);

    emit_progress(&app, "loading", 0.0, "Loading DFU package...");
    let package = DfuPackage::from_zip(&package_path)?;

    emit_progress(&app, "detecting", 0.05, "Detecting device...");
    let device = detect_device();

    let port = match device {
        DeviceState::Application { port } => {
            emit_progress(&app, "bootloader", 0.1, "Triggering bootloader...");
            trigger_bootloader(&port)?;

            tokio::time::sleep(Duration::from_millis(2500)).await;

            match detect_device() {
                DeviceState::Bootloader { port } => port,
                _ => return Err("Device did not enter bootloader".into()),
            }
        }
        DeviceState::Bootloader { port } => port,
        DeviceState::NotFound => return Err("No device found".into()),
    };

    if state.cancel_requested.load(Ordering::SeqCst) {
        return Err("Cancelled".into());
    }

    emit_progress(&app, "connecting", 0.15, "Connecting to bootloader...");
    let mut transport = LegacyDfuTransport::new(&port)?;

    emit_progress(&app, "start", 0.2, "Starting DFU...");
    transport.send_start_dfu(
        DfuImageType::Application,
        package.firmware_bin.len() as u32
    )?;

    emit_progress(&app, "init", 0.25, "Sending init packet...");
    transport.send_init_packet(&package.firmware_dat)?;

    emit_progress(&app, "firmware", 0.3, "Uploading firmware...");
    let app_clone = app.clone();
    transport.send_firmware(&package.firmware_bin, |sent, total| {
        let progress = 0.3 + 0.6 * (sent as f32 / total as f32);
        emit_progress(&app_clone, "firmware", progress,
            &format!("Uploading: {}%", (progress * 100.0) as u32));
    })?;

    emit_progress(&app, "validate", 0.95, "Validating firmware...");
    transport.validate_and_activate()?;

    emit_progress(&app, "complete", 1.0, "Flash complete!");
    Ok("Firmware uploaded successfully".into())
}

fn emit_progress(app: &AppHandle, stage: &str, progress: f32, message: &str) {
    let _ = app.emit("flash-progress", FlashProgress {
        stage: stage.to_string(),
        progress,
        message: message.to_string(),
    });
}

#[tauri::command]
fn cancel_flash(state: tauri::State<'_, Arc<FlashState>>) {
    state.cancel_requested.store(true, Ordering::SeqCst);
}
```

### Frontend integration

```typescript
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

interface FlashProgress {
  stage: string;
  progress: number;
  message: string;
}

export async function flashFirmware(packagePath: string): Promise<string> {
  const unlisten = await listen<FlashProgress>("flash-progress", (event) => {
    console.log(
      `[${event.payload.stage}] ${(event.payload.progress * 100).toFixed(
        1
      )}%: ${event.payload.message}`
    );
    // Update your UI progress bar here
  });

  try {
    return await invoke<string>("flash_firmware", { packagePath });
  } finally {
    unlisten();
  }
}
```

## Bundling adafruit-nrfutil as sidecar

For rapid implementation, bundle the Python tool:

```json
// src-tauri/tauri.conf.json
{
  "bundle": {
    "externalBin": ["binaries/adafruit-nrfutil"]
  }
}
```

Build standalone executable:

```bash
pip install pyinstaller
git clone https://github.com/adafruit/Adafruit_nRF52_nrfutil
cd Adafruit_nRF52_nrfutil/nordicsemi
pyinstaller __main__.py --onefile --clean --name adafruit-nrfutil
```

Rust sidecar invocation:

```rust
use tauri_plugin_shell::ShellExt;

#[tauri::command]
async fn flash_via_sidecar(
    app: AppHandle,
    package_path: String,
    port: String,
) -> Result<String, String> {
    let shell = app.shell();

    let output = shell.sidecar("adafruit-nrfutil")
        .map_err(|e| e.to_string())?
        .args([
            "dfu", "serial",
            "--package", &package_path,
            "-p", &port,
            "-b", "115200",
            "--singlebank",
            "--touch", "1200"
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok("Flash complete".into())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
```

## Cross-platform USB permissions

**Linux** (`/etc/udev/rules.d/99-adafruit.rules`):

```bash
SUBSYSTEM=="usb", ATTR{idVendor}=="239a", MODE="0666"
SUBSYSTEM=="tty", ATTRS{idVendor}=="239a", MODE="0666"
```

**macOS**: Works without additional configuration for CDC devices.

**Windows**: Uses standard CDC-ACM driver (usbser.sys) automatically.

## Implementation Decision Matrix

| Approach                   | Complexity | Dependencies       | Best For                             |
| -------------------------- | ---------- | ------------------ | ------------------------------------ |
| Pure Rust DFU              | Medium     | serialport, zip    | Full control, minimal deps           |
| Sidecar (adafruit-nrfutil) | Low        | PyInstaller bundle | Quick validation, proven reliability |

Recommended: Pure Rust for production. Sidecar only for initial validation if needed.
