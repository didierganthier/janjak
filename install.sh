#!/bin/bash
# ─── Janjak One-Click Installer ─────────────────────────────────────
# Usage: curl -fsSL https://raw.githubusercontent.com/didierganthier/janjak/main/install.sh | bash
# Or locally: bash install.sh
#
# What it does:
# 1. Check/install Node.js
# 2. Clone or update Janjak
# 3. Install dependencies
# 4. Build TypeScript
# 5. Link the CLI globally
# 6. Build native macOS apps (notifications + menu bar)
# 7. Set up data directory
# 8. Launch setup wizard in browser

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

INSTALL_DIR="$HOME/.janjak-app"
DATA_DIR="$HOME/.janjak"
REPO_URL="https://github.com/didierganthier/janjak.git"

echo ""
echo -e "${CYAN}${BOLD}🧠 Janjak Installer${RESET}"
echo -e "${DIM}   Your Ambient Intelligence Assistant${RESET}"
echo -e "${DIM}   ─────────────────────────────────────${RESET}"
echo ""

# ── Step 1: Check Node.js ──
echo -e "${YELLOW}[1/7]${RESET} Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo -e "  ${GREEN}✓${RESET} Node.js ${NODE_VERSION} found"
else
    echo -e "  ${RED}✗${RESET} Node.js not found"
    echo ""
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo -e "  Installing via Homebrew..."
        if command -v brew &> /dev/null; then
            brew install node
        else
            echo -e "  ${YELLOW}Installing Homebrew first...${RESET}"
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            brew install node
        fi
    else
        echo -e "  Please install Node.js 18+ from https://nodejs.org"
        exit 1
    fi
    echo -e "  ${GREEN}✓${RESET} Node.js installed"
fi

# ── Step 2: Install/Update Janjak ──
echo -e "${YELLOW}[2/7]${RESET} Installing Janjak..."
if [ -d "$INSTALL_DIR/.git" ]; then
    echo -e "  ${DIM}Updating existing installation...${RESET}"
    cd "$INSTALL_DIR"
    git pull --quiet
else
    # If running from the project directory (local install)
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "$SCRIPT_DIR/package.json" ] && grep -q '"janjak"' "$SCRIPT_DIR/package.json" 2>/dev/null; then
        echo -e "  ${DIM}Using local project directory...${RESET}"
        INSTALL_DIR="$SCRIPT_DIR"
    elif [ -f "./package.json" ] && grep -q '"janjak"' "./package.json" 2>/dev/null; then
        echo -e "  ${DIM}Using current directory...${RESET}"
        INSTALL_DIR="$(pwd)"
    else
        # Fresh remote install (curl | bash): clone the repo.
        if ! command -v git &> /dev/null; then
            echo -e "  ${RED}✗${RESET} git is required to download Janjak."
            echo -e "  Install git (e.g. ${CYAN}xcode-select --install${RESET}) and re-run."
            exit 1
        fi
        echo -e "  ${DIM}Downloading Janjak from GitHub...${RESET}"
        git clone --quiet "$REPO_URL" "$INSTALL_DIR"
    fi
fi
cd "$INSTALL_DIR"
echo -e "  ${GREEN}✓${RESET} Source ready at ${DIM}${INSTALL_DIR}${RESET}"

# ── Step 3: Install dependencies ──
echo -e "${YELLOW}[3/7]${RESET} Installing dependencies..."
npm install --silent 2>/dev/null
echo -e "  ${GREEN}✓${RESET} Dependencies installed"

# ── Step 4: Build TypeScript ──
echo -e "${YELLOW}[4/7]${RESET} Building..."
npx tsc 2>/dev/null
echo -e "  ${GREEN}✓${RESET} Build complete"

# ── Step 5: Link CLI globally ──
echo -e "${YELLOW}[5/7]${RESET} Linking CLI..."
npm link --silent 2>/dev/null || sudo npm link --silent 2>/dev/null
echo -e "  ${GREEN}✓${RESET} ${BOLD}janjak${RESET} command available globally"

# ── Step 6: Create data directory ──
echo -e "${YELLOW}[6/7]${RESET} Setting up data directory..."
mkdir -p "$DATA_DIR"

# Create .env if it doesn't exist
if [ ! -f "$DATA_DIR/.env" ]; then
    cat > "$DATA_DIR/.env" <<'EOF'
# ─── Janjak Configuration ────────────────────
# Fill in the keys for features you want to use.
# All are optional — Janjak works without them.

# OpenAI (for AI daily plans, chat, weekly summaries)
# OPENAI_API_KEY=sk-...

# GitHub (for PR/issue tracking in dashboard)
# GITHUB_TOKEN=ghp_...

# Google credentials are managed via gmail-credentials.json
# Run: janjak login (or use the setup wizard)
EOF
    echo -e "  ${GREEN}✓${RESET} Created ${DIM}~/.janjak/.env${RESET}"
else
    echo -e "  ${GREEN}✓${RESET} Config already exists"
fi

# ── Step 7: Build native macOS apps ──
echo -e "${YELLOW}[7/7]${RESET} Building macOS apps..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    # Build notification app
    if [ -f "$INSTALL_DIR/scripts/build-notify-app.sh" ]; then
        bash "$INSTALL_DIR/scripts/build-notify-app.sh" > /dev/null 2>&1 && \
            echo -e "  ${GREEN}✓${RESET} Notification app built" || \
            echo -e "  ${YELLOW}⚠${RESET} Notification app skipped (non-critical)"
    fi
    # Build menu bar app
    if [ -f "$INSTALL_DIR/scripts/build-menubar-app.sh" ]; then
        bash "$INSTALL_DIR/scripts/build-menubar-app.sh" > /dev/null 2>&1 && \
            echo -e "  ${GREEN}✓${RESET} Menu bar app built" || \
            echo -e "  ${YELLOW}⚠${RESET} Menu bar app skipped (non-critical)"
    fi
else
    echo -e "  ${DIM}Skipped (macOS only)${RESET}"
fi

# ── Done! ──
echo ""
echo -e "${GREEN}${BOLD}✅ Janjak installed successfully!${RESET}"
echo ""
echo -e "  ${BOLD}Quick start:${RESET}"
echo -e "    ${CYAN}janjak setup${RESET}     — Open setup wizard in browser"
echo -e "    ${CYAN}janjak web${RESET}       — Open web dashboard"
echo -e "    ${CYAN}janjak menubar${RESET}   — Launch menu bar app"
echo -e "    ${CYAN}janjak focus${RESET}     — Start a focus session"
echo -e "    ${CYAN}janjak status${RESET}    — Check what you're doing"
echo ""
echo -e "  ${DIM}Run ${CYAN}janjak setup${RESET}${DIM} to connect Google, GitHub, and OpenAI.${RESET}"
echo ""

# Auto-launch setup wizard
read -p "  Open setup wizard now? [Y/n] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]?$ ]]; then
    janjak setup &
fi
