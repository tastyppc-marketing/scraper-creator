import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

async function main() {
  process.stderr.write("Creating server...\n");
  const srv = new McpServer(
    { name: "test", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  srv.tool("hello", "say hello", {}, async () => ({
    content: [{ type: "text", text: "hi" }],
  }));
  process.stderr.write("Tool registered.\n");

  const t = new StdioServerTransport();
  process.stderr.write("Connecting transport...\n");
  await srv.connect(t);
  process.stderr.write("Connected! Waiting for messages...\n");
}

main().catch((err) => {
  process.stderr.write("Fatal: " + (err instanceof Error ? err.stack : String(err)) + "\n");
  process.exit(1);
});
