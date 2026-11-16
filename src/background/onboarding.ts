/**
 * Getting a new user to their first check: the welcome page on install, and the API key the checkout page hands over.
 *
 * Both are plain functions over what they need, so tests can drive them without a browser.
 */

import { type KeyHandoffStatus } from "../content/relay.js";
import { DEFAULT_API_BASE, keySession, loadSettings, saveSession } from "../shared/settings.js";

/** The website's first-run page: a code, buying checks, or a key you have (Unfret Dev: on the dev deployment). */
export const WELCOME_URL = `${DEFAULT_API_BASE}/welcome`;

/**
 * Open the welcome page after a new install, never after an update or a browser update.
 *
 * @returns Whether it was opened.
 */
export function welcomeOnInstall(
  details: { reason: string },
  open: (url: string) => unknown = (url) => chrome.tabs.create({ url }),
): boolean {
  if (details.reason !== "install") return false;
  void open(WELCOME_URL);
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

/**
 * Sign in with the key the checkout page offers. Signed in with another key or a wallet, nothing changes until the
 * user agreed on the page (`replace`): accounts are never swapped silently. The key isn't checked with the server
 * here: the page has just made it there, and the popup asks for its balance (and forgets a key the server refuses).
 */
export async function receiveKey(
  message: { key?: unknown; replace?: unknown },
  sender: chrome.runtime.MessageSender,
  extensionId: string,
): Promise<KeyHandoffStatus> {
  const { apiBase, session } = await loadSettings();
  if (!fromUnfretPage(sender, extensionId, apiBase, "/checkout")) return "invalid";
  const offered = typeof message.key === "string" ? keySession(message.key) : null;
  if (!offered || offered.token !== message.key) return "invalid";
  if (session?.token === offered.token) return "already";
  if (session && message.replace !== true) return "other-account";
  await saveSession(offered);
  return "signed-in";
}
