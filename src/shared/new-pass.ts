/**
 * The free pass: an Unfret pass the extension makes for itself on install, with a few free checks, so a new user can
 * check pages at once without a code, an account or a purchase.
 *
 * The pass is made like the website makes one (its `static/new-pass.js`): a proof of work (a few seconds of hashing),
 * then `POST /v1/keys` with `free: true`. The server gives the free checks only while this network hasn't had its
 * share today; past that the pass is made empty. To ask only once per browser profile, a flag in `storage.sync`
 * (synced with the browser's account when sync is on, local otherwise) remembers that free checks were given: a
 * reinstall in the same profile gets a pass without them. The pass's backup code is kept with it, so the options page
 * can show it.
 */

import { type IssuedKey, UnfretApi } from "../api/client.js";
import { keySession, saveSession, type Session } from "./settings.js";

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
  { ok: true; session: Session; freeChecks: number } | { ok: false; reason: "offline" | "refused" };

/**
 * Make the extension's own pass and sign in with it: with free checks unless this profile had them already.
 *
 * @param apiBase - The API.
 * @param api - The client (tests pass one with a fake fetch).
 */
export async function makeFreePass(
  apiBase: string,
  api: UnfretApi = new UnfretApi(apiBase),
): Promise<FreePass> {
  let issued: IssuedKey;
  try {
    const ask = !(await freeChecksUsed());
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
  if (freeChecks > 0) await markFreeChecksUsed();
  return { ok: true, session, freeChecks };
}
