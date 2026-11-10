/** Wording used in more than one place (the extension is in English). */

export const OFFLINE = "Couldn't reach Unfret. Check your connection.";
export const SESSION_EXPIRED =
  "Your sign-in expired; your checks are still there. Sign in again to use them.";
export const NO_CHECK_USED = "No check was used.";

export function checksText(checks: number): string {
  return checks === 1 ? "1 check left" : `${checks} checks left`;
}
export const CONSENT_HINT = "Read how Unfret works above and click I agree to start.";
