#!/usr/bin/env node
import "dotenv/config";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RenphoApiService } from "./services/renpho-api.js";
import { loadConfig } from "./config.js";
import { createAppLogger } from "./logger.js";
import { createServer } from "./server.js";

const config = loadConfig();

const logger = createAppLogger({
  level: config.logLevel,
  logDir: config.logDir,
});

const renphoApi = new RenphoApiService(config.email, config.password);

const server = createServer(renphoApi, logger);

async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("Renpho MCP Server started successfully");
  } catch (error) {
    logger.error("Failed to start server", { error: (error as Error).message });
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down gracefully");
  process.exit(0);
});

main().catch((error) => {
  logger.error("Unhandled error", { error: (error as Error).message });
  process.exit(1);
});
