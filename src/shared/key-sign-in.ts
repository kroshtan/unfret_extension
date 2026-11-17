/**
 * Signing in with an API key (an "Unfret pass", as the website calls it) instead of a wallet: shared by the popup and
 * the options page.
 */

import { ApiError, UnfretApi } from "../api/client.js";
import { keySession, saveSession, type Session } from "./settings.js";
import { OFFLINE } from "./text.js";

export type KeySignIn =
  | { ok: true; session: Session; checks: number; inviteEligible: boolean | undefined }
  | { ok: false; reason: "invalid" | "rejected" | "offline" };

/** Check the key with the server (it must know it) and keep it as the session. */
export async function signInWithKey(apiBase: string, value: string): Promise<KeySignIn> {
  const session = keySession(value);
  if (!session) return { ok: false, reason: "invalid" };
  try {
    const credits = await new UnfretApi(apiBase, session.token).credits();
    await saveSession(session);
    return { ok: true, session, checks: credits.checks_remaining, inviteEligible: credits.invite_eligible };
  } catch (error) {
    return { ok: false, reason: error instanceof ApiError && error.needsSignIn ? "rejected" : "offline" };
  }
}

/** What to say about a failed key sign-in. */
export const KEY_FAILURE = {
  invalid: "That doesn't look like an Unfret pass (it starts with ufk_). Copy it again in full.",
  rejected: "Unfret doesn't know this pass (or it was replaced with its backup code).",
  offline: OFFLINE,
} as const;
