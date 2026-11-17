/**
 * Getting a new user to their first check: a free pass and the welcome page on install, and the pass the checkout
 * page hands over.
 *
 * All plain functions over what they need, so tests can drive them without a browser.
 */

import { UnfretApi } from "../api/client.js";
import { type KeyHandoffStatus } from "../content/relay.js";
import { isOwnPass, makeFreePass } from "../shared/new-pass.js";
import { DEFAULT_API_BASE, keySession, loadSettings, saveSession } from "../shared/settings.js";

/** The website's first-run page (Unfret Dev: on the dev deployment); `?free=<n>` says "You have n free checks". */
export const WELCOME_URL = `${DEFAULT_API_BASE}/welcome`;

/** The welcome page for a pass with `freeChecks` free checks (none: the page for a code, a purchase or a pass). */
export function welcomeUrl(freeChecks: number): string {
  return freeChecks > 0 ? `${WELCOME_URL}?free=${freeChecks}` : WELCOME_URL;
}

/**
 * After a new install (never an update or a browser update): make the extension's own pass, with free checks unless
 * this browser profile had them, then open the welcome page saying how many. Offline or refused, the welcome page
 * opens anyway and the popup tries again (`passPending`).
 *
 * @returns Whether it was a new install.
 */
export async function welcomeOnInstall(
  details: { reason: string },
  open: (url: string) => unknown = (url) => chrome.tabs.create({ url }),
  makePass: (apiBase: string) => ReturnType<typeof makeFreePass> = makeFreePass,
): Promise<boolean> {
  if (details.reason !== "install") return false;
  const { apiBase, session } = await loadSettings();
  let freeChecks = 0;
  if (!session) {
    const made = await makePass(apiBase);
    if (made.ok) freeChecks = made.freeChecks;
    else await chrome.storage.local.set({ passPending: true });
  }
  void open(welcomeUrl(freeChecks));
  return true;
}

function senderOrigin(sender: chrome.runtime.MessageSender): string {
  try {
    return new URL(sender.url ?? "").origin;
  } catch {
    return "";
  }
}

/** Whether a message comes from the top frame of the configured Unfret site's page at `path`, via our content script. */
export function fromUnfretPage(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
  apiBase: string,
  path: string,
): boolean {
  if (sender.id !== extensionId || sender.frameId !== 0) return false;
  if (senderOrigin(sender) !== new URL(apiBase).origin) return false;
  return new URL(sender.url ?? "").pathname.startsWith(path);
}

/** The answer to the checkout page: a status and, for "other-account", whether that is the extension's free pass. */
export interface KeyHandoffReply {
  status: KeyHandoffStatus;
  freePass?: true;
}

/**
 * Sign in with the key the checkout page offers. Signed in with another key or a wallet, nothing changes until the
 * user agreed on the page (`replace`): accounts are never swapped silently. When what the extension has is its own
 * free pass, it says so (the page words its question for it), and on `replace` its free checks left move to the new
 * pass first, so switching loses none. The key isn't checked with the server here: the page has just made it there,
 * and the popup asks for its balance (and forgets a key the server refuses).
 */
export async function receiveKey(
  message: { key?: unknown; replace?: unknown },
  sender: chrome.runtime.MessageSender,
  extensionId: string,
): Promise<KeyHandoffReply> {
  const { apiBase, session } = await loadSettings();
  if (!fromUnfretPage(sender, extensionId, apiBase, "/checkout")) return { status: "invalid" };
  const offered = typeof message.key === "string" ? keySession(message.key) : null;
  if (!offered || offered.token !== message.key) return { status: "invalid" };
  if (session?.token === offered.token) return { status: "already" };
  const own = await isOwnPass(session);
  if (session && message.replace !== true) {
    return own ? { status: "other-account", freePass: true } : { status: "other-account" };
  }
  if (session && own) {
    try {
      await new UnfretApi(apiBase, session.token).moveFreeChecks(offered.address.slice("key:".length));
    } catch {
      // offline, or an older server: the switch goes ahead; the free pass keeps its checks
    }
  }
  await saveSession(offered);
  return { status: "signed-in" };
}
