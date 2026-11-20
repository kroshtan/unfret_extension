/**
 * bol.com product pages (the Dutch/Belgian marketplace): a port of the backend's `facts/bolcom.py`.
 * JSON-LD is already read by the generic extractor (not on every page); this adds the price on offer and its
 * reference price ("Adviesprijs", "Meestal"), the seller, its rating, the review summary, the share of each star and
 * the reviews on the page.
 */

import type { PageFacts, Review } from "../shared/facts.js";
import { attr, cut, text } from "./dom.js";
import { parseCount, parseDate, parseNumber, parsePrice, parseRating } from "./parse.js";

const SELLER_RE = /verkoop door\s+(.+?)(?:\s{2,}|$|\s+\d)/iu;
// The seller block reads "Verkoop door Light Gallery NL beoordeeld met een 8,5": the label before the name and the
// rating after it are not part of it.
const SELLER_LABEL_RE = /^(?:verkoop|verkocht) door\s+/iu;
const SELLER_TAIL_RE = /\s+(?:beoordeeld\b|met een\b|\d).*$/isu;
// The offer's price for a screen reader, the first on the page being the main offer's: "De prijs van dit product is 21
// euro en 99 cent. De adviesprijs is De adviesprijs is 29 euro en 99 cent." ("De meest getoonde prijs is …" for the
// "Meestal" reference).
const PRICE_SENTENCE_RE =
  /De prijs van dit product is (\d+) euro(?: en (\d+) cent)?\.\s*(?:De (?:adviesprijs|meest getoonde prijs) is (?:De adviesprijs is )?(\d+) euro(?: en (\d+) cent)?)?/iu;
// The review summary for a screen reader: "Gemiddeld 4,7 van de 5 sterren uit 20 reviews".
const SUMMARY_RE = /gemiddeld\s+([\d.,]+)\s+van de 5 sterren uit\s+([\d.]+)\s+review/iu;
// One bar of the star distribution: "7 klanten gaven een score van 4 sterren".
const BAR_RE = /(\d+)\s+klanten? gaven een score van\s+([1-5])\s+ster/iu;
const VERIFIED_RE = /heeft dit artikel gekocht/iu;
const MAX_SELLER_BLOCK = 100;
const SELLER_SCORE_RE = /beoordeeld met een\s+(\d{1,2}(?:,\d)?)\s+uit 10/iu;
const SELLER_BLOCK_RE = /^\s*(?:verkoop|verkocht) door(?![\p{L}\p{N}_])/iu;

/** The seller's name from bol.com's seller block, without its label or rating (parity with the backend). */
export function sellerName(blockText: string): string {
  return blockText.trim().replace(SELLER_LABEL_RE, "").replace(SELLER_TAIL_RE, "").trim();
}

/** Fill bol.com-specific facts into `facts` (JSON-LD has already been read). */
export function extract(doc: Document, facts: PageFacts): void {
  facts.title = text(doc.querySelector('[data-test="title"], h1.page-heading')) || facts.title;
  facts.brand = cut(text(doc.querySelector('[data-role="BRAND"], [data-test="brand"]')), 300) || facts.brand;
  prices(doc, facts);
  let seller =
    text(doc.querySelector('[data-test="seller-name"], .seller-name, [data-test="party-link"]')) ||
    sellerBlock(doc);
  // The page text is a last resort: the offer's seller in the JSON-LD (read already) is cleaner.
  if (!seller && !facts.seller) {
    const m = SELLER_RE.exec(text(doc.body));
    if (m) seller = m[1] ?? "";
  }
  facts.seller = cut(sellerName(seller), 300) || facts.seller;
  let sellerRating = text(doc.querySelector('[data-test="seller-rating"], .seller-rating'));
  const score = sellerRating ? null : SELLER_SCORE_RE.exec(seller);
  if (score) sellerRating = score[1] ?? "";
  if (sellerRating) {
    const value = parseNumber(sellerRating);
    // bol.com shows partner ratings on a 10-point scale ("9,1"); store them as a percentage.
    facts.seller_rating = value !== null && value <= 10 ? value * 10 : value;
  }
  const rating = parseRating(text(doc.querySelector('[data-test="rating-suffix"], .rating-stars')));
  if (rating !== null) facts.rating = facts.rating ?? rating;
  const count = parseCount(text(doc.querySelector('[data-test="rating-count"], .rating-count')));
  if (count !== null) facts.rating_count = facts.rating_count ?? count;
  reviews(doc, facts);
}

function prices(doc: Document, facts: PageFacts): void {
  const m = PRICE_SENTENCE_RE.exec(text(doc.querySelector("body")));
  if (m) {
    // The main offer as the page shows it, which the JSON-LD's offer may not be (another seller's, or none).
    const price = euros(m[1] ?? "0", m[2]);
    facts.price = price;
    facts.currency = "EUR";
    if (m[3]) {
      const was = euros(m[3], m[4]);
      if (was > price) facts.list_price = was;
    }
    return;
  }
  const priceTag = doc.querySelector('[data-test="price"]');
  if (facts.price === null && priceTag) {
    const [price, currency] = parsePrice(text(priceTag).replaceAll(" ", ","));
    facts.price = price;
    facts.currency = currency || "EUR";
  }
}

function euros(whole: string, cents: string | undefined): number {
  return Number(`${String(Number(whole))}.${String(Number(cents ?? "0")).padStart(2, "0")}`);
}

/**
 * The offer's seller line: the first short element that starts with the label and names someone ("Verkoop
 * door<!-- --> bol", a partner's "Verkoop door GameResource beoordeeld met een 8,5 uit 10" for a screen reader).
 */
function sellerBlock(doc: Document): string {
  const body = doc.querySelector("body");
  if (!body) return "";
  const walker = doc.createTreeWalker(body, 0x4); // NodeFilter.SHOW_TEXT
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || ["SCRIPT", "STYLE", "TEMPLATE"].includes(parent.tagName)) continue;
    if (!SELLER_BLOCK_RE.test((node as Text).data)) continue;
    const block = text(parent);
    const name = sellerName(block);
    if (block.length <= MAX_SELLER_BLOCK && name && !SELLER_BLOCK_RE.test(name)) return block;
  }
  return "";
}

function reviews(doc: Document, facts: PageFacts): void {
  const summary = SUMMARY_RE.exec(text(doc.querySelector('[data-testid="reviews-summary"]')));
  if (summary) {
    facts.rating = facts.rating ?? parseRating(summary[1] ?? "");
    facts.rating_count = facts.rating_count ?? parseCount(summary[2] ?? "");
  }
  const counts = new Map<number, number>();
  for (const bar of Array.from(doc.querySelectorAll('[data-testid="stars-distribution"] [aria-label]'))) {
    const m = BAR_RE.exec(attr(bar, "aria-label"));
    if (m) counts.set(Number(m[2]), Number(m[1]));
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (counts.size >= 3 && total && Object.keys(facts.rating_histogram).length === 0) {
    facts.rating_histogram = Object.fromEntries([...counts].map(([star, n]) => [String(star), n / total]));
  }
  if (facts.reviews.length === 0) {
    facts.reviews = Array.from(doc.querySelectorAll('[data-testid="review-details"]'))
      .slice(0, 100)
      .map(review);
  }
}

// A review: its stars (an aria-label), its title and date as the first texts (no reviewer's name is kept), a
// "Heeft dit artikel gekocht" line, and the text as the first paragraph.
function review(node: Element): Review {
  const stars = Array.from(node.querySelectorAll("[aria-label]")).find((el) =>
    /^klantbeoordeling/iu.test(attr(el, "aria-label")),
  );
  const leaves = Array.from(node.querySelectorAll("span"))
    .filter((span) => span.children.length === 0)
    .map((span) => text(span))
    .filter(Boolean);
  const posted = leaves.map((t) => (t.length <= 30 ? parseDate(t) : null)).find((d) => d !== null) ?? null;
  const first = leaves[0];
  const title =
    first !== undefined && parseDate(first) === null ? (leaves.find((t) => parseDate(t) === null) ?? "") : "";
  const label = stars ? attr(stars, "aria-label") : "";
  return {
    rating: stars ? parseRating(label.includes(":") ? label.slice(label.indexOf(":") + 1) : "") : null,
    posted,
    title: cut(title, 300),
    body: cut(text(node.querySelector("p")), 2000),
    verified: leaves.some((t) => VERIFIED_RE.test(t)),
  };
}
