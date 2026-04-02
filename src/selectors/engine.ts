import type { Page } from 'playwright';
import { ALL_SELECTORS_SRC } from './strategies.js';
import { SelectorRanker, SelectorResult } from './ranker.js';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ElementInfo {
  tagName: string;
  id: string | null;
  classes: string[];
  text: string;
  href: string | null;
  rect: { x: number; y: number; width: number; height: number };
  attributes: Record<string, string>;
  childCount: number;
  isInList: boolean;
  parentTagName: string | null;
}

export type { SelectorResult };

export interface CaptureResult {
  element: ElementInfo;
  selectors: SelectorResult;
}

// ---------------------------------------------------------------------------
// Internal shape returned by ALL_SELECTORS_SRC
// ---------------------------------------------------------------------------
interface RawBrowserResult {
  element: ElementInfo;
  testId: string | null;
  id: string | null;
  aria: string | null;
  css: string;
  xpath: string;
  text: string | null;
  nthChild: string | null;
}

// ---------------------------------------------------------------------------
// SelectorEngine
// ---------------------------------------------------------------------------

export class SelectorEngine {
  private readonly ranker: SelectorRanker;

  constructor(private readonly page: Page) {
    this.ranker = new SelectorRanker();
  }

  // -------------------------------------------------------------------------
  // findElements
  // Find elements matching a free-text description and return ranked selectors
  // for each match.
  // -------------------------------------------------------------------------
  async findElements(
    description: string,
    maxResults = 10
  ): Promise<CaptureResult[]> {
    const results: CaptureResult[] = [];

    // Strategy 1 — getByText (exact then partial)
    try {
      const textLocator = this.page.getByText(description, { exact: false });
      const count = await textLocator.count();
      for (let i = 0; i < Math.min(count, maxResults); i++) {
        const locator = textLocator.nth(i);
        const capture = await this._captureLocator(locator);
        if (capture) results.push(capture);
      }
    } catch {
      // locator may throw on certain descriptions — continue
    }

    if (results.length >= maxResults) return results.slice(0, maxResults);

    // Strategy 2 — getByRole
    const ROLES = [
      'button', 'link', 'textbox', 'checkbox', 'radio',
      'combobox', 'listitem', 'menuitem', 'tab', 'heading',
    ] as const;

    for (const role of ROLES) {
      if (results.length >= maxResults) break;
      try {
        const roleLocator = this.page.getByRole(role, {
          name: description,
          exact: false,
        });
        const count = await roleLocator.count();
        for (let i = 0; i < Math.min(count, maxResults - results.length); i++) {
          const capture = await this._captureLocator(roleLocator.nth(i));
          if (capture && !this._isDuplicate(results, capture)) {
            results.push(capture);
          }
        }
      } catch {
        // role may not exist on page
      }
    }

    if (results.length >= maxResults) return results.slice(0, maxResults);

    // Strategy 3 — CSS attribute / aria-label contains description
    const attributeSelectors = [
      `[aria-label*="${description}" i]`,
      `[placeholder*="${description}" i]`,
      `[title*="${description}" i]`,
      `[name*="${description}" i]`,
    ];

    for (const sel of attributeSelectors) {
      if (results.length >= maxResults) break;
      try {
        const elements = this.page.locator(sel);
        const count = await elements.count();
        for (let i = 0; i < Math.min(count, maxResults - results.length); i++) {
          const capture = await this._captureLocator(elements.nth(i));
          if (capture && !this._isDuplicate(results, capture)) {
            results.push(capture);
          }
        }
      } catch {
        // invalid selector for this description string
      }
    }

    return results.slice(0, maxResults);
  }

  // -------------------------------------------------------------------------
  // captureAtPoint
  // Capture selectors for the topmost element at a viewport coordinate.
  // -------------------------------------------------------------------------
  async captureAtPoint(x: number, y: number): Promise<CaptureResult | null> {
    const raw = await this.page.evaluate(
      ([evalSrc, px, py]: [string, number, number]) => {
        const fn = eval(evalSrc) as (el: Element) => RawBrowserResult | null; // eslint-disable-line no-eval
        const el = document.elementFromPoint(px, py);
        if (!el) return null;
        return fn(el);
      },
      [ALL_SELECTORS_SRC, x, y] as [string, number, number]
    );

    return raw ? this._buildCapture(raw) : null;
  }

  // -------------------------------------------------------------------------
  // captureBySelector
  // Generate selectors for the first element matching a CSS selector string.
  // -------------------------------------------------------------------------
  async captureBySelector(selector: string): Promise<CaptureResult | null> {
    const raw = await this.page.evaluate(
      ([evalSrc, sel]: [string, string]) => {
        const fn = eval(evalSrc) as (el: Element) => RawBrowserResult | null; // eslint-disable-line no-eval
        const el = document.querySelector(sel);
        if (!el) return null;
        return fn(el);
      },
      [ALL_SELECTORS_SRC, selector] as [string, string]
    );

    return raw ? this._buildCapture(raw) : null;
  }

  // -------------------------------------------------------------------------
  // validateSelector
  // Check whether a selector resolves on the current page and how many
  // elements it matches.
  // -------------------------------------------------------------------------
  async validateSelector(selector: string): Promise<{
    valid: boolean;
    matchCount: number;
  }> {
    const matchCount = await this.page.evaluate((sel: string) => {
      try {
        return document.querySelectorAll(sel).length;
      } catch {
        return -1;
      }
    }, selector);

    return {
      valid: matchCount > 0,
      matchCount: Math.max(0, matchCount),
    };
  }

  // -------------------------------------------------------------------------
  // findSimilarElements
  // Return ElementInfo for all elements that share the same tag + class
  // structure as the element identified by the given selector.
  // -------------------------------------------------------------------------
  async findSimilarElements(selector: string): Promise<ElementInfo[]> {
    const results = await this.page.evaluate(
      ([evalSrc, sel]: [string, string]) => {
        const fn = eval(evalSrc) as (el: Element) => RawBrowserResult | null; // eslint-disable-line no-eval

        const anchor = document.querySelector(sel);
        if (!anchor) return [];

        const tag = anchor.tagName;
        const anchorClasses = Array.from(anchor.classList).sort().join(' ');

        // Collect candidates: same tag, same class signature
        const candidates = Array.from(document.querySelectorAll(tag));
        const similar = candidates.filter((c) => {
          if (c === anchor) return true;
          const cClasses = Array.from(c.classList).sort().join(' ');
          return cClasses === anchorClasses;
        });

        return similar.map((el) => {
          const raw = fn(el);
          return raw ? raw.element : null;
        }).filter(Boolean);
      },
      [ALL_SELECTORS_SRC, selector] as [string, string]
    );

    return results as ElementInfo[];
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async _captureLocator(
    locator: ReturnType<Page['locator']>
  ): Promise<CaptureResult | null> {
    try {
      const raw = await locator.evaluate(
        (el: Element, evalSrc: string) => {
          const fn = eval(evalSrc) as (el: Element) => RawBrowserResult | null; // eslint-disable-line no-eval
          return fn(el);
        },
        ALL_SELECTORS_SRC
      );
      return raw ? this._buildCapture(raw as unknown as RawBrowserResult) : null;
    } catch {
      return null;
    }
  }

  private _buildCapture(raw: RawBrowserResult): CaptureResult {
    const selectors = this.ranker.buildResult({
      css: raw.css,
      xpath: raw.xpath,
      text: raw.text,
      aria: raw.aria,
      testId: raw.testId,
      id: raw.id,
      nthChild: raw.nthChild,
    });

    return { element: raw.element, selectors };
  }

  private _isDuplicate(existing: CaptureResult[], candidate: CaptureResult): boolean {
    return existing.some(
      (r) =>
        r.selectors.css === candidate.selectors.css &&
        r.element.rect.x === candidate.element.rect.x &&
        r.element.rect.y === candidate.element.rect.y
    );
  }
}
