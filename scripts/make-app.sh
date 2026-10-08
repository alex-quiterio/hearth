#!/bin/sh
# Build Hearth.app (the launcher in Hearth.applescript) with the flame icon. Usage: scripts/make-app.sh [dest dir]
set -e
here="$(cd "$(dirname "$0")/.." && pwd)"
dest="${1:-$HOME/Desktop}"
app="$dest/Hearth.app"
tmp="$(mktemp -d)"

osacompile -o "$app" "$here/scripts/Hearth.applescript"

# Icon: assets/hearth-icon.png if present, else the favicon rendered at 1024px.
src="$here/assets/hearth-icon.png"
if [ ! -f "$src" ]; then
  qlmanage -t -s 1024 -o "$tmp" "$here/public/favicon.svg" >/dev/null 2>&1
  src="$tmp/favicon.svg.png"
fi
mkdir "$tmp/icon.iconset"
for s in 16 32 128 256 512; do
  sips -s format png -z $s $s "$src" --out "$tmp/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -s format png -z $((s*2)) $((s*2)) "$src" --out "$tmp/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$tmp/icon.iconset" -o "$app/Contents/Resources/applet.icns"
rm -rf "$tmp"
# The icon changed the bundle after osacompile signed it: re-sign, then make Finder notice.
codesign --force --deep -s - "$app"
touch "$app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app"
killall Finder 2>/dev/null || true
echo "built $app"
