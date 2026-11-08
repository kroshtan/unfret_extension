/**
 * The background (service worker in Chrome, event page in Firefox):
 *
 * - stores the session the connect page relays, after checking where it came from;
 * - marks supported marketplace product pages with a "?" badge (nothing is read from them);
 * - runs an analysis only when the user asks, for the active tab: injects the extractor, streams the result.
 *
 * Results live in memory per tab for the popup to show; nothing about pages is ever written to storage.
 */

import { ApiError, VeridexApi } from "../api/client.js";
import { SESSION_MESSAGE } from "../content/relay.js";
import type { Extraction } from "../extract/index.js";
import {
  ANALYSIS_PORT,
  type BackgroundUpdate,
  type PopupRequest,
  type TabState,
} from "../shared/messages.js";
import { isDevBase, loadSettings, parseSession, saveSession } from "../shared/settings.js";
import { isAnalysable, isMarketplaceProduct } from "../shared/sites.js";
import { badgeFor } from "./badge.js";

const DEV_RELAY_ID = "veridex-connect-dev";
const states = new Map<number, TabState>();
const watchers = new Map<number, Set<chrome.runtime.Port>>();

function setState(tabId: number, state: TabState): void {
  states.set(tabId, state);
  const update: BackgroundUpdate = { type: "state", tabId, state };
  for (const port of watchers.get(tabId) ?? []) {
    try {
      port.postMessage(update);
    } catch {
      // popup closed
    }
  }
  const badge = badgeFor(state);
  if (badge) {
    void chrome.action.setBadgeText({ tabId, text: badge.text });
    void chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
  }
}

// ── Session relay ────────────────────────────────────────────────────────────

function senderOrigin(sender: chrome.runtime.MessageSender): string {
  try {
    return new URL(sender.url ?? "").origin;
  } catch {
    return "";
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const m = message as { type?: unknown; session?: unknown } | null;
  if (m?.type !== SESSION_MESSAGE) return false;
  void (async () => {
    const { apiBase } = await loadSettings();
    const fromConnectPage =
      sender.id === chrome.runtime.id &&
      sender.frameId === 0 &&
      senderOrigin(sender) === new URL(apiBase).origin &&
      new URL(sender.url ?? "").pathname.startsWith("/connect");
    const session = fromConnectPage ? parseSession(m.session) : null;
    if (session) await saveSession(session);
    sendResponse({ ok: session !== null });
  })();
  return true; // async response
});

// ── Marketplace badge ────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "loading" || !tab.url) return;
  states.delete(tabId);
  if (isMarketplaceProduct(tab.url)) {
    void chrome.action.setBadgeText({ tabId, text: "?" });
    void chrome.action.setBadgeBackgroundColor({ tabId, color: "#5f6368" });
  } else {
    void chrome.action.setBadgeText({ tabId, text: "" });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  states.delete(tabId);
  watchers.delete(tabId);
});

// ── Analysis ─────────────────────────────────────────────────────────────────

async function extract(tabId: number): Promise<Extraction> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["extract.js"] });
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__veridexExtract?.(),
  });
  const result: Extraction | undefined = injection?.result;
  if (!result) throw new Error("Couldn't read this page.");
  return result;
}

async function analyse(tabId: number): Promise<void> {
  const current = states.get(tabId);
  if (current?.status === "extracting" || current?.status === "analysing") return;
  const { apiBase, session } = await loadSettings();
  if (!session) {
    setState(tabId, { status: "error", message: "Sign in first.", needsSignIn: true, needsCredits: false });
    return;
  }
  const tab = await chrome.tabs.get(tabId);
  if (!isAnalysable(tab.url, apiBase)) {
    setState(tabId, {
      status: "error",
      message: "This page can't be analysed.",
      needsSignIn: false,
      needsCredits: false,
    });
    return;
  }
  setState(tabId, { status: "extracting" });
  try {
    const { facts, text } = await extract(tabId);
    const api = new VeridexApi(apiBase, session.token);
    let state: Extract<TabState, { status: "analysing" }> = { status: "analysing", findings: [] };
    setState(tabId, state);
    const body = { url: facts.url, page_facts: facts, ...(text ? { page_content: text } : {}) };
    for await (const event of api.analyze(body)) {
      if (event.kind === "page_type") state = { ...state, pageType: event.pageType };
      else if (event.kind === "finding") state = { ...state, findings: [...state.findings, event.finding] };
      else {
        setState(tabId, { ...state, status: "done", result: event.result });
        return;
      }
      setState(tabId, state);
    }
  } catch (error) {
    const apiError = error instanceof ApiError ? error : null;
    const message = apiError?.serviceOff
      ? "Veridex checks aren't available on the server right now. Please try again later."
      : error instanceof Error
        ? error.message
        : "Analysis failed.";
    setState(tabId, {
      status: "error",
      message,
      needsSignIn: apiError?.needsSignIn ?? false,
      needsCredits: apiError?.needsCredits ?? false,
    });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== ANALYSIS_PORT || port.sender?.id !== chrome.runtime.id) return;
  const watched = new Set<number>();
  port.onMessage.addListener((message: PopupRequest) => {
    const set = watchers.get(message.tabId) ?? new Set();
    set.add(port);
    watchers.set(message.tabId, set);
    watched.add(message.tabId);
    port.postMessage({
      type: "state",
      tabId: message.tabId,
      state: states.get(message.tabId) ?? { status: "idle" },
    } satisfies BackgroundUpdate);
    if (message.type === "analyze") void analyse(message.tabId);
  });
  port.onDisconnect.addListener(() => {
    for (const tabId of watched) watchers.get(tabId)?.delete(port);
  });
});

// ── Dev API origin: relay content script registered at runtime ─────────────

async function syncDevRelay(): Promise<void> {
  const { apiBase } = await loadSettings();
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [DEV_RELAY_ID] });
  if (registered.length > 0) await chrome.scripting.unregisterContentScripts({ ids: [DEV_RELAY_ID] });
  if (!isDevBase(apiBase)) return;
  // Match patterns can't carry a port; the relay itself checks the exact origin.
  const { protocol, hostname } = new URL(apiBase);
  if (!(await chrome.permissions.contains({ origins: [`${protocol}//${hostname}/*`] }))) return;
  await chrome.scripting.registerContentScripts([
    {
      id: DEV_RELAY_ID,
      matches: [`${protocol}//${hostname}/connect*`],
      js: ["connect-relay.js"],
      runAt: "document_start",
    },
  ]);
}

chrome.runtime.onInstalled.addListener(() => void syncDevRelay());
chrome.runtime.onStartup.addListener(() => void syncDevRelay());
chrome.storage.onChanged.addListener((changes) => {
  if ("apiBase" in changes) void syncDevRelay();
});
chrome.permissions.onAdded.addListener(() => void syncDevRelay());
