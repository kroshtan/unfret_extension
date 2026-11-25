/** Wording used in more than one place (the extension is in English). */

export const OFFLINE = "Couldn't reach Unfret. Check your connection.";
/**
 * When paused free deep checks are back: the pause's `scope` ("day": the day's share of the monthly budget is used,
 * "month": the month's), else `retry_after_s` (under 24 hours: tomorrow), else next month.
 */
export function pauseUntil(
  pause: { scope?: string; retry_after_s?: number } | undefined,
): "tomorrow" | "next month" {
  if (pause?.scope === "day") return "tomorrow";
  if (pause?.scope === "month") return "next month";
  const wait = pause?.retry_after_s;
  return typeof wait === "number" && wait < 86_400 ? "tomorrow" : "next month";
}

/** Free deep checks are paused (the spend ceiling): the client's own words for `free_checks_run_on_donations`. */
export function freePausedText(pause: Parameters<typeof pauseUntil>[0]): string {
  const until = pauseUntil(pause);
  return `Free checks run on donations, and ${until === "tomorrow" ? "today's" : "this month's"} are used up. Quick checks still work; deep checks are back ${until}.`;
}

/** Over a quick check that ran because free deep checks are paused (the pause note says the rest). */
export function freePausedQuick(pause: Parameters<typeof pauseUntil>[0]): string {
  return `Free deep checks are paused until ${pauseUntil(pause)}, so this is a quick check.`;
}
/** Free deep checks can't be offered right now (503): a quick check ran instead. */
export const DEEP_UNAVAILABLE =
  "Deep checks aren't available right now, so here's a quick check. Try again later.";
/** Under a quick check's result: what it is. */
export const QUICK_NOTE =
  "Quick check: Unfret read only this page, by its rules, without looking the shop up elsewhere.";
export const CONSENT_HINT = "Read how Unfret works above and click I agree to start.";
/** Where a donation goes: always the site's own redirect, never a payment page directly (contract). */
export const DONATE_PATH = "/donate";
/** What a donation pays for. */
export const SUPPORT_PATH = "/support";
