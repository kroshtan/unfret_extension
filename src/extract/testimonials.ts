/**
 * Testimonials a service company publishes on its own site: the text, the name as printed, the rating and the date.
 * A port of the backend's `facts/testimonials.py`; the parity tests keep the two in step.
 *
 * From the company's structured data (a `review` on its Organization/LocalBusiness block) when it has any, else from
 * the page: elements marked as one review or testimonial (a class such as `testimonial` or `review-card`, or Review
 * microdata), the innermost ones only. Areas that could hold the visitor's own details are skipped, as for the other
 * business facts.
 */

import type { Testimonial } from "../shared/facts.js";
import { isPrivate } from "./business.js";
import { attr, cut, squash, stripChars, tagName, text } from "./dom.js";
import { parseDate, parseNumber, parseRating } from "./parse.js";

type Json = Record<string, unknown>;

export const MAX_TESTIMONIALS = 50;
const MIN_TEXT = 10;
// One class token naming a single testimonial or review ("testimonial", "review-card", "c-testimonial__item");
// plural containers ("testimonials", "reviews-list") don't match.
const ITEM_CLASS_RE =
  /^(?:[a-z0-9]+(?:-|_|__))*(?:testimonial|review|klantervaring|ervaring|recensie|beoordeling)(?:(?:-|_|__)(?:item|card|block|entry|box|quote|slide|wrapper))?$/u;
const NAME_MARKS = ["author", "name", "naam", "auteur", "klant", "customer", "reviewer"];
const DATE_MARKS = ["date", "datum"];
const STARS_LABEL_RE =
  /([0-5](?:[.,]\d)?)\s*(?:\/|out of|of|van|uit|von)\s*5|([0-5](?:[.,]\d)?)\s*(?:stars?|sterren|ster)(?![a-z])/iu;
const NAME_LEAD = " \t\n—–-~·,";
const SKIP = new Set(["script", "style", "template"]);

function length(value: string): number {
  return Array.from(value).length;
}

/** Whether an element is one testimonial or review. */
export function isItem(el: Element): boolean {
  if (attr(el, "itemtype").toLowerCase().includes("schema.org/review")) return true;
  if (attr(el, "itemprop").toLowerCase() === "review") return true;
  return attr(el, "class")
    .toLowerCase()
    .split(/\s+/u)
    .some((token) => token !== "" && ITEM_CLASS_RE.test(token));
}

function excluded(el: Element): boolean {
  // Inside a form, an account menu or a checkout area (the visitor's), or a script.
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (SKIP.has(tagName(node)) || isPrivate(node)) return true;
  }
  return false;
}

/** The innermost testimonial or review elements on the page, in document order. */
export function items(doc: Document): Element[] {
  const found: Element[] = [];
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    if (!isItem(el) || Array.from(el.querySelectorAll("*")).some(isItem) || excluded(el)) continue;
    found.push(el);
    if (found.length >= MAX_TESTIMONIALS) break;
  }
  return found;
}

function first(el: Element, test: (d: Element) => boolean): Element | null {
  for (const d of Array.from(el.querySelectorAll("*"))) if (test(d)) return d;
  return null;
}

function marked(el: Element, words: string[]): boolean {
  const marks = attr(el, "class").toLowerCase();
  return words.some((w) => marks.includes(w));
}

function body(item: Element): string {
  const tests: ((d: Element) => boolean)[] = [
    (d) => attr(d, "itemprop") === "reviewBody",
    (d) => tagName(d) === "blockquote",
    (d) => tagName(d) === "q",
  ];
  for (const test of tests) {
    const found = first(item, test);
    if (found) return text(found);
  }
  let best = "";
  for (const p of Array.from(item.querySelectorAll("p"))) {
    const t = text(p);
    if (length(t) > length(best)) best = t;
  }
  return best || text(item);
}

function nameOf(item: Element): string {
  const author = first(item, (d) => attr(d, "itemprop") === "author");
  let name: string;
  if (author) {
    const inner = first(author, (d) => attr(d, "itemprop") === "name");
    name = text(inner ?? author);
  } else {
    const found = first(item, (d) => tagName(d) === "cite") ?? first(item, (d) => marked(d, NAME_MARKS));
    name = found ? text(found) : "";
  }
  return cut(stripChars(name, NAME_LEAD), 100);
}

function ratingOf(item: Element): number | null {
  const value = first(item, (d) => attr(d, "itemprop") === "ratingValue");
  if (value) return parseRating(attr(value, "content") || text(value));
  const nodes = [item, ...Array.from(item.querySelectorAll("*"))];
  for (const node of nodes)
    if (node.hasAttribute("data-rating")) return parseRating(attr(node, "data-rating"));
  for (const node of nodes) {
    for (const name of ["aria-label", "title"]) {
      const m = STARS_LABEL_RE.exec(attr(node, name));
      if (m) return parseRating(m[1] ?? m[2] ?? "");
    }
  }
  const stars = text(item).split("★").length - 1;
  return stars >= 1 && stars <= 5 ? stars : null;
}

function dateOf(item: Element): string | null {
  const timed = first(item, (d) => tagName(d) === "time" && d.hasAttribute("datetime"));
  if (timed) return parseDate(attr(timed, "datetime"));
  const published = first(item, (d) => attr(d, "itemprop") === "datePublished");
  if (published) return parseDate(attr(published, "content") || text(published));
  const found = first(item, (d) => tagName(d) === "time") ?? first(item, (d) => marked(d, DATE_MARKS));
  return found ? parseDate(text(found)) : null;
}

/** The testimonials marked up on the page. */
export function fromHtml(doc: Document): Testimonial[] {
  const out: Testimonial[] = [];
  for (const item of items(doc)) {
    const t = body(item);
    if (length(t) < MIN_TEXT) continue;
    out.push({ text: cut(t, 2000), name: nameOf(item), rating: ratingOf(item), posted: dateOf(item) });
  }
  return out;
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ldRating(value: unknown): number | null {
  const node = isObject(value) ? value.ratingValue : value;
  let number: number | null;
  if (typeof node === "number") number = node;
  else if (typeof node === "string") number = parseNumber(node);
  else return null;
  return number !== null && number >= 0 && number <= 5 ? number : null;
}

function ldAuthor(value: unknown): string {
  let author = Array.isArray(value) && value.length > 0 ? (value[0] as unknown) : value;
  if (isObject(author)) author = author.name;
  return typeof author === "string" ? cut(squash(author), 100) : "";
}

/** The reviews in the company's Organization/LocalBusiness structured data. */
export function fromStructuredData(orgs: Json[]): Testimonial[] {
  const out: Testimonial[] = [];
  for (const org of orgs) {
    const reviews = org.review;
    for (const review of Array.isArray(reviews) ? (reviews as unknown[]) : [reviews]) {
      if (!isObject(review)) continue;
      const raw = review.reviewBody || review.description;
      const t = typeof raw === "string" ? squash(raw) : "";
      if (length(t) < MIN_TEXT) continue;
      const published = review.datePublished;
      out.push({
        text: cut(t, 2000),
        name: ldAuthor(review.author),
        rating: ldRating(review.reviewRating),
        posted: typeof published === "string" ? parseDate(published) : null,
      });
    }
  }
  return out.slice(0, MAX_TESTIMONIALS);
}

/** The site's testimonials: its structured data's reviews when it has any, else the ones marked up on the page. */
export function extractTestimonials(doc: Document, orgs: Json[]): Testimonial[] {
  const structured = fromStructuredData(orgs);
  return structured.length > 0 ? structured : fromHtml(doc).slice(0, MAX_TESTIMONIALS);
}
