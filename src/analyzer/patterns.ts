import type { Page } from 'playwright';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaginationResult {
  found: boolean;
  type?: 'next_button' | 'page_numbers' | 'infinite_scroll' | 'load_more';
  selector?: string;
  confidence: number;
}

export interface DataStructure {
  type: 'list' | 'table' | 'card_grid';
  containerSelector: string;
  itemSelector: string;
  itemCount: number;
  sampleFields: string[];
}

export interface SearchResult {
  found: boolean;
  inputSelector?: string;
  submitSelector?: string;
}

// ---------------------------------------------------------------------------
// PatternDetector
// ---------------------------------------------------------------------------

export class PatternDetector {
  constructor(private readonly page: Page) {}

  // -------------------------------------------------------------------------
  // detectPagination
  // -------------------------------------------------------------------------
  async detectPagination(): Promise<PaginationResult> {
    // Check each pagination style in priority order.

    // 1. Next button
    const nextButton = await this._detectNextButton();
    if (nextButton.found) return nextButton;

    // 2. Page number links
    const pageNumbers = await this._detectPageNumbers();
    if (pageNumbers.found) return pageNumbers;

    // 3. Load-more button
    const loadMore = await this._detectLoadMore();
    if (loadMore.found) return loadMore;

    // 4. Infinite scroll
    const infiniteScroll = await this._detectInfiniteScroll();
    if (infiniteScroll.found) return infiniteScroll;

    return { found: false, confidence: 0 };
  }

  // -------------------------------------------------------------------------
  // detectDataStructures
  // -------------------------------------------------------------------------
  async detectDataStructures(): Promise<DataStructure[]> {
    const structures = await this.page.evaluate((): Array<{
      type: 'list' | 'table' | 'card_grid';
      containerSelector: string;
      itemSelector: string;
      itemCount: number;
      sampleFields: string[];
    }> => {
      const results: Array<{
        type: 'list' | 'table' | 'card_grid';
        containerSelector: string;
        itemSelector: string;
        itemCount: number;
        sampleFields: string[];
      }> = [];

      // -----------------------------------------------------------------------
      // Helper: generate a simple CSS selector for an element
      // -----------------------------------------------------------------------
      function simpleSelector(el: Element): string {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const tag = el.tagName.toLowerCase();
        const cls = Array.from(el.classList)
          .filter((c) => /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(c) && !/[0-9]{3,}/.test(c))
          .slice(0, 2)
          .join('.');
        return cls ? `${tag}.${cls}` : tag;
      }

      // -----------------------------------------------------------------------
      // Helper: extract visible field labels from an element's children
      // -----------------------------------------------------------------------
      function sampleFields(container: Element): string[] {
        const fields: string[] = [];
        const labels = container.querySelectorAll('label, dt, th, [class*="label"], [class*="title"], [class*="name"]');
        for (const label of labels) {
          const text = label.textContent?.trim() ?? '';
          if (text && text.length < 40 && fields.length < 8) {
            fields.push(text);
          }
        }
        return [...new Set(fields)];
      }

      // -----------------------------------------------------------------------
      // Helper: assess structural similarity between two elements
      // -----------------------------------------------------------------------
      function structuralSignature(el: Element): string {
        const tag = el.tagName;
        const childTags = Array.from(el.children)
          .map((c) => c.tagName)
          .join(',');
        return `${tag}[${childTags}]`;
      }

      // -----------------------------------------------------------------------
      // Tables
      // -----------------------------------------------------------------------
      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const rows = table.querySelectorAll('tbody tr');
        if (rows.length < 2) continue;
        const headers = Array.from(table.querySelectorAll('thead th, thead td')).map(
          (th) => th.textContent?.trim() ?? ''
        ).filter(Boolean);
        results.push({
          type: 'table',
          containerSelector: simpleSelector(table),
          itemSelector: `${simpleSelector(table)} tbody tr`,
          itemCount: rows.length,
          sampleFields: headers.length > 0 ? headers : sampleFields(table),
        });
      }

      // -----------------------------------------------------------------------
      // UL/OL lists with meaningful items
      // -----------------------------------------------------------------------
      const lists = document.querySelectorAll('ul, ol');
      for (const list of lists) {
        const items = list.querySelectorAll(':scope > li');
        if (items.length < 3) continue;
        // Skip navigation lists
        const parentTag = list.parentElement?.tagName ?? '';
        if (parentTag === 'NAV' || list.closest('nav')) continue;

        results.push({
          type: 'list',
          containerSelector: simpleSelector(list),
          itemSelector: `${simpleSelector(list)} > li`,
          itemCount: items.length,
          sampleFields: sampleFields(list),
        });
      }

      // -----------------------------------------------------------------------
      // Card grids: parent containers with 3+ structurally similar children
      // -----------------------------------------------------------------------
      const candidates = document.querySelectorAll(
        'div, section, article, main'
      );

      for (const container of candidates) {
        const children = Array.from(container.children).filter(
          (c) =>
            c.tagName !== 'SCRIPT' &&
            c.tagName !== 'STYLE' &&
            c.tagName !== 'NOSCRIPT'
        );
        if (children.length < 3) continue;

        // Check structural similarity
        const signatures = children.map(structuralSignature);
        const sigCounts: Record<string, number> = {};
        for (const sig of signatures) sigCounts[sig] = (sigCounts[sig] ?? 0) + 1;
        const [topSig, topCount] = Object.entries(sigCounts).sort(
          ([, a], [, b]) => b - a
        )[0] ?? ['', 0];

        if (!topSig || topCount < 3) continue;
        const similarityRatio = topCount / children.length;
        if (similarityRatio < 0.6) continue;

        // Avoid duplicating tables or lists already captured
        if (
          container.tagName === 'TABLE' ||
          container.tagName === 'UL' ||
          container.tagName === 'OL'
        )
          continue;

        // Find a matching child to derive item selector
        const matchingChild = children.find(
          (c) => structuralSignature(c) === topSig
        );
        if (!matchingChild) continue;

        const childTag = matchingChild.tagName.toLowerCase();
        const childClasses = Array.from(matchingChild.classList)
          .filter((c) => /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(c) && !/[0-9]{3,}/.test(c))
          .slice(0, 2)
          .join('.');
        const itemSel = childClasses
          ? `${simpleSelector(container)} > ${childTag}.${childClasses}`
          : `${simpleSelector(container)} > ${childTag}`;

        results.push({
          type: 'card_grid',
          containerSelector: simpleSelector(container),
          itemSelector: itemSel,
          itemCount: topCount,
          sampleFields: sampleFields(matchingChild),
        });
      }

      return results;
    });

    return structures;
  }

  // -------------------------------------------------------------------------
  // detectSearch
  // -------------------------------------------------------------------------
  async detectSearch(): Promise<SearchResult> {
    const result = await this.page.evaluate((): {
      found: boolean;
      inputSelector?: string;
      submitSelector?: string;
    } => {
      function sel(el: Element): string {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const tag = el.tagName.toLowerCase();
        const cls = Array.from(el.classList)
          .filter((c) => /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(c))
          .slice(0, 2)
          .join('.');
        return cls ? `${tag}.${cls}` : tag;
      }

      // Explicit search inputs
      const explicitSearch = document.querySelector('input[type="search"]');
      if (explicitSearch) {
        const form = explicitSearch.closest('form');
        const submit =
          form?.querySelector('button[type="submit"], input[type="submit"], button') ?? null;
        return {
          found: true,
          inputSelector: sel(explicitSearch),
          submitSelector: submit ? sel(submit) : undefined,
        };
      }

      // Inputs with search-related placeholder or name
      const allInputs = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[type="text"], input:not([type])')
      );

      for (const input of allInputs) {
        const placeholder = (input.placeholder ?? '').toLowerCase();
        const name = (input.name ?? '').toLowerCase();
        const ariaLabel = (input.getAttribute('aria-label') ?? '').toLowerCase();
        const isSearchInput =
          placeholder.includes('search') ||
          placeholder.includes('find') ||
          placeholder.includes('query') ||
          name.includes('search') ||
          name.includes('query') ||
          name.includes('q') ||
          ariaLabel.includes('search');

        if (isSearchInput) {
          const form = input.closest('form');
          const submit =
            form?.querySelector('button[type="submit"], input[type="submit"], button') ?? null;
          return {
            found: true,
            inputSelector: sel(input),
            submitSelector: submit ? sel(submit) : undefined,
          };
        }
      }

      // Forms with a single text input (likely a search bar)
      const forms = Array.from(document.querySelectorAll('form'));
      for (const form of forms) {
        const textInputs = form.querySelectorAll(
          'input[type="text"], input[type="search"], input:not([type])'
        );
        if (textInputs.length === 1) {
          const input = textInputs[0];
          const submit =
            form.querySelector('button[type="submit"], input[type="submit"], button') ?? null;
          return {
            found: true,
            inputSelector: sel(input),
            submitSelector: submit ? sel(submit) : undefined,
          };
        }
      }

      return { found: false };
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Private helpers — individual pagination detectors
  // -------------------------------------------------------------------------

  private async _detectNextButton(): Promise<PaginationResult> {
    const found = await this.page.evaluate((): { selector: string | null; confidence: number } => {
      function sel(el: Element): string {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const tag = el.tagName.toLowerCase();
        const cls = Array.from(el.classList)
          .filter((c) => /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(c))
          .slice(0, 2)
          .join('.');
        return cls ? `${tag}.${cls}` : tag;
      }

      const nextPatterns = [
        '[aria-label*="next" i]',
        '[aria-label*="next page" i]',
        'a[rel="next"]',
        'button[rel="next"]',
        '.pagination .next',
        '.pagination-next',
        '[class*="next-page"]',
        '[class*="nextPage"]',
      ];

      for (const pattern of nextPatterns) {
        const el = document.querySelector(pattern);
        if (el) return { selector: sel(el), confidence: 90 };
      }

      // Text-based fallback
      const links = Array.from(document.querySelectorAll('a, button'));
      for (const link of links) {
        const text = link.textContent?.trim().toLowerCase() ?? '';
        if (text === 'next' || text === 'next page' || text === '»' || text === '›') {
          return { selector: sel(link), confidence: 75 };
        }
      }

      return { selector: null, confidence: 0 };
    });

    if (found.selector) {
      return { found: true, type: 'next_button', selector: found.selector, confidence: found.confidence };
    }
    return { found: false, confidence: 0 };
  }

  private async _detectPageNumbers(): Promise<PaginationResult> {
    const found = await this.page.evaluate((): { selector: string | null; confidence: number } => {
      function sel(el: Element): string {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const tag = el.tagName.toLowerCase();
        const cls = Array.from(el.classList)
          .filter((c) => /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(c))
          .slice(0, 2)
          .join('.');
        return cls ? `${tag}.${cls}` : tag;
      }

      // Look for a group of sequential numeric links
      const paginationContainers = [
        '.pagination',
        '[class*="pagination"]',
        '[aria-label="pagination"]',
        'nav[aria-label*="page" i]',
        '.pager',
        '[class*="pager"]',
      ];

      for (const pattern of paginationContainers) {
        const container = document.querySelector(pattern);
        if (!container) continue;
        const links = container.querySelectorAll('a, button, span');
        const numericLinks = Array.from(links).filter((l) => /^\d+$/.test(l.textContent?.trim() ?? ''));
        if (numericLinks.length >= 2) {
          return { selector: sel(container), confidence: 85 };
        }
      }

      return { selector: null, confidence: 0 };
    });

    if (found.selector) {
      return { found: true, type: 'page_numbers', selector: found.selector, confidence: found.confidence };
    }
    return { found: false, confidence: 0 };
  }

  private async _detectLoadMore(): Promise<PaginationResult> {
    const found = await this.page.evaluate((): { selector: string | null; confidence: number } => {
      function sel(el: Element): string {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const tag = el.tagName.toLowerCase();
        const cls = Array.from(el.classList)
          .filter((c) => /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(c))
          .slice(0, 2)
          .join('.');
        return cls ? `${tag}.${cls}` : tag;
      }

      const patterns = [
        '[class*="load-more"]',
        '[class*="loadMore"]',
        '[class*="load_more"]',
        '#load-more',
        '#loadMore',
      ];

      for (const pattern of patterns) {
        const el = document.querySelector(pattern);
        if (el) return { selector: sel(el), confidence: 85 };
      }

      // Text-based fallback
      const buttons = Array.from(document.querySelectorAll('button, a'));
      for (const btn of buttons) {
        const text = btn.textContent?.trim().toLowerCase() ?? '';
        if (
          text === 'load more' ||
          text === 'show more' ||
          text === 'see more' ||
          text === 'view more'
        ) {
          return { selector: sel(btn), confidence: 70 };
        }
      }

      return { selector: null, confidence: 0 };
    });

    if (found.selector) {
      return { found: true, type: 'load_more', selector: found.selector, confidence: found.confidence };
    }
    return { found: false, confidence: 0 };
  }

  private async _detectInfiniteScroll(): Promise<PaginationResult> {
    // Infinite scroll is inferred rather than detected via DOM selectors.
    // We look for event listeners on scroll and for intersection observers
    // attached to sentinel elements near the bottom of the page.
    const found = await this.page.evaluate((): { found: boolean; confidence: number } => {
      // Heuristic 1: a sentinel element at the bottom with classes typical of
      // infinite-scroll libraries (react-infinite-scroll, waypoint, etc.)
      const sentinelPatterns = [
        '[class*="infinite"]',
        '[class*="sentinel"]',
        '[class*="waypoint"]',
        '[data-infinite]',
        '[data-intersect]',
      ];
      for (const pattern of sentinelPatterns) {
        if (document.querySelector(pattern)) return { found: true, confidence: 80 };
      }

      // Heuristic 2: a div very close to the bottom of the document body
      const bodyHeight = document.body.scrollHeight;
      const allDivs = Array.from(document.querySelectorAll('div'));
      for (const div of allDivs) {
        const rect = div.getBoundingClientRect();
        const absoluteBottom = window.scrollY + rect.bottom;
        if (absoluteBottom > bodyHeight - 200 && rect.height < 10) {
          // Tiny element near the very bottom — likely an IntersectionObserver trigger
          return { found: true, confidence: 60 };
        }
      }

      return { found: false, confidence: 0 };
    });

    if (found.found) {
      return { found: true, type: 'infinite_scroll', confidence: found.confidence };
    }
    return { found: false, confidence: 0 };
  }
}
