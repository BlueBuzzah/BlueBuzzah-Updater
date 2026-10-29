# Setup Guide

## Quick Start

Follow these steps to get the BlueBuzzah Updater running on your machine.

### 1. Prerequisites

Install the following software:

#### macOS

```bash
# Install Xcode Command Line Tools (if not already installed)
xcode-select --install

# Install Rust (1.88 or newer)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Node.js (v20+)
# Download from https://nodejs.org/ or use Homebrew:
brew install node
```

#### Windows

1. Install [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   - Select "Desktop development with C++" workload
2. Install [Rust](https://www.rust-lang.org/tools/install) (1.88 or newer)
3. Install [Node.js](https://nodejs.org/) (v20 or higher)
4. WebView2 should be pre-installed on Windows 10/11

### 2. Install Dependencies

```bash
cd BlueBuzzah-Updater
npm install
```

### 3. Run Development Server

```bash
npm run tauri:dev
```

This will:

1. Start the Vite development server
2. Compile the Rust backend
3. Launch the Tauri application window

The first run may take a few minutes as Rust compiles dependencies.

### 4. Build for Distribution

`npm run tauri:build` signs the app-update artifacts, so it needs the updater signing keys. Copy `.env.example` to `.env` and fill in the values (it explains how to generate keys). `npm run tauri:build:ci` runs the same build without loading `.env`, for CI, where the keys come from the environment.

```bash
npm run tauri:build
```

Build outputs:

- **macOS**: `src-tauri/target/release/bundle/dmg/`
- **Windows**: `src-tauri/target/release/bundle/nsis/`

## Development Workflow

### Project Structure

```
BlueBuzzah-Updater/
├── src/                    # React frontend
│   ├── components/
│   │   ├── ui/             # Design-system (bb-) components
│   │   ├── shell/          # Sidebar, page shell, action bar
│   │   ├── firmware/       # Firmware page
│   │   ├── configure/      # Configure page
│   │   ├── settings/       # Settings page
│   │   ├── wizard/         # Firmware page cards and progress
│   │   ├── therapy/        # Configure page cards and progress
│   │   └── updater/        # App update dialog
│   ├── hooks/              # React hooks
│   ├── services/           # Business logic
│   │   ├── FirmwareService.ts
│   │   ├── DeviceService.ts
│   │   ├── TherapyService.ts
│   │   └── UpdaterService.ts
│   ├── stores/             # Zustand state management
│   ├── types/              # TypeScript definitions
│   └── lib/                # Utilities
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── commands/       # Tauri commands
│   │   ├── dfu/            # Nordic DFU flashing and serial config (v2)
│   │   ├── esp/            # espflash flashing (v3)
│   │   ├── cache.rs        # Firmware cache
│   │   ├── settings.rs     # Saved settings
│   │   ├── lib.rs
│   │   └── main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
└── docs/                   # Documentation
```

### Making Changes

1. **Frontend Changes**: Edit files in `src/` - Vite will hot-reload automatically
2. **Backend Changes**: Edit Rust files in `src-tauri/src/` - Tauri will recompile automatically
3. **Styling**: Follow the BlueBuzzah design system; Tailwind classes are for layout, and type and color come from `src/styles/tokens.css`
4. **Configuration**: Update `src-tauri/tauri.conf.json` for app settings

### Common Development Commands

```bash
# Frontend only (without Tauri)
npm run dev

# Full development mode (Tauri + React)
npm run tauri:dev

# Build frontend
npm run build

# Build production application
npm run tauri:build

# Clean build artifacts
cd src-tauri && cargo clean && cd ..
rm -rf dist node_modules
npm install
```

### Building for Distribution

#### macOS

```bash
npm run tauri:build
```

**Output:**
- Application: `src-tauri/target/release/bundle/macos/BlueBuzzah Updater.app`
- DMG Installer: `src-tauri/target/release/bundle/dmg/BlueBuzzah Updater_<version>_<arch>.dmg`

#### Windows

```bash
npm run tauri:build
```

**Output:**
- NSIS Installer: `src-tauri/target/release/bundle/nsis/BlueBuzzah Updater_<version>_x64-setup.exe`

### Code Style Guidelines

- **TypeScript**: Use strict mode, avoid `any` types
- **React**: Functional components with hooks
- **State Management**: Zustand for global state
- **Styling**: Design-system tokens and `bb-` components; Tailwind for layout only; avoid inline styles
- **Rust**: Follow Rust conventions, use `cargo fmt`

## Troubleshooting

### No Devices Detected

**Symptoms:** Application shows "No devices found"

**Solutions:**
1. Ensure device is connected via USB with a data cable (some cables only charge)
2. Check that the device is turned on
3. Try a different USB port or cable
4. Restart the device (unplug and replug), then select **Rescan**
5. On Windows, check Device Manager for COM ports
6. On macOS, run `ls /dev/cu.usbmodem*` to see serial ports
7. The app only lists Adafruit Feather nRF52840 serial devices (VID `0x239A`) and ESP32-S3 USB-JTAG/Serial devices (VID `0x303A`, PID `0x1001`)

### Serial Port Permission Issues

**Symptoms:** "Permission denied" errors when accessing devices

**Solutions:**
1. Close any other app that uses the device, such as a serial monitor (PlatformIO, Arduino IDE)
2. Unplug the device, then plug it back in
3. Restart the application

### Windows WebView2 Issues

**Symptoms:** App doesn't launch or shows blank window on Windows

**Solutions:**
1. Download [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
2. Install the Evergreen Standalone Installer
3. Restart your computer
4. Try running the app again
5. Check if WebView2 is installed: `reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"`

### Build Errors

**Symptoms:** Rust compilation fails or TypeScript errors

**Solutions:**

**For Rust errors:**
```bash
cd src-tauri
cargo clean
cd ..
npm run tauri:build
```

**For TypeScript errors:**
```bash
rm -rf node_modules/.cache
npm install
npm run build
```

**For dependency issues:**
```bash
rm -rf node_modules package-lock.json
npm install
```

### Port Already in Use

**Symptoms:** "Port 5173 already in use" error

**Solution:**
Stop whatever is using port 5173, or change the port in both places (Vite uses `strictPort`, so it won't pick another port on its own):

`vite.config.ts`:
```typescript
server: {
  port: 5174, // Change to any available port
}
```

`src-tauri/tauri.conf.json`:
```json
"devUrl": "http://localhost:5174"
```

### Slow First Build

**Normal behavior:** First Rust compilation takes 5-10 minutes
- Rust is downloading and compiling all dependencies
- Subsequent builds are much faster (~10 seconds)
- This is expected behavior

### GitHub API Rate Limiting

**Symptoms:** "Failed to fetch releases" or 403 errors

**Solutions:**
1. Wait for the limit to reset (GitHub limits unauthenticated requests to 60/hour; the error says how many minutes are left)
2. Check your IP isn't making excessive requests

### Getting Help

If you encounter issues not covered here:

1. Check existing [GitHub Issues](../../issues)
2. Copy the app's log (**Show Log** → **Copy Log** or **Save Log**); when running `npm run tauri:dev`, the terminal also shows backend output
3. Open a new issue with:
   - Operating system and version
   - Node.js version (`node --version`)
   - Rust version (`rustc --version`)
   - Complete error message
   - Steps to reproduce

## Resources

- [Tauri Documentation](https://tauri.app/)
- [React Documentation](https://react.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Zustand State Management](https://zustand-demo.pmnd.rs/)
