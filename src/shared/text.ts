/** Wording used in more than one place (the extension is in English). */

export const OFFLINE = "Couldn't reach Unfret. Check your connection.";
export const SESSION_EXPIRED =
  "Your sign-in expired; your checks are still there. Sign in again to use them.";
/** The server no longer knows the pass in use (Unfret's new free start retired the old passes). */
export const PASS_ENDED = "Unfret has a new free start: your old pass has ended.";
/** After PASS_ENDED, in a browser that already had its free checks (its new pass comes without them). */
export const PASS_ENDED_PAID = "Quick checks stay free; deep checks come in packs.";
export const NO_CHECK_USED = "No check was used.";

/** How many checks are left; `free` of them free ones (all of them free: "You have 5 free checks"). */
export function checksText(checks: number, free = 0): string {
  if (free > 0 && free === checks)
    return checks === 1 ? "You have 1 free check" : `You have ${checks} free checks`;
  return checks === 1 ? "1 check left" : `${checks} checks left`;
}
export const FREE_PAUSED = "Free deep checks are back tomorrow. Quick checks still work.";
/** Under a quick check's result: what it is. */
export const QUICK_NOTE =
  "Quick check: Unfret read only this page, by its rules, without looking the shop up elsewhere.";
export const CONSENT_HINT = "Read how Unfret works above and click I agree to start.";
