/**
 * A service provider's profile on a platform (Werkspot, Thumbtack, Angi, …): what the platform shows about them.
 * A port of the backend's `facts/service_platforms.py`; the parity tests keep the two in step.
 *
 * Fills `seller_profile`: member since, jobs completed, years in business, rating and its count, badges and response
 * rate and time, from the profile's structured data and the platform's own wording in the page text, read outside
 * the visitor's areas (a logged-in visitor's account menu says "member since" too). The platform's reviews go into
 * `reviews`, without the reviewers' names.
 */

import type { PageFacts, Platform, Review, SellerProfile } from "../shared/facts.js";
import { publicText } from "./business.js";
import { cut } from "./dom.js";
import { parseCount, parseDate, parseNumber } from "./parse.js";
import { extractTestimonials } from "./testimonials.js";

type Json = Record<string, unknown>;

export const SERVICE_PLATFORMS = new Set<Platform>([
  "werkspot",
  "thumbtack",
  "angi",
  "homeadvisor",
  "checkatrade",
  "taskrabbit",
  "bark",
  "houzz",
  "myhammer",
  "homeguide",
]);
const PLATFORM_NAMES =
  "thumbtack|angi|homeadvisor|werkspot|bark|houzz|taskrabbit|checkatrade|myhammer|homeguide";
const MEMBER_SINCE_RE = new RegExp(
  String.raw`(?:lid sinds|actief sinds|op werkspot sinds|member since|on (?:${PLATFORM_NAMES}) since|joined(?: in)?)` +
    String.raw`\s*:?\s*(?:([a-zé]{3,10})\.?\s+)?((?:19|20)\d\d)(?![0-9])`,
  "iu",
);
const JOBS_RES = [
  /(\d[\d.,]*)\s+(?:klussen|opdrachten)\s+(?:uitgevoerd|afgerond|voltooid|via werkspot|op werkspot)/iu,
  /(\d[\d.,]*)\s+hires?(?![a-z])/iu,
  /hired\s+(\d[\d.,]*)\s+times?/iu,
  /(\d[\d.,]*)\s+(?:jobs|tasks|projects)\s+completed/iu,
  /(\d[\d.,]*)\s+(?:completed|verified)\s+(?:jobs|tasks|projects)/iu,
];
const YEARS_RES = [
  /(\d{1,3})\s+(?:years? in business|jaar (?:actief|ervaring|in bedrijf))/iu,
  /years? in business\s*:?\s*(\d{1,3})(?![\d])/iu,
];
// A rating and its count: "4.8 (127 reviews)", "4,5 ★ uit 160 beoordelingen", "5.0 · 23 Reviews". The rating is never
// the first digit of a longer number ("160 beoordelingen" is not a 1 from 60). Thumbtack and Angi write the count
// alone in brackets after the stars: "4.9 ★★★★★ (143)".
const RATING_RE = new RegExp(
  String.raw`(?<![\d.,])([0-5](?:[.,]\d{1,2})?)(?![\d])\s*(?:\/\s*5|out of 5|uit 5|van 5)?(?![\d])` +
    String.raw`(?:\s*(?:stars?|sterren|[★☆]+))?\s*(?:[(·|-]|uit|from|based on|op basis van)?\s*` +
    String.raw`(\d[\d.,]*)\s*\)?\s*(?:verified\s+)?(?:reviews?|beoordelingen|ratings?|recensies)(?![a-z])` +
    String.raw`|(?<![\d.,])([0-5][.,]\d{1,2})\s*[★☆]*\s*\((\d[\d.,]*)\)`,
  "iu",
);
// A count of reviews without a rating next to it ("2 reviews"), and a profile that says it has none yet.
const REVIEW_COUNT_RE =
  /(?<![\d.,])(\d[\d.,]*)\s+(?:verified\s+)?(?:reviews?|beoordelingen|recensies)(?![a-z])/iu;
const NO_REVIEWS_RE =
  /(?<![a-z])(?:no reviews(?: yet)?|nog geen (?:beoordelingen|reviews|recensies)|geen beoordelingen)(?![a-z])/iu;
const RESPONSE_RATE_RES = [
  /(\d{1,3})\s?%\s*(?:response rate|reactiepercentage|reageert)/iu,
  /(?:response rate|reactiepercentage)\s*:?\s*(\d{1,3})\s?%/iu,
];
const RESPONSE_TIME_RE =
  /(?:responds|reageert|reactietijd|response time)\s*:?\s*(?:usually|typically|meestal|gemiddeld)?\s*((?:within|in about|about|binnen)(?:\s+about)?\s+(?:a|an|one|een|\d+)\s+(?:minutes?|hours?|days?|minuten|uur|uren|dag|dagen))/iu;
// Badges the platforms award, as they write them (matched case-insensitively, recorded as written here).
export const BADGES = [
  "Top Pro",
  "Background checked",
  "License verified",
  "Angi Certified",
  "Super Service Award",
  "Screened & Approved",
  "Elite Service",
  "Top Rated",
  "Topvakman",
  "Geverifieerd vakman",
  "KvK geverifieerd",
  "Identiteit geverifieerd",
  "Erkend vakman",
  "KvK-nummer gecontroleerd",
  "Best of Houzz",
  "Verified License",
];
const BADGE_RES: [string, RegExp][] = BADGES.map((badge) => [
  badge,
  new RegExp(String.raw`(?<![a-z])${badge.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![a-z])`, "iu"),
]);

function memberSince(value: string): string | null {
  const m = MEMBER_SINCE_RE.exec(value);
  if (!m) return null;
  const year = m[2] ?? "";
  const month = m[1] ? parseDate(`1 ${m[1]} ${year}`) : null;
  return month ?? `${year}-01-01`;
}

function jobs(value: string): number | null {
  for (const re of JOBS_RES) {
    const m = re.exec(value);
    if (m) return parseCount(m[1] ?? "");
  }
  return null;
}

function ldNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseNumber(value);
  return null;
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rating(orgs: Json[], value: string): [number | null, number | null] {
  for (const org of orgs) {
    const node = org.aggregateRating;
    if (!isObject(node)) continue;
    const r = ldNumber(node.ratingValue);
    const count = ldNumber(node.reviewCount || node.ratingCount);
    if (r !== null && r >= 0 && r <= 5) return [r, count !== null && count >= 0 ? Math.trunc(count) : null];
  }
  const m = RATING_RE.exec(value);
  if (m) {
    const r = parseNumber(m[1] ?? m[3] ?? "");
    const count = parseCount(m[2] ?? m[4] ?? "");
    // "0.0 (0 reviews)" is no rating at all.
    return [r !== null && r <= 5 && count !== 0 ? r : null, count];
  }
  if (NO_REVIEWS_RE.test(value)) return [null, 0];
  const c = REVIEW_COUNT_RE.exec(value);
  if (c) return [null, parseCount(c[1] ?? "")];
  return [null, null];
}

function responseRate(value: string): number | null {
  for (const re of RESPONSE_RATE_RES) {
    const m = re.exec(value);
    if (m && Number(m[1]) <= 100) return Number(m[1]);
  }
  return null;
}

/** The provider as the platform shows them, or null when the page shows none of it. */
export function profile(value: string, orgs: Json[]): SellerProfile | null {
  const [r, count] = rating(orgs, value);
  const years = YEARS_RES.map((re) => re.exec(value)).find((m) => m !== null) ?? null;
  const time = RESPONSE_TIME_RE.exec(value);
  const found: SellerProfile = {
    seller_type: "",
    member_since: memberSince(value),
    rating: r,
    rating_count: count,
    badges: BADGE_RES.filter(([, re]) => re.test(value)).map(([badge]) => badge),
    other_listings: null,
    response_time: time ? cut(time[1] ?? "", 100) : "",
    response_rate: responseRate(value),
    jobs_completed: jobs(value),
    years_in_business: years && Number(years[1]) <= 200 ? Number(years[1]) : null,
  };
  const empty =
    found.member_since === null &&
    found.rating === null &&
    found.rating_count === null &&
    found.badges.length === 0 &&
    found.response_time === "" &&
    found.response_rate === null &&
    found.jobs_completed === null &&
    found.years_in_business === null;
  return empty ? null : found;
}

/** Fill `seller_profile` and, when the page has none yet, `reviews` from a service platform's profile page. */
export function extractServiceProfile(doc: Document, facts: PageFacts, orgs: Json[]): void {
  facts.seller_profile = profile(publicText(doc), orgs);
  if (facts.reviews.length === 0) {
    facts.reviews = extractTestimonials(doc, orgs)
      .map((t): Review => ({ rating: t.rating, posted: t.posted, title: "", body: t.text, verified: null }))
      .slice(0, 100);
  }
}
