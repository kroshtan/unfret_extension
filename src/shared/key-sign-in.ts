/** Signing in with an API key instead of a wallet: shared by the popup and the options page. */

import { ApiError, UnfretApi } from "../api/client.js";
import { keySession, saveSession, type Session } from "./settings.js";

export type KeySignIn =
  { ok: true; session: Session; checks: number } | { ok: false; reason: "invalid" | "rejected" | "offline" };

/** Check the key with the server (it must know it) and keep it as the session. */
export async function signInWithKey(apiBase: string, value: string): Promise<KeySignIn> {
  const session = keySession(value);
  if (!session) return { ok: false, reason: "invalid" };
  try {
    const credits = await new UnfretApi(apiBase, session.token).credits();
    await saveSession(session);
    return { ok: true, session, checks: credits.checks_remaining };
  } catch (error) {
    return { ok: false, reason: error instanceof ApiError && error.needsSignIn ? "rejected" : "offline" };
  }
}

/** The message key for a failed key sign-in. */
export const KEY_FAILURE = {
  invalid: "opt_key_invalid",
  rejected: "opt_key_rejected",
  offline: "offline",
} as const;
