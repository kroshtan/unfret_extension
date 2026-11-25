/**
 * The only things the extension stores: the API base URL and which version of the consent screen was accepted. No
 * account, no pass, no browsing data, no analysis results, no history.
 */

// Set by the build: the dev deployment for "Unfret Dev", production for everything else (and in tests).
declare const __UNFRET_API__: string | undefined;
export const DEFAULT_API_BASE = typeof __UNFRET_API__ === "string" ? __UNFRET_API__ : "https://unfret.net";
/** Origins allowed as a development override (they need an optional host permission). */
export const DEV_ORIGINS = ["http://localhost", "http://127.0.0.1"];

/**
 * The API base, normalised (no trailing slash): this build's own API or a local dev server, and the default for
 * anything else. The extension pages can reach nothing else (CSP), so a stored dev-deployment URL from before Unfret
 * Dev existed (0.8.0) falls back to the default here.
 */
export function normaliseApiBase(value: string | undefined): string {
  if (!value) return DEFAULT_API_BASE;
  try {
    const url = new URL(value);
    const isLocal = DEV_ORIGINS.some((o) => url.origin === o || url.origin.startsWith(`${o}:`));
    if (!isLocal) return DEFAULT_API_BASE;
    return url.origin;
  } catch {
    return DEFAULT_API_BASE;
  }
}

export function isDevBase(apiBase: string): boolean {
  return normaliseApiBase(apiBase) !== DEFAULT_API_BASE;
}

export async function loadSettings(): Promise<{ apiBase: string }> {
  const stored = await chrome.storage.local.get<{ apiBase?: string }>("apiBase");
  return { apiBase: normaliseApiBase(stored.apiBase) };
}

export async function saveApiBase(apiBase: string): Promise<string> {
  const normalised = normaliseApiBase(apiBase);
  await chrome.storage.local.set({ apiBase: normalised });
  return normalised;
}

/**
 * What versions before free checks for shoppers (0.14.0) kept about an account: the session or Unfret pass, its
 * backup code, notes about it, and this profile's "had its free checks" flag. The extension no longer uses any of it.
 */
export const OLD_ACCOUNT_KEYS = ["session", "sessionExpired", "passEnded", "ownPass", "passPending"] as const;
const OLD_SYNC_KEYS = ["freeChecksUsed"];
const OLD_SESSION_KEYS = ["pendingPairing", "handoffTickets", "handoffOffer"];

/** Delete every trace of an account an older version stored (run on install, update and start-up; cheap). */
export async function forgetOldAccount(): Promise<void> {
  const remove = async (
    area: chrome.storage.StorageArea | undefined,
    keys: readonly string[],
  ): Promise<void> => {
    try {
      await area?.remove([...keys]);
    } catch {
      // that storage area isn't available: nothing was kept there
    }
  };
  await remove(chrome.storage.local, OLD_ACCOUNT_KEYS);
  await remove(chrome.storage.sync, OLD_SYNC_KEYS);
  await remove(chrome.storage.session, OLD_SESSION_KEYS);
}

/**
 * Bump when what the consent screen says changes materially: everyone is asked again. 2 (0.11.0): marketplace ads and service providers.
 */
export const CONSENT_VERSION = 2;
export const PRIVACY_URL = `${DEFAULT_API_BASE}/privacy`;

/** Whether the current consent screen was accepted. */
export async function consentGiven(): Promise<boolean> {
  const stored = await chrome.storage.local.get<{ consent?: { version?: unknown } }>("consent");
  return stored.consent?.version === CONSENT_VERSION;
}

export async function giveConsent(): Promise<void> {
  await chrome.storage.local.set({ consent: { version: CONSENT_VERSION } });
}
