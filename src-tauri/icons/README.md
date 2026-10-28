# Application Icons

This directory should contain the application icons in various formats for different platforms.

## Required Icon Files

The following icon files are required for Tauri to build properly:

- `32x32.png` - 32x32 pixels, PNG format
- `128x128.png` - 128x128 pixels, PNG format
- `128x128@2x.png` - 256x256 pixels, PNG format (Retina)
- `icon.icns` - macOS icon bundle
- `icon.ico` - Windows icon file

## Generating Icons

You can use the Tauri icon generator to create all necessary icon formats from a single high-resolution PNG image (at least 1024x1024 pixels):

```bash
npm install --save-dev @tauri-apps/cli
npx tauri icon path/to/your-icon.png
```

This will automatically generate all required icon formats in the correct sizes.

## Creating Icons Manually

If you prefer to create icons manually:

### For PNG files
Use any image editor (Photoshop, GIMP, Figma, etc.) to export your icon design in the required sizes.

### For macOS (.icns)
Use the `iconutil` command on macOS:
```bash
mkdir icon.iconset
# Create various sizes in the iconset directory
iconutil -c icns icon.iconset
```

### For Windows (.ico)
Use online tools or software like:
- IcoFX
- GIMP (with ICO plugin)
- Online converters

## Icon Art

Never draw new icon art. Take it from the BlueBuzzah design system in the [BlueBuzzah-Workspace](https://github.com/BlueBuzzah/BlueBuzzah-Workspace) repo (`.claude/skills/bluebuzzah-design-system/assets/`). The `Web` and `Logos` groups hold the mark and squircle app-icon masters, and each group's README says which file to use where.

Regenerate every size from the design system's squircle master (from this repo's root), then delete the unused `ios/` and `android/` folders the command also writes:

```bash
npx tauri icon ../../.claude/skills/bluebuzzah-design-system/assets/Web/icon-1024.png --output src-tauri/icons
rm -rf src-tauri/icons/ios src-tauri/icons/android
```
