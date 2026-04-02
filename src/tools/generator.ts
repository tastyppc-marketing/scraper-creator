import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import nunjucks from "nunjucks";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { ProjectConfig } from "../config/ProjectConfig.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Template directory lives at src/generator/templates/; when running via tsx
// the source root is used directly.
const TEMPLATES_DIR = join(__dirname, "../generator/templates");

// Configure nunjucks to load from the templates directory
const nunjucksEnv = nunjucks.configure(TEMPLATES_DIR, {
  autoescape: false,
  trimBlocks: true,
  lstripBlocks: true,
});

export function registerGeneratorTools(server: McpServer): void {
  // ─── generate_scraper ─────────────────────────────────────────────────────
  server.tool(
    "generate_scraper",
    "Generates a Python scraper script from captured selectors using nunjucks templates. Saves the file to the scrapers/ directory.",
    {
      name: z
        .string()
        .regex(/^[a-zA-Z0-9_-]+$/)
        .describe("Scraper name (alphanumeric, underscores, hyphens)"),
      description: z.string().describe("What the scraper does"),
      base_url: z.string().url().describe("Starting URL for the scraper"),
      selectors: z
        .array(
          z.object({
            name: z.string().describe("Field name for this selector"),
            css: z.string().describe("CSS selector string"),
            description: z.string().describe("Human-readable description"),
          })
        )
        .min(1)
        .describe("List of selectors to extract"),
      output_format: z
        .enum(["json", "csv", "both"])
        .default("json")
        .describe("Output format for scraped data"),
      site_type: z
        .enum(["static", "dynamic", "auto"])
        .default("auto")
        .describe(
          "Type of site: static (requests+BS4), dynamic (Playwright), or auto-detect"
        ),
      login: z
        .object({
          url: z.string().url().describe("Login page URL"),
          username_selector: z.string().describe("CSS selector for username field"),
          password_selector: z.string().describe("CSS selector for password field"),
          submit_selector: z
            .string()
            .optional()
            .describe("CSS selector for submit button"),
        })
        .optional()
        .describe("Optional login configuration"),
      pagination: z
        .object({
          type: z.enum(["next_button", "infinite_scroll", "page_numbers"]),
          selector: z
            .string()
            .describe("CSS selector for next button or page number links"),
        })
        .optional()
        .describe("Optional pagination configuration"),
    },
    async ({
      name,
      description,
      base_url,
      selectors,
      output_format,
      site_type,
      login,
      pagination,
    }) => {
      try {
        const config = ProjectConfig.getInstance().get();
        const outputDir = config.output_dir;

        // Determine template based on site type
        let effectiveSiteType = site_type;
        if (site_type === "auto") {
          effectiveSiteType = pagination?.type === "infinite_scroll"
            ? "dynamic"
            : "static";
        }

        const templateFile =
          effectiveSiteType === "dynamic"
            ? "playwright_py.py.njk"
            : "requests_bs4.py.njk";

        const templateContext = {
          name,
          description,
          base_url,
          selectors,
          output_format,
          proxy: ProjectConfig.getInstance().getProxy(),
          login,
          pagination,
        };

        const code = nunjucksEnv.render(templateFile, templateContext);

        // Ensure output directory exists
        await mkdir(outputDir, { recursive: true });

        const fileName = `${name}.py`;
        const filePath = join(outputDir, fileName);
        await writeFile(filePath, code, "utf-8");

        // Build a short preview (first 20 lines)
        const preview = code.split("\n").slice(0, 20).join("\n");

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  filePath,
                  template: templateFile,
                  siteType: effectiveSiteType,
                  preview: preview + (code.split("\n").length > 20 ? "\n…" : ""),
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
          content: [{ type: "text", text: `Error generating scraper: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── test_scraper ─────────────────────────────────────────────────────────
  server.tool(
    "test_scraper",
    "Runs a generated Python scraper script and returns its output.",
    {
      path: z
        .string()
        .describe("Path to the generated .py scraper file"),
    },
    async ({ path }) => {
      try {
        if (!existsSync(path)) {
          return {
            content: [
              { type: "text", text: `Error: File not found: ${path}` },
            ],
            isError: true,
          };
        }

        const { stdout, stderr } = await execFileAsync("python3", [path], {
          timeout: 60_000,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  stdout: stdout.slice(0, 4000),
                  stderr: stderr.slice(0, 2000),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const isExecError =
          err instanceof Error && "stdout" in err && "stderr" in err;
        if (isExecError) {
          const execErr = err as { stdout: string; stderr: string; message: string };
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error: execErr.message,
                    stdout: execErr.stdout?.slice(0, 4000) ?? "",
                    stderr: execErr.stderr?.slice(0, 2000) ?? "",
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
