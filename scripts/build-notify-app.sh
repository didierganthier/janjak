#!/bin/bash
set -e

APP="$HOME/.janjak/JanjakNotify.app"
PROJECT="/Users/didierganthier/Desktop/janjak"

# Remove old app
rm -rf "$APP"

# Create directory structure
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# Compile Swift
swiftc -o "$APP/Contents/MacOS/JanjakNotify" \
  "$PROJECT/scripts/JanjakNotifyIcon.swift" \
  -framework Cocoa \
  -framework UserNotifications

# Copy icon
cp "$PROJECT/assets/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"

# Write Info.plist
cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>JanjakNotify</string>
  <key>CFBundleIdentifier</key>
  <string>com.janjak.notify</string>
  <key>CFBundleName</key>
  <string>Janjak</string>
  <key>CFBundleDisplayName</key>
  <string>Janjak</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>2.0</string>
  <key>CFBundleShortVersionString</key>
  <string>2.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSUserNotificationAlertStyle</key>
  <string>banner</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
</dict>
</plist>
EOF

# Code sign
codesign --sign - --force "$APP"

# Register with Launch Services
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister "$APP"

echo "✅ JanjakNotify.app built with icon at $APP"
ls -la "$APP/Contents/MacOS/" "$APP/Contents/Resources/"
