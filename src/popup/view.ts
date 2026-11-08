/** Pure presentation helpers for the popup (tested without a browser). */

import { light } from "../background/badge.js";

const FLAG_NAMES: Record<string, string> = {
  "listing.discount_pct": "Discount",
  "listing.generated_brand": "Brand name",
  "listing.keyword_stuffed": "Keyword-stuffed title",
  "reviews.log_reviews_per_day": "Review velocity",
  "reviews.burst_share": "Review bursts",
  "reviews.j_shaped": "Rating shape",
  "reviews.duplicate_share": "Repeated reviews",
  "reviews.off_topic_share": "Off-topic reviews",
  "html_source_signals.review_import_app": "Imported reviews",
  "dark_patterns.fee_mentions": "Extra fees",
  "injection.hidden_chars": "Hidden text",
  "eu_registry.imprint": "Company identity",
  "eu_registry.withdrawal_right": "Return rights",
  "content.generic_product": "Generic product",
  "content.implausible_claims": "Implausible claims",
  "content.missing_trust_info": "Missing trust information",
  "content.scam_copy": "Pressure tactics in the copy",
};

/** A readable name for a scorer flag such as "listing.discount_pct". */
export function flagName(type: string): string {
  const known = FLAG_NAMES[type];
  if (known) return known;
  const tail = type.includes(".") ? type.slice(type.indexOf(".") + 1) : type;
  const words = tail.replace(/_/gu, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : type;
}

export function scoreClass(score: number): string {
  const l = light(score);
  return l === "none" ? "" : l;
}

export function scoreLabel(score: number): string {
  if (score < 0) return "Not assessed";
  const l = light(score);
  const word = l === "green" ? "few risk signals" : l === "amber" ? "some risk signals" : "many risk signals";
  return `Score ${score} out of 100: ${word}`;
}

export function checksText(checks: number): string {
  return checks === 1 ? "1 check left" : `${checks} checks left`;
}
