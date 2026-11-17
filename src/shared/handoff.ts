/**
 * When the extension takes a pass or a wallet sign-in from unfret.net (the checkout and connect pages relay them),
 * and how it asks first.
 *
 * - **No pass or sign-in yet:** it takes one only when the hand-off follows a click on that page (the content script
 *   checks the page's user activation, which a script can't fake), or when the page is in a tab the extension opened
 *   itself, from its own popup or settings or after installing (a one-time **ticket** bound to that tab, valid for an
 *   hour). Anything else is refused with "needs-click": the page shows a button, and the click hands it over again.
 *   Another site can open unfret.net in a window, but it can't click there for the user, nor get a ticketed tab.
 * - **Another pass or wallet already:** it never switches by itself. It asks in its own window (`confirm.html`),
 *   which names both accounts; a page's own question can't be trusted for that. The window opens only in answer to a
 *   click on the page (or, for a wallet, in a ticketed tab), so a site can't pop it up on its own.
 *
 * Tickets and the offer waiting for an answer live in `chrome.storage.session`: memory only, and out of reach of
 * content scripts and pages.
 */

import { UnfretApi } from "../api/client.js";
import { ANSWER_MESSAGE } from "../content/relay.js";
import { isOwnPass } from "./new-pass.js";
import { loadSettings, saveSession, type Session } from "./settings.js";

/** How long a tab the extension opened may hand it a first pass without a click (a card payment takes a while). */
export const TICKET_MS = 60 * 60 * 1000;
/** How long the extension's question waits for an answer. */
export const OFFER_MS = 10 * 60 * 1000;

const TICKETS = "handoffTickets";
const OFFER = "handoffOffer";

/** From an extension page (popup, settings) to the background: open this page of the Unfret site, with a ticket. */
export const OPEN_MESSAGE = "unfret-open";
export type HandoffKind = "key" | "wallet";
export type OfferAnswer = "signed-in" | "kept";

/** What the extension's own window asks about. */
export interface Offer {
  id: string;
  kind: HandoffKind;
  /** What the page handed over. */
  session: Session;
  /** The tab it came from, told the answer. */
  tabId: number;
  /** The account the extension uses now, and whether that is the free pass it made itself. */
  current: Session;
  freePass: boolean;
  expiresAt: number;
  /** The window (or, without windows, the tab) asking. */
  windowId?: number;
  confirmTabId?: number;
}

async function sessionGet<T>(key: string): Promise<T | undefined> {
  try {
    return (await chrome.storage.session.get<Record<string, T>>(key))[key];
  } catch {
    return undefined; // no session storage: no tickets, nothing pending
  }
}

async function sessionSet(key: string, value: unknown): Promise<void> {
  try {
    await chrome.storage.session.set({ [key]: value });
  } catch {
    // no session storage: a ticket or an offer simply isn't kept
  }
}

async function sessionRemove(key: string): Promise<void> {
  try {
    await chrome.storage.session.remove(key);
  } catch {
    // nothing was kept
  }
}

// ── Tickets ─────────────────────────────────────────────────────────────────────────────────────────────────────

async function tickets(now: number): Promise<Record<string, number>> {
  const all = (await sessionGet<Record<string, number>>(TICKETS)) ?? {};
  return Object.fromEntries(Object.entries(all).filter(([, until]) => until > now));
}

/** The extension opened `tabId` on the Unfret site: a first pass from it needs no click for a while. */
export async function grantTicket(tabId: number, now: number = Date.now()): Promise<void> {
  await sessionSet(TICKETS, { ...(await tickets(now)), [tabId]: now + TICKET_MS });
}

/** Whether `tabId` holds a ticket that hasn't run out. */
export async function hasTicket(tabId: number | undefined, now: number = Date.now()): Promise<boolean> {
  if (tabId === undefined) return false;
  return String(tabId) in (await tickets(now));
}

/** Forget one tab's ticket (closed), or all of them (the extension signed in: they did their job). */
export async function dropTickets(tabId?: number): Promise<void> {
  if (tabId === undefined) return sessionRemove(TICKETS);
  const left = await tickets(Date.now());
  if (!(String(tabId) in left)) return;
  Reflect.deleteProperty(left, String(tabId));
  await sessionSet(TICKETS, left);
}

// ── The offer the extension asks about ──────────────────────────────────────────────────────────────────────────

/** The offer waiting for the user's answer, if it hasn't run out. */
export async function pendingOffer(now: number = Date.now()): Promise<Offer | undefined> {
  const offer = await sessionGet<Offer>(OFFER);
  return offer && offer.expiresAt > now ? offer : undefined;
}

export async function savePendingOffer(offer: Offer): Promise<void> {
  await sessionSet(OFFER, offer);
}

export async function clearPendingOffer(): Promise<void> {
  await sessionRemove(OFFER);
}

/** Tell the tab that handed something over how the user answered (it may have moved on or closed: no matter). */
export async function tellTab(tabId: number, kind: HandoffKind, status: OfferAnswer): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: ANSWER_MESSAGE, kind, status }, { frameId: 0 });
  } catch {
    // no content script there any more
  }
}

/**
 * The user's answer, from the extension's own window. Yes: the extension switches (a free pass's free checks left
 * move to the new pass first), and the page is told. No, or the offer ran out: nothing changes, and the page is told
 * that too. Only the offer with this `id` is answered: a newer one waits for its own answer.
 */
export async function answerOffer(id: string, accept: boolean): Promise<OfferAnswer | "gone"> {
  const offer = await pendingOffer();
  if (offer?.id !== id) return "gone";
  await clearPendingOffer();
  if (!accept) {
    await tellTab(offer.tabId, offer.kind, "kept");
    return "kept";
  }
  const { apiBase, session } = await loadSettings();
  if (
    offer.kind === "key" &&
    session &&
    session.token !== offer.session.token &&
    (await isOwnPass(session))
  ) {
    try {
      await new UnfretApi(apiBase, session.token).moveFreeChecks(offer.session.address.slice("key:".length));
    } catch {
      // offline, or an older server: the switch goes ahead; the free pass keeps its checks
    }
  }
  await saveSession(offer.session);
  await dropTickets();
  await tellTab(offer.tabId, offer.kind, "signed-in");
  return "signed-in";
}

/** A random id for an offer (only to match an answer to its question). */
export function offerId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
