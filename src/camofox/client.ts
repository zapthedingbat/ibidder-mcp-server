import { randomUUID } from "node:crypto";
import { request } from "undici";
import { logger } from "../logger.js";

export interface CamofoxConfig {
  baseUrl: string;
  accessKey?: string;
  userId: string;
}

export interface Tab {
  tabId: string;
  url: string;
}

export interface Snapshot {
  snapshot: string;
  url: string;
}

export class CamofoxClient {
  private baseUrl: string;
  private accessKey?: string;
  private userId: string;

  constructor(config: CamofoxConfig) {
    this.baseUrl = config.baseUrl;
    this.accessKey = config.accessKey;
    this.userId = config.userId;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.accessKey) h["authorization"] = `Bearer ${this.accessKey}`;
    return h;
  }

  private async req<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    logger.debug(`camofox ${method} ${path}`, body);
    const resp = await request(url, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await resp.body.json()) as T;
    if (resp.statusCode >= 400) {
      const errMsg =
        (data as Record<string, unknown>).error || JSON.stringify(data);
      throw new Error(`CamoFox ${method} ${path} ${resp.statusCode}: ${errMsg}`);
    }
    return data;
  }

  /** Create a new tab, optionally navigating to a URL. */
  async createTab(url?: string): Promise<Tab> {
    const data = await this.req<{ tabId: string; url: string }>(
      "POST",
      "/tabs",
      { userId: this.userId, sessionKey: randomUUID(), url },
    );
    return { tabId: data.tabId, url: data.url };
  }

  /** Navigate an existing tab to a URL. */
  async navigate(tabId: string, url: string): Promise<void> {
    await this.req("POST", `/tabs/${tabId}/navigate`, {
      userId: this.userId,
      url,
    });
  }

  /** Wait for a CSS selector to appear. */
  async wait(
    tabId: string,
    selector: string,
    timeout = 10000,
  ): Promise<void> {
    await this.req("POST", `/tabs/${tabId}/wait`, {
      userId: this.userId,
      selector,
      timeout,
    });
  }

  /** Get an accessibility snapshot of the page. */
  async snapshot(tabId: string): Promise<Snapshot> {
    return this.req<Snapshot>(
      "GET",
      `/tabs/${tabId}/snapshot?userId=${encodeURIComponent(this.userId)}`,
    );
  }

  /** Click an element by ref (e.g. "e5") or CSS selector. */
  async click(
    tabId: string,
    opts: { ref?: string; selector?: string },
  ): Promise<void> {
    await this.req("POST", `/tabs/${tabId}/click`, {
      userId: this.userId,
      ...opts,
    });
  }

  /** Type text into an element. */
  async type(
    tabId: string,
    opts: { ref?: string; selector?: string; text: string; submit?: boolean },
  ): Promise<void> {
    await this.req("POST", `/tabs/${tabId}/type`, {
      userId: this.userId,
      ...opts,
    });
  }

  /** Press a keyboard key (e.g. "Enter", "Escape"). */
  async press(tabId: string, key: string): Promise<void> {
    await this.req("POST", `/tabs/${tabId}/press`, {
      userId: this.userId,
      key,
    });
  }

  /** Scroll the page. */
  async scroll(
    tabId: string,
    direction: "up" | "down",
    amount?: number,
  ): Promise<void> {
    await this.req("POST", `/tabs/${tabId}/scroll`, {
      userId: this.userId,
      direction,
      amount,
    });
  }

  /** Evaluate arbitrary JavaScript in the tab context. */
  async evaluate<T = unknown>(tabId: string, expression: string): Promise<T> {
    const data = await this.req<{ ok: boolean; result: T }>(
      "POST",
      `/tabs/${tabId}/evaluate`,
      { userId: this.userId, expression },
    );
    return data.result;
  }

  /** Extract structured data from page links. */
  async links(
    tabId: string,
  ): Promise<{ href: string; text: string }[]> {
    const data = await this.req<{ links: { href: string; text: string }[] }>(
      "GET",
      `/tabs/${tabId}/links?userId=${encodeURIComponent(this.userId)}`,
    );
    return data.links;
  }

  /** Close a tab. */
  async closeTab(tabId: string): Promise<void> {
    await this.req(
      "DELETE",
      `/tabs/${tabId}?userId=${encodeURIComponent(this.userId)}`,
    );
  }

  /** Health check. */
  async health(): Promise<boolean> {
    try {
      await this.req<{ status: string }>("GET", "/health");
      return true;
    } catch {
      return false;
    }
  }
}
