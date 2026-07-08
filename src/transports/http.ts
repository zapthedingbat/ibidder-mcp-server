import { timingSafeEqual } from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "../config.js";
import type { IBidderScraper } from "../ibidder/scraper.js";
import { buildServer } from "../mcp/server.js";
import { logger } from "../logger.js";

function bearerAuth(expected: string) {
  const expectedBuf = Buffer.from(expected);
  return (req: Request, res: Response, next: NextFunction): void => {
    const [scheme, token] = (req.headers.authorization ?? "").split(/\s+/);
    const tokenBuf = Buffer.from(token ?? "");
    if (
      scheme === "Bearer" &&
      tokenBuf.length === expectedBuf.length &&
      timingSafeEqual(tokenBuf, expectedBuf)
    ) {
      next();
      return;
    }
    res.status(401).json({ error: "Unauthorized" });
  };
}

export async function startHttp(
  scraper: IBidderScraper,
  config: Config,
): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  app.get("/healthz", (_req, res) => {
    res.status(200).send("ok");
  });

  app.use(bearerAuth(config.authToken!));

  app.all("/mcp", async (req: Request, res: Response) => {
    try {
      const server = buildServer(scraper);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableDnsRebindingProtection: Boolean(
          config.allowedHosts || config.allowedOrigins,
        ),
        allowedHosts: config.allowedHosts,
        allowedOrigins: config.allowedOrigins,
      });
      res.on("close", () => {
        void transport.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error("Error handling /mcp request", { err: String(err) });
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  await new Promise<void>((resolve) => {
    app.listen(config.port, () => {
      logger.info(
        `ibidder-mcp-server listening on http://0.0.0.0:${config.port}/mcp`,
      );
      resolve();
    });
  });
}
