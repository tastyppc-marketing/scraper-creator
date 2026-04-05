# Scraper Creator

AI-powered web scraper creator with browser automation and MCP (Model Context Protocol) integration. This tool lets AI assistants control a real browser, inspect pages, capture selectors, and generate production-ready Python scrapers automatically.

## What It Does

Scraper Creator is an MCP server that exposes 16+ tools for AI assistants to:

- **Launch and control a browser** — Navigate, click, type, screenshot, execute JavaScript
- **Analyze page structure** — Detect site type (static/dynamic), authentication state, pagination patterns, forms, grids
- **Capture selectors** — Multi-strategy selector generation (CSS, XPath, aria, data-testid) ranked by robustness
- **Record user actions** — Passive recording of clicks and inputs during a session
- **Generate scrapers** — Auto-generate Python scraper code from captured data (supports static + dynamic sites)
- **Test scrapers** — Run generated scrapers directly and return results
- **Anti-detection** — Built-in stealth mode (webdriver masking, realistic UA, plugin simulation)

## Prerequisites

### Required

| Dependency | Minimum Version | Purpose |
|------------|----------------|---------|
| **Node.js** | 18+ | Runtime for the MCP server |
| **npm** | 9+ | Package manager (comes with Node.js) |
| **Python** | 3.8+ | Running generated scrapers |
| **pip** | Latest | Installing Python packages |

### System Dependencies

| Dependency | Purpose | Install |
|------------|---------|---------|
| **Chromium browser libs** | Playwright needs system-level browser libraries | Auto-installed via `npx playwright install-deps` |

## Quick Start

### Option 1: Automated Install (Recommended)

```bash
git clone <this-repo-url>
cd scraper-creator
chmod +x install.sh
./install.sh
```

The install script handles everything — Node.js packages, Playwright browsers, and Python dependencies.

### Option 2: Manual Install

```bash
# 1. Install Node.js dependencies
npm install

# 2. Install Playwright browsers (downloads ~500MB Chromium)
npx playwright install chromium
npx playwright install-deps chromium

# 3. Install Python dependencies (for running generated scrapers)
pip install -r requirements.txt
python -m playwright install chromium

# 4. Build the TypeScript source
npm run build
```

## Usage

### As an MCP Server (Primary Use)

Add to your MCP client configuration (e.g., Claude Code `settings.json`, Cursor, etc.):

```json
{
  "mcpServers": {
    "scraper-creator": {
      "command": "node",
      "args": ["/path/to/scraper-creator/dist/index.js"],
      "env": {}
    }
  }
}
```

Or use the start script:

```json
{
  "mcpServers": {
    "scraper-creator": {
      "command": "/path/to/scraper-creator/start-mcp.sh"
    }
  }
}
```

### Development Mode

```bash
npm run dev    # Runs via tsx (no build needed)
```

### Production Mode

```bash
npm run build  # Compile TypeScript
npm start      # Run compiled server
```

## MCP Tools Reference

### Browser Control

| Tool | Description |
|------|-------------|
| `start_browser` | Launch Chromium (headed/headless), optional URL and proxy |
| `stop_browser` | Close browser, return session summary |
| `navigate` | Go to a URL |
| `click` | Click an element by CSS selector |
| `type_text` | Type text into an element, optionally submit |
| `screenshot` | Capture page as base64 PNG (viewport or full page) |
| `evaluate_js` | Execute arbitrary JavaScript on the page |
| `get_page_info` | Get URL, title, auth state, cookie/localStorage counts |

### Page Analysis

| Tool | Description |
|------|-------------|
| `capture_page` | Full page analysis — structure, patterns, accessibility tree |
| `capture_selector` | Find elements by text description, return ranked selectors |
| `get_captured_clicks` | Return passively recorded click events |
| `get_actions` | Return all recorded actions from the session |

### Visual Inspection

| Tool | Description |
|------|-------------|
| `enable_highlighting` | Turn on visual element overlay |
| `disable_highlighting` | Turn off visual element overlay |

### Configuration

| Tool | Description |
|------|-------------|
| `configure` | Set output directory, format (json/csv/both), stealth level, timeout |
| `set_proxy` | Configure proxy with auth and rotation strategy |

### Scraper Generation

| Tool | Description |
|------|-------------|
| `generate_scraper` | Generate Python scraper from captured selectors and patterns |
| `test_scraper` | Run a generated scraper and return output |

## Generated Scraper Types

### Static Sites (requests + BeautifulSoup)
- Lightweight HTTP-based scraping
- Uses `requests` + `beautifulsoup4` + `lxml`
- Supports pagination (next-button parsing)
- Includes randomized delays between requests
- Login support

### Dynamic Sites (Playwright)
- Full browser automation for JS-rendered content
- Handles infinite scroll, next-button, and page-number pagination
- Async/await pattern with networkidle wait states
- Proxy and headless mode support
- Login support

## Anti-Detection Features

When stealth mode is enabled (`basic` or `full`):

- Masks `navigator.webdriver` property
- Simulates realistic `navigator.plugins`
- Sets `navigator.languages` to English
- Provides `chrome.runtime` stubs
- Overrides permissions queries
- Spoofs hardware concurrency (8 cores) and device memory (8GB)
- Randomizes User-Agent from a realistic pool
- Fixes iframe contentWindow detection

## Project Structure

```
scraper-creator/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # MCP server setup + tool registration
│   ├── analyzer/             # Page analysis (site detection, patterns, auth)
│   ├── browser/              # BrowserManager singleton, proxy, stealth, recording
│   ├── config/               # Project configuration singleton
│   ├── generator/templates/  # Nunjucks templates for Python scraper generation
│   ├── inject/               # Browser-injected scripts (highlighter, recorder, selector)
│   ├── selectors/            # Multi-strategy selector engine + ranking
│   ├── tools/                # MCP tool definitions (browser, config, generator)
│   └── types/                # TypeScript type declarations
├── scrapers/                 # Output directory for generated scrapers
├── dist/                     # Compiled JavaScript (after build)
├── install.sh                # Automated installer
├── start-mcp.sh              # MCP server launcher
├── package.json
└── tsconfig.json
```

## npm Dependencies

### Production
- `@modelcontextprotocol/sdk` ^1.27.1 — MCP protocol implementation
- `nunjucks` ^3.2.4 — Template engine for scraper code generation
- `playwright` ^1.58.2 — Browser automation
- `playwright-extra` ^4.3.6 — Playwright enhancement plugins
- `puppeteer-extra-plugin-stealth` ^2.11.2 — Anti-detection plugin

### Development
- `typescript` ^5.9.3 — TypeScript compiler
- `tsx` ^4.21.0 — TypeScript executor for dev mode
- `@types/node` ^25.3.5 — Node.js type definitions
- `@types/nunjucks` ^3.2.6 — Nunjucks type definitions

## Python Dependencies (for generated scrapers)

- `requests` — HTTP library (static scrapers)
- `beautifulsoup4` — HTML parsing (static scrapers)
- `lxml` — Fast XML/HTML parser (static scrapers)
- `playwright` — Browser automation (dynamic scrapers)

## Troubleshooting

### Playwright browser not found
```bash
npx playwright install chromium
npx playwright install-deps chromium
```

### Python scraper fails to import modules
```bash
pip install -r requirements.txt
python -m playwright install chromium
```

### MCP server won't start
- Ensure you've run `npm run build` first (or use `npm run dev` for development)
- Check that Node.js 18+ is installed: `node --version`
- Verify the dist/ directory exists and contains `index.js`

### Browser launch fails on Linux (WSL/headless server)
```bash
# Install system dependencies for Chromium
npx playwright install-deps chromium

# If running headless (no display):
# The browser defaults to headed mode — pass headless: true in start_browser
```

## License

ISC
