// Selector generation strategies.
// The functions in `selectorStrategies` are serialized and executed inside the
// browser via page.evaluate(), so they must be self-contained and must not
// close over any Node.js module references.

export interface StrategyResult {
  value: string | null;
  strategy: string;
}

// ---------------------------------------------------------------------------
// Individual strategy functions
// Each receives a single Element and returns a CSS selector string or null.
// ---------------------------------------------------------------------------

export type StrategyFn = (el: Element) => string | null;

// Helpers that are embedded alongside strategy functions when passed to the browser.
const HELPERS_SRC = `
function escapeAttr(v) {
  return v.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
}

function isCssSafe(cls) {
  return /^[a-zA-Z_\\-][a-zA-Z0-9_\\-]*$/.test(cls);
}

function isUnique(sel) {
  try { return document.querySelectorAll(sel).length === 1; } catch { return false; }
}

function selectorDepth(sel) {
  return sel.split(/\\s*[>~+]\\s*|\\s+/).length;
}

function isDynamic(cls) {
  // Heuristic: generated class names often contain hashes or look like "sc-abc123"
  return /[0-9]{3,}|[a-f0-9]{6,}|__[a-zA-Z]|_[0-9]/.test(cls);
}
`;

// ---------------------------------------------------------------------------
// byId
// ---------------------------------------------------------------------------
export function byId(el: Element): string | null {
  if (!el.id) return null;
  try {
    return `#${CSS.escape(el.id)}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// byTestId
// ---------------------------------------------------------------------------
export function byTestId(el: Element): string | null {
  const testId =
    el.getAttribute('data-testid') ||
    el.getAttribute('data-test') ||
    el.getAttribute('data-cy');
  if (!testId) return null;
  return `[data-testid="${testId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

// ---------------------------------------------------------------------------
// byAria
// ---------------------------------------------------------------------------
export function byAria(el: Element): string | null {
  const role = el.getAttribute('role');
  const label = el.getAttribute('aria-label');
  if (role && label) {
    const r = role.replace(/"/g, '\\"');
    const l = label.replace(/"/g, '\\"');
    return `[role="${r}"][aria-label="${l}"]`;
  }
  if (label) return `[aria-label="${label.replace(/"/g, '\\"')}"]`;
  if (role) return `[role="${role.replace(/"/g, '\\"')}"]`;
  return null;
}

// ---------------------------------------------------------------------------
// byCssPath  (runs IN browser — plain JS, no CSS.escape dependency)
// ---------------------------------------------------------------------------
export const byCssPathSrc = `
(function byCssPath(el) {
  ${HELPERS_SRC}

  function segmentFor(node) {
    if (node.id) {
      try { return '#' + CSS.escape(node.id); } catch { /* fall through */ }
    }

    const tag = node.tagName.toLowerCase();
    const stableClasses = Array.from(node.classList)
      .filter(c => isCssSafe(c) && !isDynamic(c));

    if (stableClasses.length > 0) {
      return tag + '.' + stableClasses.slice(0, 2).join('.');
    }

    // nth-child fallback within this function
    const parent = node.parentElement;
    if (!parent) return tag;
    const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
    if (siblings.length === 1) return tag;
    const idx = siblings.indexOf(node) + 1;
    return tag + ':nth-child(' + idx + ')';
  }

  const parts = [];
  let current = el;
  const MAX_DEPTH = 5;

  while (current && current !== document.body && parts.length < MAX_DEPTH) {
    const seg = segmentFor(current);
    parts.unshift(seg);
    const candidate = parts.join(' > ');
    if (isUnique(candidate)) return candidate;
    if (current.id) break; // id segment already unique-ish, stop climbing
    current = current.parentElement;
  }

  const full = parts.join(' > ');
  return full || null;
})
`;

// ---------------------------------------------------------------------------
// byXPath  (runs IN browser)
// ---------------------------------------------------------------------------
export const byXPathSrc = `
(function byXPath(el) {
  function getXPath(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.id) return '//*[@id="' + node.id.replace(/"/g, '\\"') + '"]';

    const parent = node.parentElement;
    if (!parent) return '/' + node.tagName.toLowerCase();

    const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
    const idx = siblings.indexOf(node) + 1;
    const position = siblings.length > 1 ? '[' + idx + ']' : '';
    return getXPath(parent) + '/' + node.tagName.toLowerCase() + position;
  }
  return getXPath(el);
})
`;

// ---------------------------------------------------------------------------
// byText  (runs IN browser)
// ---------------------------------------------------------------------------
export const byTextSrc = `
(function byText(el) {
  const text = el.textContent ? el.textContent.trim() : '';
  if (!text || text.length > 50 || text.length === 0) return null;

  // Check uniqueness across the page
  const all = document.querySelectorAll(el.tagName.toLowerCase());
  const matches = Array.from(all).filter(e => e.textContent && e.textContent.trim() === text);
  if (matches.length === 1) return text;
  return null;
})
`;

// ---------------------------------------------------------------------------
// byNthChild  (runs IN browser — most specific, least robust)
// ---------------------------------------------------------------------------
export const byNthChildSrc = `
(function byNthChild(el) {
  const parts = [];
  let current = el;

  while (current && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) { parts.unshift(tag); break; }
    const siblings = Array.from(parent.children);
    const idx = siblings.indexOf(current) + 1;
    parts.unshift(tag + ':nth-child(' + idx + ')');
    current = parent;
  }

  return parts.join(' > ') || null;
})
`;

// ---------------------------------------------------------------------------
// Full in-browser evaluation function
// Returns all selector candidates for a given element.
// ---------------------------------------------------------------------------
export const ALL_SELECTORS_SRC = `
(function getAllSelectors(el) {
  ${HELPERS_SRC}

  // --- byId ---
  function runById(el) {
    if (!el.id) return null;
    try { return '#' + CSS.escape(el.id); } catch { return null; }
  }

  // --- byTestId ---
  function runByTestId(el) {
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
    if (!testId) return null;
    return '[data-testid="' + escapeAttr(testId) + '"]';
  }

  // --- byAria ---
  function runByAria(el) {
    const role = el.getAttribute('role');
    const label = el.getAttribute('aria-label');
    if (role && label) return '[role="' + escapeAttr(role) + '"][aria-label="' + escapeAttr(label) + '"]';
    if (label) return '[aria-label="' + escapeAttr(label) + '"]';
    if (role) return '[role="' + escapeAttr(role) + '"]';
    return null;
  }

  // --- byCssPath ---
  function segmentFor(node) {
    if (node.id) {
      try { return '#' + CSS.escape(node.id); } catch { /* fall through */ }
    }
    const tag = node.tagName.toLowerCase();
    const stableClasses = Array.from(node.classList).filter(c => isCssSafe(c) && !isDynamic(c));
    if (stableClasses.length > 0) {
      return tag + '.' + stableClasses.slice(0, 2).join('.');
    }
    const parent = node.parentElement;
    if (!parent) return tag;
    const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
    if (siblings.length === 1) return tag;
    const idx = siblings.indexOf(node) + 1;
    return tag + ':nth-child(' + idx + ')';
  }

  function runByCssPath(el) {
    const parts = [];
    let current = el;
    const MAX_DEPTH = 5;
    while (current && current !== document.body && parts.length < MAX_DEPTH) {
      const seg = segmentFor(current);
      parts.unshift(seg);
      const candidate = parts.join(' > ');
      if (isUnique(candidate)) return candidate;
      if (current.id) break;
      current = current.parentElement;
    }
    const full = parts.join(' > ');
    return full || null;
  }

  // --- byXPath ---
  function getXPath(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.id) return '//*[@id="' + node.id.replace(/"/g, '\\\\"') + '"]';
    const parent = node.parentElement;
    if (!parent) return '/' + node.tagName.toLowerCase();
    const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
    const idx = siblings.indexOf(node) + 1;
    const position = siblings.length > 1 ? '[' + idx + ']' : '';
    return getXPath(parent) + '/' + node.tagName.toLowerCase() + position;
  }

  // --- byText ---
  function runByText(el) {
    const text = el.textContent ? el.textContent.trim() : '';
    if (!text || text.length > 50) return null;
    const all = document.querySelectorAll(el.tagName.toLowerCase());
    const matches = Array.from(all).filter(e => e.textContent && e.textContent.trim() === text);
    if (matches.length === 1) return text;
    return null;
  }

  // --- byNthChild ---
  function runByNthChild(el) {
    const parts = [];
    let current = el;
    while (current && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) { parts.unshift(tag); break; }
      const siblings = Array.from(parent.children);
      const idx = siblings.indexOf(current) + 1;
      parts.unshift(tag + ':nth-child(' + idx + ')');
      current = parent;
    }
    return parts.join(' > ') || null;
  }

  // --- ElementInfo ---
  const rect = el.getBoundingClientRect();
  const allAttrs = {};
  for (const attr of el.attributes) {
    allAttrs[attr.name] = attr.value;
  }

  const parentEl = el.parentElement;
  const isInList = !!(
    parentEl &&
    (parentEl.tagName === 'UL' || parentEl.tagName === 'OL' ||
     parentEl.tagName === 'TBODY' || el.tagName === 'TR' || el.tagName === 'LI')
  );

  const elementInfo = {
    tagName: el.tagName.toLowerCase(),
    id: el.id || null,
    classes: Array.from(el.classList),
    text: (el.textContent || '').trim().slice(0, 200),
    href: el.getAttribute('href'),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    attributes: allAttrs,
    childCount: el.children.length,
    isInList,
    parentTagName: parentEl ? parentEl.tagName.toLowerCase() : null,
  };

  const css = runByCssPath(el) || '';
  const xpath = getXPath(el);

  return {
    element: elementInfo,
    testId: runByTestId(el),
    id: runById(el),
    aria: runByAria(el),
    css,
    xpath,
    text: runByText(el),
    nthChild: runByNthChild(el),
  };
})
`;

// ---------------------------------------------------------------------------
// Robustness scores
// ---------------------------------------------------------------------------
export const robustnessScores: Record<string, number> = {
  testId: 100,
  id: 90,
  aria: 85,
  cssPath: 70,
  text: 60,
  xpath: 55,
  nthChild: 40,
};

// Re-export individual node-side strategy functions for use in tests/ranker
export const selectorStrategies = {
  byId,
  byTestId,
  byAria,
};
