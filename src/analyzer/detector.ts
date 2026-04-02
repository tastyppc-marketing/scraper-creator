import type { Page } from 'playwright';

export interface SiteTypeResult {
  type: 'static' | 'dynamic';
  confidence: number;
  indicators: string[];
}

/**
 * Determine whether a page is statically served HTML or a JS-rendered SPA.
 *
 * Five independent signals are combined:
 *  1. SPA framework globals (React, Vue, Angular, Next.js)
 *  2. Difference in HTML size between initial load and after a short settle
 *  3. Presence of XHR / fetch calls intercepted via performance entries
 *  4. Client-side routing (history.pushState patched or usage patterns)
 *  5. <noscript> tags with significant content (hints that JS is required)
 */
export async function detectSiteType(page: Page): Promise<SiteTypeResult> {
  const indicators: string[] = [];
  let dynamicScore = 0; // points toward "dynamic"

  // -------------------------------------------------------------------------
  // Signal 1: SPA framework globals
  // -------------------------------------------------------------------------
  const frameworkCheck = await page.evaluate((): string[] => {
    const found: string[] = [];
    if ((window as unknown as Record<string, unknown>).__NEXT_DATA__) found.push('Next.js (__NEXT_DATA__)');
    if ((window as unknown as Record<string, unknown>).__nuxt__) found.push('Nuxt.js (__nuxt__)');
    if (document.querySelector('#__next')) found.push('Next.js (#__next root)');
    if (document.querySelector('#app[data-v-app]') || (window as unknown as Record<string, unknown>).__VUE__) found.push('Vue.js');
    if (document.querySelector('app-root') || document.querySelector('[ng-version]')) found.push('Angular');
    if (document.querySelector('#root') && (window as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__) found.push('React (__REACT_DEVTOOLS_GLOBAL_HOOK__)');
    // Generic check: a div#root with no server-rendered children is a React SPA hint
    const root = document.querySelector('#root');
    if (root && root.children.length > 0 && !document.querySelector('noscript')?.textContent?.includes('JavaScript')) {
      found.push('Possible React SPA (#root with children)');
    }
    return found;
  });

  if (frameworkCheck.length > 0) {
    indicators.push(...frameworkCheck.map((f) => `SPA framework detected: ${f}`));
    dynamicScore += 40;
  }

  // -------------------------------------------------------------------------
  // Signal 2: HTML size delta after a 2-second wait
  // -------------------------------------------------------------------------
  const initialSize = await page.evaluate(() => document.documentElement.innerHTML.length);

  // Wait briefly for any JS rendering to settle
  await page.waitForTimeout(2000);

  const settledSize = await page.evaluate(() => document.documentElement.innerHTML.length);
  const sizeDelta = Math.abs(settledSize - initialSize);
  const deltaRatio = initialSize > 0 ? sizeDelta / initialSize : 0;

  if (deltaRatio > 0.15) {
    indicators.push(
      `HTML grew ${(deltaRatio * 100).toFixed(1)}% after JS execution (+${sizeDelta} chars)`
    );
    dynamicScore += 30;
  } else if (deltaRatio > 0.05) {
    indicators.push(
      `Moderate HTML change after JS execution (+${sizeDelta} chars, ${(deltaRatio * 100).toFixed(1)}%)`
    );
    dynamicScore += 15;
  }

  // -------------------------------------------------------------------------
  // Signal 3: XHR / fetch API calls via performance entries
  // -------------------------------------------------------------------------
  const apiCalls = await page.evaluate((): string[] => {
    return performance
      .getEntriesByType('resource')
      .filter((entry) => {
        const e = entry as PerformanceResourceTiming;
        return (
          e.initiatorType === 'xmlhttprequest' ||
          e.initiatorType === 'fetch'
        );
      })
      .map((e) => e.name)
      .slice(0, 5);
  });

  if (apiCalls.length > 0) {
    indicators.push(`${apiCalls.length} XHR/fetch request(s) detected (e.g. ${apiCalls[0]})`);
    dynamicScore += 20;
  }

  // -------------------------------------------------------------------------
  // Signal 4: Client-side routing — history.pushState usage or hash routing
  // -------------------------------------------------------------------------
  const hasClientRouting = await page.evaluate((): boolean => {
    // If pushState was called, it would leave history length > 1 or the
    // URL contains a hash path like /#/home
    const isHashRoute = location.hash.startsWith('#/');
    // Check for common SPA meta tags
    const hasSpaBase = !!document.querySelector('base[href]');
    return isHashRoute || hasSpaBase;
  });

  if (hasClientRouting) {
    indicators.push('Client-side routing detected (hash routes or <base> tag)');
    dynamicScore += 15;
  }

  // -------------------------------------------------------------------------
  // Signal 5: <noscript> tags with meaningful fallback content (JS required)
  // -------------------------------------------------------------------------
  const noscriptAnalysis = await page.evaluate((): { count: number; hasSignificantContent: boolean } => {
    const tags = Array.from(document.querySelectorAll('noscript'));
    const significant = tags.filter((n) => {
      const text = n.textContent?.trim() ?? '';
      // A noscript block saying "enable JS" means JS is required → dynamic
      return (
        text.length > 20 &&
        (text.toLowerCase().includes('javascript') ||
          text.toLowerCase().includes('enable') ||
          text.toLowerCase().includes('requires'))
      );
    });
    return { count: tags.length, hasSignificantContent: significant.length > 0 };
  });

  if (noscriptAnalysis.hasSignificantContent) {
    indicators.push('<noscript> tag requires JavaScript to be enabled');
    dynamicScore += 10;
  }

  // -------------------------------------------------------------------------
  // Aggregate result
  // -------------------------------------------------------------------------
  const MAX_SCORE = 115; // sum of all maximum partial scores
  const confidence = Math.min(100, Math.round((dynamicScore / MAX_SCORE) * 100));
  const type: 'static' | 'dynamic' = dynamicScore >= 30 ? 'dynamic' : 'static';

  if (type === 'static') {
    indicators.push('No significant dynamic indicators found — treating as static HTML');
  }

  return { type, confidence, indicators };
}
