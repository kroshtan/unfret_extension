/**
 * The contributor key (contract: "labels from the product, contributor keys"): optional, off until the user turns it
 * on in the settings. 32 random bytes in base64url without padding (43 characters), made and kept in this browser
 * (`storage.local`), sent only with "Wrong result?" reports and the contributor calls, never with a check. It lets
 * Unfret weigh the reports one person sends, and (only with a handle the user chooses and opts in to show) put them
 * on the public leaderboard, without knowing who they are. Losing it starts a new profile.
 */

export const CONTRIBUTOR_KEY = "contributorKey";
export const CONTRIBUTOR_KEY_RE = /^[A-Za-z0-9_-]{43}$/u;

/** A new key: 32 bytes from the browser's cryptographic random source, base64url without padding. */
export function newContributorKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** The stored key, if the user turned it on (anything malformed is ignored). */
export async function contributorKey(): Promise<string | undefined> {
  const stored = await chrome.storage.local.get<Record<string, unknown>>(CONTRIBUTOR_KEY);
  const key = stored[CONTRIBUTOR_KEY];
  return typeof key === "string" && CONTRIBUTOR_KEY_RE.test(key) ? key : undefined;
}

/** Turn it on: the stored key, or a new one. */
export async function ensureContributorKey(): Promise<string> {
  const known = await contributorKey();
  if (known) return known;
  const key = newContributorKey();
  await chrome.storage.local.set({ [CONTRIBUTOR_KEY]: key });
  return key;
}

/** Turn it off: the key is deleted from this browser. */
export async function dropContributorKey(): Promise<void> {
  await chrome.storage.local.remove(CONTRIBUTOR_KEY);
}
