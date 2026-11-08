/**
 * Amazon product detail pages on any Amazon TLD: a port of the backend's `veridex/facts/amazon.py`.
 *
 * Amazon's markup varies by locale and layout generation, so each fact tries the known variants in order and
 * leaves the fact empty when none match.
 */

import type { PageFacts, Review } from "../shared/facts.js";
import { attr, cut, stripChars, text } from "./dom.js";
import { parseCount, parseDate, parsePrice, parseRating } from "./parse.js";

const BYLINE_RE =
  /^(?:visit the|besuchen sie den|visitez la boutique|bezoek de|visita la tienda de|visita lo store di)\s+(.+?)(?:\s+store|-store|-shop|\s+boutique)?$|^(?:brand|marke|marque|merk|marca)\s*:\s*(.+)$/iu;
const FIRST_AVAILABLE_RE =
  /date first available|im angebot von amazon|disponible depuis le|datum eerste beschikbaarheid|producto en amazon desde|disponibile su amazon/iu;
const BRAND_KEY_RE = /^(?:brand|marke|marque|merk|marca|manufacturer|hersteller)/iu;
const SHIPS_FROM_RE = /ships from|versand|expédié par|verzonden door|enviado desde|spedizione/iu;
const SOLD_BY_RE = /sold by|verkäufer|vendu par|verkocht door|vendido por|venduto da/iu;
const STAR_ROW_RE = /([1-5])\s*(?:star|stern|étoile|ster|estrella|stell)/iu;
const PERCENT_RE = /(\d{1,3})\s*%/u;
const ARIA_HISTOGRAM_RE =
  /(\d{1,3})\s*(?:percent|prozent|pour cent|procent|por ciento|per cento).*?([1-5])/iu;
const MERCHANT_RE = /ships from (.+?) and sold by (.+?)\./iu;
// Amazon wraps detail-table cells in left-to-right / right-to-left marks.
const MARKS = " :‎‏";

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
  const byline = text(doc.getElementById("bylineInfo"));
  if (byline) {
    const m = BYLINE_RE.exec(byline);
    facts.brand = cut((m ? (m[1] ?? m[2] ?? "") : byline).trim(), 300);
  }
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
    else if (!facts.brand && BRAND_KEY_RE.test(key)) facts.brand = cut(value, 300);
  }
}

function seller(doc: Document, facts: PageFacts): void {
  for (const [key, value] of buyboxRows(doc)) {
    if (SHIPS_FROM_RE.test(key)) facts.ships_from = cut(value, 300);
    else if (SOLD_BY_RE.test(key)) facts.seller = cut(value, 300);
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
      verified: node.querySelector('[data-hook="avp-badge"]') !== null,
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
  const image = doc.getElementById("landingImage");
  if (image) {
    const src = attr(image, "data-old-hires") || attr(image, "src");
    if (src) facts.image_urls = [src, ...facts.image_urls.filter((u) => u !== src)].slice(0, 50);
  }
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
  for (const block of Array.from(doc.querySelectorAll(OFFER_BLOCK_SELECTORS))) {
    const label = text(block.querySelector(".offer-display-feature-label"));
    const value = text(block.querySelector(".offer-display-feature-text"));
    if (label && value) rows.set(label, value);
  }
  const merchant = text(doc.getElementById("merchant-info"));
  const m = merchant ? MERCHANT_RE.exec(merchant) : null;
  if (m) {
    if (!rows.has("Ships from")) rows.set("Ships from", m[1] ?? "");
    if (!rows.has("Sold by")) rows.set("Sold by", m[2] ?? "");
  }
  return rows;
}
