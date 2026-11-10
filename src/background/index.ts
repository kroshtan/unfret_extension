/**
 * The background (service worker in Chrome, event page in Firefox):
 *
 * - stores the session the connect page relays, after checking where it came from;
 * - registers the marketplace icon hint (declarativeContent: the browser matches URLs, the extension reads nothing);
 * - runs an analysis only when the user asks, for the active tab (activeTab, granted by that click): injects the
 *   extractor, streams the result. It holds no standing access to any shop.
 *
 * Results live in memory per tab for the popup to show, mirrored to `chrome.storage.session` (memory only, cleared
 * when the browser closes) so they survive the service worker sleeping. Nothing about pages is written to disk.
 */

import { ApiError, type ReportReason, UnfretApi } from "../api/client.js";
import { SESSION_MESSAGE } from "../content/relay.js";
import {
  ANALYSIS_PORT,
  type BackgroundUpdate,
  type PopupRequest,
  type TabState,
} from "../shared/messages.js";
import { t } from "../shared/i18n.js";
import { consentGiven, isDevBase, loadSettings, parseSession, saveSession } from "../shared/settings.js";
import { isAnalysable } from "../shared/sites.js";
import { badgeFor } from "./badge.js";
import { registerMarketplaceHint } from "./icon-hint.js";
import { extractFromTab } from "./inject.js";

const DEV_RELAY_ID = "unfret-connect-dev";
const states = new Map<number, TabState>();
const watchers = new Map<number, Set<chrome.runtime.Port>>();

const stateKey = (tabId: number): string => `tab:${tabId}`;

function persist(tabId: number, state: TabState | undefined): void {
  try {
    if (state === undefined || state.status === "idle") void chrome.storage.session.remove(stateKey(tabId));
    else void chrome.storage.session.set({ [stateKey(tabId)]: state });
  } catch {
    // no session storage: the result simply doesn't outlive this worker
  }
}

/** A tab's state: from memory, or from session storage after the service worker slept. */
async function stateOf(tabId: number): Promise<TabState> {
  const known = states.get(tabId);
  if (known) return known;
  try {
    const stored = (await chrome.storage.session.get(stateKey(tabId)))[stateKey(tabId)] as
      TabState | undefined;
    // An analysis that was running when the worker stopped can't resume: show nothing rather than a stuck spinner.
    if (stored && (stored.status === "done" || stored.status === "error")) {
      states.set(tabId, stored);
      return stored;
    }
  } catch {
    // no session storage
  }
  return { status: "idle" };
}

function setState(tabId: number, state: TabState): void {
  states.set(tabId, state);
  persist(tabId, state);
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

// ── Navigation: a result belongs to the page it was made for ────────────────
// (No tab URL needed, and none is available without host access: any navigation clears the tab's result.)

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  states.delete(tabId);
  persist(tabId, undefined);
  void chrome.action.setBadgeText({ tabId, text: "" });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  states.delete(tabId);
  persist(tabId, undefined);
  watchers.delete(tabId);
});

// ── Analysis ─────────────────────────────────────────────────────────────────

/** Tabs with an analysis starting or running; checked and set synchronously, before any await. */
const inFlight = new Set<number>();

async function analyse(tabId: number): Promise<void> {
  // Two "analyze" messages in quick succession (a double click, two popups) used to both pass a status check
  // that only changed after `await loadSettings()`, and both were charged.
  if (inFlight.has(tabId)) return;
  inFlight.add(tabId);
  try {
    await runAnalysis(tabId);
  } finally {
    inFlight.delete(tabId);
  }
}

/** Uploaded text is capped: the server reads the first 20,000 characters, and sending more only costs bandwidth. */
export const MAX_UPLOAD_TEXT_CHARS = 24_000;

async function runAnalysis(tabId: number): Promise<void> {
  const current = states.get(tabId);
  if (current?.status === "extracting" || current?.status === "analysing") return;
  const { apiBase, session } = await loadSettings();
  if (!(await consentGiven())) {
    // Nothing leaves the browser before the consent screen was accepted, whoever asks.
    setState(tabId, { status: "error", message: t("hint_consent"), needsSignIn: false, needsCredits: false });
    return;
  }
  if (!session) {
    setState(tabId, {
      status: "error",
      message: t("error_sign_in_first"),
      needsSignIn: true,
      needsCredits: false,
    });
    return;
  }
  const tab = await chrome.tabs.get(tabId);
  if (!isAnalysable(tab.url, apiBase)) {
    setState(tabId, {
      status: "error",
      // No URL means no access yet: activeTab is granted by clicking the toolbar button on that page.
      message: tab.url ? t("error_cant_analyse") : t("error_click_first"),
      needsSignIn: false,
      needsCredits: false,
    });
    return;
  }
  setState(tabId, { status: "extracting" });
  try {
    const { facts, text } = await extractFromTab(tabId);
    const api = new UnfretApi(apiBase, session.token);
    let state: Extract<TabState, { status: "analysing" }> = { status: "analysing", findings: [], steps: [] };
    setState(tabId, state);
    const upload = text.slice(0, MAX_UPLOAD_TEXT_CHARS);
    const body = { url: facts.url, page_facts: facts, ...(upload ? { page_content: upload } : {}) };
    for await (const event of api.analyze(body)) {
      if (event.kind === "page_type") state = { ...state, pageType: event.pageType };
      else if (event.kind === "step") state = { ...state, steps: [...(state.steps ?? []), event.skill] };
      else if (event.kind === "finding") state = { ...state, findings: [...state.findings, event.finding] };
      else {
        setState(tabId, { ...state, status: "done", result: event.result, body });
        return;
      }
      setState(tabId, state);
    }
  } catch (error) {
    const apiError = error instanceof ApiError ? error : null;
    // The server's English detail isn't shown: every case gets plain text in the user's language.
    const message = apiError?.serviceOff
      ? t("error_service_off")
      : apiError?.needsSignIn
        ? t("session_expired")
        : apiError?.needsCredits
          ? t("error_no_checks")
          : apiError
            ? t("error_failed")
            : t("offline");
    setState(tabId, {
      status: "error",
      message,
      needsSignIn: apiError?.needsSignIn ?? false,
      needsCredits: apiError?.needsCredits ?? false,
      refunded: apiError !== null && !apiError.needsSignIn && !apiError.needsCredits,
    });
  }
}

// ── Reports: "this is wrong" ────────────────────────────────────────────────

/** The server's refusals, in plain words in the user's language. */
function reportError(error: unknown): string {
  if (!(error instanceof ApiError)) return t("offline");
  if (error.code === "REPORT_LIMIT") return t("report_limit");
  if (error.code === "ALREADY_REPORTED_BY_YOU") return t("report_twice");
  if (error.code === "QUEUE_FULL") return t("report_queue_full");
  if (error.code === "BAD_REPORT_TOKEN") return t("report_too_old");
  return t("report_failed");
}

/** Send the finished check's request back as a report (the user consented in the popup, for this check only). */
async function report(tabId: number, reason: ReportReason): Promise<void> {
  const state = await stateOf(tabId);
  if (state.status !== "done" || !state.body || !state.result.report_token) return;
  if (state.report?.status === "sending" || state.report?.status === "sent") return;
  const { apiBase, session } = await loadSettings();
  if (!session) return;
  setState(tabId, { ...state, report: { status: "sending" } });
  try {
    const sent = await new UnfretApi(apiBase, session.token).report(state.body, state.result, reason);
    setState(tabId, { ...state, report: { status: "sent", outcome: sent.status } });
  } catch (error) {
    setState(tabId, { ...state, report: { status: "error", message: reportError(error) } });
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
    void stateOf(message.tabId).then((state) => {
      port.postMessage({ type: "state", tabId: message.tabId, state } satisfies BackgroundUpdate);
      if (message.type === "analyze") void analyse(message.tabId);
      if (message.type === "report") void report(message.tabId, message.reason);
    });
  });
  port.onDisconnect.addListener(() => {
    for (const tabId of watched) watchers.get(tabId)?.delete(port);
  });
});

// ── Dev API origin: relay content script registered at runtime ─────────────

async function syncDevRelay(): Promise<void> {
  const { apiBase } = await loadSettings();
  // Registrations persist across updates, and releases before the rename used another ID: match the suffix.
  const ids = (await chrome.scripting.getRegisteredContentScripts())
    .map((script) => script.id)
    .filter((id) => id.endsWith("-connect-dev"));
  if (ids.length > 0) await chrome.scripting.unregisterContentScripts({ ids });
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

chrome.runtime.onInstalled.addListener(() => {
  void syncDevRelay();
  void registerMarketplaceHint();
});
chrome.runtime.onStartup.addListener(() => {
  void syncDevRelay();
  void registerMarketplaceHint();
});
chrome.storage.onChanged.addListener((changes) => {
  if ("apiBase" in changes) void syncDevRelay();
});
chrome.permissions.onAdded.addListener(() => void syncDevRelay());
