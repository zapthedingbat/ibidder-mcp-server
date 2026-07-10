import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IBidderScraper } from "../../ibidder/scraper.js";

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function registerSearchTools(
  server: McpServer,
  scraper: IBidderScraper,
): void {
  server.registerTool(
    "search_auctions",
    {
      title: "Search i-bidder auction catalogues",
      description:
        "Search for auction catalogues on i-bidder.com by keyword. " +
        "Returns a list of auctions with titles, auctioneers, locations, " +
        "and links to browse individual lots.",
      inputSchema: {
        query: z.string().describe("Search keywords (e.g. 'lathe', 'antique furniture')"),
        page: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Page number (default 1)"),
      },
    },
    async ({ query, page }) => {
      const results = await scraper.searchAuctions({ query, page });
      if (results.length === 0) {
        return textResult({
          message: `No auction catalogues found for "${query}".`,
          results: [],
        });
      }
      return textResult({ count: results.length, results });
    },
  );

  server.registerTool(
    "search_lots",
    {
      title: "Search i-bidder lots",
      description:
        "Search for individual lots (items) across all auctions on i-bidder.com. " +
        "Returns lots with titles, bids, estimates, distance, and links. " +
        "If a postcode is configured on the server, results default to distance sort. " +
        "Omit query to browse all lots (e.g. nearest lots with no keyword filter).",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Search keywords (e.g. 'network switch', 'rolex'). Omit to browse all."),
        postcode: z
          .string()
          .optional()
          .describe("UK postcode to sort by distance from (e.g. 'BS14 0QG'). Uses server default if omitted."),
        max_distance: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum distance in miles (default: any)"),
        sort: z
          .enum(["distance", "publishedDate", "auctionDate"])
          .optional()
          .describe("Sort order (default: distance if postcode set, otherwise publishedDate)"),
        page: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Page number (default 1)"),
      },
    },
    async ({ query, postcode, max_distance, sort, page }) => {
      const results = await scraper.searchLots({
        query,
        postcode,
        maxDistance: max_distance,
        sort,
        page,
      });
      if (results.length === 0) {
        return textResult({
          message: query
            ? `No lots found for "${query}".`
            : "No lots found.",
          results: [],
        });
      }
      return textResult({ count: results.length, results });
    },
  );

  server.registerTool(
    "get_auction_lots",
    {
      title: "List lots in an auction catalogue",
      description:
        "Browse the lots within a specific i-bidder auction catalogue. " +
        "Use the catalogue URL from a search_auctions result.",
      inputSchema: {
        catalogue_url: z
          .string()
          .url()
          .describe("Full URL of the auction catalogue page"),
        page: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Page number (default 1)"),
      },
    },
    async ({ catalogue_url, page }) => {
      const results = await scraper.getAuctionLots(catalogue_url, page);
      if (results.length === 0) {
        return textResult({
          message: "No lots found in this catalogue.",
          results: [],
        });
      }
      return textResult({ count: results.length, results });
    },
  );

  server.registerTool(
    "get_lot_detail",
    {
      title: "Get i-bidder lot details",
      description:
        "Get full details for a specific lot on i-bidder.com including " +
        "description, images, current bid, estimate, and attributes. " +
        "Use the lot URL from a search_lots or get_auction_lots result.",
      inputSchema: {
        lot_url: z
          .string()
          .url()
          .describe("Full URL of the lot detail page"),
      },
    },
    async ({ lot_url }) => {
      const detail = await scraper.getLotDetail(lot_url);
      return textResult(detail);
    },
  );

  server.registerTool(
    "debug_snapshot",
    {
      title: "Debug: page accessibility snapshot",
      description:
        "Take a CamoFox accessibility snapshot of any i-bidder.com page. " +
        "Useful for debugging selectors or discovering page structure.",
      inputSchema: {
        url: z
          .string()
          .url()
          .describe("Full URL of the i-bidder page to snapshot"),
      },
    },
    async ({ url }) => {
      const snapshot = await scraper.debugSnapshot(url);
      return { content: [{ type: "text" as const, text: snapshot }] };
    },
  );
}
