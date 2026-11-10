/**
 * "Have an invite?": a code someone got with a pack of checks, redeemed onto the signed-in account (the wallet's
 * session or the API key). The server adds the checks only for a new account, one that never had any; its refusals
 * are shown as it words them. Shared by the popup and the options page. The code is sent once and never stored.
 */

import { ApiError, UnfretApi } from "../api/client.js";
import { OFFLINE, SESSION_EXPIRED } from "./text.js";

/** An invite code: `ufi_` and 32 lower-case base32 letters (the server ignores case and surrounding spaces). */
export const INVITE_RE = /^ufi_[a-z2-7]{32}$/u;

export const NOT_AN_INVITE = "That isn't an invite code (it starts with ufi_).";

/** The refusals the server explains itself (its `detail` is shown); the wording here is the fallback. */
const REFUSED: Record<string, string> = {
  INVALID_INVITE: NOT_AN_INVITE,
  UNKNOWN_INVITE: "Unknown invite code.",
  INVITE_USED: "This invite has already been used.",
  INVITE_NOT_FOR_THIS_ACCOUNT:
    "Invites are for new accounts: this one has had checks before, or used an invite.",
};

export type InviteRedemption =
  { ok: true; checksAdded: number; checks: number } | { ok: false; message: string; signedOut: boolean };

/** The code as typed, or null when it isn't one (checked before anything is sent). */
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
    if (error.needsSignIn) return { ok: false, message: SESSION_EXPIRED, signedOut: true };
    const refused = REFUSED[error.code];
    if (refused) {
      // The server's own words, unless it sent none (then the same text from here).
      const detail = error.message.startsWith("HTTP ") ? "" : error.message;
      return { ok: false, message: detail || refused, signedOut: false };
    }
    const message = error.serviceOff
      ? "Invites aren't available right now. Please try again later."
      : "That invite didn't work. Please try again later.";
    return { ok: false, message, signedOut: false };
  }
}
