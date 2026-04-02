#!/bin/bash
set -e

# ============================================================
# Scraper Creator — Automated Installer
# ============================================================
# This script installs all dependencies needed to run the
# scraper-creator MCP server and the Python scrapers it generates.
#
# Usage:
#   chmod +x install.sh
#   ./install.sh
#
# What it installs:
#   1. Node.js npm packages (MCP server dependencies)
#   2. Playwright Chromium browser (~500MB download)
#   3. System-level browser dependencies (Linux only)
#   4. Python packages for generated scrapers
#   5. Builds the TypeScript source to dist/
# ============================================================

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_step() {
    echo -e "\n${BOLD}${GREEN}[$1/$TOTAL_STEPS]${NC} ${BOLD}$2${NC}"
}

print_warn() {
    echo -e "${YELLOW}  WARNING:${NC} $1"
}

print_error() {
    echo -e "${RED}  ERROR:${NC} $1"
}

print_success() {
    echo -e "${GREEN}  OK:${NC} $1"
}

TOTAL_STEPS=6

echo -e "${BOLD}"
echo "================================================"
echo "  Scraper Creator — Installer"
echo "================================================"
echo -e "${NC}"

# ----------------------------------------------------------
# Step 1: Check Node.js
# ----------------------------------------------------------
print_step 1 "Checking Node.js..."

if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 18 ]; then
        print_success "Node.js v$NODE_VERSION found"
    else
        print_error "Node.js v$NODE_VERSION found but v18+ is required"
        echo "  Install the latest LTS from https://nodejs.org/"
        exit 1
    fi
else
    print_error "Node.js not found"
    echo ""
    echo "  Install Node.js v18+ first:"
    echo "    - macOS:   brew install node"
    echo "    - Ubuntu:  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs"
    echo "    - Windows: https://nodejs.org/en/download"
    echo "    - nvm:     nvm install --lts"
    echo ""
    exit 1
fi

# ----------------------------------------------------------
# Step 2: Check Python
# ----------------------------------------------------------
print_step 2 "Checking Python..."

PYTHON_CMD=""
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
fi

if [ -n "$PYTHON_CMD" ]; then
    PYTHON_VERSION=$($PYTHON_CMD --version 2>&1 | sed 's/Python //')
    print_success "Python $PYTHON_VERSION found ($PYTHON_CMD)"
else
    print_warn "Python not found — generated scrapers won't run without it"
    echo "  Install Python 3.8+ from https://python.org/"
fi

PIP_CMD=""
if command -v pip3 &> /dev/null; then
    PIP_CMD="pip3"
elif command -v pip &> /dev/null; then
    PIP_CMD="pip"
fi

# ----------------------------------------------------------
# Step 3: Install Node.js dependencies
# ----------------------------------------------------------
print_step 3 "Installing Node.js dependencies..."

npm install
print_success "npm packages installed"

# ----------------------------------------------------------
# Step 4: Install Playwright browsers
# ----------------------------------------------------------
print_step 4 "Installing Playwright Chromium browser..."

npx playwright install chromium
print_success "Playwright Chromium installed"

# Install system deps on Linux
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "  Installing system dependencies for Chromium (may require sudo)..."
    if command -v sudo &> /dev/null; then
        sudo npx playwright install-deps chromium 2>/dev/null || {
            print_warn "Could not install system deps automatically"
            echo "  Run manually: sudo npx playwright install-deps chromium"
        }
    else
        npx playwright install-deps chromium 2>/dev/null || {
            print_warn "Could not install system deps (no sudo available)"
            echo "  Run manually as root: npx playwright install-deps chromium"
        }
    fi
fi

# ----------------------------------------------------------
# Step 5: Install Python dependencies (optional)
# ----------------------------------------------------------
print_step 5 "Installing Python dependencies for generated scrapers..."

if [ -n "$PIP_CMD" ]; then
    $PIP_CMD install requests beautifulsoup4 lxml 2>/dev/null && \
        print_success "Python packages installed (requests, beautifulsoup4, lxml)" || \
        print_warn "Some Python packages failed to install — scrapers using them may not work"

    # Install Python Playwright (for dynamic scrapers)
    $PIP_CMD install playwright 2>/dev/null && \
        $PYTHON_CMD -m playwright install chromium 2>/dev/null && \
        print_success "Python Playwright installed" || \
        print_warn "Python Playwright install failed — dynamic scrapers may not work"
else
    print_warn "pip not found — skipping Python dependencies"
    echo "  Install manually: pip install requests beautifulsoup4 lxml playwright"
fi

# ----------------------------------------------------------
# Step 6: Build TypeScript
# ----------------------------------------------------------
print_step 6 "Building TypeScript source..."

npm run build
print_success "Build complete — dist/ directory ready"

# Make start script executable
chmod +x start-mcp.sh 2>/dev/null || true

# ----------------------------------------------------------
# Done
# ----------------------------------------------------------
echo ""
echo -e "${BOLD}${GREEN}================================================${NC}"
echo -e "${BOLD}${GREEN}  Installation complete!${NC}"
echo -e "${BOLD}${GREEN}================================================${NC}"
echo ""
echo "  To use as an MCP server, add to your client config:"
echo ""
echo "    {\"mcpServers\": {"
echo "      \"scraper-creator\": {"
echo "        \"command\": \"node\","
echo "        \"args\": [\"$(pwd)/dist/index.js\"]"
echo "      }"
echo "    }}"
echo ""
echo "  Or run directly:"
echo "    npm start          # production"
echo "    npm run dev        # development (auto-reload)"
echo ""
