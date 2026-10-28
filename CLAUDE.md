# BlueBuzzah Updater

Tauri 2.0 desktop app that flashes BlueBuzzah firmware over serial to two hardware targets — Adafruit Feather nRF52840 gloves (Nordic Secure DFU) and PentaBuzzer / Seeed XIAO ESP32-S3 boards (esptool protocol via espflash) — then configures device role and therapy profile post-flash.

**Frontend**: React 18 + TypeScript + Vite | Zustand, design-system `bb-` components (Radix for dialogs), Tailwind (layout), Lucide
**Backend**: Rust + Tauri 2.0 | Nordic DFU protocol (nRF52840) and espflash (ESP32-S3) over serial

## Design System — required for every UI/UX change

Any change a person can see, hear or touch follows the **BlueBuzzah design system**. That includes layout, color, type, spacing, components, icons, logos and app icons, motion, accessibility, and copy (voice, error messages, the disclaimer). The design system lives in the BlueBuzzah workspace repo as the `bluebuzzah-design-system` skill, at `../../.claude/skills/bluebuzzah-design-system/` from this repo's root.

Before making a UI/UX change:

1. **Load it.** Invoke the `bluebuzzah-design-system` skill. If it isn't in your skill list (e.g. Claude was started in this repo instead of the workspace root), read `../../.claude/skills/bluebuzzah-design-system/SKILL.md` directly and follow it.
2. **If that path doesn't exist, stop.** This repo isn't checked out inside the workspace. Ask the user to set it up: clone `https://github.com/BlueBuzzah/BlueBuzzah-Workspace`, then run `npm run workspace:setup` to clone this repo under its `projects/`. Don't work from memory.
3. **Read what applies:** `README.md` and `accessibility.md`, then `updater.md` (this app's surface guide), then the README of every design-system component you touch.

Rules:

- **The design system wins any conflict.** That includes existing styling and anything else in this file. Much of the current UI predates it. Build new and changed UI to the design system rather than copying the surrounding legacy styles.
- **Take every value from the design system's tokens.** Use the copied `tokens.css` (the Tailwind theme maps to its variables). Never hand-type a hex color, size, radius, duration or font. Build components as `bb-` wrappers over the copied `bundle.css` (see Conventions).
- **Copy, don't link.** Copy fonts, icons and logos from the design system into this repo. Never reference the workspace path at build or run time, because this repo builds and ships on its own.
- **Don't invent rules.** If the design system doesn't cover something, ask rather than inventing a rule.
- **Full migrations:** a whole-app pass is the `/implement-design-system` command, run from the workspace.

### Design system files

`src/styles/tokens.css`, `src/styles/fonts/` and `src/styles/bundle.css` are copies of the design system, unchanged. Re-run this after a design-system re-import (from this repo's root):

```bash
DS=../../.claude/skills/bluebuzzah-design-system
cp $DS/tokens.css src/styles/tokens.css
rm -rf src/styles/fonts && cp -R $DS/fonts src/styles/fonts
cp $DS/components/bundle.css src/styles/bundle.css
cp $DS/favicons/favicon.ico public/favicon.ico
```

Before committing UI work, this check must print nothing (hand-typed sizes, colors, legacy icons, plurals like "device(s)", exclamation marks):

```bash
grep -rnE "text-(xs|sm|base|lg|[0-9]?xl)\b|text-\[|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(|-(red|amber|yellow|emerald|zinc|blue|green|gray|slate)-[0-9]{2,3}|(bg|text|border|ring|from|to|shadow)-[a-z-]+/[0-9]{1,2}\b|animate-|duration-[0-9]|shadow-(sm|md|lg|xl)|space-y-6|XCircle|AlertCircle|CircuitBoard|\bBan\b|device\(s\)|!['\"]" src --include='*.tsx' --include='*.ts' --include='*.css' | grep -v "src/styles/" | grep -v "\.test\."
```

## Quick Reference

| Task | Command |
|------|---------|
| Dev (hot reload) | `npm run tauri:dev` |
| Frontend typecheck + build | `npm run build` |
| Production build | `npm run tauri:build` (loads updater signing keys from `.env`, see `.env.example`; CI uses `tauri:build:ci`) |
| Frontend tests | `npm test` (Vitest + Testing Library) |
| One frontend test file | `npx vitest run src/services/DeviceService.test.ts` |
| Rust tests | `npm run tauri:test` |
| One Rust test | `cd src-tauri && cargo test <test_name>` |

## Architecture

`HomeScreen` picks a mode; `App.tsx` routes the step switch for two wizards: **flash** (`components/wizard/`: FirmwareSelection → DeviceSelection → InstallationProgress → SuccessScreen) and **therapy config** (`components/therapy/`, steps 0–2: ProfileSelection (renders `CustomProfilePanel` inline when Custom is picked) → TherapyDeviceSelection → TherapyProgress, swapped for TherapySuccess once a result exists). Both → Zustand stores (`src/stores/`: `wizardStore`, `therapyStore`, `settingsStore`, `updaterStore`) → services (`src/services/`: `DeviceService`, `FirmwareService`, `UpdaterService` implement `I*Repository`; `TherapyService` implements `ITherapyService`) → Rust via `invoke()` + `Channel` progress events.

| Rust module (`src-tauri/src/`) | Purpose |
|--------------------------------|---------|
| `dfu/protocol.rs` | DFU state machine — `upload_firmware()`, `configure_device_role_flexible()`, `configure_device_with_settings()`, `drain_boot_output()` |
| `dfu/transport.rs` | Serial transport, 1200-baud touch reset, port-open retry; `open()` (resets board) vs `open_for_query()` (doesn't) |
| `dfu/device.rs` | Device detection; `DeviceIdentifier` tracks devices across re-enumeration (serial number preferred, VID/PID+port-pattern fallback) |
| `dfu/slip.rs`, `dfu/packet.rs` | SLIP/HCI framing, CRC16 |
| `dfu/firmware_reader.rs` | Nordic DFU zip parsing (`manifest.json`, `firmware.bin`/`.dat`) |
| `dfu/menu.rs` | App-mode menu protocol — `[MENU-TX]` frame parsing, `PROFILE_GET`/`PROFILE_CUSTOM` batching (`build_custom_batch`) |
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
- VID `0x303A` (Espressif) / PID `0x1001` (ESP32-S3 USB-JTAG/Serial) identifies PentaBuzzer v3 boards; the same PID is used in both app and download mode, so `in_bootloader` is always `false` for v3 devices. Both boards use the `Nrf52Device` struct (v3 has `board == "esp32s3"`); `display_label()` yields "BlueBuzzah v3 (port)", "BlueBuzzah v2 (port)", or "nRF52840 Bootloader (port)".

## Cross-Repo Contract (must match BlueBuzzah-Firmware)

- Serial commands: `SET_ROLE:PRIMARY|SECONDARY`, `SET_PROFILE:REGULAR|NOISY|HYBRID|GENTLE`, advanced-setting commands from `settings.rs::to_pre_profile_commands()`
- Response markers parsed by `protocol.rs`: `[CONFIG]`, `[ERROR]`, `[SETTING]`, `"Role set to"`, `"Profile set to"` — hardcoded in firmware `main.cpp` serial output; rewording either side breaks the other
- Boot markers in `drain_boot_output`: `[READY]`, `[INIT]`, `[BOOT]`, `BlueBuzzah`
- Firmware distribution: `FirmwareService.ts` fetches `https://api.github.com/repos/BlueBuzzah/BlueBuzzah-Firmware/releases`; asset name determines board — `NRF_ASSET_PATTERN` (`BlueBuzzah-Firmware-<tag>-<sha>.zip`) is the Nordic DFU package (v2), `V3_ASSET_PATTERN` (`BlueBuzzah-Firmware-v3-<tag>-<sha>.zip`) is the v3 package. 60 req/hr unauthenticated.
- v3 manifest schema (`esp/manifest.rs`) is produced by BlueBuzzah-Firmware `scripts/package_penta.py`; keep the two in sync on any manifest field change.
- Menu protocol (Custom therapy profile): the Updater sends `INFO`, `PROFILE_LOAD:4`, `PROFILE_GET`, and `PROFILE_CUSTOM:KEY:VALUE…` over app-mode serial and parses the `[MENU-TX] KEY:VALUE\n…\x04` frame (`dfu/menu.rs`). This works only because those commands are absent from firmware `INTERNAL_MESSAGES` (`include/internal_messages.h` — the single definition site, shared by `src/menu_controller.cpp` and the native test) — adding any of them there silently severs the Updater from the device, which is why `test_menu_controller` guards it.
- Custom parameter bounds are duplicated in `src/lib/therapy-bounds.ts` from the firmware `PARAM_MIN_*`/`PARAM_MAX_*` constants in `include/config.h`. Firmware remains the sole validator; the TS table only constrains inputs and cannot widen what the device accepts.
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
- **Cache keying**: `cache.rs` keys entries `(version, board)` as `version::board`; on disk, `commands/firmware.rs::firmware_filename` keeps legacy `{version}.zip` for nrf52 and `{version}-{board}.zip` for other boards.
- **Opening a port can reboot the glove**: `SerialTransport::open` pulses DTR, which resets the board (deliberate for DFU). Read-only menu paths must use `open_for_query` (no DTR/RTS), as `read_custom_profile` does. macOS may still assert DTR on open by itself.
- **Serial menu replies have no request IDs**: `send_menu_command` calls `clear_input()` before every write. Removing it lets stale `INFO` replies from timed-out readiness probes be read as the answer to the next command.
- **Batch flashing is single-board only**: mixing hardware versions (one v2 + one v3) in the same run is unsupported — enforced by a UI guard in `DeviceSelection` and a defensive guard in `InstallationProgress`. Two devices of the same version flash fine.
- **Custom profile writes are two-phase and reboot the device**: `PROFILE_CUSTOM` is rejected unless Custom is already loaded, and `PROFILE_LOAD` reboots. Phase 2 therefore reacquires the port via `wait_for_application_flexible` between the two. A partial outcome (profile loaded, parameters unconfirmed) must never be reported as success: `commands/dfu.rs` emits a distinct `partial` progress stage (not `complete`) because the frontend badge keys on stage. `preflight_primary_check` runs before `PROFILE_LOAD` so a SECONDARY or silent glove stops the flow.

## Conventions

- Rust retry naming: public retrying fn wraps `*_inner`; single attempt = `*_once`; re-enumeration-tolerant = `*_flexible`
- Tests colocated: `*.test.ts(x)` beside source (global Tauri mocks in `src/test/setup.ts`, factories in `src/test/factories.ts`); Rust `#[cfg(test)]` at file bottom
- Strict TypeScript (no `any`)
- UI components live in `src/components/ui/` and render the design system's `bb-` markup (`bundle.css`). Radix only where behavior needs it (dialog focus trap). Tailwind for layout only; its theme is the token CSS variables. Type comes from `tokens.css` classes. No inline styles except computed widths (progress fill).
- Loading states for all async ops; `src/lib/error-messages.ts` maps DFU errors to user guidance

## Docs

| Document | Purpose |
|----------|---------|
| `SETUP.md` | Per-OS toolchain prerequisites |
| `docs/TAURI_DFU_FLASH_GUIDE.MD` | DFU flashing implementation guide |
