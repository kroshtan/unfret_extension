/**
 * The free pass: an Unfret pass the extension makes for itself on install, with a few free checks, so a new user can
 * check pages at once without a code, an account or a purchase.
 *
 * The pass is made like the website makes one (its `static/new-pass.js`): a proof of work (a few seconds of hashing),
 * then `POST /v1/keys` with `free: true`. The server gives the free checks only while this network hasn't had its
 * share today; past that the pass is made empty. To ask only once per browser profile, a flag in `storage.sync`
 * (synced with the browser's account when sync is on, local otherwise) remembers that free checks were given: a
 * reinstall in the same profile gets a pass without them. Removing the extension wipes that flag when the browser
 * doesn't sync, so a pass with free checks is made only from the welcome page (`/welcome?setup=1`), which first says
 * whether the website's own note in this browser has them as given (`siteHad`): with either note, no free checks.
 * The pass's backup code is kept with it, so the options page can show it.
 */

import { ApiError, type IssuedKey, UnfretApi } from "../api/client.js";
import { expireSession, isKeySession, keySession, saveSession, type Session } from "./settings.js";

/**
 * The website's welcome page while the extension makes its free pass: it says whether this browser had its free
 * checks (background `receiveFreeAsk`), then moves on to the welcome that fits (`?free=<n>`, `?note=…` or the plain
 * one). Opened on install and by the popup's "Get your free checks".
 */
export const WELCOME_SETUP_PATH = "/welcome?setup=1";
/**
 * The same, after the server stopped knowing this browser's pass (Unfret's new free start): the welcome page then
 * says so ("your old pass has ended") on the welcome it moves on to. Older servers ignore `renewed`.
 */
export const WELCOME_RENEWED_PATH = "/welcome?setup=1&renewed=1";

/** In `storage.sync`: this browser profile has had its free checks. */
export const FREE_FLAG = "freeChecksUsed";

/** The pass the extension made for itself: its ID, and its backup code (the server keeps only a hash of it). */
export interface OwnPass {
  keyId: string;
  recoveryCode: string;
}

function zeroBits(digest: ArrayBuffer): number {
  let bits = 0;
  for (const byte of new Uint8Array(digest)) {
    if (byte) return bits + Math.clz32(byte) - 24;
    bits += 8;
  }
  return bits;
}

/** The proof of work: a counter `n` with SHA-256(challenge + ":" + n) starting with `bits` zero bits. */
export async function solve(challenge: string, bits: number): Promise<string> {
  const encoder = new TextEncoder();
  for (let start = 0; ; start += 256) {
    const batch = Array.from({ length: 256 }, (_, i) => String(start + i));
    const digests = await Promise.all(
      batch.map((n) => crypto.subtle.digest("SHA-256", encoder.encode(`${challenge}:${n}`))),
    );
    const found = digests.findIndex((digest) => zeroBits(digest) >= bits);
    if (found >= 0) return batch[found] ?? "0";
  }
}

/** Whether this browser profile already had its free checks (sync storage unavailable: no). */
export async function freeChecksUsed(): Promise<boolean> {
  try {
    const stored = await chrome.storage.sync.get<Record<string, unknown>>(FREE_FLAG);
    return stored[FREE_FLAG] === true;
  } catch {
    return false;
  }
}

async function markFreeChecksUsed(): Promise<void> {
  try {
    await chrome.storage.sync.set({ [FREE_FLAG]: true });
  } catch {
    // no sync storage: the server's own limits still apply
  }
}

export async function ownPass(): Promise<OwnPass | undefined> {
  const stored = await chrome.storage.local.get<{ ownPass?: OwnPass }>("ownPass");
  return stored.ownPass;
}

/** Whether `session` is the pass the extension made for itself. */
export async function isOwnPass(session: Session | undefined): Promise<boolean> {
  const own = await ownPass();
  return own !== undefined && session?.address === `key:${own.keyId}`;
}

export type FreePass =
  | { ok: true; session: Session; freeChecks: number; asked: boolean }
  | { ok: false; reason: "offline" | "refused" };

/**
 * Make the extension's own pass and sign in with it: with free checks unless this profile had them already.
 *
 * @param apiBase - The API.
 * @param api - The client (tests pass one with a fake fetch).
 * @param siteHad - The website's note in this browser says it had its free checks (the welcome page's answer); then
 *   none are asked for either, and this profile's own flag is set to match.
 * @returns The pass, how many free checks it came with and whether they were asked for.
 */
export async function makeFreePass(
  apiBase: string,
  api: UnfretApi = new UnfretApi(apiBase),
  siteHad = false,
): Promise<FreePass> {
  let issued: IssuedKey;
  let ask: boolean;
  try {
    ask = !siteHad && !(await freeChecksUsed());
    const challenge = await api.keyChallenge();
    issued = await api.createKey(challenge.challenge, await solve(challenge.challenge, challenge.bits), ask);
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    return { ok: false, reason: typeof status === "number" ? "refused" : "offline" };
  }
  const session = keySession(issued.key);
  if (!session) return { ok: false, reason: "refused" };
  const freeChecks = issued.free_checks ?? 0;
  await chrome.storage.local.set({ ownPass: { keyId: issued.key_id, recoveryCode: issued.recovery_code } });
  await chrome.storage.local.remove("passPending");
  await saveSession(session);
  if (freeChecks > 0 || siteHad) await markFreeChecksUsed();
  return { ok: true, session, freeChecks, asked: ask };
}

/**
 * The server no longer knows `session`'s pass (401 `INVALID_API_KEY`: retired at Unfret's new free start, or replaced
 * with its backup code). Forget it, and its backup code if the extension made it (useless now); note once that it
 * ended, so the popup says so calmly (not "expired": there is nothing to sign in to again) and offers the free pass
 * again (`passPending`). The free checks' flag in `storage.sync` stays as it is: a browser that never had them gets
 * them now, one that had them gets a pass without. A newer sign-in stored meanwhile is left alone.
 */
export async function endPass(session: Session): Promise<void> {
  const stored = await chrome.storage.local.get<{ session?: Session; ownPass?: OwnPass }>([
    "session",
    "ownPass",
  ]);
  if (stored.session !== undefined && stored.session.token !== session.token) return;
  const forget = ["session", "sessionExpired"];
  if (stored.ownPass !== undefined && session.address === `key:${stored.ownPass.keyId}`)
    forget.push("ownPass");
  await chrome.storage.local.remove(forget);
  await chrome.storage.local.set({ passEnded: true, passPending: true });
}

/** Whether the server's `error` says that `session`, a pass, has ended (a wallet's 401 never is). */
export function passEndedBy(session: Session | undefined, error: unknown): session is Session {
  return isKeySession(session) && error instanceof ApiError && error.passEnded;
}

/**
 * The server refused `session` (a 401): a pass that ended ({@link endPass}), or else an expired or revoked sign-in,
 * remembered as before so the popup asks to sign in again.
 *
 * @returns Which of the two it was.
 */
export async function rejectSession(
  session: Session | undefined,
  error: unknown,
): Promise<"ended" | "expired"> {
  if (passEndedBy(session, error)) {
    await endPass(session);
    return "ended";
  }
  await expireSession();
  return "expired";
}
