/** What a check that failed shows: the server's refusals in plain words (never its technical detail). */

import { ApiError } from "../api/client.js";
import type { TabState } from "../shared/messages.js";
import { OFFLINE } from "../shared/text.js";

/** "a minute", "5 minutes", "an hour": how long to wait, from `retry_after_s`. */
export function waitText(seconds: number | undefined): string {
  if (seconds === undefined || seconds <= 60) return "a minute";
  if (seconds < 3600) return `${String(Math.ceil(seconds / 60))} minutes`;
  return "an hour";
}

/** The tab's state after a check failed with `error`. */
export function checkFailed(error: unknown, quick: boolean): Extract<TabState, { status: "error" }> {
  const apiError = error instanceof ApiError ? error : null;
  const message =
    apiError?.code === "TOO_MANY_REQUESTS"
      ? quick
        ? `Too many quick checks from your network just now. Please wait ${waitText(apiError.retryAfterS)}.`
        : `Too many deep checks from your network this hour. Please wait ${waitText(apiError.retryAfterS)}, or run a quick check.`
      : apiError?.serviceOff
        ? "Unfret checks aren't available right now. Please try again later."
        : apiError
          ? "The check failed. Please try again."
          : OFFLINE;
  return { status: "error", message };
}
