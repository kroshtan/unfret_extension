/**
 * Walmart.com product pages: a port of the backend's `facts/walmart.py`.
 *
 * Walmart renders with Next.js and ships the whole product in the `__NEXT_DATA__` script: price and "was" price,
 * the seller (Walmart itself or a marketplace seller), the rating histogram and a page of reviews. Its Product
 * JSON-LD is less reliable (the first offer can be a protection plan), so these facts override what JSON-LD gave.
 */

import type { PageFacts, Review } from "../shared/facts.js";
import { cut } from "./dom.js";
import { parseDate } from "./parse.js";

type Json = Record<string, unknown>;

const STARS: [string, string][] = [
  ["1", "One"],
  ["2", "Two"],
  ["3", "Three"],
  ["4", "Four"],
  ["5", "Five"],
];

/** Fill Walmart-specific facts into `facts` (JSON-LD has already been read). */
export function extract(doc: Document, facts: PageFacts): void {
  const data = initialData(doc);
  const product = dict(data["product"]);
  if (Object.keys(product).length === 0) return;
  facts.title = cut(str(product["name"]) || facts.title, 2000);
  facts.brand = cut(str(product["brand"]) || facts.brand, 300);
  const priceInfo = dict(product["priceInfo"]);
  const price = amount(priceInfo["currentPrice"]);
  if (price !== null) {
    facts.price = price;
    facts.currency = cut(str(dict(priceInfo["currentPrice"])["currencyUnit"]) || "USD", 8);
  }
  const was = amount(priceInfo["wasPrice"]) || amount(priceInfo["listPrice"]);
  if (was !== null && facts.price !== null && was > facts.price) facts.list_price = was;
  const seller = str(product["sellerDisplayName"]) || str(product["sellerName"]);
  facts.seller = cut(seller, 300) || facts.seller;
  if (product["fulfillmentType"] === "FC" || product["fulfillmentType"] === "WFS")
    facts.ships_from = "Walmart";
  const rating = product["averageRating"];
  if (typeof rating === "number" && rating >= 0 && rating <= 5) facts.rating = rating;
  const count = product["numberOfReviews"];
  if (Number.isInteger(count) && (count as number) >= 0) facts.rating_count = count as number;
  const reviewData = dict(data["reviews"]);
  const shares = histogram(reviewData);
  if (Object.keys(shares).length > 0) facts.rating_histogram = shares;
  const found = reviews(reviewData);
  if (found.length > 0) facts.reviews = found;
  const allImages = dict(product["imageInfo"])["allImages"];
  const images = (Array.isArray(allImages) ? allImages : [])
    .filter((i) => Boolean(dict(i)["url"]))
    .map((i) => String(dict(i)["url"]));
  if (images.length > 0) {
    facts.image_urls = [...images, ...facts.image_urls.filter((u) => !images.includes(u))].slice(0, 50);
  }
}

function initialData(doc: Document): Json {
  const script = doc.querySelector("script#__NEXT_DATA__");
  let data: unknown;
  try {
    data = script ? JSON.parse(script.textContent || "") : {};
  } catch {
    return {};
  }
  return dict(dict(dict(dict(dict(data)["props"])["pageProps"])["initialData"])["data"]);
}

function dict(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

/** Python's `str(value or "")` for the strings and numbers Walmart sends (anything else counts as absent). */
function str(value: unknown): string {
  if (typeof value === "string") return value;
  return typeof value === "number" && value !== 0 ? String(value) : "";
}

function amount(node: unknown): number | null {
  const value = dict(node)["price"];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function histogram(reviewData: Json): Record<string, number> {
  const valid: [string, number][] = [];
  for (const [star, name] of STARS) {
    const n = reviewData[`ratingValue${name}Count`];
    if (Number.isInteger(n) && (n as number) >= 0) valid.push([star, n as number]);
  }
  const total = valid.reduce((sum, [, n]) => sum + n, 0);
  if (valid.length < 5 || total === 0) return {};
  return Object.fromEntries(valid.map(([star, n]) => [star, Math.round((n / total) * 10_000) / 10_000]));
}

function reviews(reviewData: Json): Review[] {
  const nodes = reviewData["customerReviews"];
  const out: Review[] = [];
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) continue;
    const review = node as Json;
    const rating = review["rating"];
    const badges = Array.isArray(review["badges"]) ? review["badges"].map((b) => dict(b)["id"]) : [];
    out.push({
      rating: typeof rating === "number" && rating >= 0 && rating <= 5 ? rating : null,
      posted: usDate(str(review["reviewSubmissionTime"])),
      title: cut(str(review["reviewTitle"]), 300),
      body: cut(str(review["reviewText"]), 2000),
      verified: badges.includes("VerifiedPurchaser"),
    });
  }
  return out.slice(0, 100);
}

/** Walmart writes review dates as M/D/YYYY. */
function usDate(value: string): string | null {
  const parts = value.split("/");
  if (parts.length === 3 && parts.every((p) => /^\d+$/u.test(p))) {
    const [month, day, year] = parts.map(Number);
    return parseDate(
      `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
  }
  return parseDate(value);
}
