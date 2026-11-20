/**
 * Amazon product detail pages on any Amazon TLD: a port of the backend's `facts/amazon.py`.
 *
 * Amazon's markup varies by locale and layout generation, so each fact tries the known variants in order and
 * leaves the fact empty when none match.
 */

import type { PageFacts, Review } from "../shared/facts.js";
import { cleanBrand } from "./brand.js";
import { attr, cut, rawDecode, stripChars, text } from "./dom.js";
import { parseCount, parseDate, parsePrice, parseRating } from "./parse.js";

const FIRST_AVAILABLE_RE =
  /date first available|im angebot von amazon|disponible depuis le|datum eerste beschikbaarheid|producto en amazon desde|disponibile su amazon/iu;
const BRAND_KEY_RE = /^(?:brand|marke|marque|merk|marca|manufacturer|hersteller)/iu;
// A row that names the brand itself, not its manufacturer.
const BRAND_ONLY_RE = /^(?:brand|marke|marque|merk|marca|marka|märke|varumärke|marchio)$/iu;
// The byline link's search filter by brand (`field-brandtextbin=Duracell`); a store link's path is the store's
// name, which isn't always the brand's ("AmazonBasics" for Amazon Basics).
const BYLINE_BRAND_PARAMS = ["field-brandtextbin", "field-brand"];
// The buybox's labels for who ships and who sells, in Amazon's languages. The current offer box names both in one
// label when one company does both ("Shipper / Seller", "Verzender / Verkoper", "Versender / Verkäufer",
// "Expéditeur / Vendeur"): such a row fills both facts.
const SHIPS_FROM_RE =
  /ships from|shipper|dispatches from|versand|versender|expédié par|expéditeur|verzonden door|verzender|enviado desde|enviado por|remitente|spedizion|spedito da|mittente|wysyłka|nadawca|skickas från|avsändare|gönderici/iu;
const SOLD_BY_RE =
  /sold by|seller|verkäufer|verkauf durch|vendu par|vendeur|verkocht door|verkoper|vendido por|vendedor|venduto da|venditore|sprzedawca|sprzedawane przez|säljs av|säljare|satıcı/iu;
const STAR_ROW_RE = /([1-5])\s*(?:star|stern|étoile|ster|estrella|stell)/iu;
const PERCENT_RE = /(\d{1,3})\s*%/u;
const ARIA_HISTOGRAM_RE =
  /(\d{1,3})\s*(?:percent|prozent|pour cent|procent|por ciento|per cento).*?([1-5])/iu;
const MERCHANT_RE = /ships from (.+?) and sold by (.+?)\./iu;
const MERCHANT_SAME_RE = /ships from and sold by (.+?)\./iu;
// Media bylines carry the format after the artist ("Etta James (Artist) Format: Audio CD").
const FORMAT_SUFFIX_RE = /\s+(?:format|formaat|formato)\s*:.*$/iu;
// Amazon wraps detail-table cells in left-to-right / right-to-left marks.
const MARKS = " :‎‏";

// The product gallery, in its order. The desktop page names it in its image block's script
// (`'colorImages': { 'initial': [{"hiRes": …, "large": …, "main": {url: [w, h]}, "variant": "MAIN"}, …] }`, as JSON or
// as a JSON string to `parseJSON`); the mobile page puts each photo's large copy on its carousel slide
// (`data-a-hires`); the desktop thumbnails (`#altImages`) are the last resort, made large. Only Amazon's product
// images (`/images/I/`): no banners, sprites or pixels (`/images/G/`), no video thumbnails or badges.
export const GALLERY_MAX = 12;
const GALLERY_INITIAL_RE =
  /['"]colorImages['"]\s*:\s*\{\s*['"]initial['"]\s*:\s*(?:[\w$.]*parseJSON\(\s*')?/u;
const GALLERY_MOBILE_SELECTORS = "#image-block .media-block-image-tag[data-a-hires]";
const GALLERY_THUMB_SELECTORS = "#altImages li.imageThumbnail img";
const PRODUCT_IMAGE_RE =
  /^https:\/\/[A-Za-z0-9.-]*(?:media-amazon\.com|images-amazon\.com)\/images\/I\/([A-Za-z0-9_%+-]+)\.(?:[^/?#]*\.)?(?:jpe?g|png|webp)$/iu;
const SIZE_MODIFIER_RE = /\._[^/]*_\.(jpe?g|png|webp)$/iu;

const PRICE_SELECTORS =
  "#corePrice_feature_div .a-offscreen, #corePriceDisplay_desktop_feature_div .a-offscreen, #priceblock_ourprice, #priceblock_dealprice, .a-price .a-offscreen";
const LIST_PRICE_SELECTORS =
  ".basisPrice .a-offscreen, .a-text-price .a-offscreen, #listPrice, #priceblock_listprice";
const DETAIL_ROW_SELECTORS =
  "#prodDetails tr, #productDetails_detailBullets_sections1 tr, #productDetails_techSpec_section_1 tr";
const OFFER_BLOCK_SELECTORS =
  '[offer-display-feature-name$="-fulfiller-info"], [offer-display-feature-name$="-merchant-info"]';
const VARIATION_SELECTORS =
  "#twister li, #variation_color_name li, #variation_size_name li, #inline-twister li";
const REVIEW_STAR_SELECTORS =
  '[data-hook="review-star-rating"], [data-hook="cmps-review-star-rating"], .a-icon-alt';

/** Fill Amazon-specific facts into `facts` (generic markup has already been read). */
export function extract(doc: Document, facts: PageFacts): void {
  titleAndBrand(doc, facts);
  prices(doc, facts);
  ratings(doc, facts);
  details(doc, facts);
  seller(doc, facts);
  reviews(doc, facts);
  variationsAndImages(doc, facts);
}

function titleAndBrand(doc: Document, facts: PageFacts): void {
  facts.title = text(doc.getElementById("productTitle")) || facts.title;
  // Structured data first (the product's JSON-LD, the overview table's and the detail table's brand row, the
  // byline link's brand filter), then the byline's text without the phrase around it; a manufacturer row is the
  // last resort (in details).
  const rows = detailRows(doc);
  const byline = doc.getElementById("bylineInfo");
  const brandRows = (from: Map<string, string>): string[] =>
    Array.from(from)
      .filter(([key]) => BRAND_ONLY_RE.test(key))
      .map(([, value]) => value);
  const candidates = [
    facts.brand,
    ...brandRows(overviewRows(doc)),
    ...brandRows(rows),
    bylineParam(byline),
    text(byline).replace(FORMAT_SUFFIX_RE, ""),
  ];
  facts.brand = "";
  for (const candidate of candidates) {
    const brand = cleanBrand(candidate);
    if (brand) {
      facts.brand = brand;
      break;
    }
  }
}

function overviewRows(doc: Document): Map<string, string> {
  const rows = new Map<string, string>();
  for (const tr of Array.from(doc.querySelectorAll("#productOverview_feature_div tr"))) {
    const cells = tr.querySelectorAll("td");
    if (cells.length >= 2) {
      const key = stripChars(text(cells[0]), MARKS);
      if (!rows.has(key)) rows.set(key, stripChars(text(cells[1]), MARKS));
    }
  }
  return rows;
}

function bylineParam(byline: Element | null): string {
  if (!byline) return "";
  const link = byline.tagName === "A" ? byline : byline.querySelector("a");
  const href = link?.getAttribute("href");
  if (href === null || href === undefined) return "";
  let query: URLSearchParams;
  try {
    query = new URL(href, "https://www.amazon.com/").searchParams;
  } catch {
    return "";
  }
  for (const param of BYLINE_BRAND_PARAMS) {
    const value = query.get(param);
    if (value) return value;
  }
  return "";
}

function prices(doc: Document, facts: PageFacts): void {
  const priceTag = doc.querySelector(PRICE_SELECTORS);
  if (priceTag) {
    const [price, currency] = parsePrice(text(priceTag));
    facts.price = price ?? facts.price;
    facts.currency = currency || facts.currency;
  }
  const listTag = doc.querySelector(LIST_PRICE_SELECTORS);
  if (listTag) {
    const [listPrice] = parsePrice(text(listTag));
    if (listPrice !== null && (facts.price === null || listPrice > facts.price)) facts.list_price = listPrice;
  }
}

function ratings(doc: Document, facts: PageFacts): void {
  const rating = parseRating(text(doc.querySelector("#averageCustomerReviews .a-icon-alt")));
  if (rating !== null) facts.rating = rating;
  const count = parseCount(text(doc.getElementById("acrCustomerReviewText")));
  if (count !== null) facts.rating_count = count;
  const shares = histogram(doc);
  if (Object.keys(shares).length > 0) facts.rating_histogram = shares;
}

function details(doc: Document, facts: PageFacts): void {
  for (const [key, value] of detailRows(doc)) {
    if (FIRST_AVAILABLE_RE.test(key)) facts.date_first_available = parseDate(value);
    else if (!facts.brand && BRAND_KEY_RE.test(key)) facts.brand = cleanBrand(value);
  }
}

function seller(doc: Document, facts: PageFacts): void {
  for (const [key, value] of buyboxRows(doc)) {
    if (SHIPS_FROM_RE.test(key)) facts.ships_from = cut(value, 300);
    if (SOLD_BY_RE.test(key)) facts.seller = cut(value, 300);
  }
  if (!facts.seller) {
    facts.seller = cut(
      text(doc.getElementById("sellerProfileTriggerId") ?? doc.querySelector("#merchant-info a")),
      300,
    );
  }
}

function reviews(doc: Document, facts: PageFacts): void {
  const found: Review[] = Array.from(doc.querySelectorAll('[data-hook="review"]'))
    .slice(0, 100)
    .map((node) => ({
      rating: parseRating(text(node.querySelector(REVIEW_STAR_SELECTORS))),
      posted: parseDate(text(node.querySelector('[data-hook="review-date"]'))),
      title: cut(text(node.querySelector('[data-hook="review-title"]')), 300),
      body: cut(text(node.querySelector('[data-hook="review-body"]')), 2000),
      verified: node.querySelector('[data-hook^="avp-badge"]') !== null,
    }));
  if (found.length > 0) facts.reviews = found;
}

function variationsAndImages(doc: Document, facts: PageFacts): void {
  const variations = Array.from(doc.querySelectorAll(VARIATION_SELECTORS)).map((li) => {
    const value = attr(li, "title") || text(li);
    return value.startsWith("Click to select ") ? value.slice("Click to select ".length) : value;
  });
  const kept = variations
    .filter(Boolean)
    .map((v) => cut(v, 200))
    .slice(0, 100);
  if (kept.length > 0) facts.variations = kept;
  const photos = gallery(doc);
  if (photos.length > 0) {
    facts.image_urls = photos; // the product's own photos, not the page's banners and pixels
    return;
  }
  const image = doc.getElementById("landingImage");
  if (image) {
    const src = attr(image, "data-old-hires") || attr(image, "src");
    if (src) facts.image_urls = [src, ...facts.image_urls.filter((u) => u !== src)].slice(0, 50);
  }
}

/** The product gallery's photos, large, in order: the first of the page's three ways of naming them that does. */
function gallery(doc: Document): string[] {
  for (const found of [galleryScript(doc), galleryMobile(doc), galleryThumbnails(doc)]) {
    const photos = new Map<string, string>();
    for (const url of found) {
      const m = PRODUCT_IMAGE_RE.exec(url);
      if (m?.[1] && !photos.has(m[1])) photos.set(m[1], url);
    }
    if (photos.size > 0) return [...photos.values()].slice(0, GALLERY_MAX);
  }
  return [];
}

function galleryScript(doc: Document): string[] {
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    const body = script.textContent;
    if (!body.includes("colorImages")) continue;
    const m = GALLERY_INITIAL_RE.exec(body);
    if (!m) continue;
    const items = rawDecode(body, m.index + m[0].length);
    if (!Array.isArray(items)) return [];
    return items.filter(isRecord).map(galleryUrl);
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The high-resolution copy, else the large one, else the largest the page shows.
function galleryUrl(item: Record<string, unknown>): string {
  for (const key of ["hiRes", "large"]) {
    const value = item[key];
    if (typeof value === "string" && value) return value;
  }
  let best = "";
  let width = -1;
  const main = item["main"];
  for (const [url, size] of Object.entries(isRecord(main) ? main : {})) {
    const first: unknown = Array.isArray(size) ? size[0] : undefined;
    const digits = typeof first === "number" ? String(first) : typeof first === "string" ? first : "";
    if (/^\d+$/u.test(digits) && Number(digits) > width) {
      best = url;
      width = Number(digits);
    }
  }
  return best;
}

function galleryMobile(doc: Document): string[] {
  return Array.from(doc.querySelectorAll(GALLERY_MOBILE_SELECTORS)).map((el) => attr(el, "data-a-hires"));
}

function galleryThumbnails(doc: Document): string[] {
  return Array.from(doc.querySelectorAll(GALLERY_THUMB_SELECTORS))
    .filter((img) => img.hasAttribute("src"))
    .map((img) => attr(img, "src").replace(SIZE_MODIFIER_RE, "._AC_SL1500_.$1"));
}

function histogram(doc: Document): Record<string, number> {
  const shares = new Map<number, number>();
  for (const row of Array.from(
    doc.querySelectorAll("#histogramTable tr, #histogramTable li, #cm_cr_dp_d_rating_histogram li"),
  )) {
    const rowText = text(row);
    const aria = Array.from(row.querySelectorAll("[aria-label]"))
      .map((a) => attr(a, "aria-label"))
      .join(" ");
    const ariaMatch = aria ? ARIA_HISTOGRAM_RE.exec(aria) : null;
    if (ariaMatch) {
      shares.set(Number(ariaMatch[2]), Number(ariaMatch[1]) / 100);
      continue;
    }
    const star = STAR_ROW_RE.exec(rowText);
    const pct = PERCENT_RE.exec(rowText);
    if (star && pct) shares.set(Number(star[1]), Number(pct[1]) / 100);
  }
  return shares.size >= 3 ? Object.fromEntries(Array.from(shares, ([k, v]) => [String(k), v])) : {};
}

function detailRows(doc: Document): Map<string, string> {
  const rows = new Map<string, string>();
  for (const tr of Array.from(doc.querySelectorAll(DETAIL_ROW_SELECTORS))) {
    const key = tr.querySelector("th");
    const value = tr.querySelector("td");
    if (key && value) rows.set(stripChars(text(key), MARKS), stripChars(text(value), MARKS));
  }
  for (const li of Array.from(doc.querySelectorAll("#detailBullets_feature_div li"))) {
    const parts = Array.from(li.querySelectorAll("span.a-text-bold, span.a-list-item > span")).map((s) =>
      text(s),
    );
    if (parts.length >= 2) rows.set(stripChars(parts[0] ?? "", MARKS), stripChars(parts.at(-1) ?? "", MARKS));
  }
  return rows;
}

function buyboxRows(doc: Document): Map<string, string> {
  const rows = new Map<string, string>();
  for (const row of Array.from(
    doc.querySelectorAll("#tabular-buybox tr, #tabular-buybox .tabular-buybox-container > div"),
  )) {
    const cells = Array.from(row.querySelectorAll("td, .tabular-buybox-text")).map((c) => text(c));
    if (cells.length >= 2) rows.set(cells[0] ?? "", cells[1] ?? "");
  }
  for (const [label, value] of offerDisplayRows(doc)) {
    if (!rows.has(label)) rows.set(label, value);
  }
  const merchant = text(doc.getElementById("merchant-info"));
  const m = merchant ? MERCHANT_RE.exec(merchant) : null;
  const same = merchant && !m ? MERCHANT_SAME_RE.exec(merchant) : null;
  const [shipsFrom, soldBy] = m ? [m[1], m[2]] : same ? [same[1], same[1]] : [undefined, undefined];
  if (shipsFrom !== undefined && !rows.has("Ships from")) rows.set("Ships from", shipsFrom);
  if (soldBy !== undefined && !rows.has("Sold by")) rows.set("Sold by", soldBy);
  return rows;
}

/**
 * The offer display shows each feature as a label element and a text element, either nested in one block or as
 * two siblings that share the feature name (the current amazon.com layout).
 */
function offerDisplayRows(doc: Document): Map<string, string> {
  const rows = new Map<string, string>();
  const labels = new Map<string, string>();
  const values = new Map<string, string>();
  for (const block of Array.from(doc.querySelectorAll(OFFER_BLOCK_SELECTORS))) {
    const feature = attr(block, "offer-display-feature-name");
    const label = text(block.querySelector(".offer-display-feature-label"));
    const value = text(
      block.querySelector(".offer-display-feature-text-message, .offer-display-feature-text"),
    );
    if (label && value) rows.set(label, value);
    else if (block.classList.contains("offer-display-feature-label")) {
      if (!labels.has(feature)) labels.set(feature, text(block));
    } else if (block.classList.contains("offer-display-feature-text") && !values.has(feature)) {
      values.set(feature, text(block.querySelector(".offer-display-feature-text-message") ?? block));
    }
  }
  for (const [feature, label] of labels) {
    const value = values.get(feature);
    if (label && value && !rows.has(label)) rows.set(label, value);
  }
  return rows;
}
