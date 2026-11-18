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
/**
 * From 0.12.0, when the extension doesn't sign in with the session at once: `{type: "unfret-session-status", status}`,
 * "needs-click" (no click on the page came first: a button on the page hands it over again), "confirm" (the extension
 * asks in its own window; the received message follows on a yes) or "kept" (the user said no there). A message of its
 * own, so pages from before it (which take any received message as a sign-in) aren't misled.
 */
export const SESSION_STATUS_MESSAGE = "unfret-session-status";
export const SESSION_STATUSES = ["needs-click", "confirm", "kept"] as const;
export type SessionHandoffStatus = (typeof SESSION_STATUSES)[number];

export function isSessionHandoffStatus(value: unknown): value is SessionHandoffStatus {
  return (SESSION_STATUSES as readonly unknown[]).includes(value);
}

/**
 * Whether the user has just clicked (or typed) on this page: the browser's transient user activation, a few seconds
 * after a click. A script can't fake it, so a hand-off a page posts by itself on loading doesn't have it.
 */
export function userActivated(
  nav: unknown = typeof navigator === "undefined" ? undefined : navigator,
): boolean {
  const activation = (nav as { userActivation?: { isActive?: unknown } } | undefined)?.userActivation;
  return activation?.isActive === true;
}

/** From the extension to the content script of the tab that handed something over: how the user answered. */
export const ANSWER_MESSAGE = "unfret-handoff-answer";

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
// /checkout posts `{type: "unfret-key", key}` to itself when it shows a key it just made (a gift code, a card
// payment, a recovery, "Make a new key"), and `replace: true` once the user agreed to switch accounts. The extension
// answers `{type: "unfret-key-received", status}`; the answer never carries a key, an account or a balance. From
// 0.12.0 also "needs-click" (no pass yet, and no click on the page came first: nothing kept), "confirm" (the extension
// asks in its own window before it switches) and, after that window, "signed-in" again or "kept" (the user said no).

export const KEY_MESSAGE = "unfret-key";
export const KEY_RECEIVED_MESSAGE = "unfret-key-received";
export const KEY_STATUSES = [
  "signed-in",
  "already",
  "other-account",
  "invalid",
  "needs-click",
  "confirm",
  "kept",
] as const;
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

// ── An affiliate's code from the welcome page ───────────────────────────────────────────────────────────────────
// /welcome posts `{type: "unfret-ref", code}` to itself while the site keeps the code of an affiliate's link
// (unfret.net/?ref=CODE). The extension made its own pass on install without it; the background tells the server once,
// with that pass, and the page gets `{type: "unfret-ref-received", status}` back. Nothing else goes either way.

export const REF_MESSAGE = "unfret-ref";
export const REF_RECEIVED_MESSAGE = "unfret-ref-received";
export const REF_STATUSES = ["attributed", "already", "not_eligible", "invalid", "no-pass", "error"] as const;
export type RefStatus = (typeof REF_STATUSES)[number];
const REF_CODE_RE = /^[A-Za-z0-9]{3,24}$/;

export function isRefStatus(value: unknown): value is RefStatus {
  return (REF_STATUSES as readonly unknown[]).includes(value);
}

/** The affiliate code the welcome page offers, or null for anything else. */
export function acceptRefMessage(
  event: MessageLike,
  pageWindow: unknown,
  pageOrigin: string,
  apiBase: string,
): string | null {
  if (event.source !== pageWindow) return null;
  if (event.origin !== pageOrigin) return null;
  if (pageOrigin !== new URL(normaliseApiBase(apiBase)).origin) return null;
  const data = event.data;
  if (typeof data !== "object" || data === null) return null;
  const { type, code } = data as { type?: unknown; code?: unknown };
  if (type !== REF_MESSAGE || typeof code !== "string" || !REF_CODE_RE.test(code)) return null;
  return code.toUpperCase();
}

// ── Whether this browser had its free checks, from the welcome page (0.12.0) ────────────────────────────────────
// /welcome?setup=1 posts `{type: "unfret-free-ask", had}` to itself: whether the website's own note (the link checker's
// `unfret-free-pass` in localStorage) says this browser already had its free checks. A boolean, nothing else. The
// extension makes its free pass only then (a reinstall without browser sync has lost its own note in `storage.sync`),
// and answers `{type: "unfret-free-answer", status, free}`: "free" (the pass came with `free` free checks),
// "had-free" (without, as this browser had them), "none-today" (without: the server had none to give), "has-pass"
// (the extension has a pass or wallet already: nothing made), "error" (offline or refused: the popup offers it again)
// or "invalid".

export const FREE_ASK_MESSAGE = "unfret-free-ask";
export const FREE_ANSWER_MESSAGE = "unfret-free-answer";
export const FREE_STATUSES = ["free", "had-free", "none-today", "has-pass", "error", "invalid"] as const;
export type FreeStatus = (typeof FREE_STATUSES)[number];

export function isFreeStatus(value: unknown): value is FreeStatus {
  return (FREE_STATUSES as readonly unknown[]).includes(value);
}

/** Whether the welcome page says this browser had its free checks (true/false), or null for anything else. */
export function acceptFreeAsk(
  event: MessageLike,
  pageWindow: unknown,
  pageOrigin: string,
  apiBase: string,
): boolean | null {
  if (event.source !== pageWindow) return null;
  if (event.origin !== pageOrigin) return null;
  if (pageOrigin !== new URL(normaliseApiBase(apiBase)).origin) return null;
  const data = event.data;
  if (typeof data !== "object" || data === null) return null;
  const { type, had } = data as { type?: unknown; had?: unknown };
  if (type !== FREE_ASK_MESSAGE || typeof had !== "boolean") return null;
  return had;
}
