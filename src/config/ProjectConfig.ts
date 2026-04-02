export interface ProxySettings {
  server: string;
  username?: string;
  password?: string;
  rotation: "none" | "per_request" | "per_session";
}

export interface Config {
  output_dir: string;
  output_format: "json" | "csv" | "both";
  stealth_level: "none" | "basic" | "full";
  default_timeout: number;
  proxy?: ProxySettings;
}

const DEFAULT_CONFIG: Config = {
  output_dir: "scrapers",
  output_format: "json",
  stealth_level: "basic",
  default_timeout: 30000,
};

export class ProjectConfig {
  private static instance: ProjectConfig;
  private config: Config = { ...DEFAULT_CONFIG };

  private constructor() {}

  static getInstance(): ProjectConfig {
    if (!ProjectConfig.instance) {
      ProjectConfig.instance = new ProjectConfig();
    }
    return ProjectConfig.instance;
  }

  get(): Config {
    return { ...this.config };
  }

  update(updates: Partial<Omit<Config, "proxy">>): Config {
    this.config = { ...this.config, ...updates };
    return this.get();
  }

  setProxy(proxy: ProxySettings): void {
    this.config.proxy = proxy;
  }

  getProxy(): ProxySettings | undefined {
    return this.config.proxy;
  }
}
