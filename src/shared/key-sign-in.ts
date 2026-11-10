/** Signing in with an API key instead of a wallet: shared by the popup and the options page. */

import { ApiError, VeridexApi } from "../api/client.js";
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
    const credits = await new VeridexApi(apiBase, session.token).credits();
    await saveSession(session);
    return { ok: true, session, checks: credits.checks_remaining, inviteEligible: credits.invite_eligible };
  } catch (error) {
    return { ok: false, reason: error instanceof ApiError && error.needsSignIn ? "rejected" : "offline" };
  }
}

/** What to say about a failed key sign-in. */
export const KEY_FAILURE = {
  invalid: "That isn't an API key (it starts with ufk_).",
  rejected: "The server doesn't know this key (or it was replaced with its recovery code).",
  offline: OFFLINE,
} as const;
