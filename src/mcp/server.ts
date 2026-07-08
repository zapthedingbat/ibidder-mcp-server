import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IBidderScraper } from "../ibidder/scraper.js";
import { registerSearchTools } from "./tools/search.js";

export function buildServer(scraper: IBidderScraper): McpServer {
  const server = new McpServer({
    name: "ibidder-mcp-server",
    version: "0.1.0",
  });

  registerSearchTools(server, scraper);

  return server;
}
