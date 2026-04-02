import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ProjectConfig } from "../config/ProjectConfig.js";

export function registerConfigTools(server: McpServer): void {
  // ─── configure ────────────────────────────────────────────────────────────
  server.tool(
    "configure",
    "Updates project-level configuration (output directory, format, stealth level, timeout). Returns the full current config.",
    {
      output_dir: z
        .string()
        .optional()
        .describe("Directory where generated scrapers are saved"),
      output_format: z
        .enum(["json", "csv", "both"])
        .optional()
        .describe("Default output format for generated scrapers"),
      stealth_level: z
        .enum(["none", "basic", "full"])
        .optional()
        .describe("Browser stealth level for evading bot detection"),
      default_timeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Default navigation timeout in milliseconds"),
    },
    async ({ output_dir, output_format, stealth_level, default_timeout }) => {
      try {
        const config = ProjectConfig.getInstance();

        const updates: Parameters<typeof config.update>[0] = {};
        if (output_dir !== undefined) updates.output_dir = output_dir;
        if (output_format !== undefined) updates.output_format = output_format;
        if (stealth_level !== undefined) updates.stealth_level = stealth_level;
        if (default_timeout !== undefined)
          updates.default_timeout = default_timeout;

        const current = config.update(updates);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, config: current }, null, 2),
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

  // ─── set_proxy ────────────────────────────────────────────────────────────
  server.tool(
    "set_proxy",
    "Configures a proxy server to be used by the browser and generated scrapers.",
    {
      server: z
        .string()
        .describe("Proxy server URL, e.g. http://proxy.example.com:8080"),
      username: z.string().optional().describe("Proxy authentication username"),
      password: z.string().optional().describe("Proxy authentication password"),
      rotation: z
        .enum(["none", "per_request", "per_session"])
        .optional()
        .default("none")
        .describe("Proxy rotation strategy"),
    },
    async ({ server: proxyServer, username, password, rotation }) => {
      try {
        const config = ProjectConfig.getInstance();

        config.setProxy({
          server: proxyServer,
          username,
          password,
          rotation: rotation ?? "none",
        });

        const proxy = config.getProxy();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  proxy: {
                    server: proxy?.server,
                    username: proxy?.username ?? null,
                    hasPassword: proxy?.password !== undefined,
                    rotation: proxy?.rotation,
                  },
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
