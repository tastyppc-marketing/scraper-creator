/**
 * highlighter.js
 *
 * Injected into browser pages to provide visual element highlighting and
 * element introspection for the Scraper Creator tool.
 *
 * Exposes:
 *   window.__scraperCreator.getElementInfo(x, y)
 *   window.__scraperCreator.getAllSelectors(element)
 *   window.__scraperCreator.enableHighlighting()
 *   window.__scraperCreator.disableHighlighting()
 */

(function () {
  'use strict';

  // ── Namespace setup ──────────────────────────────────────────────────────
  if (!window.__scraperCreator) {
    window.__scraperCreator = {};
  }

  const SC = window.__scraperCreator;

  // ── Constants ────────────────────────────────────────────────────────────
  const HIGHLIGHT_COLOR = 'rgba(59, 130, 246, 0.20)'; // #3b82f6 @ 20 %
  const BORDER_COLOR = 'rgba(59, 130, 246, 0.85)';
  const TOOLTIP_BG = 'rgba(17, 24, 39, 0.92)';
  const TOOLTIP_TEXT = '#f9fafb';
  const OVERLAY_Z = '2147483647'; // max z-index

  // ── Internal state ───────────────────────────────────────────────────────
  let overlayEl = null;
  let tooltipEl = null;
  let isHighlightingEnabled = false;
  let lastTarget = null;

  // ── Overlay element ──────────────────────────────────────────────────────
  function createOverlay() {
    const el = document.createElement('div');
    el.id = '__sc-highlight-overlay';
    el.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'box-sizing:border-box',
      `background:${HIGHLIGHT_COLOR}`,
      `border:2px solid ${BORDER_COLOR}`,
      `border-radius:3px`,
      `z-index:${OVERLAY_Z}`,
      'display:none',
      'transition:none',
    ].join(';');
    document.body.appendChild(el);
    return el;
  }

  // ── Tooltip element ──────────────────────────────────────────────────────
  function createTooltip() {
    const el = document.createElement('div');
    el.id = '__sc-highlight-tooltip';
    el.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'box-sizing:border-box',
      `background:${TOOLTIP_BG}`,
      `color:${TOOLTIP_TEXT}`,
      'font:12px/1.4 "SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace',
      'padding:6px 8px',
      'border-radius:4px',
      `z-index:${OVERLAY_Z}`,
      'display:none',
      'max-width:320px',
      'word-break:break-all',
      'white-space:pre-wrap',
      'box-shadow:0 2px 8px rgba(0,0,0,0.4)',
    ].join(';');
    document.body.appendChild(el);
    return el;
  }

  // ── Position the overlay over a DOM rect ─────────────────────────────────
  function positionOverlay(rect) {
    overlayEl.style.left = rect.left + 'px';
    overlayEl.style.top = rect.top + 'px';
    overlayEl.style.width = rect.width + 'px';
    overlayEl.style.height = rect.height + 'px';
    overlayEl.style.display = 'block';
  }

  // ── Position the tooltip near the cursor ─────────────────────────────────
  function positionTooltip(x, y, content) {
    tooltipEl.textContent = content;
    tooltipEl.style.display = 'block';

    const tipW = tooltipEl.offsetWidth;
    const tipH = tooltipEl.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer bottom-right of cursor; flip if near edge
    let left = x + 14;
    let top = y + 14;

    if (left + tipW > vw - 8) left = x - tipW - 14;
    if (top + tipH > vh - 8) top = y - tipH - 14;

    tooltipEl.style.left = Math.max(4, left) + 'px';
    tooltipEl.style.top = Math.max(4, top) + 'px';
  }

  // ── Build tooltip text from element info ─────────────────────────────────
  function buildTooltipText(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const classes = Array.from(el.classList).slice(0, 3).map(c => `.${c}`).join('');
    const text = (el.textContent || '').trim().slice(0, 60);
    const textPreview = text ? `"${text}${text.length === 60 ? '…' : ''}"` : '';
    const parts = [`<${tag}${id}${classes}>`];
    if (textPreview) parts.push(textPreview);
    return parts.join('\n');
  }

  // ── Mouse move handler ───────────────────────────────────────────────────
  function onMouseMove(e) {
    if (!isHighlightingEnabled) return;

    // Temporarily hide overlay so elementFromPoint works through it
    if (overlayEl) overlayEl.style.display = 'none';
    if (tooltipEl) tooltipEl.style.display = 'none';

    const el = document.elementFromPoint(e.clientX, e.clientY);

    if (!el || el === document.body || el === document.documentElement) {
      lastTarget = null;
      return;
    }

    lastTarget = el;

    const rect = el.getBoundingClientRect();
    positionOverlay(rect);
    positionTooltip(e.clientX, e.clientY, buildTooltipText(el));
  }

  // ── Mouse leave handler ──────────────────────────────────────────────────
  function onMouseLeave() {
    if (overlayEl) overlayEl.style.display = 'none';
    if (tooltipEl) tooltipEl.style.display = 'none';
    lastTarget = null;
  }

  // ── Selector helpers ─────────────────────────────────────────────────────

  /** Generate a CSS selector for an element (unique within document). */
  function buildCssSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;

    const parts = [];
    let current = el;

    while (current && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();

      if (current.id) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        break;
      }

      const classes = Array.from(current.classList)
        .filter(c => /^[a-zA-Z_-]/.test(c))
        .slice(0, 3);

      if (classes.length) {
        part += classes.map(c => `.${CSS.escape(c)}`).join('');
      }

      // Add nth-child if needed for uniqueness
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          s => s.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          part += `:nth-of-type(${idx})`;
        }
      }

      parts.unshift(part);
      current = current.parentElement;

      // Stop early if candidate is already unique
      const candidate = parts.join(' > ');
      try {
        if (document.querySelectorAll(candidate).length === 1) break;
      } catch {
        // invalid intermediate selector — continue building
      }
    }

    return parts.join(' > ');
  }

  /** Generate an XPath string for an element. */
  function buildXPath(el) {
    if (el.id) return `//*[@id="${el.id}"]`;

    const parts = [];
    let current = el;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const tag = current.tagName.toLowerCase();

      if (current.id) {
        parts.unshift(`//*[@id="${current.id}"]`);
        break;
      }

      const parent = current.parentElement;
      let index = 1;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          s => s.tagName === current.tagName
        );
        if (siblings.length > 1) {
          index = siblings.indexOf(current) + 1;
          parts.unshift(`${tag}[${index}]`);
        } else {
          parts.unshift(tag);
        }
      } else {
        parts.unshift(tag);
      }

      current = current.parentElement;
    }

    return '//' + parts.join('/');
  }

  /** Determine whether an element is inside a list of similar siblings. */
  function isInList(el) {
    const parent = el.parentElement;
    if (!parent) return false;
    const siblings = Array.from(parent.children).filter(
      s => s.tagName === el.tagName
    );
    return siblings.length > 2;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Returns rich information about the element at coordinates (x, y).
   */
  SC.getElementInfo = function (x, y) {
    // Hide overlay temporarily
    const prevOverlay = overlayEl ? overlayEl.style.display : 'none';
    if (overlayEl) overlayEl.style.display = 'none';

    const el = document.elementFromPoint(x, y);

    if (overlayEl) overlayEl.style.display = prevOverlay;

    if (!el) return null;

    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const id = el.id || null;
    const classes = Array.from(el.classList);
    const text = (el.textContent || '').trim().slice(0, 200);
    const href = el.getAttribute('href') || null;

    const parent = el.parentElement;
    const parentInfo = parent
      ? {
          tagName: parent.tagName.toLowerCase(),
          id: parent.id || null,
          classes: Array.from(parent.classList),
        }
      : null;

    const cssSelector = buildCssSelector(el);
    const xpath = buildXPath(el);
    const testId = el.getAttribute('data-testid') || null;
    const ariaLabel = el.getAttribute('aria-label') || null;

    return {
      tagName: tag,
      id,
      classes,
      text,
      href,
      rect: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      selector: {
        css: cssSelector,
        xpath,
        testId,
        ariaLabel,
      },
      parentInfo,
      childCount: el.children.length,
      isInList: isInList(el),
    };
  };

  /**
   * Returns all selector variants for a given element.
   */
  SC.getAllSelectors = function (element) {
    if (!element || !(element instanceof Element)) return null;

    const id = element.id ? `#${CSS.escape(element.id)}` : null;
    const testId = element.getAttribute('data-testid')
      ? `[data-testid="${element.getAttribute('data-testid')}"]`
      : null;
    const ariaLabel = element.getAttribute('aria-label')
      ? `[aria-label="${element.getAttribute('aria-label')}"]`
      : null;
    const role = element.getAttribute('role')
      ? `[role="${element.getAttribute('role')}"]`
      : null;
    const css = buildCssSelector(element);
    const xpath = buildXPath(element);
    const text = (element.textContent || '').trim().slice(0, 80);
    const textSelector = text ? `:has-text("${text.replace(/"/g, '\\"')}")` : null;

    return { id, testId, ariaLabel, role, css, xpath, textSelector };
  };

  /** Start highlighting elements under the mouse cursor. */
  SC.enableHighlighting = function () {
    if (isHighlightingEnabled) return;

    if (!overlayEl) overlayEl = createOverlay();
    if (!tooltipEl) tooltipEl = createTooltip();

    isHighlightingEnabled = true;
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseleave', onMouseLeave, true);
  };

  /** Stop highlighting and hide overlay/tooltip. */
  SC.disableHighlighting = function () {
    if (!isHighlightingEnabled) return;
    isHighlightingEnabled = false;
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseleave', onMouseLeave, true);
    if (overlayEl) overlayEl.style.display = 'none';
    if (tooltipEl) tooltipEl.style.display = 'none';
    lastTarget = null;
  };

  /** Returns the element currently under the highlight overlay. */
  SC.getLastHighlightedElement = function () {
    return lastTarget;
  };
})();
