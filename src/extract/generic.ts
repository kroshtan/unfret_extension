/**
 * Extract `PageFacts` from a page's DOM: a port of the backend's `facts/extract.py`. Platform extractors
 * (Amazon, bol.com, Walmart) fill in what generic markup (JSON-LD, microdata, Open Graph) doesn't carry.
 *
 * Works on any `Document`: the live page in the browser, or a parsed HTML string in tests (parity with Python).
 */

import {
  type Checkbox,
  emptyFacts,
  emptyReview,
  P2P_PLATFORMS,
  PRIVATE_SELLER_PLATFORMS,
  type PageFacts,
  type Platform,
} from "../shared/facts.js";
import * as amazon from "./amazon.js";
import * as p2p from "./p2p.js";
import * as bolcom from "./bolcom.js";
import * as walmart from "./walmart.js";
import * as widgets from "./widgets.js";
import { extractBusiness, organizations } from "./business.js";
import { extractServiceProfile, SERVICE_PLATFORMS } from "./services.js";
import { extractTestimonials } from "./testimonials.js";
import { extractMarkup } from "./markup.js";
import { cleanBrand } from "./brand.js";
import { attr, cut, dedupe, hostname, squash, tagName, text, urljoin } from "./dom.js";
import { parseCount, parseDate, parseNumber, parseRating } from "./parse.js";
import { pyJsonLength } from "./pyjson.js";

const HIDDEN_STYLE_RE =
  /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![.\d])|opacity\s*:\s*0(?![.\d])|(?:left|top|text-indent)\s*:\s*-\d{3,}px/iu;
export const TIMER_ATTR_RE = /countdown|count-down|timer|hurry|urgency|limited-time|flash-?sale/iu;
const TIMER_SCRIPT_RE =
  /countdown|setInterval\s*\(.{0,200}?(?:hours|minutes|seconds)|evergreen[\s_-]?(?:timer|countdown|clock)|deadline\s*=/isu;
const FEE_RE =
  /(?:service fee|handling fee|processing fee|booking fee|convenience fee|admin(?:istration)? fee|shipping (?:is )?calculated at checkout|taxes and shipping calculated|plus shipping|excl\.? shipping|verzendkosten|servicekosten|administratiekosten|bearbeitungsgebühr|servicegebühr|zzgl\.? versand|frais de (?:service|dossier|traitement)|gastos de (?:gestión|envío)|spese di (?:gestione|spedizione))/giu;
// EU VAT numbers per country (VIES formats), matched against a candidate with its separators removed.
const VAT_RE =
  /^(?:ATU\d{8}|BE0?\d{9}|BG\d{9,10}|CY\d{8}[A-Z]|CZ\d{8,10}|DE\d{9}|DK\d{8}|EE\d{9}|EL\d{9}|ES[A-Z0-9]\d{7}[A-Z0-9]|FI\d{8}|FR[A-HJ-NP-Z0-9]{2}\d{9}|HR\d{11}|HU\d{8}|IE\d[A-Z0-9+*]\d{5}[A-Z]{1,2}|IT\d{11}|LT\d{9,12}|LU\d{8}|LV\d{11}|MT\d{8}|NL\d{9}B\d{2}|PL\d{10}|PT\d{9}|RO\d{2,10}|SE\d{12}|SI\d{8}|SK\d{10}|XI\d{9})$/u;
const VAT_CANDIDATE_RE =
  /(?<![A-Z0-9])(?:AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)[\s.]?[0-9A-Z][0-9A-Z\s.+*]{6,18}/gu;
const LEGAL_RE =
  /(?:impressum|imprint|kvk|kamer van koophandel|handelsregister|registre du commerce|company number|registered in|chamber of commerce|withdraw(?:al)?|widerruf|herroeping|bedenktijd|rétractation|desistimiento|recesso|14[ -](?:day|dagen|tage|jours|días|giorni))/giu;
// The copyright line ("© 2026 Acme Outdoor LLC. All rights reserved."): where a shop most often names its company.
// It sits in the footer, which the page text the backend's skills read leaves out, so it travels with the facts.
const COPYRIGHT_RE = /(?:\bcopyright\s*)?(?:©|\(c\)(?=\s*\d{4}))|\bcopyright(?=\s*\d{4})/giu;
const MAX_COPYRIGHT = 3;
const POLICY_KINDS: [string, RegExp][] = [
  ["refund", /refund|return|retour|widerruf|rétractation|devoluci|reso/iu],
  ["shipping", /shipping|delivery|verzend|versand|livraison|envío|spedizion/iu],
  ["terms", /terms|conditions|voorwaarden|\bagb\b|cgv|condiciones|termini/iu],
  ["privacy", /privacy|datenschutz|confidentialit|privacidad/iu],
  ["contact", /contact|kontakt|contacto|contatti/iu],
  [
    "imprint",
    /impressum|imprint|legal notice|mentions légales|colofon|aviso legal|bedrijfsgegevens|company details/iu,
  ],
];
const SHOPIFY_RE = /cdn\.shopify\.com|Shopify\.theme|myshopify\.com/iu;
const WOO_RE = /woocommerce|wp-content\/plugins\/woocommerce/iu;
const AMAZON_HOST_RE = /(?:^|[\s.])amazon\.[a-z.]+/u;
const BOL_HOST_RE = /(?:^|[\s.])bol\.com/u;
const WALMART_HOST_RE = /(?:^|[\s.])walmart\.com\b/u;
// Peer-to-peer marketplaces and service platforms, by host (the backend's classifier decides the page type).
const HOST_PATTERNS: [Platform, string][] = [
  ["ebay", String.raw`ebay\.[a-z.]+`],
  ["marktplaats", String.raw`marktplaats\.nl`],
  ["2dehands", String.raw`2dehands\.be|2ememain\.be`],
  ["vinted", String.raw`vinted\.[a-z.]+`],
  ["craigslist", String.raw`craigslist\.[a-z.]+`],
  ["facebook", String.raw`facebook\.com`],
  ["werkspot", String.raw`werkspot\.nl`],
  ["thumbtack", String.raw`thumbtack\.com`],
  ["angi", String.raw`angi\.com|angieslist\.com`],
  ["homeadvisor", String.raw`homeadvisor\.com`],
  ["checkatrade", String.raw`checkatrade\.com`],
  ["taskrabbit", String.raw`taskrabbit\.[a-z.]+`],
  ["bark", String.raw`bark\.com`],
  ["houzz", String.raw`houzz\.[a-z.]+`],
  ["myhammer", String.raw`my-hammer\.de|myhammer\.de`],
  ["homeguide", String.raw`homeguide\.com`],
];
const PLATFORM_HOSTS: [Platform, RegExp][] = [
  ["bol.com", BOL_HOST_RE],
  ["walmart", WALMART_HOST_RE],
  ...HOST_PATTERNS.map(([name, hosts]): [Platform, RegExp] => [
    name,
    new RegExp(String.raw`(?:^|[\s.])(?:${hosts})(?![a-z0-9-])`, "u"),
  ]),
];
const COMPARE_AT_RE = /"compare_at_price"\s*:\s*("?)(\d+(?:\.\d+)?)\1/gu;
const VARIANT_PRICE_RE = /"price"\s*:\s*("?)(\d+(?:\.\d+)?)\1/gu;
const VARIANT_ID_RE = /"id"\s*:\s*"?(\d{6,})/gu;
const VARIANT_WINDOW = 1_500; // chars around a compare-at price that belong to the same variant object
const SKIP_HIDDEN = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "head",
  "meta",
  "link",
  "svg",
  "input",
]);
const TRIM_KEYS = [
  "@type",
  "name",
  "brand",
  "sku",
  "gtin",
  "gtin13",
  "gtin12",
  "gtin8",
  "mpn",
  "offers",
  "aggregateRating",
];

const MAX_HIDDEN_CHARS = 300;
const MAX_SNIPPETS = 20;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Python's `str(value)` for the JSON values pages contain (strings, numbers, booleans). */
function str(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

/** Python truthiness for JSON values. */
function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return Boolean(value);
}

/** `value or fallback` with Python truthiness. */
function or(value: unknown, fallback: unknown): unknown {
  return truthy(value) ? value : fallback;
}

/** Extract the facts from a page. `html` is the raw markup (some signals live in script text). */
export function extractFacts(doc: Document, html: string, url = ""): PageFacts {
  const facts = emptyFacts(url);
  facts.platform = platform(doc, html, url);
  scriptsAndMeta(doc, url, facts);
  hiddenText(doc, facts);
  facts.checkboxes = checkboxes(doc).slice(0, 100);
  timers(doc, facts);
  textSignals(doc, facts);
  policyLinks(doc, url, facts);
  images(doc, url, facts);
  mainPhotoFirst(doc, url, facts, structuredData(doc, facts));
  if (facts.platform === "amazon") amazon.extract(doc, facts);
  else if (facts.platform === "bol.com") bolcom.extract(doc, facts);
  else if (facts.platform === "walmart") walmart.extract(doc, facts);
  else if (facts.platform === "shopify") shopify(html, facts, url);
  facts.brand = cleanBrand(facts.brand); // one brand string for every check: no byline phrase, no sentence
  if (!facts.title) facts.title = text(doc.querySelector("h1")) || meta(doc, "og:title");
  const ogImage = meta(doc, "og:image");
  if (facts.image_urls.length === 0 && ogImage) facts.image_urls = [urljoin(url, ogImage)];
  if (PRIVATE_SELLER_PLATFORMS.has(facts.platform)) p2p.extract(doc, facts); // the ad and the account, never the name
  widgets.extract(doc, facts); // reviews and a "was" price the structured data left out
  if (P2P_PLATFORMS.has(facts.platform)) {
    // A private seller's name is never kept.
    facts.seller = "";
    facts.json_ld = withoutSeller(facts.json_ld);
  }
  extractBusiness(doc, url, facts);
  if (!PRIVATE_SELLER_PLATFORMS.has(facts.platform)) {
    const orgs = organizations(doc);
    // A provider's profile: the platform's reviews, without names.
    if (SERVICE_PLATFORMS.has(facts.platform)) extractServiceProfile(doc, facts, orgs);
    // Not on a product page, whose reviews are already in `reviews`.
    else if (facts.json_ld.length === 0 && facts.price === null)
      facts.testimonials = extractTestimonials(doc, orgs);
  }
  extractMarkup(doc, url, facts);
  return facts;
}

/** Product JSON-LD without the offers' seller (on a peer-to-peer ad, a private person's name). */
export function withoutSeller(jsonLd: Json[]): Json[] {
  const offer = (value: unknown): unknown => {
    if (!isObject(value)) return value;
    const copy: Json = {};
    for (const [k, v] of Object.entries(value)) if (k !== "seller") copy[k] = v;
    return copy;
  };
  return jsonLd.map((node) => {
    const offers = node.offers;
    if (offers === undefined) return node;
    return { ...node, offers: Array.isArray(offers) ? offers.map(offer) : offer(offers) };
  });
}

export function platform(doc: Document, html: string, url: string): Platform {
  const host = hostname(url).replace(/^www\./u, "");
  const canonical = doc.querySelector('link[rel~="canonical"]');
  const canonicalHost = canonical ? hostname(attr(canonical, "href")) : "";
  const hosts = `${host} ${canonicalHost}`;
  if (AMAZON_HOST_RE.test(hosts) || (doc.getElementById("productTitle") && doc.getElementById("dp"))) {
    return "amazon";
  }
  for (const [name, pattern] of PLATFORM_HOSTS) if (pattern.test(hosts)) return name;
  if (SHOPIFY_RE.test(html)) return "shopify";
  if (WOO_RE.test(html)) return "woocommerce";
  return "generic";
}

function scriptsAndMeta(doc: Document, url: string, facts: PageFacts): void {
  facts.script_srcs = Array.from(doc.querySelectorAll("script[src]"))
    .map((s) => urljoin(url, attr(s, "src")))
    .slice(0, 300);
  const metas: Record<string, string> = {};
  let count = 0;
  for (const tag of Array.from(doc.querySelectorAll("meta"))) {
    const key = attr(tag, "name") || attr(tag, "property") || attr(tag, "http-equiv");
    const content = attr(tag, "content");
    if (key && content && count < 100) {
      const k = cut(key.toLowerCase(), 100);
      if (!(k in metas)) count++;
      metas[k] = cut(content, 300);
    }
  }
  facts.meta = metas;
}

function hiddenText(doc: Document, facts: PageFacts): void {
  const hidden: string[] = [];
  for (const tag of Array.from(doc.querySelectorAll("*"))) {
    if (SKIP_HIDDEN.has(tagName(tag))) continue;
    const style = attr(tag, "style");
    if (tag.hasAttribute("hidden") || (style && HIDDEN_STYLE_RE.test(style))) {
      const t = text(tag);
      if (Array.from(t).length >= 20) hidden.push(cut(t, MAX_HIDDEN_CHARS));
    }
  }
  facts.hidden_text = dedupe(hidden).slice(0, 100);
}

function checkboxes(doc: Document): Checkbox[] {
  const labelsFor = new Map<string, string>();
  for (const lab of Array.from(doc.querySelectorAll("label[for]")))
    labelsFor.set(attr(lab, "for"), text(lab));
  const boxes: Checkbox[] = [];
  for (const box of Array.from(doc.querySelectorAll("input"))) {
    if (!/^checkbox$/iu.test(attr(box, "type"))) continue;
    let label = labelsFor.get(attr(box, "id")) ?? "";
    const parentLabel = box.parentElement?.closest("label");
    if (!label && parentLabel) label = text(parentLabel);
    if (!label && box.parentElement) label = text(box.parentElement);
    boxes.push({
      label: cut(label, 300),
      name: cut(attr(box, "name"), 300),
      checked: box.hasAttribute("checked"),
    });
  }
  return boxes;
}

export function attrSummary(tag: Element): string {
  const parts: string[] = [];
  const id = attr(tag, "id");
  if (id) parts.push(`id="${id}"`);
  const classes = (tag.getAttribute("class") ?? "").split(/\s+/u).filter(Boolean);
  if (classes.length > 0) parts.push(`class="${classes.join(" ")}"`);
  return cut(parts.join(" "), 120);
}

/** The elements bs4 finds with `class=TIMER_ATTR_RE` followed by those with `id=TIMER_ATTR_RE`. */
export function timerElements(doc: Document): Element[] {
  const all = Array.from(doc.querySelectorAll("*"));
  const byClass = all.filter((el) =>
    (el.getAttribute("class") ?? "")
      .split(/\s+/u)
      .filter(Boolean)
      .some((c) => TIMER_ATTR_RE.test(c)),
  );
  const byId = all.filter((el) => TIMER_ATTR_RE.test(attr(el, "id")));
  return [...byClass, ...byId].filter((el) => !["script", "style"].includes(tagName(el)));
}

export function timerLabel(tag: Element): string {
  return `<${tagName(tag)} ${attrSummary(tag)}> ${cut(text(tag), 80)}`.trim();
}

function timers(doc: Document, facts: PageFacts): void {
  const found = timerElements(doc).map(timerLabel);
  for (const script of Array.from(doc.querySelectorAll("script:not([src])"))) {
    const body = script.textContent;
    const m = TIMER_SCRIPT_RE.exec(body);
    if (m) {
      found.push(`script: ${squash(body.slice(Math.max(0, m.index - 60), m.index + m[0].length + 120))}`);
    }
  }
  for (const src of facts.script_srcs) if (TIMER_ATTR_RE.test(src)) found.push(`script src: ${src}`);
  facts.timers = dedupe(found).slice(0, 50);
}

/**
 * The keyword plus its sentence (up to `before`/`after` chars either side). Widening by slicing instead of a
 * leading `[^.]{0,80}` in the pattern keeps matching linear and finds keywords that share a sentence.
 */
function snippets(re: RegExp, value: string, before: number, after: number): string[] {
  return Array.from(value.matchAll(re), (m) => {
    const start = m.index;
    const end = start + m[0].length;
    let head = value.slice(Math.max(start - before, 0), start);
    const tail = value.slice(end, Math.min(end + after, value.length));
    if (head.includes(".")) head = head.slice(head.lastIndexOf(".") + 1);
    const stop = tail.indexOf(".");
    return squash(head + m[0] + (stop >= 0 ? tail.slice(0, stop) : tail));
  });
}

function textSignals(doc: Document, facts: PageFacts): void {
  const all = text(doc.documentElement);
  facts.fee_mentions = dedupe(snippets(FEE_RE, all, 80, 80)).slice(0, MAX_SNIPPETS);
  facts.vat_ids = dedupe(vatIds(all)).slice(0, 10);
  facts.legal_mentions = dedupe(snippets(LEGAL_RE, all, 60, 100)).slice(0, MAX_SNIPPETS);
  // Not cut at the first full stop like the legal snippets: "Co. LLC" and "L.L.C." have them inside the name.
  const lines = Array.from(all.matchAll(COPYRIGHT_RE), (m) =>
    squash(all.slice(m.index, m.index + m[0].length + 100)),
  );
  facts.copyright_lines = dedupe(lines).slice(0, MAX_COPYRIGHT);
}

function vatIds(value: string): string[] {
  const found: string[] = [];
  for (const m of value.matchAll(VAT_CANDIDATE_RE)) {
    const squashed = m[0].replace(/[\s.]/gu, "");
    // The run may swallow what follows the number; keep its longest prefix that is a valid VAT format.
    for (let end = squashed.length; end > 7; end--) {
      if (VAT_RE.test(squashed.slice(0, end))) {
        found.push(squashed.slice(0, end));
        break;
      }
    }
  }
  return found;
}

function policyLinks(doc: Document, url: string, facts: PageFacts): void {
  const links: Record<string, string> = {};
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = attr(a, "href");
    const label = `${text(a)} ${href}`;
    for (const [kind, pattern] of POLICY_KINDS) {
      if (!(kind in links) && pattern.test(label)) links[kind] = cut(urljoin(url, href), 500);
    }
  }
  facts.policy_links = links;
}

function images(doc: Document, url: string, facts: PageFacts): void {
  const found: string[] = [];
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const src = attr(img, "data-old-hires") || attr(img, "src") || attr(img, "data-src");
    if (src && !src.startsWith("data:") && !src.toLowerCase().endsWith(".svg")) found.push(urljoin(url, src));
  }
  facts.image_urls = dedupe(found).slice(0, 50);
}

// A product with variants is a schema.org ProductGroup (Google's variant markup, which Shopify themes emit) whose
// offers sit on its variants (`hasVariant`); a product page may also state its rating in a separate block whose
// `itemReviewed` is the product.
const PRODUCT_TYPES = new Set(["Product", "ProductGroup"]);

function kinds(node: Json): Set<string> {
  const kind = node["@type"] ?? "";
  const list: unknown[] = Array.isArray(kind) ? kind : [kind];
  return new Set(list.filter((k): k is string => typeof k === "string" && k.length > 0));
}

function aboutAProduct(item: unknown): boolean {
  return isObject(item) && [...kinds(item)].some((k) => PRODUCT_TYPES.has(k));
}

// An AggregateRating of a product, on its own or wrapped in an untyped block; never a shop's own rating.
function productRating(node: Json): Json | null {
  const found = kinds(node);
  const rating = found.has("AggregateRating") ? node : found.size === 0 ? node.aggregateRating : null;
  return isObject(rating) && aboutAProduct(rating.itemReviewed) ? rating : null;
}

function jsonLd(doc: Document): [Json[], Json[]] {
  const products: Json[] = [];
  const ratings: Json[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else if (isObject(node)) {
      if ([...kinds(node)].some((k) => PRODUCT_TYPES.has(k))) products.push(node);
      else {
        const rating = productRating(node);
        if (rating) ratings.push(rating);
      }
      for (const key of ["@graph", "mainEntity", "itemListElement"]) if (key in node) walk(node[key]);
    }
  };
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    if (attr(script, "type") !== "application/ld+json") continue;
    try {
      walk(JSON.parse(script.textContent));
    } catch {
      continue;
    }
  }
  return [products, ratings];
}

function variantField(product: Json, key: string): unknown {
  const variants = product.hasVariant;
  for (const variant of Array.isArray(variants) ? variants : [variants]) {
    if (isObject(variant) && truthy(variant[key])) return variant[key];
  }
  return null;
}

/**
 * The photo checks take a product page's first image as its main photo. Without one in the structured data, the
 * page's own markup comes first in document order: on most shops the header's logo. A product page's Open Graph
 * image is its product photo, so it goes first; pages that don't say they are about a product keep their order.
 */
function mainPhotoFirst(doc: Document, url: string, facts: PageFacts, structured: boolean): void {
  const image = meta(doc, "og:image:secure_url") || meta(doc, "og:image");
  if (structured || !image || image.startsWith("data:")) return;
  const ogType = meta(doc, "og:type").trim().toLowerCase();
  if (
    !["product", "product.item", "product.group", "og:product"].includes(ogType) &&
    !facts.json_ld.some((p) => aboutAProduct(p))
  )
    return;
  facts.image_urls = dedupe([urljoin(url, image), ...facts.image_urls]).slice(0, 50);
}

function trim(node: Json): Json {
  const trimmed: Json = {};
  for (const k of TRIM_KEYS) if (k in node) trimmed[k] = node[k];
  if (pyJsonLength(trimmed) <= 4000) return trimmed;
  const small: Json = {};
  for (const k of ["@type", "name", "brand"]) if (k in trimmed) small[k] = trimmed[k];
  return small;
}

/** Read the product, its offer, rating, reviews and photos from the JSON-LD; whether it named the photos. */
function structuredData(doc: Document, facts: PageFacts): boolean {
  const [products, ratings] = jsonLd(doc);
  facts.json_ld = products.slice(0, 20).map(trim);
  let photos = false;
  const product = products[0];
  if (product) {
    facts.title = facts.title || cut(str(or(product.name, "")), 2000);
    const brand = product.brand;
    facts.brand = facts.brand || cut(str(isObject(brand) ? (brand.name ?? "") : or(brand, "")), 300);
    applyOffer(product.offers, facts);
    applyRating(product.aggregateRating, facts);
    applyReviews(product.review, facts);
    // A ProductGroup (Shopify's, among others) may name its photos on its variants only.
    photos = applyImages(or(product.image, variantField(product, "image")), facts);
  }
  if (ratings[0]) applyRating(ratings[0], facts);
  if (facts.price === null) {
    facts.price = num(meta(doc, "product:price:amount") || meta(doc, "og:price:amount"));
    facts.currency = facts.currency || meta(doc, "product:price:currency") || meta(doc, "og:price:currency");
  }
  // A ProductGroup's own price is its variants' (the page's Open Graph price, read above, is the one on show).
  if (facts.price === null && product) applyOffer(variantField(product, "offers"), facts);
  if (product && facts.list_price === null && facts.price !== null)
    facts.list_price = referencePrice(product.offers, facts.price);
  if (facts.rating === null || facts.rating_count === null) microdataRating(doc, facts);
  if (facts.reviews.length === 0) microdataReviews(doc, facts);
  return products.length > 0 && photos;
}

// A priceSpecification's priceType for a reference price ("https://schema.org/ListPrice", "StrikethroughPrice").
const REFERENCE_TYPE_RE = /(?:ListPrice|StrikethroughPrice|MSRP|SRP)$/iu;

/**
 * The offer's reference price in its structured data: a `priceSpecification` whose `priceType` is a list or
 * strike-through price (Google's markup for a "was" price), above the price on offer.
 */
export function referencePrice(offers: unknown, price: number): number | null {
  const offer = Array.isArray(offers) && offers.length > 0 ? (offers[0] as unknown) : offers;
  const specs = isObject(offer) ? offer.priceSpecification : null;
  for (const spec of Array.isArray(specs) ? specs : [specs]) {
    if (!isObject(spec) || !REFERENCE_TYPE_RE.test(str(or(spec.priceType, "")))) continue;
    const was = num(spec.price);
    if (was !== null && was > price) return was;
  }
  return null;
}

function microdataRating(doc: Document, facts: PageFacts): void {
  const rating = doc.querySelector('[itemprop="aggregateRating"]');
  if (!rating) return;
  const value = rating.querySelector('[itemprop="ratingValue"]');
  const count = rating.querySelector('[itemprop="reviewCount"], [itemprop="ratingCount"]');
  if (facts.rating === null && value) facts.rating = parseRating(attr(value, "content") || text(value));
  if (facts.rating_count === null && count)
    facts.rating_count = parseCount(attr(count, "content") || text(count));
}

function applyOffer(offers: unknown, facts: PageFacts): void {
  const offer = Array.isArray(offers) && offers.length > 0 ? (offers[0] as unknown) : offers;
  if (!isObject(offer)) return;
  if (facts.price === null) facts.price = num(or(offer.price, offer.lowPrice));
  facts.currency = facts.currency || cut(str(or(offer.priceCurrency, "")), 8);
  const seller = offer.seller;
  if (isObject(seller) && !facts.seller) facts.seller = cut(str(or(seller.name, "")), 300);
}

function applyRating(rating: unknown, facts: PageFacts): void {
  if (!isObject(rating)) return;
  if (facts.rating === null) facts.rating = num(rating.ratingValue, 5);
  if (facts.rating_count === null) {
    const count = num(or(rating.ratingCount, rating.reviewCount));
    facts.rating_count = count !== null ? Math.trunc(count) : null;
  }
}

function applyReviews(reviews: unknown, facts: PageFacts): void {
  const items: unknown[] = Array.isArray(reviews) ? reviews : isObject(reviews) ? [reviews] : [];
  for (const r of items.slice(0, 100)) {
    if (!isObject(r)) continue;
    const ratingNode = r.reviewRating;
    const stars = isObject(ratingNode) ? ratingNode.ratingValue : ratingNode;
    facts.reviews.push({
      ...emptyReview(),
      rating: num(stars, 5),
      posted: parseDate(str(or(r.datePublished, ""))),
      title: cut(str(or(r.name, "")), 300),
      body: cut(str(or(r.reviewBody, "")), 2000),
    });
  }
}

function applyImages(imgs: unknown, facts: PageFacts): boolean {
  const items: unknown[] = Array.isArray(imgs) ? imgs : truthy(imgs) ? [imgs] : [];
  // An ImageObject names its file as `url` or as `contentUrl` (IKEA's, among others).
  const urls = items
    .map((i) => (isObject(i) ? or(i.url, i.contentUrl) : i))
    .filter((u): u is string => typeof u === "string" && u.length > 0 && !u.startsWith("data:"))
    .map((u) => urljoin(facts.url, u));
  facts.image_urls = dedupe([...urls, ...facts.image_urls]).slice(0, 50);
  return urls.length > 0;
}

function microdataReviews(doc: Document, facts: PageFacts): void {
  for (const container of Array.from(doc.querySelectorAll('[itemprop="review"]')).slice(0, 100)) {
    const rating = container.querySelector('[itemprop="ratingValue"]');
    const posted = container.querySelector('[itemprop="datePublished"]');
    const body = container.querySelector('[itemprop="reviewBody"]');
    facts.reviews.push({
      ...emptyReview(),
      rating: rating ? parseRating(attr(rating, "content") || text(rating)) : null,
      posted: posted ? parseDate(attr(posted, "content") || text(posted)) : null,
      body: body ? cut(text(body), 2000) : "",
    });
  }
}

function shopifyAmount(digits: string): number {
  // Integer amounts in Shopify's product JSON are cents; a decimal ("29.99", from a theme's money filter) is already
  // in the currency. An integer is never read as whole units: that turned "2495" into a 99% discount.
  return digits.includes(".") ? Number(digits) : Number((Number.parseInt(digits, 10) / 100).toFixed(2));
}

/**
 * The struck-through "was" price of the variant on show, as the backend's `shopify_compare_at` computes it: bound
 * to the `?variant=` in the URL, else to the variant whose own price is the listed price; without either, only a
 * compare-at price every variant shares counts. A value at or below the listed price is never a discount.
 */
export function shopifyCompareAt(html: string, price: number, url = ""): number | null {
  let variant = "";
  try {
    variant = new URL(url).searchParams.get("variant") ?? "";
  } catch {
    // no URL: bind by price only
  }
  const candidates: { was: number; isVariant: boolean; ownPrice: boolean }[] = [];
  for (const m of html.matchAll(COMPARE_AT_RE)) {
    const at = m.index;
    const lo = Math.max(at - VARIANT_WINDOW, 0);
    const ids = Array.from(html.slice(lo, at).matchAll(VARIANT_ID_RE), (id) => id[1]);
    let nearest: RegExpExecArray | null = null;
    let distance = Infinity;
    const window = html.slice(lo, at + m[0].length + VARIANT_WINDOW);
    for (const p of window.matchAll(VARIANT_PRICE_RE)) {
      const d = Math.abs(lo + p.index - at);
      if (d < distance) {
        distance = d;
        nearest = p;
      }
    }
    const own = nearest?.[2] !== undefined ? shopifyAmount(nearest[2]) : null;
    candidates.push({
      was: shopifyAmount(m[2] ?? "0"),
      isVariant: variant !== "" && ids.at(-1) === variant,
      ownPrice: own === price,
    });
  }
  if (candidates.length === 0) return null;
  const bound = candidates.filter((c) => c.isVariant);
  const chosen = bound.length > 0 ? bound : candidates.filter((c) => c.ownPrice);
  const values = new Set((chosen.length > 0 ? chosen : candidates).map((c) => c.was));
  if (values.size !== 1) return null; // variants disagree and none is the one on show
  const [was] = values;
  return was !== undefined && was > price ? was : null;
}

function shopify(html: string, facts: PageFacts, url: string): void {
  if (facts.list_price === null && facts.price !== null)
    facts.list_price = shopifyCompareAt(html, facts.price, url);
}

/** The content of the first `<meta property=key>`, else of the first `<meta name=key>` (as the backend looks). */
export function meta(doc: Document, key: string): string {
  const metas = Array.from(doc.querySelectorAll("meta"));
  const tag =
    metas.find((m) => m.getAttribute("property") === key) ??
    metas.find((m) => m.getAttribute("name") === key);
  return attr(tag, "content");
}

/** The backend's `_number`: JSON numbers as they are, strings parsed; negatives and out-of-range values dropped. */
export function num(value: unknown, maximum?: number): number | null {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  const n = typeof value === "number" ? value : parseNumber(str(value));
  if (n === null || Number.isNaN(n) || n < 0 || (maximum !== undefined && n > maximum)) return null;
  return n;
}
