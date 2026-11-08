/**
 * The only things the extension stores: the API base URL, and the session (token, wallet address, expiry).
 * No browsing data, no analysis results, no history.
 */

export const DEFAULT_API_BASE = "https://veridex.kroshtan.com";
/** Origins allowed as a development override (they need an optional host permission). */
export const DEV_ORIGINS = ["http://localhost", "http://127.0.0.1"];

export interface Session {
  token: string;
  address: string;
  expiresAt: string;
}

interface Stored {
  apiBase?: string;
  session?: Session;
}

const BASE58_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;

/** The API base, normalised (no trailing slash); falls back to production for anything unexpected. */
export function normaliseApiBase(value: string | undefined): string {
  if (!value) return DEFAULT_API_BASE;
  try {
    const url = new URL(value);
    const isDev = DEV_ORIGINS.some((o) => url.origin === o || url.origin.startsWith(`${o}:`));
    if (url.protocol !== "https:" && !isDev) return DEFAULT_API_BASE;
    return url.origin;
  } catch {
    return DEFAULT_API_BASE;
  }
}

export function isDevBase(apiBase: string): boolean {
  return normaliseApiBase(apiBase) !== DEFAULT_API_BASE;
}

/** A session object from an untrusted source (the connect page), or null when it doesn't look right. */
export function parseSession(value: unknown, now: Date = new Date()): Session | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const token = v.token;
  const address = v.address;
  const expiresAt = v.expires_at ?? v.expiresAt;
  if (typeof token !== "string" || token.length < 16 || token.length > 4096) return null;
  if (typeof address !== "string" || !BASE58_ADDRESS_RE.test(address)) return null;
  if (typeof expiresAt !== "string") return null;
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry) || expiry <= now.getTime()) return null;
  return { token, address, expiresAt: new Date(expiry).toISOString() };
}

export function sessionValid(session: Session | undefined, now: Date = new Date()): session is Session {
  return session !== undefined && Date.parse(session.expiresAt) > now.getTime();
}

export async function loadSettings(): Promise<{ apiBase: string; session?: Session }> {
  const stored = await chrome.storage.local.get<Stored>(["apiBase", "session"]);
  const apiBase = normaliseApiBase(stored.apiBase);
  return sessionValid(stored.session) ? { apiBase, session: stored.session } : { apiBase };
}

export async function saveApiBase(apiBase: string): Promise<string> {
  const normalised = normaliseApiBase(apiBase);
  await chrome.storage.local.set({ apiBase: normalised });
  return normalised;
}

export async function saveSession(session: Session): Promise<void> {
  await chrome.storage.local.set({ session });
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove("session");
}

export function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}
