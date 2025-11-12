# BlueBuzzah Updater

![BlueBuzzah Updater](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)

Device firmware updater for BlueBuzzah devices.

## 🚀 Quick Start

### For Users

Download the appropriate package for your operating system and install:

[![Download for Windows][1]][2] [![Download for macOS][3]][4]

> [!NOTE]  
> Current releases are not code-signed. You may see security warnings on first run:
>
> - **macOS**: Right-click the app → "Open" (first time only)
> - **Windows**: Click "More info" → "Run anyway"
>
> Code signing may be added in future releases.

### For Developers

```bash
# Clone and install
git clone <repository-url>
cd BlueBuzzah-Updater
npm install

# Run development server
npm run tauri:dev

# Build for production
npm run tauri:build
```

> [!NOTE]  
> **Need detailed setup instructions?** See [SETUP.md](SETUP.md) for complete installation guide, prerequisites, and troubleshooting.

## ✨ Features

- **Modern UI**: Beautiful dark-themed interface with BlueBuzzah brand colors (#35B6F2, #05212D)
- **4-Step Wizard**: Intuitive workflow from firmware selection to successful installation
- **GitHub Integration**: Automatically fetches latest firmware releases
- **Auto-Detection**: Automatically detects connected CircuitPython devices
- **Dual-Device Support**: Update up to 2 devices simultaneously with PRIMARY/SECONDARY roles
- **Real-time Progress**: Live progress tracking with detailed logging
- **Cross-Platform**: Native support for macOS and Windows

## 🏗️ Architecture

**Frontend:** React 18 + TypeScript + Zustand + shadcn/ui + Tailwind CSS
**Backend:** Tauri 2.0 + Rust for native device detection and file operations

### Project Structure

```
src/
├── components/     # React components (UI, wizard steps, layout)
├── services/       # Business logic (firmware, device operations)
├── stores/         # Zustand state management
├── types/          # TypeScript type definitions
└── lib/            # Utilities and config templates

src-tauri/
└── src/commands/   # Rust commands (device.rs, firmware.rs)
```

### Wizard Flow

1. **Firmware Selection** → Browse GitHub releases and select version
2. **Device Selection** → Auto-detect devices and assign roles (PRIMARY/SECONDARY)
3. **Installation** → Real-time progress with file-by-file tracking
4. **Complete** → Success screen with post-installation instructions

## 🎨 UI/UX

The application features a modern dark theme with BlueBuzzah brand colors:

- **Primary Blue** (#35B6F2) - Highlights, buttons, progress indicators
- **Dark Navy** (#05212D) - Cards, secondary surfaces
- **Smooth animations** and **glow effects** for a polished user experience

For complete design system documentation, see [DESIGN_GUIDE.md](DESIGN_GUIDE.md).

## 📦 Technology Stack

| Category             | Technologies                         |
| -------------------- | ------------------------------------ |
| **Frontend**         | React 18, TypeScript, Vite           |
| **UI Components**    | shadcn/ui (dark theme), Tailwind CSS |
| **State Management** | Zustand                              |
| **Icons**            | Lucide React                         |
| **Backend**          | Tauri 2.0, Rust                      |
| **Device Detection** | Native Rust implementations          |
| **HTTP Client**      | reqwest, native fetch                |

## 📚 Documentation

- **[SETUP.md](SETUP.md)** - Complete setup guide, prerequisites, and troubleshooting
- **[DESIGN_GUIDE.md](DESIGN_GUIDE.md)** - Complete design system, UI/UX patterns, and component guidelines

## 🔧 Development

### Key Commands

```bash
npm run tauri:dev      # Development mode with hot reload
npm run tauri:build    # Production build (DMG for macOS, MSI for Windows)
npm run dev            # Frontend only (no Tauri)
```

### Device Configuration

The updater automatically generates role-specific `config.py` files:

- **PRIMARY**: Coordinator device, broadcasts to secondary
- **SECONDARY**: Listener device, receives from primary

## 🐛 Troubleshooting

For common issues and solutions, see [SETUP.md](SETUP.md#troubleshooting).

Quick fixes:

- **No devices detected?** Ensure device is mounted as `CIRCUITPY` with `boot_out.txt`
- **Build errors?** Run `cd src-tauri && cargo clean && cd .. && npm run tauri:build`
- **Permission issues (macOS)?** Grant Full Disk Access in System Settings

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Follow existing code style and architecture
4. Submit a pull request with clear description

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

Copyright (c) 2025 BlueBuzzah Partners

## 💬 Support

- **Issues**: [GitHub Issue Tracker](../../issues)
- **Documentation**: See docs above
- **Questions**: Open a discussion or issue

[1]: assets/download-windows.png
[2]: https://github.com/BlueBuzzah/BlueBuzzah-Updater/releases/latest/download/BlueBuzzah-Updater-x64.msi "Download for Windows"
[3]: assets/download-macos.png
[4]: https://github.com/BlueBuzzah/BlueBuzzah-Updater/releases/latest/download/BlueBuzzah-Updater-universal.dmg "Download for macOS"
