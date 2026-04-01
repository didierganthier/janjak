#!/bin/bash
set -e

APP="$HOME/.janjak/JanjakMenuBar.app"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "🧠 Building Janjak Menu Bar App..."

# Remove old app
rm -rf "$APP"

# Create directory structure
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# Compile Swift
swiftc -o "$APP/Contents/MacOS/JanjakMenuBar" \
  "$PROJECT_DIR/scripts/JanjakMenuBar.swift" \
  -framework Cocoa \
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
  <string>JanjakMenuBar</string>
  <key>CFBundleIdentifier</key>
  <string>com.janjak.menubar</string>
  <key>CFBundleName</key>
  <string>Janjak</string>
  <key>CFBundleDisplayName</key>
  <string>Janjak</string>
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
</dict>
</plist>
EOF

# Code sign
codesign --force --sign - "$APP"

echo "✅ Built: $APP"
echo ""
echo "To launch: open $APP"
echo "Or run:    janjak menubar"
