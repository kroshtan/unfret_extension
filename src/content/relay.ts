/**
 * Accepting the session the connect page announces. The page posts `{type: "veridex-session", ...}` to itself
 * after a successful Sign-In With Solana; only a message from that very window, on the configured Unfret
 * origin, with a well-formed session, is relayed to the extension. `unfret-session` is accepted too: the site
 * switches to it once the extensions in use understand it, and the old name goes after that.
 */

import { API_KEY_RE, normaliseApiBase, parseSession, type Session } from "../shared/settings.js";

// Wire names of API contract v1, shared with the backend's connect.js and every released extension (≤ 0.8.3), so
// they keep their pre-rename spelling; renaming them takes a coordinated two-step release.
export const SESSION_MESSAGE = "veridex-session";
const SESSION_MESSAGES: readonly unknown[] = [SESSION_MESSAGE, "unfret-session"];
export const SESSION_RECEIVED_MESSAGE = "veridex-session-received";

export interface MessageLike {
  origin: string;
  source: unknown;
  data: unknown;
}

export function acceptSessionMessage(
  event: MessageLike,
  pageWindow: unknown,
  pageOrigin: string,
  apiBase: string,
): Session | null {
  if (event.source !== pageWindow) return null; // not from the page itself (iframes, other windows)
  if (event.origin !== pageOrigin) return null;
  if (pageOrigin !== new URL(normaliseApiBase(apiBase)).origin) return null; // not the configured Unfret site
  const data = event.data;
  if (
    typeof data !== "object" ||
    data === null ||
    !SESSION_MESSAGES.includes((data as { type?: unknown }).type)
  ) {
    return null;
  }
  return parseSession(data);
}

// ── A new API key from the checkout page ────────────────────────────────────────────────────────────────────────
// /checkout posts `{type: "unfret-key", key}` to itself when it shows a key it just made (an intro code, a card
// payment, a recovery, "Make a new key"), and `replace: true` once the user agreed to switch accounts. The extension
// answers `{type: "unfret-key-received", status}`; the answer never carries a key, an account or a balance.

export const KEY_MESSAGE = "unfret-key";
export const KEY_RECEIVED_MESSAGE = "unfret-key-received";
export const KEY_STATUSES = ["signed-in", "already", "other-account", "invalid"] as const;
export type KeyHandoffStatus = (typeof KEY_STATUSES)[number];

export interface KeyOffer {
  key: string;
  /** The user agreed, on the page, to replace the account the extension is signed in with. */
  replace: boolean;
}

export function isKeyHandoffStatus(value: unknown): value is KeyHandoffStatus {
  return (KEY_STATUSES as readonly unknown[]).includes(value);
}

/** The key the checkout page offers, or null for anything else (another window or origin, a malformed message). */
export function acceptKeyMessage(
  event: MessageLike,
  pageWindow: unknown,
  pageOrigin: string,
  apiBase: string,
): KeyOffer | null {
  if (event.source !== pageWindow) return null;
  if (event.origin !== pageOrigin) return null;
  if (pageOrigin !== new URL(normaliseApiBase(apiBase)).origin) return null;
  const data = event.data;
  if (typeof data !== "object" || data === null) return null;
  const { type, key, replace } = data as { type?: unknown; key?: unknown; replace?: unknown };
  if (type !== KEY_MESSAGE || typeof key !== "string" || !API_KEY_RE.test(key)) return null;
  return { key, replace: replace === true };
}
