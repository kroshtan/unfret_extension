/**
 * Accepting the session the connect page announces. The page posts `{type: "veridex-session", ...}` to itself
 * after a successful Sign-In With Solana; only a message from that very window, on the configured Veridex
 * origin, with a well-formed session, is relayed to the extension.
 */

import { normaliseApiBase, parseSession, type Session } from "../shared/settings.js";

export const SESSION_MESSAGE = "veridex-session";

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
  if (pageOrigin !== new URL(normaliseApiBase(apiBase)).origin) return null; // not the configured Veridex site
  const data = event.data;
  if (typeof data !== "object" || data === null || (data as { type?: unknown }).type !== SESSION_MESSAGE) {
    return null;
  }
  return parseSession(data);
}
