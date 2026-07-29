# BlueBuzzah Updater

Tauri 2.0 desktop app that flashes BlueBuzzah firmware over serial to two hardware targets — Adafruit Feather nRF52840 gloves (Nordic Secure DFU) and PentaBuzzer / Seeed XIAO ESP32-S3 boards (esptool protocol via espflash) — then configures device role and therapy profile post-flash.

**Frontend**: React 18 + TypeScript + Vite | Zustand, shadcn/ui, Tailwind, Lucide
**Backend**: Rust + Tauri 2.0 | Nordic DFU protocol (nRF52840) and espflash (ESP32-S3) over serial

## Quick Reference

| Task | Command |
|------|---------|
| Dev (hot reload) | `npm run tauri:dev` |
| Frontend typecheck + build | `npm run build` |
| Production build | `npm run tauri:build` (loads signing env via dotenv; CI uses `tauri:build:ci`) |
| Frontend tests | `npm test` (Vitest + Testing Library) |
| One frontend test file | `npx vitest run src/services/DeviceService.test.ts` |
| Rust tests | `npm run tauri:test` |
| One Rust test | `cd src-tauri && cargo test <test_name>` |

## Architecture

Frontend flow: `src/components/wizard/` (FirmwareSelection → DeviceSelection → InstallationProgress → SuccessScreen) → Zustand stores (`src/stores/`: `wizardStore`, `therapyStore`, `settingsStore`, `updaterStore`) → services (`src/services/`: `DeviceService`, `FirmwareService`, `TherapyService`, `UpdaterService`, each implementing an `I*Repository` interface) → Rust via `invoke()` + `Channel` progress events.

| Rust module (`src-tauri/src/`) | Purpose |
|--------------------------------|---------|
| `dfu/protocol.rs` | DFU state machine — `upload_firmware()`, `configure_device_role_flexible()`, `configure_device_with_settings()`, `drain_boot_output()` |
| `dfu/transport.rs` | Serial transport, 1200-baud touch reset, port-open retry |
| `dfu/device.rs` | Device detection; `DeviceIdentifier` tracks devices across re-enumeration (serial number preferred, VID/PID+port-pattern fallback) |
| `dfu/slip.rs`, `dfu/packet.rs` | SLIP/HCI framing, CRC16 |
| `dfu/firmware_reader.rs` | Nordic DFU zip parsing (`manifest.json`, `firmware.bin`/`.dat`) |
| `dfu/config.rs` | VID/PIDs, opcodes, all timing/retry constants |
| `dfu/error.rs` | `DfuError` taxonomy — `is_retriable()`, `is_operation_retriable()`, stable `error_code()` (DFU-0xx) |
| `esp/manifest.rs` | v3 (ESP32-S3/PentaBuzzer) firmware zip parsing — validates `manifest_version` 1, board `pentabuzzer_esp32s3`, chip `esp32s3`, per-part SHA256; parses manifest flash offsets |
| `esp/flasher.rs` | espflash 4.5-based multi-part flash over the ESP32-S3 USB-JTAG/Serial bootloader; reuses `DfuStage` progress and `configure_device_role_flexible` role config; exposes Tauri command `flash_v3_firmware` |
| `commands/` | Tauri command boundary (`dfu.rs`, `firmware.rs`, `settings.rs`); stringifies errors for frontend |
| `cache.rs` | Per-version firmware cache with SHA256 verification |
| `settings.rs` | `AdvancedSettings` persistence + pre-profile serial command generation |

**Flash flow** (`upload_firmware`): read DFU zip → touch reset (1200 baud, DTR toggle) → `wait_for_bootloader_flexible` (2 consecutive detections) → HCI DFU: start → erase wait (`wait_with_drain`) → init packet → chunked firmware with flash-page pacing → validate → reboot → `wait_for_application_flexible` → send `SET_ROLE:...` over app-mode serial.

**Concurrency**: `DFU_IN_PROGRESS`/`DFU_CANCELLED` atomics + RAII `DfuGuard` in `commands/dfu.rs`. A dropped frontend `Channel` sets `DFU_CANCELLED` (reverse cancellation path).

## Hardware Constants (`dfu/config.rs`)

- VID `0x239A` (Adafruit); app PIDs `0x8029`/`0x802A`; bootloader PIDs `0x0029`/`0x002A`
- DFU protocol at 115200 baud; bootloader entry via 1200-baud touch
- VID `0x303A` (Espressif) / PID `0x1001` (ESP32-S3 USB-JTAG/Serial) identifies PentaBuzzer v3 boards; the same PID is used in both app and download mode, so `in_bootloader` is always `false` for v3 devices. Device labels are fixed per hardware revision by `find_supported_devices()`: "BlueBuzzah v2 (port)" for nRF52840, "BlueBuzzah v3 (port)" for ESP32-S3.

## Cross-Repo Contract (must match BlueBuzzah-Firmware)

- Serial commands: `SET_ROLE:PRIMARY|SECONDARY`, `SET_PROFILE:REGULAR|NOISY|HYBRID|GENTLE`, advanced-setting commands from `settings.rs::to_pre_profile_commands()`
- Response markers parsed by `protocol.rs`: `[CONFIG]`, `[ERROR]`, `[SETTING]`, `"Role set to"`, `"Profile set to"` — hardcoded in firmware `main.cpp` serial output; rewording either side breaks the other
- Boot markers in `drain_boot_output`: `[READY]`, `[INIT]`, `[BOOT]`, `BlueBuzzah`
- Firmware distribution: `FirmwareService.ts` fetches `https://api.github.com/repos/BlueBuzzah/BlueBuzzah-Firmware/releases`; asset name determines board — `NRF_ASSET_PATTERN` (`BlueBuzzah-Firmware-<tag>-<sha>.zip`) is the Nordic DFU package (v2), `V3_ASSET_PATTERN` (`BlueBuzzah-Firmware-v3-<tag>-<sha>.zip`) is the v3 package. 60 req/hr unauthenticated.
- v3 manifest schema (`esp/manifest.rs`) is produced by BlueBuzzah-Firmware `scripts/package_penta.py`; keep the two in sync on any manifest field change.
- Menu protocol (Custom therapy profile): the Updater sends `INFO`, `PROFILE_LOAD:4`, `PROFILE_GET`, and `PROFILE_CUSTOM:KEY:VALUE…` over app-mode serial and parses the `[MENU-TX] KEY:VALUE\n…\x04` frame (`dfu/menu.rs`). This works only because those commands are absent from firmware `INTERNAL_MESSAGES` (`menu_controller.cpp`) — adding any of them there silently severs the Updater from the device, which is why `test_menu_controller` guards it.
- Custom parameter bounds are duplicated in `src/lib/therapy-bounds.ts` from firmware `include/config.h:197-206`. Firmware remains the sole validator; the TS table only constrains inputs and cannot widen what the device accepts.
- `PROFILE_GET` does not identify which profile its values belong to. Always ask `INFO` first and only read values when it reports `PROFILE:4:…`.
- `setParameter` validates `AMPMIN` against the stored `amplitudeMax` and vice versa, so `build_custom_batch` orders the two keys from the device's current values. Reordering them unconditionally reintroduces a rejected batch.

## Gotchas

- **Windows semaphore timeout**: `"The semaphore timeout period has expired"` (ERROR_SEM_TIMEOUT) means CDC pipes aren't bound yet post-reboot — transient, must stay classified retriable in `transport.rs::is_transient_port_error`, `error.rs::is_retriable`, and `commands/dfu.rs::is_operation_retriable`.
- **Role-config failure must never re-flash**: role config runs *after* a successful transfer; `is_operation_retriable` deliberately excludes it (it has its own inner retry). Regression = pointless full re-flash of a good device.
- **Windows COM renumbering**: port numbers change across DFU reboots — always track devices via `DeviceIdentifier`, never a stored port string. Windows also gets longer touch waits and more re-detection polls (`#[cfg(target_os = "windows")]` throughout).
- **macOS duplicate ports**: devices appear as both `cu.*` and `tty.*`; `find_nrf52_devices` filters `tty.*` — bypassing it double-counts devices.
- **macOS stale port**: `wait_with_drain` keep-alives the port during the long flash-erase wait; removing it causes macOS-only flakiness.
- **Boot noise**: firmware boot logs can contain `ERROR` text; always `drain_boot_output` before sending a command or responses get misparsed.
- **`[SETTING]` ack timeout = success**: `send_setting_command` treats no-ack as success for backward compat with older firmware.
- **Format detection**: a firmware zip's `manifest.json` has `manifest_version` for v3 or a top-level `manifest` key for Nordic — never feed one reader the other's zip.
- **Cache keying**: `cache.rs` keys entries `(version, board)` as `version::board`; nrf52 keeps legacy `{version}.zip` filenames on disk, other boards use `{version}-{board}.zip`.
- **Batch flashing is single-board only**: mixing hardware versions (one v2 + one v3) in the same run is unsupported — enforced by a UI guard in `DeviceSelection` and a defensive guard in `InstallationProgress`. Two devices of the same version flash fine.
- **Custom profile writes are two-phase and reboot the device**: `PROFILE_CUSTOM` is rejected unless Custom is already loaded, and `PROFILE_LOAD` reboots. Phase 2 therefore reacquires the port via `wait_for_application_flexible` between the two. A partial outcome (profile loaded, parameters unconfirmed) must never be reported as success.

## Conventions

- Rust retry naming: public retrying fn wraps `*_inner`; single attempt = `*_once`; re-enumeration-tolerant = `*_flexible`
- Tests colocated: `*.test.ts(x)` beside source (global Tauri mocks in `src/test/setup.ts`, factories in `src/test/factories.ts`); Rust `#[cfg(test)]` at file bottom
- Strict TypeScript (no `any`); shadcn/ui components exclusively; Tailwind only (no inline styles)
- Blue for success states (brand); loading states for all async ops; errors via toast or destructive card (`src/lib/error-messages.ts` maps DFU errors to user guidance)

## Docs

| Document | Purpose |
|----------|---------|
| `docs/TAURI_DFU_FLASH_GUIDE.MD` | DFU flashing implementation guide |
| `docs/DESIGN_GUIDE.md` | UI/visual design guide |
| `docs/superpowers/plans/` | TDD implementation plans (e.g. Windows re-enum/role-config resilience) |
