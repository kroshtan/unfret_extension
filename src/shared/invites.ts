/**
 * "Have a gift code?": a code someone got with a pack of checks (`ufi_…`), redeemed onto the signed-in account (the
 * wallet's session or the API key). Any account may redeem one, but not a code from its own pack, and one a calendar
 * month; the server's refusals are shown as it words them. Anything that isn't a gift code is refused here, without
 * asking the server. Shared by the popup and the options page. The code is sent once and never stored.
 */

import { ApiError, UnfretApi } from "../api/client.js";
import { OFFLINE, PASS_ENDED, SESSION_EXPIRED } from "./text.js";

/** A gift code: `ufi_` and 32 lower-case base32 letters (the server ignores case and surrounding spaces). */
export const INVITE_RE = /^ufi_[a-z2-7]{32}$/u;

/** The website's "I have a code" checkout (path on the API base): a new API key with the code redeemed onto it. */
export const CODE_CHECKOUT = "/checkout?mode=code";

export const NOT_AN_INVITE =
  "That doesn't look like a gift code: they start with ufi_. Check it and try again.";

/** The refusals the server explains itself (its `detail` is shown); the wording here is the fallback. */
const REFUSED: Record<string, string> = {
  INVALID_INVITE: NOT_AN_INVITE,
  UNKNOWN_INVITE: "Unknown gift code.",
  INVITE_USED: "This gift code has already been used.",
  INVITE_OWN_PACK: "This gift code came with your own pack: give it to a friend.",
  INVITE_MONTHLY_LIMIT:
    "You've already used a gift code this month; this one still works next month, or give it to someone else.",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * One gift code per pass or wallet a calendar month (429 `INVITE_MONTHLY_LIMIT`; the code stays unused): in the
 * extension's words, naming the month from the server's `metadata.next_month` ("2026-12-01") when it sent one.
 */
export function monthlyLimitMessage(metadata: unknown): string {
  const next = (metadata as { next_month?: unknown } | null | undefined)?.next_month;
  const month = typeof next === "string" ? /^\d{4}-(\d{2})-\d{2}$/u.exec(next)?.[1] : undefined;
  const name = month ? MONTHS[Number(month) - 1] : undefined;
  return name
    ? `You've already used a gift code this month; this one still works from ${name}, or give it to someone else.`
    : (REFUSED.INVITE_MONTHLY_LIMIT ?? "");
}

export type InviteRedemption =
  | { ok: true; checksAdded: number; checks: number }
  /** `passEnded`: the server no longer knows the pass (`signedOut` too); otherwise a 401 is an expired sign-in. */
  | { ok: false; message: string; signedOut: boolean; passEnded?: boolean };

/** The gift code as typed (spaces, any case), lower case, or null when it isn't one. */
export function normaliseInvite(value: string): string | null {
  const code = value.trim().toLowerCase();
  return INVITE_RE.test(code) ? code : null;
}

/** "3 checks added." */
export function inviteAdded(checksAdded: number): string {
  return checksAdded === 1 ? "✓ 1 check added." : `✓ ${checksAdded} checks added.`;
}

/** Redeem `value` for the account behind `token`. */
export async function redeemInvite(apiBase: string, token: string, value: string): Promise<InviteRedemption> {
  const code = normaliseInvite(value);
  if (!code) return { ok: false, message: NOT_AN_INVITE, signedOut: false };
  try {
    const added = await new UnfretApi(apiBase, token).redeemInvite(code);
    return { ok: true, checksAdded: added.checks_added, checks: added.checks_remaining };
  } catch (error) {
    if (!(error instanceof ApiError)) return { ok: false, message: OFFLINE, signedOut: false };
    if (error.needsSignIn && error.passEnded && token.startsWith("ufk_"))
      return { ok: false, message: PASS_ENDED, signedOut: true, passEnded: true };
    if (error.needsSignIn) return { ok: false, message: SESSION_EXPIRED, signedOut: true };
    if (error.code === "INVITE_MONTHLY_LIMIT")
      return { ok: false, message: monthlyLimitMessage(error.metadata), signedOut: false };
    const refused = REFUSED[error.code];
    if (refused) {
      // The server's own words, unless it sent none (then the same text from here).
      const detail = error.message.startsWith("HTTP ") ? "" : error.message;
      return { ok: false, message: detail || refused, signedOut: false };
    }
    const message = error.serviceOff
      ? "Gift codes aren't available right now. Please try again later."
      : "That gift code didn't work. Please try again later.";
    return { ok: false, message, signedOut: false };
  }
}
