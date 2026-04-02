import { startServer } from "./server.js";
import { BrowserManager } from "./browser/BrowserManager.js";

async function main(): Promise<void> {
  // Graceful shutdown handlers
  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`\nReceived ${signal}, shutting down…\n`);
    const manager = BrowserManager.getInstance();
    if (manager.isActive()) {
      await manager.close().catch(() => {});
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Unhandled rejections should not silently swallow errors
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(
      `Unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}\n`
    );
  });

  await startServer();
}

main().catch((err) => {
  process.stderr.write(
    `Fatal error: ${err instanceof Error ? err.stack : String(err)}\n`
  );
  process.exit(1);
});
