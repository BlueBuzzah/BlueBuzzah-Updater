# BlueBuzzah Updater - Claude Code Reference

## Project Overview

Tauri 2.0 desktop app for CircuitPython firmware deployment. 4-step wizard: Firmware Selection → Device Selection → Installation → Success.

## Tech Stack

**Frontend**: React 18 + TS + Vite | Zustand (state) | shadcn/ui (dark) | Tailwind | Lucide icons
**Backend**: Rust + Tauri 2.0 commands
**Patterns**: Repository pattern, OOP services

## Architecture

### State Management (Zustand)

- `src/stores/wizardStore.ts`: Wizard flow, selected firmware/devices, progress tracking
- Single store, no Redux

### Services (Repository Pattern)

- `src/services/FirmwareService.ts`: GitHub API, firmware download/cache via Tauri commands
- `src/services/DeviceService.ts`: Device detection, firmware deployment, config generation

### Tauri Commands (Rust)

- `src-tauri/src/commands/firmware.rs`: `download_firmware`, `get_cached_firmware`, `extract_firmware`
- `src-tauri/src/commands/device.rs`: `detect_devices`, `deploy_firmware`, `write_config`

### Key Components

- `src/components/wizard/`: FirmwareSelection, DeviceSelection, InstallationProgress, SuccessScreen
- `src/components/layout/WizardLayout.tsx`: Step indicator, navigation
- `src/components/ui/`: shadcn/ui primitives (button, card, progress, badge, toast, select)

## Design System

### Colors (Brand Identity)

- **Primary**: `#35B6F2` (blue) - buttons, progress, success states, accents
- **Secondary**: `#05212D` (dark navy) - cards, surfaces
- **Background**: `#0a0a0a` | **Text**: `#fafafa`
- **NO green for success** - always use blue for brand consistency

### Effects

- Blue glow: `rgba(53, 182, 242, 0.2)` on hover/active
- Transitions: 200ms ease-in-out
- Border radius: buttons 6px, cards 8px, badges full

### Typography

- System fonts only (no web fonts)
- Headers: bold/semibold | Body: 16px | Small: 14px | Badges: 12px

## Key Constraints

1. **Dark theme only** - no light mode
2. **Linear wizard** - no step skipping, back button enabled (except during install)
3. **GitHub releases only** - no manual firmware upload
4. **Auto-detection only** - no manual device path entry
5. **Single firmware version** - all devices get same version per session
6. **CircuitPython devices** - detects via `boot_out.txt` on `CIRCUITPY` mount

## Device Roles

- **PRIMARY**: Coordinator, broadcasts to secondary (config: `ROLE = "primary"`)
- **SECONDARY**: Listener, receives from primary (config: `ROLE = "secondary"`)
- Config written to `<device>/config.py` during installation

## Installation Flow

1. **Download**: GitHub release → local cache (20% progress)
2. **Wipe**: Delete old firmware files (per device)
3. **Copy**: Extract and transfer firmware files (shows current file)
4. **Configure**: Write role-specific `config.py`
5. **Complete**: Per-device completion, all devices succeed → wizard complete

## Common Commands

```bash
npm run tauri:dev      # Dev mode (hot reload)
npm run tauri:build    # Production build (DMG/MSI)
npm run build          # Frontend only (TypeScript check)
cd src-tauri && cargo clean  # Clean Rust cache
```

## File Locations

### Critical Paths

- Main entry: `src/main.tsx` → `src/App.tsx`
- Types: `src/types/index.ts` (Device, FirmwareRelease, UpdateProgress, etc.)
- Styles: `src/index.css` (CSS vars, Tailwind, global styles)
- Tauri config: `src-tauri/tauri.conf.json`
- Rust main: `src-tauri/src/main.rs`

### Config Templates

- `src/lib/config.ts`: PRIMARY/SECONDARY config.py templates

## Development Rules

1. **Always use shadcn/ui components** - no custom buttons/cards/etc.
2. **Repository pattern** - services implement interfaces, export singletons
3. **Type safety** - no `any`, strict TypeScript
4. **Functional components** - hooks only, no class components
5. **Tailwind only** - no inline styles except dynamic values
6. **Blue for success** - never green (brand consistency)

## Common Patterns

### Tauri Command Invocation

```typescript
import { invoke } from "@tauri-apps/api/core";
const result = await invoke<ReturnType>("command_name", { param: value });
```

### Progress Updates

```typescript
deviceService.deployFirmware(device, firmware, (progress: UpdateProgress) => {
  // progress.stage: 'wiping' | 'copying' | 'configuring' | 'complete'
  // progress.progress: 0-100
  // progress.currentFile: string | undefined
});
```

### Wizard Navigation

```typescript
const { currentStep, nextStep, prevStep, selectRelease, selectDevices } =
  useWizardStore();
```

## Troubleshooting

- **No devices detected**: Check `CIRCUITPY` mount, verify `boot_out.txt` exists
- **Build errors**: Run `cargo clean`, clear `node_modules`, rebuild
- **Type errors**: Ensure all imports match exact export names (case-sensitive)
- **macOS permissions**: Grant Full Disk Access to Terminal/IDE

## GitHub Integration

- Repo: `BlueBuzzah/BlueBuzzah-Firmware`
- API: `https://api.github.com/repos/BlueBuzzah/BlueBuzzah-Firmware/releases`
- Asset detection: Finds first `.zip` file in release assets
- Rate limit: 60 req/hr unauthenticated

## Success Criteria

1. Firmware downloads from GitHub successfully
2. Devices auto-detected (≥1 required to proceed)
3. Role assigned via dropdown (PRIMARY/SECONDARY)
4. Installation completes with real-time progress
5. Success screen shows summary, blue checkmark with glow
6. `config.py` written with correct role

## Notes for Claude

- **Read DESIGN_GUIDE.md** for complete design system details
- **Read SETUP.md** for troubleshooting, prerequisites, build instructions
- **Never** use green for success states - always blue (#35B6F2)
- **Always** implement loading states during async operations
- **Always** show error messages in toast or card with destructive variant
- Repository pattern is non-negotiable - services must implement interfaces
- Device detection is OS-specific (macOS: `/Volumes/CIRCUITPY`, Windows: drive letters)
