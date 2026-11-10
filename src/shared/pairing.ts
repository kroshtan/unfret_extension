/**
 * Sign in with a phone wallet: wait for the session a phone attaches to a pairing.
 *
 * The popup shows the pairing's connect URL as a QR code and its confirmation code; this polls the API until the
 * phone has signed in (the session is delivered once), the pairing expires, or the user cancels. Brief network
 * failures are retried until the pairing's expiry; anything the server refuses ends the wait.
 */

import { ApiError, type PairedSession, type UnfretApi } from "../api/client.js";
import { parseSession, type Session } from "./settings.js";

export const POLL_INTERVAL_MS = 1500;

export type PairingOutcome =
  | { kind: "signed-in"; session: Session }
  | { kind: "expired" }
  | { kind: "cancelled" }
  | { kind: "failed"; message: string };

export interface WaitOptions {
  expiresAt: string;
  signal?: AbortSignal;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function toSession(paired: PairedSession): Session | null {
  return parseSession(paired);
}

/**
 * Poll a pairing until it resolves.
 *
 * @param api - The API client (no token needed).
 * @param pairId - The pairing id.
 * @param options - Expiry, cancellation and (for tests) the clock and sleep.
 * @returns What happened.
 */
export async function waitForPairing(
  api: UnfretApi,
  pairId: string,
  options: WaitOptions,
): Promise<PairingOutcome> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const interval = options.intervalMs ?? POLL_INTERVAL_MS;
  const deadline = Date.parse(options.expiresAt);
  for (;;) {
    if (options.signal?.aborted) return { kind: "cancelled" };
    try {
      const poll = await api.pollPairing(pairId);
      if (poll.status === "ready") {
        const session = toSession(poll.session);
        return session
          ? { kind: "signed-in", session }
          : { kind: "failed", message: "The sign-in was not valid." };
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 410) return { kind: "expired" };
        if (error.status === 404)
          return { kind: "failed", message: "This sign-in request is no longer valid." };
        if (error.status < 500 && error.status !== 429) return { kind: "failed", message: error.message };
      }
      // Network trouble or a 5xx: keep trying until the pairing expires.
    }
    if (!Number.isNaN(deadline) && now() >= deadline) return { kind: "expired" };
    await sleep(interval, options.signal);
  }
}
