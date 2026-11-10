/**
 * `PageFacts`: the structured facts about a product page, mirroring the backend's pydantic model
 * (`facts.schema.PageFacts`, JSON schema in `pagefacts.schema.json`). Absent facts are `null` or empty,
 * never guessed. Dates are ISO `YYYY-MM-DD` strings; histogram keys are star counts as strings ("1"–"5").
 */

export type Platform = "amazon" | "bol.com" | "walmart" | "shopify" | "woocommerce" | "generic";

export interface Review {
  rating: number | null;
  posted: string | null;
  title: string;
  body: string;
  verified: boolean | null;
}

export interface Checkbox {
  label: string;
  name: string;
  checked: boolean;
}

export interface PageFacts {
  platform: Platform;
  url: string;
  title: string;
  brand: string;
  seller: string;
  seller_rating: number | null;
  ships_from: string;
  price: number | null;
  list_price: number | null;
  currency: string;
  date_first_available: string | null;
  rating: number | null;
  rating_count: number | null;
  rating_histogram: Record<string, number>;
  reviews: Review[];
  variations: string[];
  json_ld: Record<string, unknown>[];
  script_srcs: string[];
  meta: Record<string, string>;
  hidden_text: string[];
  checkboxes: Checkbox[];
  timers: string[];
  fee_mentions: string[];
  vat_ids: string[];
  legal_mentions: string[];
  copyright_lines: string[];
  policy_links: Record<string, string>;
  image_urls: string[];
}

export function emptyFacts(url = ""): PageFacts {
  return {
    platform: "generic",
    url,
    title: "",
    brand: "",
    seller: "",
    seller_rating: null,
    ships_from: "",
    price: null,
    list_price: null,
    currency: "",
    date_first_available: null,
    rating: null,
    rating_count: null,
    rating_histogram: {},
    reviews: [],
    variations: [],
    json_ld: [],
    script_srcs: [],
    meta: {},
    hidden_text: [],
    checkboxes: [],
    timers: [],
    fee_mentions: [],
    vat_ids: [],
    legal_mentions: [],
    copyright_lines: [],
    policy_links: {},
    image_urls: [],
  };
}

export function emptyReview(): Review {
  return { rating: null, posted: null, title: "", body: "", verified: null };
}
