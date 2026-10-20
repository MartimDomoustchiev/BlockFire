#!/bin/bash
# ============================================================
# Builds BLOCKFIRE.app - the game as a native macOS app - next to
# index.html. Needs Xcode (or the Command Line Tools) for swiftc.
#
#   ./mac/build.sh          then double-click BLOCKFIRE.app
#
# The app is a universal binary (Apple Silicon + Intel), signed
# ad hoc. Copied to another Mac, it opens with right-click > Open
# the first time (it isn't notarized by Apple).
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
VERSION="1.0"
# assemble and sign outside the project folder: iCloud Drive (Documents) tags files with attributes that
# code signing refuses, so the finished app is copied in at the end
WORK="$(mktemp -d)"
APP="$WORK/BLOCKFIRE.app"
GAME="$APP/Contents/Resources/game"
mkdir -p "$APP/Contents/MacOS" "$GAME"

# the game itself (everything the page loads; no tests or docs), without extended attributes
for f in index.html three.min.js manifest.webmanifest sw.js; do [ -e "$f" ] && ditto --norsrc --noextattr --noqtn "$f" "$GAME/$f"; done
for d in js vendor icons; do [ -d "$d" ] && ditto --norsrc --noextattr --noqtn "$d" "$GAME/$d"; done
[ -e mac/AppIcon.icns ] && ditto --norsrc --noextattr --noqtn mac/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>BLOCKFIRE</string>
  <key>CFBundleDisplayName</key><string>BLOCKFIRE</string>
  <key>CFBundleIdentifier</key><string>local.blockfire.game</string>
  <key>CFBundleExecutable</key><string>BLOCKFIRE</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>12.3</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.action-games</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
  <key>NSHumanReadableCopyright</key><string>BLOCKFIRE - an original voxel game</string>
</dict>
</plist>
PLIST

# compile for both CPU kinds and glue them together
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos12.3" -o "$WORK/BLOCKFIRE-$arch" mac/BlockfireApp.swift -framework Cocoa -framework WebKit
done
lipo -create -output "$APP/Contents/MacOS/BLOCKFIRE" "$WORK/BLOCKFIRE-arm64" "$WORK/BLOCKFIRE-x86_64"

xattr -cr "$APP"
codesign --force --deep --sign - --identifier local.blockfire.game "$APP"
codesign --verify --deep --strict "$APP"

rm -rf "$ROOT/BLOCKFIRE.app"
ditto "$APP" "$ROOT/BLOCKFIRE.app"
rm -rf "$WORK"
echo "Built $ROOT/BLOCKFIRE.app"
