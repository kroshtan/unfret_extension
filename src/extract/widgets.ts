/**
 * Reviews and reference prices from a shop's own markup, where its structured data leaves them out: a port of the
 * backend's `facts/widgets.py`.
 *
 * - WooCommerce's product summary: the struck "was" price (`<del>`) next to the price on offer (`<ins>`), the rating
 *   and count, and the reviews under the product (`#reviews .commentlist`).
 * - Review apps that write their data into the page as attributes: Judge.me (the review widget's average, count,
 *   star histogram and reviews), Loox and Stamped (their rating badge's average and count).
 * - eBay's struck reference price ("List price", "Was") in the item's price section.
 *
 * Every reading here only fills a fact that is still empty.
 */

import type { PageFacts, Review } from "../shared/facts.js";
import { attr, cut, text } from "./dom.js";
import { parseCount, parseDate, parseNumber, parsePrice, parseRating } from "./parse.js";

const MAX_REVIEWS = 100;

const WOO_SUMMARY = ".summary, .entry-summary";
const WOO_WAS = ".price del .amount";
const WOO_NOW = ".price ins .amount";
const WOO_RATING = ".woocommerce-product-rating .rating";
const WOO_COUNT = ".woocommerce-product-rating .count, .woocommerce-review-link .count";
const WOO_REVIEWS = "#reviews .commentlist li.review, #reviews .commentlist li.comment";

const JUDGEME_WIDGET = ".jdgm-rev-widg[data-average-rating]";
const JUDGEME_BAR = ".jdgm-histogram__row[data-rating][data-frequency]";
const JUDGEME_REVIEWS = ".jdgm-rev";
const LOOX_BADGE = ".loox-rating[data-rating][data-raters]";
const STAMPED_BADGE = ".stamped-badge[data-rating]";
const STAMPED_CAPTION = ".stamped-badge-caption[data-reviews]";

const EBAY_WAS =
  ".x-price-section .ux-textspans--STRIKETHROUGH, .x-additional-info .ux-textspans--STRIKETHROUGH";

/** Fill the reviews and the reference price from the shop's own markup where they are still empty. */
export function extract(doc: Document, facts: PageFacts): void {
  if (facts.platform === "woocommerce") woocommerce(doc, facts);
  if (facts.platform === "ebay") wasPrice(facts, Array.from(doc.querySelectorAll(EBAY_WAS)));
  judgeme(doc, facts);
  badges(doc, facts);
}

function woocommerce(doc: Document, facts: PageFacts): void {
  const summary = doc.querySelector(WOO_SUMMARY);
  if (summary) {
    const [now, currency] = parsePrice(text(summary.querySelector(WOO_NOW)));
    if (facts.price === null && now !== null) {
      facts.price = now;
      facts.currency = facts.currency || currency;
    }
    wasPrice(facts, Array.from(summary.querySelectorAll(WOO_WAS)));
    rating(facts, text(summary.querySelector(WOO_RATING)), text(summary.querySelector(WOO_COUNT)));
  }
  if (facts.reviews.length === 0) {
    facts.reviews = Array.from(doc.querySelectorAll(WOO_REVIEWS)).slice(0, MAX_REVIEWS).map(wooReview);
  }
}

function wooReview(node: Element): Review {
  const posted = node.querySelector("time[datetime]");
  return {
    rating: parseRating(text(node.querySelector(".star-rating .rating, .star-rating strong"))),
    posted: posted ? parseDate(attr(posted, "datetime")) : null,
    title: "",
    body: cut(text(node.querySelector(".description")), 2000),
    verified: node.querySelector(".woocommerce-review__verified, .verified") !== null,
  };
}

function judgeme(doc: Document, facts: PageFacts): void {
  const widget = doc.querySelector(JUDGEME_WIDGET);
  if (!widget) return;
  rating(facts, attr(widget, "data-average-rating"), attr(widget, "data-number-of-reviews"));
  const counts = new Map<number, number>();
  for (const bar of Array.from(widget.querySelectorAll(JUDGEME_BAR))) {
    const star = parseCount(attr(bar, "data-rating"));
    const count = parseCount(attr(bar, "data-frequency"));
    if (star !== null && star >= 1 && star <= 5 && count !== null) counts.set(star, count);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (Object.keys(facts.rating_histogram).length === 0 && counts.size >= 3 && total) {
    facts.rating_histogram = Object.fromEntries([...counts].map(([star, n]) => [String(star), n / total]));
  }
  if (facts.reviews.length === 0) {
    facts.reviews = Array.from(widget.querySelectorAll(JUDGEME_REVIEWS))
      .slice(0, MAX_REVIEWS)
      .map(judgemeReview);
  }
}

function judgemeReview(node: Element): Review {
  const score = node.querySelector(".jdgm-rev__rating[data-score]");
  const posted = node.querySelector(".jdgm-rev__timestamp[data-content]");
  return {
    rating: score ? parseRating(attr(score, "data-score")) : null,
    posted: posted ? parseDate(attr(posted, "data-content")) : null,
    title: cut(text(node.querySelector(".jdgm-rev__title")), 300),
    body: cut(text(node.querySelector(".jdgm-rev__body")), 2000),
    verified: attr(node, "data-verified-buyer").toLowerCase() === "true",
  };
}

function badges(doc: Document, facts: PageFacts): void {
  const loox = doc.querySelector(LOOX_BADGE);
  if (loox) rating(facts, attr(loox, "data-rating"), attr(loox, "data-raters"));
  const stamped = doc.querySelector(STAMPED_BADGE);
  if (stamped) {
    const caption = doc.querySelector(STAMPED_CAPTION);
    rating(facts, attr(stamped, "data-rating"), caption ? attr(caption, "data-reviews") : "");
  }
}

// Fill the average and the count when still empty; a badge without a count says too little to count as one.
function rating(facts: PageFacts, value: string, count: string): void {
  const stars = parseRating(value);
  const number = parseCount(count);
  if (facts.rating === null && stars !== null && number) facts.rating = stars;
  if (facts.rating_count === null && number !== null) facts.rating_count = number;
}

// The first struck price above the price on offer.
function wasPrice(facts: PageFacts, tags: Element[]): void {
  if (facts.list_price !== null || facts.price === null) return;
  for (const tag of tags) {
    const was = parseNumber(text(tag));
    if (was !== null && was > facts.price) {
      facts.list_price = was;
      return;
    }
  }
}
