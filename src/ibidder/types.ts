/** An auction catalogue listed on i-bidder. */
export interface AuctionCatalogue {
  title: string;
  url: string;
  auctioneer: string;
  location: string;
  /** e.g. "Ending Now", "Starts 10 Jul 14:00" */
  status: string;
  /** e.g. "Timed online", "Live webcast" */
  type: string;
  /** Category tags with lot counts, e.g. "Vehicles (12)" */
  categories: string[];
  imageUrl?: string;
}

/** An individual lot within an auction catalogue. */
export interface Lot {
  title: string;
  url: string;
  lotNumber: string;
  currentBid?: string;
  estimate?: string;
  imageUrl?: string;
  auctioneer?: string;
  /** e.g. "Ending 10 Jul 14:00", "Sold" */
  status?: string;
  /** e.g. "Bristol" */
  location?: string;
  /** e.g. "2 miles" */
  distance?: string;
  /** e.g. "14 Jul" */
  biddingEnds?: string;
}

/** Full details for a single lot. */
export interface LotDetail {
  title: string;
  url: string;
  lotNumber: string;
  description: string;
  currentBid?: string;
  estimate?: string;
  auctioneer?: string;
  location?: string;
  saleDate?: string;
  status?: string;
  imageUrls: string[];
  /** Buyer's commission percentage ex-VAT (e.g. "26.00%"). */
  commissionPercent?: string;
  /** Any additional fields scraped from the detail page. */
  attributes: Record<string, string>;
}

export type SortTerm = "distance" | "publishedDate" | "auctionDate";

export interface SearchOptions {
  query?: string;
  /** Page number (1-based). */
  page?: number;
  /** UK postcode for distance-sorted search. */
  postcode?: string;
  /** Maximum distance in miles (default: any). */
  maxDistance?: number;
  /** Sort order (default: distance). */
  sort?: SortTerm;
}
