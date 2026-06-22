#!/bin/bash
# ─── Build Janjak.app — a double-clickable macOS bundle ─────────────
# Produces dist-app/Janjak.app. Double-clicking it starts the always-on
# daemon and opens the dashboard — no terminal required. The bundle ships
# the compiled app + production dependencies and a vendored Node.js runtime
# (falling back to a system Node.js, prompting the user to install it if
# neither is available).
#
# Usage: bash scripts/build-app.sh   (or: npm run app)
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$PROJECT_DIR/dist-app"
APP="$OUT_DIR/Janjak.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RES="$CONTENTS/Resources"
APP_RES="$RES/app"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; DIM='\033[2m'; RESET='\033[0m'
echo ""
echo -e "${CYAN}🧠 Building Janjak.app${RESET}"
echo -e "${DIM}   ─────────────────────${RESET}"

# ── 1. Compile TypeScript ──
echo -e "  → Compiling TypeScript..."
( cd "$PROJECT_DIR" && npm run build >/dev/null )

# ── 2. Reset bundle ──
rm -rf "$APP"
mkdir -p "$MACOS" "$APP_RES"

# ── 3. Copy app code ──
echo -e "  → Copying app code..."
cp -R "$PROJECT_DIR/dist" "$APP_RES/dist"
cp -R "$PROJECT_DIR/web" "$APP_RES/web"
cp "$PROJECT_DIR/package.json" "$APP_RES/package.json"

# ── 4. Bundle production dependencies (skip dev-only tooling) ──
echo -e "  → Bundling dependencies ${DIM}(may take a minute)${RESET}..."
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  ( cd "$PROJECT_DIR" && npm install >/dev/null )
fi
rsync -a \
  --exclude 'typescript/' \
  --exclude 'tsx/' \
  --exclude '@types/' \
  --exclude 'esbuild/' \
  --exclude '@esbuild/' \
  --exclude 'node-gyp/' \
  --exclude '.cache/' \
  --exclude '.package-lock.json' \
  "$PROJECT_DIR/node_modules/" "$APP_RES/node_modules/"

# ── 4b. Vendor the Node.js runtime (zero-dependency launch) ──
# Bundles the official self-contained Node binary matching THIS build host's
# Node version + arch. The native module (better-sqlite3) is compiled for this
# exact ABI, so the vendored Node major MUST match the Node used to install
# dependencies. This makes the resulting app architecture-specific (arm64 or
# x64). If the download fails, the app falls back to a system Node.js.
echo -e "  → Vendoring Node.js runtime..."
NODE_VER="$(node -v)"                          # e.g. v26.0.0
case "$(uname -m)" in
  arm64)  NODE_ARCH="arm64" ;;
  x86_64) NODE_ARCH="x64" ;;
  *)      NODE_ARCH="" ;;
esac
if [ -n "$NODE_ARCH" ]; then
  CACHE_DIR="$PROJECT_DIR/.cache/node-vendor"
  TARBALL="node-${NODE_VER}-darwin-${NODE_ARCH}.tar.gz"
  mkdir -p "$CACHE_DIR"
  if [ ! -f "$CACHE_DIR/$TARBALL" ]; then
    URL="https://nodejs.org/dist/${NODE_VER}/${TARBALL}"
    echo -e "    ${DIM}downloading ${URL}${RESET}"
    curl -fsSL "$URL" -o "$CACHE_DIR/$TARBALL" \
      || { echo -e "    ${DIM}download failed — app will fall back to system Node${RESET}"; rm -f "$CACHE_DIR/$TARBALL"; }
  fi
  if [ -f "$CACHE_DIR/$TARBALL" ]; then
    EXTRACT="$CACHE_DIR/node-${NODE_VER}-darwin-${NODE_ARCH}"
    [ -d "$EXTRACT" ] || tar -xzf "$CACHE_DIR/$TARBALL" -C "$CACHE_DIR"
    mkdir -p "$APP_RES/runtime/bin"
    cp "$EXTRACT/bin/node" "$APP_RES/runtime/bin/node"
    chmod +x "$APP_RES/runtime/bin/node"
  fi
else
  echo -e "    ${DIM}unknown arch — skipping (app will use system Node)${RESET}"
fi

# ── 5. App icon ──
if [ ! -f "$PROJECT_DIR/assets/AppIcon.icns" ] && [ -d "$PROJECT_DIR/assets/AppIcon.iconset" ]; then
  iconutil -c icns "$PROJECT_DIR/assets/AppIcon.iconset" -o "$PROJECT_DIR/assets/AppIcon.icns" || true
fi
[ -f "$PROJECT_DIR/assets/AppIcon.icns" ] && cp "$PROJECT_DIR/assets/AppIcon.icns" "$RES/AppIcon.icns"

# ── 6. Launcher executable ──
echo -e "  → Writing launcher..."
cat > "$MACOS/Janjak" <<'LAUNCHER'
#!/bin/bash
# Janjak.app launcher — start the background daemon, then open the UI.
APP_RES="$(cd "$(dirname "$0")/../Resources/app" && pwd)"
DATA_DIR="$HOME/.janjak"
LOG="$DATA_DIR/janjak-app.log"
mkdir -p "$DATA_DIR"

# Locate a usable Node.js (vendored runtime, Homebrew, system, or login PATH).
find_node() {
  local c
  # Prefer the Node runtime vendored inside the app (zero-dependency).
  c="$APP_RES/runtime/bin/node"
  [ -x "$c" ] && { echo "$c"; return 0; }
  for c in /opt/homebrew/bin/node /usr/local/bin/node; do
    [ -x "$c" ] && { echo "$c"; return 0; }
  done
  c="$(/bin/zsh -lc 'command -v node' 2>/dev/null)"
  [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return 0; }
  return 1
}

NODE="$(find_node)" || NODE=""
if [ -z "$NODE" ]; then
  CHOICE="$(osascript \
    -e 'display dialog "Janjak needs Node.js 18 or newer to run.\n\nClick Install to open the download page." with title "Janjak" buttons {"Cancel","Install"} default button "Install"' \
    -e 'button returned of result' 2>/dev/null)"
  [ "$CHOICE" = "Install" ] && open "https://nodejs.org/en/download/"
  exit 1
fi

CLI="$APP_RES/dist/index.js"

# Start the always-on daemon (idempotent: exits fast if already running).
"$NODE" "$CLI" daemon start >>"$LOG" 2>&1 || true

# First run (no OpenAI key yet) → open the setup wizard; otherwise the dashboard.
if [ ! -s "$DATA_DIR/.env" ] || ! grep -Eq '^[[:space:]]*OPENAI_API_KEY=.+' "$DATA_DIR/.env" 2>/dev/null; then
  "$NODE" "$CLI" setup >>"$LOG" 2>&1 &
else
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    curl -s "http://localhost:7777/api/health" >/dev/null 2>&1 && break
    sleep 0.3
  done
  open "http://localhost:7777"
fi
LAUNCHER
chmod +x "$MACOS/Janjak"

# ── 7. Info.plist ──
VERSION="$(node -p "require('$PROJECT_DIR/package.json').version" 2>/dev/null || echo 1.0.0)"
cat > "$CONTENTS/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>Janjak</string>
  <key>CFBundleIdentifier</key>
  <string>com.janjak.app</string>
  <key>CFBundleName</key>
  <string>Janjak</string>
  <key>CFBundleDisplayName</key>
  <string>Janjak</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>
EOF

# ── 8. Ad-hoc code sign (unblocks local launch; not notarized) ──
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

echo -e "  ${GREEN}✓${RESET} Built ${CYAN}${APP}${RESET}"
echo ""
echo -e "  Try it:  ${CYAN}open \"$APP\"${RESET}"
echo -e "  Package: ${CYAN}npm run dmg${RESET} ${DIM}(creates a distributable .dmg)${RESET}"
echo ""
