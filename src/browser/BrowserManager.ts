import type { Browser, BrowserContext, Page } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Lazy-load playwright to avoid blocking MCP server startup (~12s import)
async function getChromium() {
  const pw = await import("playwright");
  return pw.chromium;
}

async function loadStealth() {
  const mod = await import("./stealth.js");
  return mod;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Paths to inject scripts (resolved relative to this file at runtime)
const INJECT_DIR = path.resolve(__dirname, "../inject");

function readInjectScript(filename: string): string {
  return fs.readFileSync(path.join(INJECT_DIR, filename), "utf-8");
}

export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

export interface RecordedAction {
  action: string;
  selector: string | null;
  url: string;
  value: string | null;
  timestamp: string;
}

export interface SessionInfo {
  sessionId: string;
  url: string;
  title: string;
}

export interface SessionSummary {
  actionsRecorded: number;
  selectorsCaptured: number;
}

export class BrowserManager {
  private static instance: BrowserManager;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private sessionId: string | null = null;
  private actions: RecordedAction[] = [];
  private selectorsCaptured: number = 0;
  private cleanupRegistered = false;

  private constructor() {}

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  isActive(): boolean {
    return this.browser !== null && this.page !== null;
  }

  isRunning(): boolean {
    return (
      this.browser !== null &&
      this.browser.isConnected() &&
      this.page !== null &&
      !this.page.isClosed()
    );
  }

  getPage(): Page {
    if (!this.page || this.page.isClosed()) {
      throw new Error("No active browser session. Call start_browser first.");
    }
    return this.page;
  }

  getSessionId(): string {
    if (!this.sessionId) {
      throw new Error("No active browser session.");
    }
    return this.sessionId;
  }

  getActions(): RecordedAction[] {
    return [...this.actions];
  }

  incrementSelectorsCaptured(): void {
    this.selectorsCaptured++;
  }

  recordAction(action: RecordedAction): void {
    this.actions.push(action);
  }

  async launch(options: {
    url?: string;
    headless?: boolean;
    proxy?: ProxyConfig;
  }): Promise<SessionInfo> {
    if (this.browser) {
      await this.close();
    }

    this.sessionId = `session_${Date.now()}`;
    this.actions = [];
    this.selectorsCaptured = 0;

    const chromium = await getChromium();
    const { applyStealthSettings, getRandomUserAgent } = await loadStealth();

    this.browser = await chromium.launch({
      headless: options.headless ?? false,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-infobars",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ],
      ...(options.proxy
        ? {
            proxy: {
              server: options.proxy.server,
              username: options.proxy.username,
              password: options.proxy.password,
            },
          }
        : {}),
    });

    this.context = await this.browser.newContext({
      userAgent: getRandomUserAgent(),
      viewport: { width: 1920, height: 1080 },
    });

    // Apply stealth settings to the context
    await applyStealthSettings(this.context);

    // Create the page and inject browser scripts
    this.page = await this.context.newPage();

    // Inject highlighter, selector, and recorder scripts so they run on every page load
    await this.page.addInitScript({
      content: readInjectScript("highlighter.js"),
    });
    await this.page.addInitScript({
      content: readInjectScript("selector.js"),
    });
    await this.page.addInitScript({
      content: readInjectScript("recorder.js"),
    });

    // Record navigation events
    this.page.on("framenavigated", (frame) => {
      if (frame === this.page?.mainFrame()) {
        this.actions.push({
          action: "navigate",
          selector: null,
          url: frame.url(),
          value: null,
          timestamp: new Date().toISOString(),
        });
      }
    });

    this.registerCleanup();

    let url = "about:blank";
    let title = "";

    if (options.url) {
      await this.page.goto(options.url, { waitUntil: "domcontentloaded" });
      url = this.page.url();
      title = await this.page.title();
    }

    return {
      sessionId: this.sessionId,
      url,
      title,
    };
  }

  async close(): Promise<SessionSummary> {
    const summary: SessionSummary = {
      actionsRecorded: this.actions.length,
      selectorsCaptured: this.selectorsCaptured,
    };

    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }

    this.sessionId = null;
    this.actions = [];
    this.selectorsCaptured = 0;

    return summary;
  }

  private registerCleanup(): void {
    if (this.cleanupRegistered) return;
    this.cleanupRegistered = true;

    const cleanup = () => {
      if (this.browser) {
        this.browser.close().catch(() => {});
      }
    };

    process.on("exit", cleanup);
    process.on("SIGINT", () => {
      cleanup();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      cleanup();
      process.exit(0);
    });
    process.on("uncaughtException", (err) => {
      console.error("Uncaught exception — closing browser:", err);
      cleanup();
      process.exit(1);
    });
  }
}
