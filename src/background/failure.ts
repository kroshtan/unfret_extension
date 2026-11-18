/** What a check that failed shows: the server's refusals in plain words (never its technical detail). */

import { ApiError } from "../api/client.js";
import type { TabState } from "../shared/messages.js";
import { endPass, passEndedBy } from "../shared/new-pass.js";
import type { Session } from "../shared/settings.js";
import { OFFLINE, PASS_ENDED, SESSION_EXPIRED } from "../shared/text.js";

/**
 * The tab's state after a check failed with `error`. A pass the server no longer knows (Unfret's new free start) is
 * forgotten here at once, even with the popup closed ({@link endPass}); the popup then offers the new free pass.
 */
export async function checkFailed(
  session: Session | undefined,
  error: unknown,
): Promise<Extract<TabState, { status: "error" }>> {
  const apiError = error instanceof ApiError ? error : null;
  const passEnded = passEndedBy(session, error);
  if (passEnded) await endPass(session);
  const message = apiError?.serviceOff
    ? "Unfret checks aren't available right now. Please try again later."
    : passEnded
      ? PASS_ENDED
      : apiError?.needsSignIn
        ? SESSION_EXPIRED
        : apiError?.needsCredits
          ? "You have no checks left."
          : apiError?.code === "TOO_MANY_REQUESTS"
            ? "Too many quick checks in a minute; wait a moment. No check was used."
            : apiError
              ? "The check failed. No check was used."
              : OFFLINE;
  return {
    status: "error",
    message,
    needsSignIn: apiError?.needsSignIn ?? false,
    needsCredits: apiError?.needsCredits ?? false,
    ...(passEnded ? { passEnded } : {}),
    refunded: apiError !== null && !apiError.needsSignIn && !apiError.needsCredits,
  };
}
