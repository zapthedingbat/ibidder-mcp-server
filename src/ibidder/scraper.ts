import type { CamofoxClient } from "../camofox/client.js";
import { logger } from "../logger.js";
import type {
  AuctionCatalogue,
  Lot,
  LotDetail,
  SearchOptions,
} from "./types.js";

const BASE = "https://www.i-bidder.com/en-gb";

/**
 * JS executed in-page to extract lot data from i-bidder search results.
 * Each lot is an <article> element containing:
 *  - a link with href containing "/lot-" (title + URL + image)
 *  - a separate auctioneer link (href to /auction-catalogues/<auctioneer>)
 *  - a <complementary> section with opening bid, estimate, distance, bidding
 *    ends, and location as labelled list items / strong elements
 */
const EXTRACT_LOTS_JS = `(() => {
  const results = [];
  const articles = document.querySelectorAll('article');
  for (const article of articles) {
    const lotLink = article.querySelector('a[href*="/lot-"]');
    if (!lotLink) continue;
    const href = lotLink.getAttribute('href') || '';
    // The img alt text is the cleanest title source (no HTML/JS cruft)
    const img = article.querySelector('img');
    const altTitle = img?.alt?.trim() || '';
    // Fallback to link text, stripping any HTML artefacts
    const rawText = lotLink.textContent?.trim()
      ?.replace(/^\\d+/, '')  // strip leading lot number prefix
      ?.replace(/No Image[\\s\\S]*?setTimeout\\([^)]+\\);?/g, '')
      .trim() || '';
    const title = altTitle || rawText;

    // Auctioneer link (points to /auction-catalogues/<slug>, not a lot)
    const auctLinks = article.querySelectorAll('a[href*="/auction-catalogues/"]');
    let auctioneer = '';
    for (const a of auctLinks) {
      if (!a.getAttribute('href')?.includes('/lot-') && !a.getAttribute('href')?.includes('/catalogue-id-')) {
        auctioneer = a.textContent?.trim() || '';
        break;
      }
    }

    // Extract structured data from the complementary section
    const comp = article.querySelector('[role="complementary"], complementary, aside')
      || article;
    const getText = (label) => {
      const items = comp.querySelectorAll('li, [class*="detail"], div');
      for (const item of items) {
        if (item.textContent?.includes(label)) {
          const strong = item.querySelector('strong');
          return strong ? strong.textContent.trim() : '';
        }
      }
      // Also check direct text nodes
      const all = comp.querySelectorAll('strong');
      let found = false;
      for (const node of comp.childNodes) {
        if (node.textContent?.includes(label)) { found = true; continue; }
        if (found && node.nodeName === 'STRONG') return node.textContent.trim();
      }
      return '';
    };

    // Get all strong elements in order for positional extraction
    const strongs = Array.from(comp.querySelectorAll('strong')).map(s => s.textContent?.trim() || '');
    const fullText = comp.textContent || '';

    let openingBid = '';
    let estimate = '';
    let distance = '';
    let biddingEnds = '';
    let location = '';

    // Parse labelled values from the text
    if (fullText.includes('Opening bid')) {
      const m = fullText.match(/Opening bid[\\s:]*([\\d,.]+)\\s*(\\w+)/);
      if (m) openingBid = m[1] + ' ' + m[2];
    }
    if (fullText.includes('Estimate')) {
      const m = fullText.match(/Estimate[\\s:]*([\\"\\d,.]+)[\\s-]*([\\"\\d,.]+)?\\s*(\\w+)?/);
      if (m) estimate = (m[1] + (m[2] ? ' - ' + m[2] : '') + (m[3] ? ' ' + m[3] : '')).replace(/"/g, '');
    }
    if (fullText.includes('Distance')) {
      const m = fullText.match(/Distance[\\s:]*(\\d+\\s*miles?)/i);
      if (m) distance = m[1];
    }
    if (fullText.includes('Bidding ends')) {
      const m = fullText.match(/Bidding ends[:\\s]*([\\w\\d\\s]+?)(?:Location|Additional|$)/);
      if (m) biddingEnds = m[1].trim();
    }
    if (fullText.includes('Location')) {
      const m = fullText.match(/Location[:\\s]*([\\w\\s,]+?)$/m);
      if (m) location = m[1].trim();
    }

    results.push({
      title,
      url: href.startsWith('http') ? href : 'https://www.i-bidder.com' + href,
      lotNumber: '',
      currentBid: openingBid || undefined,
      estimate: estimate || undefined,
      imageUrl: img?.src || undefined,
      auctioneer: auctioneer || undefined,
      location: location || undefined,
      distance: distance || undefined,
      biddingEnds: biddingEnds || undefined,
    });
  }
  return results;
})()`;

/**
 * Scrapes i-bidder.com via the CamoFox stealth browser.
 *
 * Each public method creates a tab, navigates, extracts data via JS
 * evaluation, then closes the tab.
 */
export class IBidderScraper {
  private postcode?: string;

  constructor(camofox: CamofoxClient, opts?: { postcode?: string }) {
    this.camofox = camofox;
    this.postcode = opts?.postcode;
  }

  private camofox: CamofoxClient;

  /** Search auction catalogues by keyword. */
  async searchAuctions(opts: SearchOptions): Promise<AuctionCatalogue[]> {
    const params = new URLSearchParams();
    if (opts.query) params.set("keyword", opts.query);
    if (opts.page && opts.page > 1) params.set("pagenumber", String(opts.page));
    const url = `${BASE}/auction-catalogues/search-filter?${params}`;

    const tab = await this.camofox.createTab(url);
    try {
      // Wait for results to render
      await this.camofox.wait(tab.tabId, ".search-results-list, .auction-search-results, .search-result, [class*='auction']", 15000).catch(() => {
        logger.debug("Wait for auction results selector timed out, proceeding with evaluate");
      });

      const catalogues = await this.camofox.evaluate<AuctionCatalogue[]>(
        tab.tabId,
        `(() => {
          const results = [];
          // i-bidder renders auction cards — try common patterns
          const cards = document.querySelectorAll(
            '.search-results-list .search-result, ' +
            '[class*="auction-card"], ' +
            '.auction-search-results > div, ' +
            'a[href*="/catalogue-id-"]'
          );

          // If we found direct links to catalogues, extract from those
          if (cards.length === 0) {
            // Fallback: find all catalogue links on the page
            const links = document.querySelectorAll('a[href*="/catalogue-id-"]');
            const seen = new Set();
            for (const a of links) {
              const href = a.getAttribute('href');
              if (!href || seen.has(href)) continue;
              seen.add(href);
              const card = a.closest('[class*="result"], [class*="card"], [class*="auction"], li, article') || a;
              const img = card.querySelector('img');
              results.push({
                title: a.textContent?.trim() || '',
                url: href.startsWith('http') ? href : 'https://www.i-bidder.com' + href,
                auctioneer: '',
                location: '',
                status: '',
                type: '',
                categories: [],
                imageUrl: img?.src || undefined,
              });
            }
            return results;
          }

          for (const card of cards) {
            const link = card.querySelector('a[href*="/catalogue-id-"]') || (card.tagName === 'A' ? card : null);
            if (!link) continue;
            const href = link.getAttribute('href') || '';
            const img = card.querySelector('img');

            results.push({
              title: link.textContent?.trim() || '',
              url: href.startsWith('http') ? href : 'https://www.i-bidder.com' + href,
              auctioneer: card.querySelector('[class*="auctioneer"], [class*="organizer"]')?.textContent?.trim() || '',
              location: card.querySelector('[class*="location"]')?.textContent?.trim() || '',
              status: card.querySelector('[class*="status"], [class*="ending"], [class*="timer"], [class*="countdown"]')?.textContent?.trim() || '',
              type: card.querySelector('[class*="type"]')?.textContent?.trim() || '',
              categories: Array.from(card.querySelectorAll('[class*="category"] a, [class*="tag"]'))
                .map(el => el.textContent?.trim())
                .filter(Boolean),
              imageUrl: img?.src || undefined,
            });
          }
          return results;
        })()`
      );

      logger.info("searchAuctions", { query: opts.query, found: catalogues.length });
      return catalogues;
    } finally {
      await this.camofox.closeTab(tab.tabId).catch(() => {});
    }
  }

  /** Search lots (items) across all auctions, sorted by distance. */
  async searchLots(opts: SearchOptions): Promise<Lot[]> {
    const postcode = opts.postcode ?? this.postcode;
    const sort = opts.sort ?? (postcode ? "distance" : "publishedDate");
    const params = new URLSearchParams({
      sortTerm: sort,
      countrylocation: "UK",
      pageSize: "120",
    });
    if (postcode) {
      params.set("postCodelocation", postcode);
    }
    if (opts.maxDistance) {
      params.set("distancelocation", String(opts.maxDistance));
    } else {
      // 2147483647 = "any distance" on i-bidder
      params.set("distancelocation", "2147483647");
    }
    if (opts.query) {
      params.set("searchTerm", opts.query);
    }
    if (opts.page && opts.page > 1) {
      params.set("page", String(opts.page));
    }
    const url = `${BASE}/search-results?${params}`;

    const tab = await this.camofox.createTab(url);
    try {
      // Wait for lot article elements to render
      await this.camofox.wait(tab.tabId, "article, h1", 15000).catch(() => {
        logger.debug("Wait for search results timed out, proceeding with evaluate");
      });

      const lots = await this.camofox.evaluate<Lot[]>(
        tab.tabId,
        EXTRACT_LOTS_JS,
      );

      logger.info("searchLots", { query: opts.query, postcode, found: lots.length });
      return lots;
    } finally {
      await this.camofox.closeTab(tab.tabId).catch(() => {});
    }
  }

  /** Get lots within a specific auction catalogue. */
  async getAuctionLots(catalogueUrl: string, page?: number): Promise<Lot[]> {
    let url = catalogueUrl;
    if (page && page > 1) {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}page=${page}`;
    }

    const tab = await this.camofox.createTab(url);
    try {
      await this.camofox.wait(tab.tabId, "[class*='lot'], .lot-list, table", 15000).catch(() => {
        logger.debug("Wait for catalogue lots timed out, proceeding");
      });

      const lots = await this.camofox.evaluate<Lot[]>(
        tab.tabId,
        `(() => {
          const results = [];
          const rows = document.querySelectorAll(
            '[class*="lot-row"], [class*="lot-item"], ' +
            '[class*="lot-card"], tr[class*="lot"], ' +
            'a[href*="/lot-"]'
          );

          const seen = new Set();
          for (const row of rows) {
            const link = row.querySelector('a[href*="/lot-"]') || (row.tagName === 'A' ? row : null);
            if (!link) continue;
            const href = link.getAttribute('href') || '';
            if (seen.has(href)) continue;
            seen.add(href);
            const img = row.querySelector('img');

            results.push({
              title: link.textContent?.trim() || '',
              url: href.startsWith('http') ? href : 'https://www.i-bidder.com' + href,
              lotNumber: row.querySelector('[class*="lot-number"], [class*="lotNumber"], .lot-num')?.textContent?.trim() || '',
              currentBid: row.querySelector('[class*="bid"], [class*="price"], [class*="hammer"]')?.textContent?.trim() || undefined,
              estimate: row.querySelector('[class*="estimate"]')?.textContent?.trim() || undefined,
              imageUrl: img?.src || undefined,
              status: row.querySelector('[class*="status"], [class*="timer"]')?.textContent?.trim() || undefined,
            });
          }
          return results;
        })()`
      );

      logger.info("getAuctionLots", { url: catalogueUrl, found: lots.length });
      return lots;
    } finally {
      await this.camofox.closeTab(tab.tabId).catch(() => {});
    }
  }

  /** Get full details for a specific lot. */
  async getLotDetail(lotUrl: string): Promise<LotDetail> {
    const tab = await this.camofox.createTab(lotUrl);
    try {
      await this.camofox.wait(tab.tabId, "[class*='lot-detail'], [class*='lot-info'], .lot-description, h1", 15000).catch(() => {
        logger.debug("Wait for lot detail timed out, proceeding");
      });

      const detail = await this.camofox.evaluate<LotDetail>(
        tab.tabId,
        `(() => {
          const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
          const getAll = (sel) => Array.from(document.querySelectorAll(sel)).map(el => el.textContent?.trim()).filter(Boolean);

          // Collect all images
          const imageUrls = Array.from(document.querySelectorAll(
            '[class*="lot-image"] img, [class*="gallery"] img, ' +
            '[class*="lot-detail"] img, [class*="carousel"] img'
          )).map(img => img.src).filter(Boolean);

          // Collect key-value attributes from detail tables/lists
          const attributes = {};
          document.querySelectorAll(
            '[class*="detail"] dt, [class*="detail"] th, ' +
            '[class*="attribute"] .label, [class*="spec"] .label'
          ).forEach(label => {
            const value = label.nextElementSibling;
            if (value) {
              const k = label.textContent?.trim();
              const v = value.textContent?.trim();
              if (k && v) attributes[k] = v;
            }
          });

          return {
            title: getText('h1, [class*="lot-title"], [class*="lot-heading"]'),
            url: window.location.href,
            lotNumber: getText('[class*="lot-number"], [class*="lotNumber"]'),
            description: getText('[class*="description"], [class*="lot-desc"]'),
            currentBid: getText('[class*="current-bid"], [class*="bid-amount"], [class*="price"]') || undefined,
            estimate: getText('[class*="estimate"]') || undefined,
            auctioneer: getText('[class*="auctioneer"], [class*="seller"]') || undefined,
            location: getText('[class*="location"]') || undefined,
            saleDate: getText('[class*="sale-date"], [class*="auction-date"], time') || undefined,
            status: getText('[class*="status"], [class*="bidding-status"]') || undefined,
            imageUrls,
            attributes,
          };
        })()`
      );

      logger.info("getLotDetail", { url: lotUrl });
      return detail;
    } finally {
      await this.camofox.closeTab(tab.tabId).catch(() => {});
    }
  }

  /** Take a snapshot of any i-bidder page (for debugging / discovery). */
  async debugSnapshot(url: string): Promise<string> {
    const tab = await this.camofox.createTab(url);
    try {
      // Give the page a moment to load
      await this.camofox.wait(tab.tabId, "body", 10000).catch(() => {});
      const snap = await this.camofox.snapshot(tab.tabId);
      return snap.snapshot;
    } finally {
      await this.camofox.closeTab(tab.tabId).catch(() => {});
    }
  }
}
