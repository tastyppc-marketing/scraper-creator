/**
 * selector.js
 *
 * Advanced, multi-strategy selector generation for the Scraper Creator tool.
 *
 * Injected into browser pages.  Requires highlighter.js to have been injected
 * first (so window.__scraperCreator exists), but also works standalone.
 *
 * Exposes:
 *   window.__scraperCreator.generateSelectors(element) → SelectorResult
 */

(function () {
  'use strict';

  if (!window.__scraperCreator) {
    window.__scraperCreator = {};
  }

  const SC = window.__scraperCreator;

  // ── CSS.escape polyfill (in case UA doesn't have it) ──────────────────────
  const cssEscape =
    typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape.bind(CSS)
      : function (value) {
          return value.replace(/[^\w-]/g, '\\$&');
        };

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Return true if `sel` matches exactly one element in the document. */
  function isUnique(sel) {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  }

  /** Return true if `sel` matches `el` and only `el`. */
  function matchesUniquely(el, sel) {
    try {
      const hits = document.querySelectorAll(sel);
      return hits.length === 1 && hits[0] === el;
    } catch {
      return false;
    }
  }

  // ── ID selector ───────────────────────────────────────────────────────────

  function getIdSelector(el) {
    if (!el.id) return null;
    const sel = `#${cssEscape(el.id)}`;
    return isUnique(sel) ? sel : null;
  }

  // ── data-testid selector ──────────────────────────────────────────────────

  function getTestIdSelector(el) {
    const testId = el.getAttribute('data-testid');
    if (!testId) return null;
    const sel = `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
    return isUnique(sel) ? sel : null;
  }

  // ── ARIA selector ─────────────────────────────────────────────────────────

  function getAriaSelector(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      const sel = `[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;
      if (matchesUniquely(el, sel)) return sel;
    }

    const role = el.getAttribute('role');
    if (role) {
      const ariaLabelledBy = el.getAttribute('aria-labelledby');
      if (ariaLabelledBy) {
        const sel = `[role="${role}"][aria-labelledby="${ariaLabelledBy}"]`;
        if (matchesUniquely(el, sel)) return sel;
      }
      const sel = `[role="${role}"]`;
      if (matchesUniquely(el, sel)) return sel;
    }

    return null;
  }

  // ── Text-based selector (Playwright :has-text) ────────────────────────────

  function getTextSelector(el) {
    const text = (el.textContent || '').trim();
    if (!text || text.length > 100) return null;
    // Use exact match with trimmed text
    const escaped = text.replace(/"/g, '\\"');
    return `:has-text("${escaped}")`;
    // Note: this is Playwright syntax, not valid CSS — callers should be aware.
  }

  // ── CSS selector (shortest unique path) ──────────────────────────────────

  /**
   * Attempt to find the shortest unique CSS selector for `el`, working from
   * the element outward. Strategy mirrors @medv/finder:
   * 1. Try just the element's own attributes/classes.
   * 2. Build a path segment by segment toward the root, stopping as soon as
   *    the accumulated selector is unique in the document.
   */
  function getCssSelector(el) {
    // Fast path — id
    const idSel = getIdSelector(el);
    if (idSel) return idSel;

    // Build segments from el to root
    const segments = [];
    let current = el;

    while (current && current !== document.documentElement) {
      segments.unshift(buildSegment(current));
      current = current.parentElement;

      const candidate = segments.join(' > ');
      if (matchesUniquely(el, candidate)) return candidate;
    }

    // Fallback: full path
    return segments.join(' > ');
  }

  /**
   * Build a single CSS segment for an element, preferring class-based over
   * nth-child for readability.
   */
  function buildSegment(el) {
    const tag = el.tagName.toLowerCase();

    if (el.id) return `#${cssEscape(el.id)}`;

    // Try tag + meaningful classes
    const classes = Array.from(el.classList)
      .filter(c => /^[a-zA-Z_-]/.test(c) && c.length < 40)
      .slice(0, 4);

    if (classes.length) {
      const classSel = tag + classes.map(c => `.${cssEscape(c)}`).join('');
      // Only use classes if they would help narrow things down
      if (
        document.querySelectorAll(classSel).length <
        document.querySelectorAll(tag).length
      ) {
        return classSel;
      }
    }

    // Attribute hints
    for (const attr of ['name', 'type', 'placeholder', 'href']) {
      const val = el.getAttribute(attr);
      if (val && val.length < 60) {
        const attrSel = `${tag}[${attr}="${val.replace(/"/g, '\\"')}"]`;
        if (document.querySelectorAll(attrSel).length < 5) return attrSel;
      }
    }

    // nth-of-type fallback
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        s => s.tagName === el.tagName
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(el) + 1;
        return `${tag}:nth-of-type(${idx})`;
      }
    }

    return tag;
  }

  // ── nth-child selector (most specific / most fragile) ─────────────────────

  function getNthChildSelector(el) {
    const parts = [];
    let current = el;

    while (current && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;

      if (!parent) {
        parts.unshift(tag);
        break;
      }

      const siblings = Array.from(parent.children);
      const idx = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}:nth-child(${idx})`);
      current = parent;
    }

    return parts.join(' > ');
  }

  // ── XPath selector ────────────────────────────────────────────────────────

  function getXPath(el) {
    if (el.id) return `//*[@id="${el.id}"]`;

    const parts = [];
    let current = el;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      if (current.id) {
        parts.unshift(`//*[@id="${current.id}"]`);
        break;
      }

      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;

      if (parent) {
        const sameTagSiblings = Array.from(parent.children).filter(
          s => s.tagName === current.tagName
        );

        if (sameTagSiblings.length > 1) {
          const idx = sameTagSiblings.indexOf(current) + 1;
          parts.unshift(`${tag}[${idx}]`);
        } else {
          parts.unshift(tag);
        }
      } else {
        parts.unshift(tag);
      }

      current = current.parentElement;
    }

    // If we broke out with an id anchor, parts[0] is already absolute
    if (parts[0] && parts[0].startsWith('//*[@id')) {
      return parts.length === 1
        ? parts[0]
        : parts[0] + '/' + parts.slice(1).join('/');
    }

    return '//' + parts.join('/');
  }

  // ── Robustness scoring ────────────────────────────────────────────────────

  /**
   * Assign a 0-100 robustness score to a set of selectors.
   * Higher = more likely to survive page updates.
   */
  function scoreRobustness(selectors) {
    if (selectors.testId) return 100;
    if (selectors.id) return 95;
    if (selectors.aria) return 85;
    if (selectors.text) return 60;
    // CSS: penalise if it contains many nth-child segments
    if (selectors.css) {
      const nthCount = (selectors.css.match(/nth/g) || []).length;
      return Math.max(70 - nthCount * 15, 30);
    }
    if (selectors.nthChild) return 40;
    return 20;
  }

  // ── Main public function ──────────────────────────────────────────────────

  /**
   * Generate a comprehensive set of selectors for the given element.
   *
   * @param {Element} element
   * @returns {{
   *   id: string|null,
   *   testId: string|null,
   *   css: string,
   *   xpath: string,
   *   aria: string|null,
   *   text: string|null,
   *   nthChild: string,
   *   robustness: number
   * }}
   */
  SC.generateSelectors = function (element) {
    if (!element || !(element instanceof Element)) {
      throw new TypeError('generateSelectors: argument must be a DOM Element');
    }

    const id = getIdSelector(element);
    const testId = getTestIdSelector(element);
    const aria = getAriaSelector(element);
    const css = getCssSelector(element);
    const xpath = getXPath(element);
    const text = getTextSelector(element);
    const nthChild = getNthChildSelector(element);

    const result = { id, testId, css, xpath, aria, text, nthChild, robustness: 0 };
    result.robustness = scoreRobustness(result);
    return result;
  };

  // Re-export individual helpers for use by other inject scripts
  SC._buildCssSelector = getCssSelector;
  SC._buildXPath = getXPath;
})();
