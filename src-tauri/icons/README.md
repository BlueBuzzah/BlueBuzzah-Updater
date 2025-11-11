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

## Design Guidelines

- Use a square aspect ratio (1:1)
- Keep the design simple and recognizable at small sizes
- Use a transparent background for PNG files
- Test the icon at different sizes to ensure clarity
- Follow platform-specific icon design guidelines (macOS HIG, Windows UX guidelines)

## BlueBuzzah Branding

For the BlueBuzzah Updater, consider using:
- BlueBuzzah brand colors
- A recognizable symbol related to firmware updates or devices
- Simple, bold shapes that scale well
