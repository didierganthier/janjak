#!/bin/bash
# ─── Build Janjak.dmg — a distributable disk image ──────────────────
# Wraps dist-app/Janjak.app into a drag-to-Applications .dmg. Builds the
# app first if needed.
#
# Usage: bash scripts/build-dmg.sh   (or: npm run dmg)
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$PROJECT_DIR/dist-app"
APP="$OUT_DIR/Janjak.app"
VERSION="$(node -p "require('$PROJECT_DIR/package.json').version" 2>/dev/null || echo 1.0.0)"
DMG="$OUT_DIR/Janjak-${VERSION}.dmg"
STAGE="$OUT_DIR/dmg-stage"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; DIM='\033[2m'; RESET='\033[0m'
echo ""
echo -e "${CYAN}📦 Building Janjak.dmg${RESET}"
echo -e "${DIM}   ─────────────────────${RESET}"

# ── 1. Ensure the app exists ──
if [ ! -d "$APP" ]; then
  echo -e "  → Janjak.app not found; building it first..."
  bash "$PROJECT_DIR/scripts/build-app.sh"
fi

# ── 2. Stage contents (app + Applications symlink) ──
echo -e "  → Staging disk image contents..."
rm -rf "$STAGE" "$DMG"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/Janjak.app"
ln -s /Applications "$STAGE/Applications"

# ── 3. Create the compressed image ──
echo -e "  → Creating compressed image..."
hdiutil create \
  -volname "Janjak" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDZO \
  "$DMG" >/dev/null

rm -rf "$STAGE"

echo -e "  ${GREEN}✓${RESET} Built ${CYAN}${DMG}${RESET}"
echo ""
echo -e "  ${DIM}Share this file. Users drag Janjak into Applications, then${RESET}"
echo -e "  ${DIM}right-click → Open the first time (it is ad-hoc signed, not notarized).${RESET}"
echo ""
