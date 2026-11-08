/**
 * bol.com product pages (the Dutch/Belgian marketplace): a port of the backend's `veridex/facts/bolcom.py`.
 * JSON-LD is already read by the generic extractor; this adds the seller, its rating and the review summary.
 */

import type { PageFacts } from "../shared/facts.js";
import { cut, text } from "./dom.js";
import { parseCount, parseNumber, parsePrice, parseRating } from "./parse.js";

const SELLER_RE = /verkoop door\s+(.+?)(?:\s{2,}|$|\s+\d)/iu;

/** Fill bol.com-specific facts into `facts` (JSON-LD has already been read). */
export function extract(doc: Document, facts: PageFacts): void {
  facts.title = text(doc.querySelector('[data-test="title"], h1.page-heading')) || facts.title;
  facts.brand = cut(text(doc.querySelector('[data-role="BRAND"], [data-test="brand"]')), 300) || facts.brand;
  const priceTag = doc.querySelector('[data-test="price"]');
  if (facts.price === null && priceTag) {
    const [price, currency] = parsePrice(text(priceTag).replaceAll(" ", ","));
    facts.price = price;
    facts.currency = currency || "EUR";
  }
  let seller = text(doc.querySelector('[data-test="seller-name"], .seller-name, [data-test="party-link"]'));
  if (!seller) {
    const m = SELLER_RE.exec(text(doc.body));
    if (m) seller = m[1] ?? "";
  }
  facts.seller = cut(seller, 300) || facts.seller;
  const sellerRating = text(doc.querySelector('[data-test="seller-rating"], .seller-rating'));
  if (sellerRating) {
    const value = parseNumber(sellerRating);
    // bol.com shows partner ratings on a 10-point scale ("9,1"); store them as a percentage.
    facts.seller_rating = value !== null && value <= 10 ? value * 10 : value;
  }
  const rating = parseRating(text(doc.querySelector('[data-test="rating-suffix"], .rating-stars')));
  if (rating !== null) facts.rating = facts.rating ?? rating;
  const count = parseCount(text(doc.querySelector('[data-test="rating-count"], .rating-count')));
  if (count !== null) facts.rating_count = facts.rating_count ?? count;
}
