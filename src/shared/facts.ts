/**
 * `PageFacts`: the structured facts about a page, mirroring the backend's pydantic model
 * (`facts.schema.PageFacts`, JSON schema in `pagefacts.schema.json`). Absent facts are `null` or empty,
 * never guessed. Dates are ISO `YYYY-MM-DD` strings; histogram keys are star counts as strings ("1"–"5").
 *
 * The business fields (contacts, identity statements, payment methods) are what a shop or service company
 * publishes about itself; nothing about the person viewing the page belongs here. A private seller's name is never
 * kept. `seller_profile` and `listing` are for platform extractors (peer-to-peer ads, service platforms).
 */

export type Platform =
  | "amazon"
  | "bol.com"
  | "walmart"
  | "shopify"
  | "woocommerce"
  | "ebay"
  | "marktplaats"
  | "2dehands"
  | "vinted"
  | "craigslist"
  | "facebook"
  | "werkspot"
  | "thumbtack"
  | "angi"
  | "homeadvisor"
  | "checkatrade"
  | "taskrabbit"
  | "bark"
  | "houzz"
  | "myhammer"
  | "generic";

/** Platforms where the seller is usually a private person: their name is never kept. */
export const P2P_PLATFORMS = new Set<Platform>([
  "marktplaats",
  "2dehands",
  "vinted",
  "craigslist",
  "facebook",
]);
/** Platforms where the seller may be a private person: only product IDs and payment methods are read there. */
export const PRIVATE_SELLER_PLATFORMS = new Set<Platform>([...P2P_PLATFORMS, "ebay"]);

export type PhoneKind = "mobile" | "local" | "national" | "toll_free" | "premium" | "unknown";
export type EmailKind = "own_domain" | "webmail" | "other";
export type SellerType = "" | "business" | "private";

export interface Phone {
  number: string;
  kind: PhoneKind;
  country: string;
}

export interface Email {
  address: string;
  kind: EmailKind;
}

export interface Licence {
  number: string;
  state: string;
}

export interface Link {
  text: string;
  url: string;
}

/** The seller or provider as the platform shows them: never their name. */
export interface SellerProfile {
  seller_type: SellerType;
  member_since: string | null;
  rating: number | null;
  rating_count: number | null;
  badges: string[];
  other_listings: number | null;
  response_time: string;
  response_rate: number | null;
  jobs_completed: number | null;
  years_in_business: number | null;
}

/** A testimonial a service company publishes on its own site; the name only as the site prints it. */
export interface Testimonial {
  text: string;
  name: string;
  rating: number | null;
  posted: string | null;
}

/** A peer-to-peer ad: the item and the deal as the platform shows them (the price is `PageFacts.price`). */
export interface ListingDetails {
  negotiable: boolean | null;
  bidding: boolean | null;
  condition: string;
  category: string;
  listed: string | null;
  location: string;
  delivery: ("shipping" | "pickup")[];
  payment_protection: boolean | null;
  contact_methods: string[];
  payment_requests: string[];
}

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
  product_ids: Record<string, string>;
  payment_methods: string[];
  phones: Phone[];
  emails: Email[];
  addresses: string[];
  founded_claims: string[];
  business_name: string;
  legal_form: string;
  kvk_numbers: string[];
  licences: Licence[];
  certifications: string[];
  cities_served: string[];
  internal_links: Link[];
  pricing_terms: string[];
  promises: string[];
  testimonials: Testimonial[];
  organization_ld: Record<string, unknown>[];
  seller_profile: SellerProfile | null;
  listing: ListingDetails | null;
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
    product_ids: {},
    payment_methods: [],
    phones: [],
    emails: [],
    addresses: [],
    founded_claims: [],
    business_name: "",
    legal_form: "",
    kvk_numbers: [],
    licences: [],
    certifications: [],
    cities_served: [],
    internal_links: [],
    pricing_terms: [],
    promises: [],
    testimonials: [],
    organization_ld: [],
    seller_profile: null,
    listing: null,
  };
}

export function emptyReview(): Review {
  return { rating: null, posted: null, title: "", body: "", verified: null };
}
