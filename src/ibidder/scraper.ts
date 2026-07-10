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
 * Scrapes i-bidder.com via the CamoFox stealth browser.
 *
 * Each public method creates a tab, navigates, extracts data via JS
 * evaluation, then closes the tab.
 */
export class IBidderScraper {
  constructor(private camofox: CamofoxClient) {}

  /** Search auction catalogues by keyword. */
  async searchAuctions(opts: SearchOptions): Promise<AuctionCatalogue[]> {
    const params = new URLSearchParams({ keyword: opts.query });
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

  /** Search lots (items) across all auctions. */
  async searchLots(opts: SearchOptions): Promise<Lot[]> {
    // i-bidder's lot search is JS-driven — the search form calls
    // AddSearchParametersToQuerystring() which builds a URL client-side.
    // We load the homepage and programmatically fill + submit the search
    // form via evaluate to avoid cookie-consent overlays and ref instability.
    const tab = await this.camofox.createTab(BASE);
    try {
      // Wait for the search box to appear
      await this.camofox.wait(tab.tabId, "[name='main-search-term']", 15000);

      // Fill the search box and submit the form entirely via JS.
      // This bypasses cookie consent overlays and the JS-driven onsubmit.
      await this.camofox.evaluate(tab.tabId, `(() => {
        const input = document.querySelector('[name="main-search-term"]');
        if (!input) throw new Error('search input not found');
        input.value = ${JSON.stringify(opts.query)};
        const form = input.closest('form');
        if (form) {
          // Trigger the site's own JS handler if available
          if (typeof AddSearchParametersToQuerystring === 'function') {
            AddSearchParametersToQuerystring(form);
          } else {
            form.submit();
          }
        }
      })()`);

      // Wait for search results page to load
      await this.camofox.wait(tab.tabId, "a[href*='/lot-'], [class*='lot'], .search-results, h1", 15000).catch(() => {
        logger.debug("Wait for lot results selector timed out, proceeding with evaluate");
      });

      const lots = await this.camofox.evaluate<Lot[]>(
        tab.tabId,
        `(() => {
          const results = [];
          // Try lot-specific selectors
          const cards = document.querySelectorAll(
            '.lot-search-results .lot, ' +
            '[class*="lot-card"], ' +
            '[class*="lot-item"], ' +
            '.search-results .result, ' +
            'a[href*="/lot-"]'
          );

          if (cards.length === 0) {
            // Fallback: find all lot links
            const links = document.querySelectorAll('a[href*="/lot-"]');
            const seen = new Set();
            for (const a of links) {
              const href = a.getAttribute('href');
              if (!href || seen.has(href)) continue;
              seen.add(href);
              results.push({
                title: a.textContent?.trim() || '',
                url: href.startsWith('http') ? href : 'https://www.i-bidder.com' + href,
                lotNumber: '',
              });
            }
            return results;
          }

          for (const card of cards) {
            const link = card.querySelector('a[href*="/lot-"]') || (card.tagName === 'A' ? card : null);
            if (!link) continue;
            const href = link.getAttribute('href') || '';
            const img = card.querySelector('img');

            results.push({
              title: link.textContent?.trim() || '',
              url: href.startsWith('http') ? href : 'https://www.i-bidder.com' + href,
              lotNumber: card.querySelector('[class*="lot-number"], [class*="lotNumber"]')?.textContent?.trim() || '',
              currentBid: card.querySelector('[class*="bid"], [class*="price"]')?.textContent?.trim() || undefined,
              estimate: card.querySelector('[class*="estimate"]')?.textContent?.trim() || undefined,
              imageUrl: img?.src || undefined,
              status: card.querySelector('[class*="status"], [class*="ending"], [class*="timer"]')?.textContent?.trim() || undefined,
            });
          }
          return results;
        })()`
      );

      logger.info("searchLots", { query: opts.query, found: lots.length });
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
