# Setup Guide

## Quick Start

Follow these steps to get the BlueBuzzah Updater running on your machine.

### 1. Prerequisites

Install the following software:

#### macOS

```bash
# Install Xcode Command Line Tools (if not already installed)
xcode-select --install

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Node.js (v18+)
# Download from https://nodejs.org/ or use Homebrew:
brew install node
```

#### Windows

1. Install [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   - Select "Desktop development with C++" workload
2. Install [Rust](https://www.rust-lang.org/tools/install)
3. Install [Node.js](https://nodejs.org/) (v18 or higher)
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

```bash
npm run tauri:build
```

Build outputs:

- **macOS**: `src-tauri/target/release/bundle/dmg/`
- **Windows**: `src-tauri/target/release/bundle/msi/`

## Development Workflow

### Project Structure

```
BlueBuzzah-Updater/
├── src/                    # React frontend
│   ├── components/
│   │   ├── ui/             # shadcn/ui components
│   │   ├── wizard/         # Wizard step components
│   │   └── layout/         # Layout components
│   ├── services/           # Business logic
│   │   ├── FirmwareService.ts
│   │   └── DeviceService.ts
│   ├── stores/             # Zustand state management
│   ├── types/              # TypeScript definitions
│   └── lib/                # Utilities
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── commands/       # Tauri commands
│   │   └── main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
└── docs/                   # Documentation
```

### Making Changes

1. **Frontend Changes**: Edit files in `src/` - Vite will hot-reload automatically
2. **Backend Changes**: Edit Rust files in `src-tauri/src/` - Tauri will recompile automatically
3. **Styling**: Modify Tailwind classes or `src/index.css`
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
- DMG Installer: `src-tauri/target/release/bundle/dmg/BlueBuzzah Updater_1.0.0_x64.dmg`

#### Windows

```bash
npm run tauri:build
```

**Output:**
- MSI Installer: `src-tauri/target/release/bundle/msi/BlueBuzzah Updater_1.0.0_x64_en-US.msi`

### Code Style Guidelines

- **TypeScript**: Use strict mode, avoid `any` types
- **React**: Functional components with hooks
- **State Management**: Zustand for global state
- **Styling**: Tailwind utility classes, avoid inline styles
- **Rust**: Follow Rust conventions, use `cargo fmt`

## Troubleshooting

### No Devices Detected

**Symptoms:** Application shows "No CircuitPython Devices Found"

**Solutions:**
1. Ensure device is connected via USB
2. Verify device is mounted as `CIRCUITPY` (check in Finder/Explorer)
3. Check that `boot_out.txt` exists on the device root
4. Try a different USB port or cable
5. Restart the device (unplug and replug)
6. On Windows, check Device Manager for COM ports
7. On macOS, run `ls /Volumes` to see mounted drives

### macOS Permission Issues

**Symptoms:** "Permission denied" errors when accessing devices

**Solutions:**
1. Go to **System Settings → Privacy & Security**
2. Grant **Full Disk Access** to:
   - Terminal (if running from terminal)
   - Your IDE (VS Code, etc.)
   - The BlueBuzzah Updater app itself
3. Restart the application
4. If issues persist, try: `sudo npm run tauri:dev`

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
rm tsconfig.tsbuildinfo
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
Edit `vite.config.ts`:
```typescript
server: {
  port: 5174, // Change to any available port
}
```

### Slow First Build

**Normal behavior:** First Rust compilation takes 5-10 minutes
- Rust is downloading and compiling all dependencies
- Subsequent builds are much faster (~10 seconds)
- This is expected behavior

### GitHub API Rate Limiting

**Symptoms:** "Failed to fetch releases" or 403 errors

**Solutions:**
1. Wait 1 hour (GitHub limits unauthenticated requests to 60/hour)
2. Set up GitHub token for higher limits (5000/hour)
3. Check your IP isn't making excessive requests

### Testing Device Detection

To test without physical devices:

**macOS:**
```bash
mkdir -p /Volumes/CIRCUITPY
echo "Adafruit CircuitPython 8.0.0" > /Volumes/CIRCUITPY/boot_out.txt
```

**Windows:**
```powershell
# Create a folder and map it as a drive
subst X: C:\MockCircuitPy
echo "Adafruit CircuitPython 8.0.0" > X:\boot_out.txt
```

### Getting Help

If you encounter issues not covered here:

1. Check existing [GitHub Issues](../../issues)
2. Enable debug logging: Set `RUST_LOG=debug` before running
3. Open a new issue with:
   - Operating system and version
   - Node.js version (`node --version`)
   - Rust version (`rustc --version`)
   - Complete error message
   - Steps to reproduce

## Resources

- [Tauri Documentation](https://tauri.app/)
- [React Documentation](https://react.dev/)
- [shadcn/ui Components](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Zustand State Management](https://zustand-demo.pmnd.rs/)
