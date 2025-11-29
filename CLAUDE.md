# BlueBuzzah Updater - Claude Code Reference

## Project Overview

Tauri 2.0 desktop app for DFU firmware flashing to Adafruit Feather nRF52840 devices. 4-step wizard: Firmware Selection → Device Selection → Installation → Success.

## Tech Stack

**Frontend**: React 18 + TypeScript + Vite | Zustand | shadcn/ui (dark theme) | Tailwind | Lucide
**Backend**: Rust + Tauri 2.0 | Nordic DFU protocol over serial
**Target Hardware**: Adafruit Feather nRF52840 Express (VID: 0x239A)

## Architecture

### Frontend Services

- `src/services/FirmwareService.ts`: GitHub API, firmware download/cache
- `src/services/DeviceService.ts`: Device detection, DFU flashing, progress tracking
- `src/stores/wizardStore.ts`: Wizard state (Zustand)

### Rust DFU Module (`src-tauri/src/dfu/`)

| File | Purpose |
|------|---------|
| `config.rs` | USB VID/PID, protocol constants, HCI flags |
| `error.rs` | `DfuError` enum with thiserror |
| `slip.rs` | SLIP encoding/decoding, streaming decoder |
| `packet.rs` | HCI packet builder with CRC16-CCITT |
| `firmware_reader.rs` | Firmware zip parsing (manifest.json, .bin, .dat) |
| `transport.rs` | Serial port abstraction, 1200 baud touch |
| `device.rs` | nRF52840 detection by VID/PID |
| `protocol.rs` | DFU state machine, role configuration |

### Tauri Commands

```rust
// src-tauri/src/commands/dfu.rs
detect_dfu_devices()           // Returns Vec<DfuDevice>
flash_dfu_firmware(            // Flashes firmware with progress channel
  serial_port, firmware_path,
  device_role, progress: Channel
)

// src-tauri/src/commands/firmware.rs
download_firmware(url, version)
get_cached_firmware()
extract_firmware(zip_path, dest)
```

## Device Detection

- **VID**: `0x239A` (Adafruit)
- **App PIDs**: `0x8029` (Feather nRF52840)
- **Bootloader PIDs**: `0x0029`, `0x0052`
- **macOS**: Filters `tty.*` ports, uses `cu.*` only
- **Windows**: Handles COM ports > 9 with `\\.\` prefix

## DFU Installation Flow

1. **Bootloader Entry**: 1200 baud touch triggers bootloader mode
2. **Wait for Device**: Poll for bootloader PID (device re-enumerates)
3. **Send Init Packet**: `firmware.dat` with device info
4. **Transfer Firmware**: `firmware.bin` in 512-byte chunks via SLIP/HCI
5. **Validate**: Device verifies CRC
6. **Configure Role**: Send `SET_ROLE:PRIMARY\n` or `SET_ROLE:SECONDARY\n`
7. **Activate**: Device reboots into new firmware

## Device Roles

- **PRIMARY**: Coordinator - `SET_ROLE:PRIMARY\n`
- **SECONDARY**: Listener - `SET_ROLE:SECONDARY\n`
- Sent via serial after firmware validation, before activation

## Design System

| Element | Value |
|---------|-------|
| Primary | `#35B6F2` (blue) - buttons, progress, success |
| Secondary | `#05212D` (dark navy) - cards |
| Background | `#0a0a0a` |
| **Success color** | **Blue only** - never green |

## Key Constraints

1. Dark theme only
2. Linear wizard (no step skipping)
3. GitHub releases only (no manual upload)
4. Auto-detection only (no manual port entry)
5. Single firmware version per session
6. Up to 2 devices simultaneously

## Commands

```bash
npm run tauri:dev      # Dev with hot reload
npm run tauri:build    # Production build
npm run build          # Frontend TypeScript check
npm test               # Frontend tests (272)
cargo test             # Rust tests (88)
```

## File Structure

```
src/
├── services/          # FirmwareService, DeviceService
├── stores/            # wizardStore (Zustand)
├── components/wizard/ # FirmwareSelection, DeviceSelection, etc.
├── types/index.ts     # Device, DfuProgress, UpdateProgress
└── lib/error-messages.ts  # Error guidance with DFU patterns

src-tauri/src/
├── dfu/               # Nordic DFU implementation
├── commands/          # dfu.rs, firmware.rs
├── cache.rs           # Firmware cache management
└── main.rs            # Tauri app entry
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No devices | Check USB data cable, try different port |
| Device not detected | Press reset twice quickly for DFU mode |
| 4 devices shown (macOS) | Fixed - filters `tty.*` ports |
| Permission denied | Grant terminal Full Disk Access |
| Build errors | `cargo clean`, clear `node_modules` |

## GitHub Integration

- Repo: `BlueBuzzah/BlueBuzzah-Firmware`
- Asset: First `.zip` in release assets
- Rate limit: 60 req/hr unauthenticated

## Development Rules

1. Use shadcn/ui components exclusively
2. Repository pattern for services
3. Strict TypeScript (no `any`)
4. Tailwind only (no inline styles)
5. Blue for success states (brand consistency)
6. Loading states for all async operations
7. Error messages via toast or destructive card
