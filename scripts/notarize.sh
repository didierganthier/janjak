#!/bin/bash
# ─── Notarize Janjak.app and produce a Gatekeeper-approved .dmg ─────
# Ad-hoc signing (what build-app.sh does) is enough to run locally, but
# users still get the "unidentified developer" warning. To ship a .dmg that
# opens with a normal double-click on any Mac, you must sign with an Apple
# "Developer ID Application" certificate (requires a paid Apple Developer
# account, $99/yr) and notarize it with Apple.
#
# This script signs the app with the hardened runtime + the entitlements a
# bundled Node.js runtime needs, packages a .dmg, submits it to Apple's
# notary service, waits for the result, and staples the ticket.
#
# ── Prerequisites ──
#   1. Xcode command line tools:  xcode-select --install
#   2. A "Developer ID Application" certificate in your login keychain.
#   3. Either a stored notarytool keychain profile (recommended) OR an
#      app-specific password (https://appleid.apple.com → App-Specific
#      Passwords).
#
#   Store a reusable notary profile once (recommended):
#     xcrun notarytool store-credentials janjak-notary \
#       --apple-id "you@example.com" \
#       --team-id "ABCDE12345" \
#       --password "abcd-efgh-ijkl-mnop"
#
# ── Usage ──
#   Using a stored profile:
#     DEVELOPER_ID_APP="Developer ID Application: Your Name (ABCDE12345)" \
#     NOTARY_PROFILE="janjak-notary" \
#     bash scripts/notarize.sh
#
#   Or with inline credentials:
#     DEVELOPER_ID_APP="Developer ID Application: Your Name (ABCDE12345)" \
#     APPLE_ID="you@example.com" \
#     APPLE_TEAM_ID="ABCDE12345" \
#     APPLE_APP_PASSWORD="abcd-efgh-ijkl-mnop" \
#     bash scripts/notarize.sh
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$PROJECT_DIR/dist-app"
APP="$OUT_DIR/Janjak.app"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; DIM='\033[2m'; RESET='\033[0m'

# ── Validate inputs ──
if [ -z "$DEVELOPER_ID_APP" ]; then
  echo -e "${YELLOW}✗ Set DEVELOPER_ID_APP to your signing identity.${RESET}"
  echo -e "  List available identities with:"
  echo -e "    ${CYAN}security find-identity -v -p codesigning${RESET}"
  exit 1
fi

if [ -z "$NOTARY_PROFILE" ] && { [ -z "$APPLE_ID" ] || [ -z "$APPLE_TEAM_ID" ] || [ -z "$APPLE_APP_PASSWORD" ]; }; then
  echo -e "${YELLOW}✗ Provide notarization credentials.${RESET}"
  echo -e "  Either set NOTARY_PROFILE (a stored notarytool profile), or set"
  echo -e "  APPLE_ID + APPLE_TEAM_ID + APPLE_APP_PASSWORD."
  exit 1
fi

echo ""
echo -e "${CYAN}🔏 Notarizing Janjak.app${RESET}"
echo -e "${DIM}   ─────────────────────${RESET}"

# ── 1. Build the app fresh (ensures the latest code is bundled) ──
echo -e "  → Building app..."
bash "$PROJECT_DIR/scripts/build-app.sh" >/dev/null

# ── 2. Entitlements the bundled Node.js runtime needs under hardened runtime ──
ENTITLEMENTS="$(mktemp -t janjak-entitlements).plist"
cat > "$ENTITLEMENTS" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
PLIST

# ── 3. Sign every nested Mach-O, then the app, with the hardened runtime ──
echo -e "  → Signing with Developer ID (hardened runtime)..."
# Sign nested binaries (vendored node + native .node modules) first.
while IFS= read -r -d '' bin; do
  codesign --force --timestamp --options runtime \
    --entitlements "$ENTITLEMENTS" \
    --sign "$DEVELOPER_ID_APP" "$bin" >/dev/null
done < <(find "$APP/Contents/Resources/app" \
           \( -name '*.node' -o -path '*/runtime/bin/node' \) -type f -print0)

# Sign the app bundle itself last.
codesign --force --timestamp --options runtime \
  --entitlements "$ENTITLEMENTS" \
  --sign "$DEVELOPER_ID_APP" "$APP" >/dev/null

codesign --verify --deep --strict --verbose=2 "$APP"
rm -f "$ENTITLEMENTS"

# ── 4. Package a .dmg from the signed app ──
echo -e "  → Packaging .dmg..."
bash "$PROJECT_DIR/scripts/build-dmg.sh" >/dev/null
VERSION="$(node -p "require('$PROJECT_DIR/package.json').version" 2>/dev/null || echo 1.0.0)"
DMG="$OUT_DIR/Janjak-${VERSION}.dmg"
[ -f "$DMG" ] || DMG="$(ls -t "$OUT_DIR"/*.dmg | head -1)"

# ── 5. Submit to Apple's notary service and wait ──
echo -e "  → Submitting to Apple notary service ${DIM}(this can take a few minutes)${RESET}..."
if [ -n "$NOTARY_PROFILE" ]; then
  xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
else
  xcrun notarytool submit "$DMG" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_PASSWORD" \
    --wait
fi

# ── 6. Staple the ticket so it verifies offline ──
echo -e "  → Stapling ticket..."
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
spctl --assess --type open --context context:primary-signature -v "$DMG" || true

echo ""
echo -e "  ${GREEN}✓${RESET} Notarized ${CYAN}${DMG}${RESET}"
echo -e "  ${DIM}Users can now open it with a normal double-click.${RESET}"
echo ""
