import type { Page } from 'playwright';
import { detectSiteType } from './detector.js';
import { PatternDetector } from './patterns.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectedPattern {
  type: 'list' | 'table' | 'pagination' | 'search' | 'login_form' | 'card_grid';
  selector: string;
  itemCount?: number;
  confidence: number;
}

export interface PageMetadata {
  url: string;
  title: string;
  description: string | null;
  keywords: string | null;
  canonical: string | null;
  ogTitle: string | null;
  ogImage: string | null;
  language: string | null;
}

export interface PageAnalysis {
  url: string;
  title: string;
  siteType: 'static' | 'dynamic';
  authState: 'logged_in' | 'login_page' | 'unknown';
  elements: {
    total: number;
    interactive: number;
    forms: number;
    tables: number;
    lists: number;
    images: number;
  };
  patterns: DetectedPattern[];
  accessibilitySnapshot: string;
}

// ---------------------------------------------------------------------------
// PageAnalyzer
// ---------------------------------------------------------------------------

export class PageAnalyzer {
  private readonly patternDetector: PatternDetector;

  constructor(private readonly page: Page) {
    this.patternDetector = new PatternDetector(page);
  }

  // -------------------------------------------------------------------------
  // analyze — full page analysis
  // -------------------------------------------------------------------------
  async analyze(): Promise<PageAnalysis> {
    const [url, title, siteTypeResult, authState, elementCounts, accessibilitySnapshot] =
      await Promise.all([
        this.page.url(),
        this.page.title(),
        this.detectSiteType(),
        this.detectAuthState(),
        this._countElements(),
        this._getAccessibilitySnapshot(),
      ]);

    const patterns = await this._detectAllPatterns();

    return {
      url,
      title,
      siteType: siteTypeResult,
      authState,
      elements: elementCounts,
      patterns,
      accessibilitySnapshot,
    };
  }

  // -------------------------------------------------------------------------
  // detectSiteType
  // -------------------------------------------------------------------------
  async detectSiteType(): Promise<'static' | 'dynamic'> {
    const result = await detectSiteType(this.page);
    return result.type;
  }

  // -------------------------------------------------------------------------
  // getMetadata
  // -------------------------------------------------------------------------
  async getMetadata(): Promise<PageMetadata> {
    return this.page.evaluate((): PageMetadata => {
      function meta(name: string): string | null {
        return (
          document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ??
          document.querySelector<HTMLMetaElement>(`meta[property="${name}"]`)?.content ??
          null
        );
      }

      return {
        url: location.href,
        title: document.title,
        description: meta('description'),
        keywords: meta('keywords'),
        canonical:
          document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null,
        ogTitle: meta('og:title'),
        ogImage: meta('og:image'),
        language: document.documentElement.lang || null,
      };
    });
  }

  // -------------------------------------------------------------------------
  // detectAuthState
  // -------------------------------------------------------------------------
  async detectAuthState(): Promise<'logged_in' | 'login_page' | 'unknown'> {
    return this.page.evaluate((): 'logged_in' | 'login_page' | 'unknown' => {
      // ----- Login page signals -----
      const passwordInputs = document.querySelectorAll('input[type="password"]');
      if (passwordInputs.length > 0) {
        // Has password field → almost certainly a login/register page
        // But if it also has a logout link it might be a settings page
        const hasLogout = !!document.querySelector(
          'a[href*="logout"], a[href*="sign-out"], button[class*="logout"]'
        );
        if (!hasLogout) return 'login_page';
      }

      // ----- Logged-in signals -----
      const logoutSignals = [
        'a[href*="logout"]',
        'a[href*="signout"]',
        'a[href*="sign-out"]',
        'a[href*="log-out"]',
        'button[class*="logout"]',
        '[data-testid*="logout"]',
        '[aria-label*="log out" i]',
        '[aria-label*="sign out" i]',
      ];
      for (const pattern of logoutSignals) {
        if (document.querySelector(pattern)) return 'logged_in';
      }

      // Text-based logout link
      const allLinks = Array.from(document.querySelectorAll('a, button'));
      for (const link of allLinks) {
        const text = link.textContent?.trim().toLowerCase() ?? '';
        if (
          text === 'logout' ||
          text === 'log out' ||
          text === 'sign out' ||
          text === 'signout'
        ) {
          return 'logged_in';
        }
      }

      // User avatar / profile menu pattern
      const profileSignals = [
        '[aria-label*="profile" i]',
        '[aria-label*="account" i]',
        '[class*="avatar"]',
        '[class*="user-menu"]',
        '[class*="userMenu"]',
        '[data-testid*="avatar"]',
        '[data-testid*="user"]',
      ];
      for (const pattern of profileSignals) {
        if (document.querySelector(pattern)) return 'logged_in';
      }

      return 'unknown';
    });
  }

  // -------------------------------------------------------------------------
  // Private: count element types
  // -------------------------------------------------------------------------
  private async _countElements(): Promise<PageAnalysis['elements']> {
    return this.page.evaluate((): PageAnalysis['elements'] => {
      // TypeScript doesn't know about the outer interface here, so use inline type
      const total = document.querySelectorAll('*').length;
      const interactive = document.querySelectorAll(
        'a, button, input, select, textarea, [role="button"], [tabindex]'
      ).length;
      const forms = document.querySelectorAll('form').length;
      const tables = document.querySelectorAll('table').length;
      const lists = document.querySelectorAll('ul, ol, dl').length;
      const images = document.querySelectorAll('img, picture, svg, [role="img"]').length;
      return { total, interactive, forms, tables, lists, images };
    });
  }

  // -------------------------------------------------------------------------
  // Private: build a trimmed accessibility snapshot
  // Playwright's page.accessibility API was removed in v1.36+, so we build
  // a compact snapshot manually via page.evaluate().
  // -------------------------------------------------------------------------
  private async _getAccessibilitySnapshot(): Promise<string> {
    try {
      const snapshot = await this.page.evaluate((): string => {
        interface AXNode {
          role: string;
          name?: string;
          children?: AXNode[];
        }

        function buildNode(el: Element, depth: number): AXNode | null {
          if (depth > 6) return null;
          const tag = el.tagName.toLowerCase();
          const role =
            el.getAttribute('role') ||
            {
              a: 'link', button: 'button', input: 'textbox', select: 'combobox',
              textarea: 'textbox', img: 'img', table: 'table', nav: 'navigation',
              main: 'main', header: 'banner', footer: 'contentinfo', form: 'form',
              h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading',
              h5: 'heading', h6: 'heading', ul: 'list', ol: 'list', li: 'listitem',
            }[tag] ||
            'generic';

          const name =
            el.getAttribute('aria-label') ||
            el.getAttribute('aria-labelledby') ||
            (el as HTMLInputElement).placeholder ||
            (el as HTMLAnchorElement).title ||
            (role === 'heading' || role === 'link' || role === 'button'
              ? (el.textContent?.trim().slice(0, 80) ?? '')
              : '');

          const interestingRoles = new Set([
            'link', 'button', 'textbox', 'combobox', 'img', 'table',
            'navigation', 'main', 'banner', 'contentinfo', 'form',
            'heading', 'list', 'listitem', 'checkbox', 'radio', 'menuitem',
          ]);

          const childNodes: AXNode[] = [];
          for (const child of el.children) {
            const childNode = buildNode(child, depth + 1);
            if (childNode) childNodes.push(childNode);
          }

          if (!interestingRoles.has(role) && childNodes.length === 0) return null;

          const node: AXNode = { role };
          if (name) node.name = name;
          if (childNodes.length > 0) node.children = childNodes;
          return node;
        }

        const root = buildNode(document.body, 0);
        const text = JSON.stringify(root, null, 2);
        return text.length <= 4000 ? text : text.slice(0, 3997) + '...';
      });

      return snapshot;
    } catch {
      return '';
    }
  }

  // -------------------------------------------------------------------------
  // Private: run all pattern detectors and collect DetectedPattern[]
  // -------------------------------------------------------------------------
  private async _detectAllPatterns(): Promise<DetectedPattern[]> {
    const patterns: DetectedPattern[] = [];

    // Pagination
    const pagination = await this.patternDetector.detectPagination();
    if (pagination.found && pagination.selector) {
      patterns.push({
        type: 'pagination',
        selector: pagination.selector,
        confidence: pagination.confidence,
      });
    }

    // Search
    const search = await this.patternDetector.detectSearch();
    if (search.found && search.inputSelector) {
      patterns.push({
        type: 'search',
        selector: search.inputSelector,
        confidence: 85,
      });
    }

    // Data structures (lists, tables, card grids)
    const structures = await this.patternDetector.detectDataStructures();
    for (const structure of structures) {
      patterns.push({
        type: structure.type,
        selector: structure.containerSelector,
        itemCount: structure.itemCount,
        confidence: 75,
      });
    }

    // Login form
    const hasLoginForm = await this.page.evaluate((): boolean => {
      return (
        document.querySelectorAll('input[type="password"]').length > 0 &&
        document.querySelectorAll('input[type="text"], input[type="email"]').length > 0
      );
    });
    if (hasLoginForm) {
      const formSelector = await this.page.evaluate((): string => {
        const form = document.querySelector('form:has(input[type="password"])');
        if (form) {
          if (form.id) return `#${CSS.escape(form.id)}`;
          const cls = Array.from(form.classList)
            .filter((c) => /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(c))
            .slice(0, 2)
            .join('.');
          return cls ? `form.${cls}` : 'form';
        }
        return 'form';
      });
      patterns.push({
        type: 'login_form',
        selector: formSelector,
        confidence: 90,
      });
    }

    return patterns;
  }
}
