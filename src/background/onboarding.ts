/**
 * Getting a new user to their first check: a free pass and the welcome page on install, the pass the checkout page
 * hands over and the wallet sign-in the connect page hands over (when to take them, and when to ask first:
 * `shared/handoff.ts`), and the Unfret pages the extension opens itself.
 *
 * All plain functions over what they need, so tests can drive them without a browser.
 */

import { UnfretApi } from "../api/client.js";
import {
  type FreeStatus,
  isRefStatus,
  type KeyHandoffStatus,
  type RefStatus,
  type SessionHandoffStatus,
} from "../content/relay.js";
import {
  dropTickets,
  grantTicket,
  type HandoffKind,
  hasTicket,
  OFFER_MS,
  offerId,
  pendingOffer,
  savePendingOffer,
  tellTab,
} from "../shared/handoff.js";
import { isOwnPass, makeFreePass, WELCOME_SETUP_PATH } from "../shared/new-pass.js";
import {
  DEFAULT_API_BASE,
  isKeySession,
  keySession,
  loadSettings,
  parseSession,
  saveSession,
  type Session,
} from "../shared/settings.js";
import { withoutSecrets } from "../shared/urls.js";

/** The website's first-run page (Unfret Dev: on the dev deployment). */
export const WELCOME_URL = `${DEFAULT_API_BASE}/welcome`;
/** The welcome page while the extension makes its free pass (`WELCOME_SETUP_PATH`). */
export const WELCOME_SETUP_URL = `${DEFAULT_API_BASE}${WELCOME_SETUP_PATH}`;

/**
 * Open a page of the Unfret site in a new tab, with a ticket: until the extension has a pass, that tab may hand it one
 * without a click (the user started there from the extension itself). Never an address with pass or key material.
 *
 * @returns The new tab's id, if the browser gave one.
 */
export async function openUnfretTab(url: string): Promise<number | undefined> {
  const tab = await chrome.tabs.create({ url: withoutSecrets(url) });
  if (tab.id !== undefined) await grantTicket(tab.id);
  return tab.id;
}

/**
 * The address of a page of the API's own site at `path` ("/checkout?mode=code"), or null for anything else: an
 * extension page asks the background to open it, so it may only name a path there.
 */
export function unfretPageUrl(apiBase: string, path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return null;
  try {
    const url = new URL(path, apiBase);
    return url.origin === new URL(apiBase).origin ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * After a new install (never an update or a browser update): open the welcome page, which tells the extension whether
 * this browser had its free checks, and the extension makes its pass then (`receiveFreeAsk`): a reinstall without
 * browser sync has lost the extension's own note of that. The page opens with a ticket (a code or a purchase there
 * signs the extension in). Until the pass is made, the popup offers the free checks again (`passPending`).
 *
 * @returns Whether it was a new install.
 */
export async function welcomeOnInstall(
  details: { reason: string },
  open: (url: string) => unknown = openUnfretTab,
): Promise<boolean> {
  if (details.reason !== "install") return false;
  const { session } = await loadSettings();
  if (session) {
    void open(WELCOME_URL);
    return true;
  }
  await chrome.storage.local.set({ passPending: true });
  void open(WELCOME_SETUP_URL);
  return true;
}

/** The answer to the welcome page's question: how the free pass went, and how many free checks it came with. */
export interface FreeAnswer {
  status: FreeStatus;
  free?: number;
}

let making: Promise<FreeAnswer> | undefined; // one free pass at a time, whatever number of welcome pages ask

/**
 * The welcome page says whether this browser had its free checks (the website's own note: a yes or no). Without a
 * pass or wallet yet, make the extension's free pass now: with free checks only if neither that note nor this
 * profile's own flag says they were given. Only from the welcome page of the configured Unfret site.
 */
export async function receiveFreeAsk(
  message: { had?: unknown },
  sender: chrome.runtime.MessageSender,
  extensionId: string,
  makePass: typeof makeFreePass = makeFreePass,
): Promise<FreeAnswer> {
  const { apiBase, session } = await loadSettings();
  if (!fromUnfretPage(sender, extensionId, apiBase, "/welcome")) return { status: "invalid" };
  if (typeof message.had !== "boolean") return { status: "invalid" };
  if (making) return making;
  if (session) return { status: "has-pass" };
  const had = message.had;
  making = (async (): Promise<FreeAnswer> => {
    const made = await makePass(apiBase, undefined, had);
    if (!made.ok) return { status: "error" };
    if (made.freeChecks > 0) return { status: "free", free: made.freeChecks };
    return { status: made.asked ? "none-today" : "had-free" };
  })().finally(() => {
    making = undefined;
  });
  return making;
}

function senderOrigin(sender: chrome.runtime.MessageSender): string {
  try {
    return new URL(sender.url ?? "").origin;
  } catch {
    return "";
  }
}

/**
 * Whether a message comes from the top frame of the configured Unfret site's page at `path` exactly (not a longer
 * path that merely starts with it), via our content script.
 */
export function fromUnfretPage(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
  apiBase: string,
  path: string,
): boolean {
  if (sender.id !== extensionId || sender.frameId !== 0) return false;
  if (senderOrigin(sender) !== new URL(apiBase).origin) return false;
  const pathname = new URL(sender.url ?? "").pathname;
  return pathname === path || pathname === `${path}/`;
}

/** Whether a message comes from one of the extension's own pages (popup, settings), not a content script. */
export function fromExtensionPage(sender: chrome.runtime.MessageSender, extensionId: string): boolean {
  if (sender.id !== extensionId) return false;
  try {
    const url = new URL(sender.url ?? "");
    return url.protocol.endsWith("-extension:") && url.host === extensionId;
  } catch {
    return false;
  }
}

/** Opens the extension's own window (or tab) that asks; its ids, to notice when it is closed unanswered. */
export type AskWindow = () => Promise<{ windowId?: number | undefined; tabId?: number | undefined }>;

/** The extension's question, in a small window of its own (a tab where there are no windows: Firefox for Android). */
export const openAskWindow: AskWindow = async () => {
  const url = chrome.runtime.getURL("confirm/confirm.html");
  const asking = await pendingOffer();
  try {
    if (asking?.windowId !== undefined) {
      await chrome.windows.update(asking.windowId, { focused: true });
      return { windowId: asking.windowId };
    }
  } catch {
    // that window is gone: open another
  }
  const windows = chrome.windows as typeof chrome.windows | undefined; // none on Firefox for Android
  if (windows) {
    const created = await windows.create({ url, type: "popup", width: 440, height: 600, focused: true });
    return { windowId: created?.id };
  }
  const tab = await chrome.tabs.create({ url });
  return { tabId: tab.id };
};

/**
 * Ask in the extension's own window before switching to `offered`; a newer question replaces an older one (whose page
 * is told "kept").
 */
export async function askInExtension(
  kind: HandoffKind,
  offered: Session,
  current: Session,
  tabId: number,
  ask: AskWindow = openAskWindow,
): Promise<void> {
  const before = await pendingOffer();
  const offer = {
    id: offerId(),
    kind,
    session: offered,
    tabId,
    current,
    freePass: await isOwnPass(current),
    expiresAt: Date.now() + OFFER_MS,
    ...(before?.windowId !== undefined ? { windowId: before.windowId } : {}),
  };
  await savePendingOffer(offer);
  if (before && before.tabId !== tabId) await tellTab(before.tabId, before.kind, "kept");
  const opened: Awaited<ReturnType<AskWindow>> = await ask().catch(() => ({}));
  const now = await pendingOffer();
  if (now?.id !== offer.id) return; // answered (or replaced) meanwhile
  await savePendingOffer({
    ...now,
    ...(opened.windowId !== undefined ? { windowId: opened.windowId } : {}),
    ...(opened.tabId !== undefined ? { confirmTabId: opened.tabId } : {}),
  });
}

/** The answer to the checkout page: a status and, for "other-account", whether that is the extension's free pass. */
export interface KeyHandoffReply {
  status: KeyHandoffStatus;
  freePass?: true;
}

/**
 * The key the checkout page offers.
 *
 * - The same key: "already".
 * - No pass yet: signs in when the hand-off followed a click on the page (`activated`, read by the content script) or
 *   came from a tab the extension opened (its ticket); otherwise "needs-click" and nothing is kept.
 * - Another pass or a wallet: "other-account" (and whether it is the extension's free pass, so the page words its
 *   question for it); once the user agreed on the page (`replace`, on a click), the extension asks in its own window
 *   ("confirm"), and only a yes there switches (a free pass's free checks left move first). The page is told then.
 *
 * The key isn't checked with the server here: the page has just made it there, and the popup asks for its balance
 * (and forgets a key the server refuses).
 */
export async function receiveKey(
  message: { key?: unknown; replace?: unknown; activated?: unknown },
  sender: chrome.runtime.MessageSender,
  extensionId: string,
  ask: AskWindow = openAskWindow,
): Promise<KeyHandoffReply> {
  const { apiBase, session } = await loadSettings();
  if (!fromUnfretPage(sender, extensionId, apiBase, "/checkout")) return { status: "invalid" };
  const offered = typeof message.key === "string" ? keySession(message.key) : null;
  if (!offered || offered.token !== message.key) return { status: "invalid" };
  if (session?.token === offered.token) return { status: "already" };
  const activated = message.activated === true;
  const tabId = sender.tab?.id;
  if (!session) {
    if (!activated && !(await hasTicket(tabId))) return { status: "needs-click" };
    await saveSession(offered);
    await dropTickets();
    return { status: "signed-in" };
  }
  if (message.replace === true && activated && tabId !== undefined) {
    await askInExtension("key", offered, session, tabId, ask);
    return { status: "confirm" };
  }
  return (await isOwnPass(session))
    ? { status: "other-account", freePass: true }
    : { status: "other-account" };
}

/** The answer to the connect page: signed in (`ok`), or why not yet. */
export type SessionHandoffReply = { ok: true } | { ok: false; status?: SessionHandoffStatus };

/**
 * The wallet sign-in the connect page relays.
 *
 * - The same wallet (a renewed sign-in) or no sign-in yet after a click on the page or in a tab the extension opened:
 *   signed in.
 * - No sign-in yet otherwise: "needs-click", nothing kept.
 * - Another wallet or a pass: the extension asks in its own window ("confirm") when the hand-off followed a click on
 *   the page or came from a tab it opened; otherwise "needs-click" (a click on the page brings the question).
 */
export async function receiveSession(
  message: { session?: unknown; activated?: unknown },
  sender: chrome.runtime.MessageSender,
  extensionId: string,
  ask: AskWindow = openAskWindow,
): Promise<SessionHandoffReply> {
  const { apiBase, session: current } = await loadSettings();
  if (!fromUnfretPage(sender, extensionId, apiBase, "/connect")) return { ok: false };
  const offered = parseSession(message.session);
  if (!offered) return { ok: false };
  const tabId = sender.tab?.id;
  const clicked = message.activated === true || (await hasTicket(tabId));
  if (current && !isKeySession(current) && current.address === offered.address) {
    await saveSession(offered);
    return { ok: true };
  }
  if (!clicked || tabId === undefined) return { ok: false, status: "needs-click" };
  if (!current) {
    await saveSession(offered);
    await dropTickets();
    return { ok: true };
  }
  await askInExtension("wallet", offered, current, tabId, ask);
  return { ok: false, status: "confirm" };
}

/**
 * Tell the server which affiliate brought this user, with the extension's own pass: the welcome page relays the code
 * the site kept from an affiliate's link (`unfret.net/?ref=CODE`). Only from the welcome page, only for a pass (a
 * wallet is never attributed), and the server decides the rest: a pass counts for one affiliate, the first, and only
 * if it never bought checks. "no-pass" (none yet: the page keeps the code) and "error" (offline) let the page try again
 * later.
 */
export async function receiveRef(
  message: { code?: unknown },
  sender: chrome.runtime.MessageSender,
  extensionId: string,
): Promise<{ status: RefStatus }> {
  const { apiBase, session } = await loadSettings();
  if (!fromUnfretPage(sender, extensionId, apiBase, "/welcome")) return { status: "invalid" };
  if (typeof message.code !== "string" || !/^[A-Za-z0-9]{3,24}$/.test(message.code))
    return { status: "invalid" };
  if (!session) return { status: "no-pass" };
  if (session.kind !== "key") return { status: "not_eligible" };
  try {
    const status = await new UnfretApi(apiBase, session.token).attributeAffiliate(message.code);
    return { status: isRefStatus(status) ? status : "invalid" };
  } catch {
    return { status: "error" };
  }
}
