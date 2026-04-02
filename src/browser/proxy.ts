export type ProxyRotation = 'none' | 'per_request' | 'per_session';

export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
  rotation: ProxyRotation;
}

/** Playwright's native proxy shape (subset we care about). */
export interface PlaywrightProxy {
  server: string;
  username?: string;
  password?: string;
}

export class ProxyManager {
  private config: ProxyConfig | null = null;

  /**
   * Store a proxy configuration.
   * The `server` must be a full URL, e.g. `http://proxy.example.com:8080`
   * or `socks5://proxy.example.com:1080`.
   */
  setProxy(config: ProxyConfig): void {
    if (!config.server) {
      throw new Error('ProxyConfig.server must be a non-empty string.');
    }
    this.config = { ...config };
  }

  /**
   * Returns a proxy object that can be passed directly to Playwright's
   * `browser.newContext({ proxy })` or `chromium.launch({ proxy })`.
   * Throws if no proxy has been configured.
   */
  getPlaywrightProxy(): PlaywrightProxy {
    if (!this.config) {
      throw new Error(
        'No proxy configured. Call setProxy() before getPlaywrightProxy().'
      );
    }

    const proxy: PlaywrightProxy = { server: this.config.server };

    if (this.config.username) {
      proxy.username = this.config.username;
    }
    if (this.config.password) {
      proxy.password = this.config.password;
    }

    return proxy;
  }

  /** Returns true if a proxy has been set. */
  isConfigured(): boolean {
    return this.config !== null;
  }

  /** Returns the current rotation strategy, or null if unconfigured. */
  getRotation(): ProxyRotation | null {
    return this.config?.rotation ?? null;
  }

  /** Remove the current proxy configuration. */
  clear(): void {
    this.config = null;
  }
}
