import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BrowserManager } from "../browser/BrowserManager.js";
import { PageAnalyzer } from "../analyzer/page.js";
import { SelectorEngine } from "../selectors/engine.js";

const manager = BrowserManager.getInstance();

export function registerBrowserTools(server: McpServer): void {
  // ─── start_browser ────────────────────────────────────────────────────────
  server.tool(
    "start_browser",
    "Opens a headed Chromium browser via Playwright. Optionally navigates to a URL.",
    {
      url: z
        .string()
        .url()
        .optional()
        .describe("URL to navigate to after launch"),
      headless: z
        .boolean()
        .optional()
        .default(false)
        .describe("Run browser in headless mode (default: false)"),
      proxy: z
        .object({
          server: z.string().describe("Proxy server URL, e.g. http://host:port"),
          username: z.string().optional().describe("Proxy username"),
          password: z.string().optional().describe("Proxy password"),
        })
        .optional()
        .describe("Optional proxy configuration"),
    },
    async ({ url, headless, proxy }) => {
      try {
        const info = await manager.launch({ url, headless, proxy });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  sessionId: info.sessionId,
                  url: info.url,
                  title: info.title,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── stop_browser ─────────────────────────────────────────────────────────
  server.tool(
    "stop_browser",
    "Closes the browser and returns a summary of the recording session.",
    {},
    async () => {
      try {
        const summary = await manager.close();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  actionsRecorded: summary.actionsRecorded,
                  selectorsCaptured: summary.selectorsCaptured,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── capture_page ─────────────────────────────────────────────────────────
  server.tool(
    "capture_page",
    "Analyzes the current page structure: URL, title, site type, auth state, element counts, patterns, and an accessibility tree snapshot.",
    {},
    async () => {
      try {
        const page = manager.getPage();
        const analyzer = new PageAnalyzer(page);
        const analysis = await analyzer.analyze();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(analysis, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── capture_selector ─────────────────────────────────────────────────────
  server.tool(
    "capture_selector",
    "Captures multi-tier selectors (CSS, XPath, text, aria) for elements matching the user's description.",
    {
      description: z
        .string()
        .describe(
          'Description of the element to find, e.g. "the price element" or "add to cart button"'
        ),
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Which match to return if multiple elements found (0-based)"),
    },
    async ({ description, index }) => {
      try {
        const page = manager.getPage();

        try {
          const engine = new SelectorEngine(page);
          const results = await engine.findElements(description, 5);

          manager.incrementSelectorsCaptured();

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ matches: results }, null, 2),
              },
            ],
          };
        } catch {
          // Fallback to inline implementation
          const results = await page.evaluate(
            ({ desc, idx }: { desc: string; idx: number }) => {
              function getXPath(el: Element): string {
                if (el.id) return `//*[@id="${el.id}"]`;
                const parts: string[] = [];
                let node: Element | null = el;
                while (node && node.nodeType === Node.ELEMENT_NODE) {
                  let index = 1;
                  let sibling = node.previousElementSibling;
                  while (sibling) {
                    if (sibling.tagName === node.tagName) index++;
                    sibling = sibling.previousElementSibling;
                  }
                  const part =
                    index === 1
                      ? node.tagName.toLowerCase()
                      : `${node.tagName.toLowerCase()}[${index}]`;
                  parts.unshift(part);
                  node = node.parentElement;
                }
                return "/" + parts.join("/");
              }

              function robustnessScore(el: Element): number {
                let score = 0;
                if (el.id) score += 40;
                if (el.getAttribute("data-testid")) score += 30;
                if (el.getAttribute("aria-label")) score += 20;
                if (el.getAttribute("name")) score += 15;
                if (el.className && typeof el.className === "string") score += 5;
                return score;
              }

              const descLower = desc.toLowerCase();
              const candidates: Element[] = [];

              document
                .querySelectorAll(
                  "a, button, input, label, h1, h2, h3, h4, h5, h6, p, span, div, td, th, li, [role]"
                )
                .forEach((el) => {
                  const text = (el.textContent ?? "").toLowerCase();
                  const ariaLabel = (
                    el.getAttribute("aria-label") ?? ""
                  ).toLowerCase();
                  const placeholder = (
                    el.getAttribute("placeholder") ?? ""
                  ).toLowerCase();
                  const name = (el.getAttribute("name") ?? "").toLowerCase();

                  if (
                    text.includes(descLower) ||
                    ariaLabel.includes(descLower) ||
                    placeholder.includes(descLower) ||
                    name.includes(descLower)
                  ) {
                    candidates.push(el);
                  }
                });

              const target = candidates[idx] ?? candidates[0];
              if (!target) return [];

              const topMatches = candidates.slice(0, 5).map((el) => ({
                css: (() => {
                  let s = el.tagName.toLowerCase();
                  if (el.id) return `#${CSS.escape(el.id)}`;
                  if (el.className && typeof el.className === "string") {
                    const cls = el.className
                      .trim()
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((c) => `.${CSS.escape(c)}`)
                      .join("");
                    if (cls) s = el.tagName.toLowerCase() + cls;
                  }
                  return s;
                })(),
                xpath: getXPath(el),
                text: (el.textContent ?? "").trim().slice(0, 100),
                aria: el.getAttribute("aria-label") ?? "",
                robustness_score: robustnessScore(el),
              }));

              return topMatches;
            },
            { desc: description, idx: index ?? 0 }
          );

          manager.incrementSelectorsCaptured();

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ matches: results }, null, 2),
              },
            ],
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── navigate ─────────────────────────────────────────────────────────────
  server.tool(
    "navigate",
    "Navigates the browser to a URL.",
    {
      url: z.string().url().describe("URL to navigate to"),
    },
    async ({ url }) => {
      try {
        const page = manager.getPage();
        await page.goto(url, { waitUntil: "domcontentloaded" });
        const newUrl = page.url();
        const title = await page.title();

        manager.recordAction({
          action: "navigate",
          selector: null,
          url: newUrl,
          value: url,
          timestamp: new Date().toISOString(),
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, url: newUrl, title }, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── click ────────────────────────────────────────────────────────────────
  server.tool(
    "click",
    "Clicks an element on the page identified by a CSS selector.",
    {
      selector: z.string().describe("CSS selector of the element to click"),
      description: z
        .string()
        .optional()
        .describe("Human-readable description of what is being clicked"),
    },
    async ({ selector, description }) => {
      try {
        const page = manager.getPage();
        const urlBefore = page.url();

        await page.click(selector);

        // Wait briefly to detect navigation
        await page.waitForTimeout(500);
        const newUrl = page.url();

        manager.recordAction({
          action: "click",
          selector,
          url: newUrl,
          value: description ?? null,
          timestamp: new Date().toISOString(),
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  navigated: newUrl !== urlBefore,
                  url: newUrl,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── type_text ────────────────────────────────────────────────────────────
  server.tool(
    "type_text",
    "Types text into an element identified by a CSS selector. Optionally presses Enter after typing.",
    {
      selector: z.string().describe("CSS selector of the element to type into"),
      text: z.string().describe("Text to type"),
      submit: z
        .boolean()
        .optional()
        .default(false)
        .describe("Press Enter after typing (default: false)"),
    },
    async ({ selector, text, submit }) => {
      try {
        const page = manager.getPage();

        await page.fill(selector, text);

        if (submit) {
          await page.press(selector, "Enter");
        }

        manager.recordAction({
          action: "type",
          selector,
          url: page.url(),
          value: text,
          timestamp: new Date().toISOString(),
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true }, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── screenshot ───────────────────────────────────────────────────────────
  server.tool(
    "screenshot",
    "Takes a screenshot of the current page and returns it as a base64-encoded image.",
    {
      fullPage: z
        .boolean()
        .optional()
        .default(false)
        .describe("Capture the full scrollable page (default: false)"),
    },
    async ({ fullPage }) => {
      try {
        const page = manager.getPage();
        const buffer = await page.screenshot({ fullPage: fullPage ?? false });
        const base64 = buffer.toString("base64");

        return {
          content: [
            {
              type: "image",
              data: base64,
              mimeType: "image/png",
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── evaluate_js ──────────────────────────────────────────────────────────
  server.tool(
    "evaluate_js",
    "Evaluates JavaScript code on the current page and returns the result as a JSON string.",
    {
      code: z.string().describe("JavaScript code to evaluate"),
    },
    async ({ code }) => {
      try {
        const page = manager.getPage();
        const result = await page.evaluate(code);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ result: JSON.stringify(result) }, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── get_captured_clicks ──────────────────────────────────────────────────
  server.tool(
    "get_captured_clicks",
    "Returns the click events captured by the injected recorder script.",
    {},
    async () => {
      try {
        const page = manager.getPage();
        const clicks = await page.evaluate(
          () => window.__scraperCreator?.getCapturedClicks?.() ?? []
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ clicks }, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── enable_highlighting ──────────────────────────────────────────────────
  server.tool(
    "enable_highlighting",
    "Enables the visual element highlighter overlay on the current page.",
    {},
    async () => {
      try {
        const page = manager.getPage();
        await page.evaluate(() => window.__scraperCreator?.enableHighlighting?.());

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true }, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── disable_highlighting ─────────────────────────────────────────────────
  server.tool(
    "disable_highlighting",
    "Disables the visual element highlighter overlay on the current page.",
    {},
    async () => {
      try {
        const page = manager.getPage();
        await page.evaluate(() => window.__scraperCreator?.disableHighlighting?.());

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true }, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── get_actions ──────────────────────────────────────────────────────────
  server.tool(
    "get_actions",
    "Returns all recorded user actions (navigations, clicks, etc.) from the current session.",
    {},
    async () => {
      try {
        const actions = manager.getActions();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ actions }, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── get_page_info ────────────────────────────────────────────────────────
  server.tool(
    "get_page_info",
    "Returns lightweight page metadata: URL, title, authentication status, cookie count, and localStorage key count.",
    {},
    async () => {
      try {
        const page = manager.getPage();

        const url = page.url();
        const title = await page.title();

        const cookies = await page.context().cookies();

        const { localStorageCount, isAuthenticated } = await page.evaluate(
          () => {
            const lsCount = localStorage.length;

            const loginForms = document.querySelectorAll(
              'form input[type="password"]'
            );
            const profileIndicators = document.querySelectorAll(
              '[aria-label*="account" i], [aria-label*="profile" i], .user-menu, .account-menu, .avatar, [data-user], [data-username]'
            );

            const authed =
              loginForms.length === 0 && profileIndicators.length > 0;

            return { localStorageCount: lsCount, isAuthenticated: authed };
          }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  url,
                  title,
                  isAuthenticated,
                  cookieCount: cookies.length,
                  localStorageKeysCount: localStorageCount,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
