import type { BrowserContext } from 'playwright';

// A curated list of real-world User-Agent strings for common browsers/OS combos.
const REALISTIC_USER_AGENTS: string[] = [
  // Chrome on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  // Chrome on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  // Firefox on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  // Firefox on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
  // Edge on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  // Safari on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
];

export function getRandomUserAgent(): string {
  return REALISTIC_USER_AGENTS[
    Math.floor(Math.random() * REALISTIC_USER_AGENTS.length)
  ]!;
}

/**
 * Applies a collection of anti-detection init scripts to a Playwright
 * BrowserContext. Call this immediately after creating the context and
 * before opening any pages.
 */
export async function applyStealthSettings(context: BrowserContext): Promise<void> {
  // ── 1. Remove navigator.webdriver ──────────────────────────────────────────
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
  });

  // ── 2. Override navigator.plugins to simulate a real browser ──────────────
  await context.addInitScript(() => {
    const makePlugin = (name: string, filename: string, description: string) => {
      const plugin = Object.create(Plugin.prototype) as Plugin;
      Object.defineProperty(plugin, 'name', { value: name });
      Object.defineProperty(plugin, 'filename', { value: filename });
      Object.defineProperty(plugin, 'description', { value: description });
      Object.defineProperty(plugin, 'length', { value: 0 });
      return plugin;
    };

    const pluginArray = [
      makePlugin(
        'Chrome PDF Plugin',
        'internal-pdf-viewer',
        'Portable Document Format'
      ),
      makePlugin(
        'Chrome PDF Viewer',
        'mhjfbmdgcfjbbpaeojofohoefgiehjai',
        'Portable Document Format'
      ),
      makePlugin(
        'Native Client',
        'internal-nacl-plugin',
        'Native Client Executable'
      ),
    ];

    Object.defineProperty(navigator, 'plugins', {
      get: () => pluginArray,
      configurable: true,
    });
  });

  // ── 3. Override navigator.languages ───────────────────────────────────────
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
      configurable: true,
    });

    Object.defineProperty(navigator, 'language', {
      get: () => 'en-US',
      configurable: true,
    });
  });

  // ── 4. Mask headless detection — chrome.runtime, permissions, etc. ────────
  await context.addInitScript(() => {
    // Provide a realistic window.chrome object
    if (!('chrome' in window)) {
      (window as unknown as Record<string, unknown>)['chrome'] = {};
    }

    const chrome = (window as unknown as Record<string, unknown>)['chrome'] as Record<string, unknown>;

    if (!chrome['runtime']) {
      chrome['runtime'] = {
        // Minimal stubs
        PlatformOs: {
          MAC: 'mac',
          WIN: 'win',
          ANDROID: 'android',
          CROS: 'cros',
          LINUX: 'linux',
          OPENBSD: 'openbsd',
        },
        PlatformArch: {
          ARM: 'arm',
          X86_32: 'x86-32',
          X86_64: 'x86-64',
        },
        RequestUpdateCheckStatus: {
          THROTTLED: 'throttled',
          NO_UPDATE: 'no_update',
          UPDATE_AVAILABLE: 'update_available',
        },
        OnInstalledReason: {
          INSTALL: 'install',
          UPDATE: 'update',
          CHROME_UPDATE: 'chrome_update',
          SHARED_MODULE_UPDATE: 'shared_module_update',
        },
        OnRestartRequiredReason: {
          APP_UPDATE: 'app_update',
          OS_UPDATE: 'os_update',
          PERIODIC: 'periodic',
        },
      };
    }

    // Permissions — make notifications behave like a real browser
    const origQuery = window.navigator.permissions?.query?.bind(
      window.navigator.permissions
    );
    if (origQuery) {
      window.navigator.permissions.query = (parameters: PermissionDescriptor) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({
            state: Notification.permission,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
          } as unknown as PermissionStatus);
        }
        return origQuery(parameters);
      };
    }
  });

  // ── 5. Override hardware concurrency to appear like a real machine ─────────
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8,
      configurable: true,
    });

    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
      configurable: true,
    });
  });

  // ── 6. Prevent iframe-based iframe.contentWindow.navigator.webdriver checks
  await context.addInitScript(() => {
    // Override HTMLIFrameElement.prototype.contentWindow getter to also strip
    // webdriver on nested frames (best-effort; CSP may block in practice).
    try {
      const nativeGetter = Object.getOwnPropertyDescriptor(
        HTMLIFrameElement.prototype,
        'contentWindow'
      )?.get;

      if (nativeGetter) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          get() {
            const win = nativeGetter.call(this) as WindowProxy | null;
            if (win) {
              try {
                Object.defineProperty(win.navigator, 'webdriver', {
                  get: () => undefined,
                  configurable: true,
                });
              } catch {
                // cross-origin frames will throw — that is expected
              }
            }
            return win;
          },
          configurable: true,
        });
      }
    } catch {
      // non-fatal
    }
  });
}
