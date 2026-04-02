import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerBrowserTools } from "./tools/browser.js";
import { registerGeneratorTools } from "./tools/generator.js";
import { registerConfigTools } from "./tools/config.js";

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "scraper-creator",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  registerBrowserTools(server);
  registerGeneratorTools(server);
  registerConfigTools(server);

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
