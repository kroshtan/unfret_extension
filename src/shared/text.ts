/** Wording used in more than one place (the extension is in English). */

export const OFFLINE = "Couldn't reach Unfret. Check your connection.";
/**
 * Free deep checks are paused (the spend ceiling, paced per day): the client's own words for
 * `free_checks_run_on_donations`. The pause always lasts until the next day.
 */
export const FREE_PAUSED =
  "Free checks run on donations, and today's are used up. Quick checks still work; deep checks are back tomorrow.";
/** Over a quick check that ran because free deep checks are paused (the pause note says the rest). */
export const FREE_PAUSED_QUICK = "Free deep checks are paused until tomorrow, so this is a quick check.";
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
