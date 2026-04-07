#!/bin/bash
set -e

APP="$HOME/.janjak/JanjakOverlay.app"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "🧠 Building Janjak Overlay App..."

# Remove old app
rm -rf "$APP"

# Create directory structure
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# Compile Swift
swiftc -o "$APP/Contents/MacOS/JanjakOverlay" \
  "$PROJECT_DIR/scripts/JanjakOverlay.swift" \
  -framework Cocoa \
  -framework Carbon \
  -framework AVFoundation \
  -O

# Copy icon if available
if [ -f "$PROJECT_DIR/assets/AppIcon.icns" ]; then
  cp "$PROJECT_DIR/assets/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
fi

# Write Info.plist
cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>JanjakOverlay</string>
  <key>CFBundleIdentifier</key>
  <string>com.janjak.overlay</string>
  <key>CFBundleName</key>
  <string>Janjak Overlay</string>
  <key>CFBundleDisplayName</key>
  <string>Janjak Overlay</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
  <key>NSMicrophoneUsageDescription</key>
  <string>Janjak needs microphone access to listen to your voice commands.</string>
</dict>
</plist>
EOF

# Code sign
codesign --force --sign - "$APP"

echo "✅ Built: $APP"
echo ""
echo "To launch: open $APP"
echo "Or run:    janjak overlay"
