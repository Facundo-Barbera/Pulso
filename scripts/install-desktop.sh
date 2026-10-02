#!/usr/bin/env bash
# Installs the desktop window as ~/Applications/Pulso.app, on the Mac's internal
# disk. Run from node_modules on the Taller volume, Electron lost its own binary
# and frameworks whenever the disk dropped and spun the CPU retrying; installed,
# it outlives the disk and just waits for the engine (main.js shows "Esperando a
# Pulso…" and reconnects). Re-run after changing apps/desktop/main.js.
#
#   scripts/install-desktop.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON_APP="$(cd "$ROOT/apps/desktop" && node -p 'require("path").resolve(require("electron"), "../../..")')"
DEST="$HOME/Applications/Pulso.app"
ICON_PNG="$ROOT/apps/ios/Pulso/Assets.xcassets/AppIcon.appiconset/AppIcon.png"

[[ -d "$ELECTRON_APP" && "$ELECTRON_APP" == *.app ]] || { echo "Electron.app not found (run bun install)" >&2; exit 1; }

osascript -e 'quit app "Pulso"' 2>/dev/null || true
mkdir -p "$HOME/Applications"
rm -rf "$DEST"
ditto "$ELECTRON_APP" "$DEST"
mv "$DEST/Contents/MacOS/Electron" "$DEST/Contents/MacOS/Pulso"

APP="$DEST/Contents/Resources/app"
mkdir -p "$APP"
cp "$ROOT/apps/desktop/main.js" "$APP/main.js"
printf '{ "name": "pulso-desktop", "productName": "Pulso", "main": "main.js" }\n' > "$APP/package.json"
rm -f "$DEST/Contents/Resources/default_app.asar"

PLIST="$DEST/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable Pulso" \
  -c "Set :CFBundleName Pulso" \
  -c "Set :CFBundleIdentifier com.bixku.pulso.desktop" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Pulso" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string Pulso" "$PLIST"

# The iOS icon as an .icns.
if [[ -f "$ICON_PNG" ]]; then
  SET="$(mktemp -d)/Pulso.iconset"
  mkdir -p "$SET"
  for size in 16 32 128 256 512; do
    sips -z $size $size "$ICON_PNG" --out "$SET/icon_${size}x${size}.png" >/dev/null
    sips -z $((size * 2)) $((size * 2)) "$ICON_PNG" --out "$SET/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$SET" -o "$DEST/Contents/Resources/electron.icns"
fi

# Edited bundle: re-sign ad hoc so macOS runs it.
codesign --force --deep --sign - "$DEST" >/dev/null 2>&1
touch "$DEST"
echo "installed $DEST"
