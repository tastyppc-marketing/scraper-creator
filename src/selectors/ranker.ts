import type { Page } from 'playwright';
import { robustnessScores } from './strategies.js';

export interface SelectorResult {
  css: string;
  xpath: string;
  text: string | null;
  aria: string | null;
  testId: string | null;
  id: string | null;
  robustnessScore: number;
  method: string;
}

// ---------------------------------------------------------------------------
// Penalty / bonus helpers
// ---------------------------------------------------------------------------

/** Count the number of selector parts separated by combinators or whitespace. */
function selectorPartCount(selector: string): number {
  return selector.split(/\s*[>~+]\s*|\s+/).filter(Boolean).length;
}

/** Return true if the selector contains an nth-child pseudo-class. */
function hasNthChild(selector: string): boolean {
  return /:nth-child\(/i.test(selector);
}

/**
 * Heuristic: class names that look machine-generated.
 * Patterns: 6+ hex chars, 3+ consecutive digits, BEM double-underscore (__), etc.
 */
function hasDynamicClass(selector: string): boolean {
  return /[a-f0-9]{6,}|[0-9]{3,}|__[a-zA-Z]|_[0-9]/.test(selector);
}

/** Count combinator depth (> ~ + or whitespace combinator). */
function nestingDepth(selector: string): number {
  return (selector.match(/\s*[>~+]\s*|\s+/g) ?? []).length;
}

// ---------------------------------------------------------------------------
// Internal scoring of a raw selector string
// ---------------------------------------------------------------------------
function scoreString(raw: string, baseScore: number): number {
  let score = baseScore;

  // Bonus for short selectors (≤ 2 parts)
  const parts = selectorPartCount(raw);
  if (parts <= 2) score += 10;

  // Penalty for nth-child usage
  if (hasNthChild(raw)) score -= 15;

  // Penalty for dynamic-looking class names
  if (hasDynamicClass(raw)) score -= 20;

  // Penalty for deep nesting
  const depth = nestingDepth(raw);
  if (depth > 3) score -= (depth - 3) * 5;

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// SelectorRanker
// ---------------------------------------------------------------------------
export class SelectorRanker {
  /**
   * Return a copy of the provided array sorted best-first by robustnessScore.
   */
  rank(selectors: SelectorResult[]): SelectorResult[] {
    return [...selectors].sort((a, b) => b.robustnessScore - a.robustnessScore);
  }

  /**
   * Pick the single best selector string for a given use case.
   *
   * - scraping  → prefer stable identifiers (testId > id > aria > css)
   * - clicking  → prefer aria (accessible) > testId > id > css
   * - waiting   → prefer id > testId > css (shortest path wins)
   */
  bestFor(
    selectors: SelectorResult[],
    useCase: 'scraping' | 'clicking' | 'waiting'
  ): string {
    const ranked = this.rank(selectors);
    const best = ranked[0];
    if (!best) return '';

    if (useCase === 'clicking') {
      // For clicking, accessible selectors reduce flakiness
      if (best.aria) return best.aria;
      if (best.testId) return best.testId;
      if (best.id) return best.id;
      return best.css;
    }

    if (useCase === 'waiting') {
      // Prefer the shortest unique selector for wait stability
      if (best.id) return best.id;
      if (best.testId) return best.testId;
      if (best.css && selectorPartCount(best.css) <= 2) return best.css;
      return best.css || best.xpath;
    }

    // scraping — default priority
    if (best.testId) return best.testId;
    if (best.id) return best.id;
    if (best.aria) return best.aria;
    return best.css;
  }

  /**
   * Compute a robustness score for an arbitrary selector string by:
   * 1. Verifying the selector resolves on the current page.
   * 2. Applying structural heuristics.
   */
  async score(selector: string, page: Page): Promise<number> {
    // Determine base score from strategy type
    let baseScore = robustnessScores.cssPath; // default

    if (selector.startsWith('#')) {
      baseScore = robustnessScores.id;
    } else if (selector.startsWith('[data-testid') || selector.startsWith('[data-test') || selector.startsWith('[data-cy')) {
      baseScore = robustnessScores.testId;
    } else if (selector.startsWith('[aria-label') || selector.startsWith('[role')) {
      baseScore = robustnessScores.aria;
    } else if (selector.startsWith('//') || selector.startsWith('//*')) {
      baseScore = robustnessScores.xpath;
    }

    // Verify it resolves
    const matchCount = await page.evaluate((sel: string) => {
      try {
        return document.querySelectorAll(sel).length;
      } catch {
        return 0;
      }
    }, selector);

    if (matchCount === 0) return 0;

    let computed = scoreString(selector, baseScore);

    // Extra bonus when the selector is perfectly unique
    if (matchCount === 1) computed = Math.min(100, computed + 5);

    return computed;
  }

  /**
   * Build a SelectorResult from raw browser-extracted data and compute the
   * overall robustnessScore that represents the best available selector.
   */
  buildResult(raw: {
    css: string;
    xpath: string;
    text: string | null;
    aria: string | null;
    testId: string | null;
    id: string | null;
    nthChild: string | null;
  }): SelectorResult {
    // Determine which strategy produced the best selector and what score it earns
    let method = 'cssPath';
    let baseScore = robustnessScores.cssPath;

    if (raw.testId) {
      method = 'testId';
      baseScore = robustnessScores.testId;
    } else if (raw.id) {
      method = 'id';
      baseScore = robustnessScores.id;
    } else if (raw.aria) {
      method = 'aria';
      baseScore = robustnessScores.aria;
    } else if (raw.text) {
      method = 'text';
      baseScore = robustnessScores.text;
    } else if (raw.css) {
      method = 'cssPath';
      baseScore = robustnessScores.cssPath;
    } else {
      method = 'xpath';
      baseScore = robustnessScores.xpath;
    }

    // Apply structural bonuses/penalties to the best available CSS string
    const evalTarget = raw.css || raw.id || raw.testId || raw.aria || '';
    const robustnessScore = evalTarget ? scoreString(evalTarget, baseScore) : baseScore;

    return {
      css: raw.css,
      xpath: raw.xpath,
      text: raw.text,
      aria: raw.aria,
      testId: raw.testId,
      id: raw.id,
      robustnessScore,
      method,
    };
  }
}
