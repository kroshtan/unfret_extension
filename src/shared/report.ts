/**
 * "Wrong result?": one flow (contract: 'one "Wrong result?" flow'). The shopper picks the level they think is right,
 * marks the findings shown that are wrong and, if they like, findings that are missing; the report goes to
 * `POST /v1/labels` with the result's label token and the request exactly as it was analysed. It keeps the page it is
 * about (scrubbed of personal details), never who sent it.
 */

import {
  type AnalysisResult,
  ApiError,
  type CatalogueFinding,
  type Label,
  type LabelOutcome,
} from "../api/client.js";
import { OFFLINE } from "./text.js";

/** The levels in words, as the shopper picks one (0 to 4; higher is worse). */
export const LEVEL_CHOICES: readonly { level: number; label: string }[] = [
  { level: 0, label: "No concerns" },
  { level: 1, label: "Pressure and tricks" },
  { level: 2, label: "May cost more than it's worth" },
  { level: 3, label: "May not work as described" },
  { level: 4, label: "May not arrive, or may not be safe" },
];

/** The longest comment the server takes. */
export const COMMENT_MAX = 500;

/**
 * Findings a shopper can say are missing, worst first, when the server's catalogue (`GET /v1/catalogue/findings`)
 * can't be read: a short list of its types and titles.
 */
export const MISSING_CHOICES: readonly { type: string; title: string; level: number | null }[] = [
  { type: "new_domain", title: "Brand-new web shop", level: 4 },
  { type: "no_imprint", title: "No company details", level: 4 },
  { type: "far_below_market", title: "Far below the usual price", level: 4 },
  { type: "seller_lookalike", title: "Seller named like the brand", level: 4 },
  { type: "safety_gate_alert", title: "On the EU list of dangerous products", level: 4 },
  { type: "irreversible_payment_only", title: "Only payments you can't get back", level: null },
  { type: "claim_contradicted", title: "A claim that doesn't add up", level: 3 },
  { type: "implausible_claims", title: "Hard-to-believe claims", level: 3 },
  { type: "generic_product", title: "Generic product", level: 2 },
  { type: "dropshipping_tools", title: "Dropshipping", level: 2 },
  { type: "ships_from_far", title: "Ships from far away", level: 2 },
  { type: "drip_pricing", title: "Price goes up at checkout", level: 2 },
  { type: "no_return_policy", title: "No return policy found", level: 2 },
  { type: "fake_urgency_app", title: "Urgency tricks", level: 1 },
  { type: "preticked_addon", title: "Paid extra already ticked", level: 1 },
  { type: "was_never_charged", title: "'Was' price not charged recently", level: 1 },
  { type: "duplicate_reviews", title: "Copy-paste reviews", level: 1 },
  { type: "pushy_copy", title: "Pushy sales talk", level: 1 },
];

/** What the result showed, to mark as wrong: the findings behind the level, then the card's other reasons. */
export function shownFindings(result: AnalysisResult): { type: string; title: string }[] {
  const seen = new Set<string>();
  const out: { type: string; title: string }[] = [];
  const add = (type: string, title: string): void => {
    if (!type || seen.has(type)) return;
    seen.add(type);
    out.push({ type, title });
  };
  for (const b of result.verdict?.risk?.because ?? []) add(b.type, b.title);
  for (const r of result.verdict?.reasons ?? []) add(r.type, r.title);
  return out;
}

/**
 * The missing-finding choices: the server's catalogue (or, offline, the short list), without payment modifiers (no
 * level of their own) and without what the result already showed.
 */
export function missingChoices(
  result: AnalysisResult,
  catalogue?: readonly CatalogueFinding[] | null,
): { type: string; title: string; level: number | null }[] {
  const shown = new Set(shownFindings(result).map((f) => f.type));
  const source = catalogue?.length ? catalogue : MISSING_CHOICES;
  return source.filter((c) => c.level !== null && !shown.has(c.type));
}

/** Whether a result can be reported: it has a label token and the request it was made from. */
export function reportable(result: AnalysisResult, hasBody: boolean): boolean {
  return hasBody && typeof result.label_token === "string" && result.label_token !== "" && result.score >= 0;
}

export const REPORT_OUTCOME: Record<LabelOutcome, string> = {
  queued: "Thanks! A person will review this page.",
  already_reported: "Thanks! Someone reported this page too; yours counts toward the same review.",
  already_known: "Thanks! We reviewed this page recently.",
};

const REPORT_ERROR: Record<string, string> = {
  BAD_LABEL_TOKEN: "This check can't be reported any more; check the page again first.",
  BAD_LABEL: "Pick a level, or a reason that's wrong or missing.",
  BAD_CONTRIBUTOR_KEY: "Your contributor key isn't valid. Turn it off and on again in Settings.",
  ALREADY_LABELLED: "You've already reported this result.",
  LABEL_LIMIT: "That's a lot of reports today. Thank you! Please try again tomorrow.",
  LABELS_PAUSED: "We're getting a lot of reports right now. Please try again tomorrow.",
  LABELS_OFF: "Reports aren't taken right now. Please try again later.",
  QUEUE_FULL: "Our review queue is full right now. Please try again in a few days.",
};

/** A refused or failed report, in plain words. */
export function reportError(error: unknown): string {
  if (!(error instanceof ApiError)) return OFFLINE;
  return REPORT_ERROR[error.code] ?? "The report didn't go through. Please try again later.";
}

const TYPE_RE = /^[a-z0-9_]{1,64}$/u;

/**
 * The report as it may go out: a level from 0 to 4, wrong findings the result showed, missing ones it didn't show and
 * the comment (trimmed, at most 500 characters); null without a level, a wrong or a missing finding (the server wants
 * at least one of the three; a comment alone isn't a report).
 */
export function cleanLabel(result: AnalysisResult, label: Label): Label | null {
  const shown = new Set(shownFindings(result).map((f) => f.type));
  const level =
    typeof label.level === "number" && Number.isInteger(label.level) && label.level >= 0 && label.level <= 4
      ? label.level
      : undefined;
  const wrong = [...new Set(label.wrong ?? [])].filter((t) => shown.has(t));
  // The catalogue is the server's: any type it could hold, never one the result showed (that one can be wrong).
  const missing = [...new Set(label.missing ?? [])].filter((t) => TYPE_RE.test(t) && !shown.has(t));
  if (level === undefined && wrong.length === 0 && missing.length === 0) return null;
  const comment = typeof label.comment === "string" ? label.comment.trim().slice(0, COMMENT_MAX) : "";
  return {
    ...(level !== undefined ? { level } : {}),
    ...(wrong.length ? { wrong } : {}),
    ...(missing.length ? { missing } : {}),
    ...(comment ? { comment } : {}),
  };
}
