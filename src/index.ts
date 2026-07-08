#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { logger, setLogLevel } from "./logger.js";
import { CamofoxClient } from "./camofox/client.js";
import { IBidderScraper } from "./ibidder/scraper.js";
import { buildServer } from "./mcp/server.js";
import { startStdio } from "./transports/stdio.js";
import { startHttp } from "./transports/http.js";

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  const camofox = new CamofoxClient({
    baseUrl: config.camofoxUrl,
    accessKey: config.camofoxAccessKey,
    userId: config.camofoxUserId,
  });

  const scraper = new IBidderScraper(camofox);

  if (config.transport === "stdio") {
    const server = buildServer(scraper);
    await startStdio(server);
  } else {
    await startHttp(scraper, config);
  }

  logger.info("ibidder-mcp-server started", {
    transport: config.transport,
    camofoxUrl: config.camofoxUrl,
  });
}

main().catch((err) => {
  logger.error("Fatal startup error", { err: String(err) });
  process.exitCode = 1;
});
