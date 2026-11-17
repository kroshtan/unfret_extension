/**
 * The background (service worker in Chrome, event page in Firefox):
 *
 * - stores the session the connect page relays, and the new API key the checkout page relays, after checking where
 *   they came from (onboarding.ts); opens the website's welcome page once, after installing;
 * - registers the marketplace icon hint (declarativeContent: the browser matches URLs, the extension reads nothing);
 * - runs an analysis only when the user asks, for the active tab (activeTab, granted by that click): injects the
 *   extractor, streams the result. It holds no standing access to any shop.
 *
 * Results live in memory per tab for the popup to show, mirrored to `chrome.storage.session` (memory only, cleared
 * when the browser closes) so they survive the service worker sleeping. Nothing about pages is written to disk.
 */

import { type AnalyzeBody, ApiError, type ReportReason, UnfretApi } from "../api/client.js";
import { KEY_MESSAGE, SESSION_MESSAGE } from "../content/relay.js";
import {
  ANALYSIS_PORT,
  type BackgroundUpdate,
  type PopupRequest,
  type TabState,
} from "../shared/messages.js";
import { consentGiven, isDevBase, loadSettings, parseSession, saveSession } from "../shared/settings.js";
import { createShare, previewShare, shareRequest } from "../shared/share.js";
import { isAnalysable } from "../shared/sites.js";
import { CONSENT_HINT, FREE_PAUSED, OFFLINE, SESSION_EXPIRED } from "../shared/text.js";
import { badgeFor } from "./badge.js";
import { registerMarketplaceHint } from "./icon-hint.js";
import { extractFromTab } from "./inject.js";
import { fromUnfretPage, receiveKey, welcomeOnInstall } from "./onboarding.js";

// Content scripts registered for a local dev API, by id suffix (releases before the rename used another prefix).
const DEV_RELAYS = [
  { id: "unfret-connect-dev", path: "/connect*", js: "connect-relay.js" },
  { id: "unfret-key-dev", path: "/checkout*", js: "key-relay.js" },
];
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

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const m = message as { type?: unknown; session?: unknown; key?: unknown; replace?: unknown } | null;
  if (m?.type === KEY_MESSAGE) {
    void receiveKey(m, sender, chrome.runtime.id).then(
      (reply) => {
        sendResponse(reply);
      },
      () => {
        sendResponse({ status: "invalid" });
      },
    );
    return true; // async response
  }
  if (m?.type !== SESSION_MESSAGE) return false;
  void (async () => {
    const { apiBase } = await loadSettings();
    const fromConnectPage = fromUnfretPage(sender, chrome.runtime.id, apiBase, "/connect");
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

async function analyse(tabId: number, tier?: "quick"): Promise<void> {
  // Two "analyze" messages in quick succession (a double click, two popups) used to both pass a status check
  // that only changed after `await loadSettings()`, and both were charged.
  if (inFlight.has(tabId)) return;
  inFlight.add(tabId);
  try {
    await runAnalysis(tabId, tier);
  } finally {
    inFlight.delete(tabId);
  }
}

/** Why a deep check couldn't be paid for, when a quick check is offered instead; null for any other failure. */
function quickBecause(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "FREE_CHECKS_PAUSED") return `${FREE_PAUSED} Here's a quick check meanwhile.`;
  if (error.needsCredits) return "You have no checks left, so here's a quick check instead.";
  return null;
}

/** Uploaded text is capped: the server reads the first 20,000 characters, and sending more only costs bandwidth. */
export const MAX_UPLOAD_TEXT_CHARS = 24_000;

async function runAnalysis(tabId: number, tier?: "quick"): Promise<void> {
  const current = states.get(tabId);
  if (current?.status === "extracting" || current?.status === "analysing") return;
  const { apiBase, session } = await loadSettings();
  if (!(await consentGiven())) {
    // Nothing leaves the browser before the consent screen was accepted, whoever asks.
    setState(tabId, { status: "error", message: CONSENT_HINT, needsSignIn: false, needsCredits: false });
    return;
  }
  if (!session) {
    setState(tabId, {
      status: "error",
      message: "Sign in first.",
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
      message: tab.url
        ? "This page can't be checked."
        : "Click the Unfret button on the page you want to check, then try again.",
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
    const page: AnalyzeBody = {
      url: facts.url,
      page_facts: facts,
      ...(upload ? { page_content: upload } : {}),
    };
    // A deep check that needs checks the account doesn't have (none left, or only free ones while they're paused for
    // the day) becomes a quick check, free, saying why.
    let note: string | undefined;
    let body: AnalyzeBody = tier === "quick" ? { ...page, tier } : page;
    for (;;) {
      try {
        for await (const event of api.analyze(body)) {
          if (event.kind === "page_type") state = { ...state, pageType: event.pageType };
          else if (event.kind === "step") state = { ...state, steps: [...(state.steps ?? []), event.skill] };
          else if (event.kind === "finding")
            state = { ...state, findings: [...state.findings, event.finding] };
          else {
            setState(tabId, {
              ...state,
              status: "done",
              result: event.result,
              body,
              ...(note ? { note } : {}),
            });
            return;
          }
          setState(tabId, state);
        }
        return;
      } catch (error) {
        const because = body.tier === undefined ? quickBecause(error) : null;
        if (because === null) throw error;
        note = because;
        body = { ...page, tier: "quick" };
      }
    }
  } catch (error) {
    const apiError = error instanceof ApiError ? error : null;
    // The server's technical detail isn't shown: every case gets plain words.
    const message = apiError?.serviceOff
      ? "Unfret checks aren't available right now. Please try again later."
      : apiError?.needsSignIn
        ? SESSION_EXPIRED
        : apiError?.needsCredits
          ? "You have no checks left."
          : apiError
            ? "The check failed. No check was used."
            : OFFLINE;
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

/** The server's refusals, in plain words. */
function reportError(error: unknown): string {
  if (!(error instanceof ApiError)) return OFFLINE;
  if (error.code === "REPORT_LIMIT") return "You've used this month's reports. Thank you!";
  if (error.code === "ALREADY_REPORTED_BY_YOU") return "You've already reported this page.";
  if (error.code === "QUEUE_FULL")
    return "Our review queue is full right now; please try again in a few days.";
  if (error.code === "BAD_REPORT_TOKEN")
    return "This check can't be reported any more; check the page again first.";
  return "The report didn't go through. Please try again later.";
}

type DoneState = Extract<TabState, { status: "done" }>;

/**
 * Change a finished check's state, as it is now: a report and a share can run at the same time, and each must keep
 * what the other did. Nothing happens when the tab has moved on (another check, or a navigation) in between.
 */
function updateDone(tabId: number, result: DoneState["result"], change: Partial<DoneState>): void {
  const now = states.get(tabId);
  if (now?.status !== "done" || now.result !== result) return;
  setState(tabId, { ...now, ...change });
}

/** Send the finished check's request back as a report (the user consented in the popup, for this check only). */
async function report(tabId: number, reason: ReportReason): Promise<void> {
  const state = await stateOf(tabId);
  if (state.status !== "done" || !state.body || !state.result.report_token) return;
  if (state.report?.status === "sending" || state.report?.status === "sent") return;
  const { apiBase, session } = await loadSettings();
  if (!session) return;
  updateDone(tabId, state.result, { report: { status: "sending" } });
  try {
    const sent = await new UnfretApi(apiBase, session.token).report(state.body, state.result, reason);
    updateDone(tabId, state.result, { report: { status: "sent", outcome: sent.status } });
  } catch (error) {
    updateDone(tabId, state.result, { report: { status: "error", message: reportError(error) } });
  }
}

// ── "Share this result" ──────────────────────────────────────────────────────
// Anonymous: the client is made without the session, and it never sends Authorization for a share anyway. Each step
// reads the state, checks it and marks it in one synchronous run after its last await, so a double click can't send
// twice.

/** The tab's finished check as it is right now, once `stateOf` has loaded it from session storage if needed. */
function doneNow(tabId: number): DoneState | undefined {
  const state = states.get(tabId);
  return state?.status === "done" ? state : undefined;
}

async function sharePreview(tabId: number): Promise<void> {
  const { apiBase } = await loadSettings();
  await stateOf(tabId);
  const state = doneNow(tabId);
  const request = state && shareRequest(state.body, state.result);
  if (!state || !request) return;
  if (state.share && !(state.share.status === "error" && !state.share.preview)) return;
  updateDone(tabId, state.result, { share: { status: "loading" } });
  updateDone(tabId, state.result, { share: await previewShare(new UnfretApi(apiBase), request) });
}

async function share(tabId: number): Promise<void> {
  const { apiBase } = await loadSettings();
  await stateOf(tabId);
  const state = doneNow(tabId);
  const request = state && shareRequest(state.body, state.result);
  const now = state?.share;
  // Only what the user saw in the preview, and only once.
  const preview = now?.status === "preview" || now?.status === "error" ? now.preview : undefined;
  if (!state || !request || !preview) return;
  updateDone(tabId, state.result, { share: { status: "sharing", preview } });
  updateDone(tabId, state.result, {
    share: await createShare(new UnfretApi(apiBase), apiBase, request, preview),
  });
}

async function shareCancel(tabId: number): Promise<void> {
  await stateOf(tabId);
  const state = doneNow(tabId);
  if (!state?.share || state.share.status === "sharing" || state.share.status === "shared") return;
  const rest: DoneState = { ...state };
  delete rest.share;
  setState(tabId, rest);
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
      if (message.type === "analyze") void analyse(message.tabId, message.tier);
      if (message.type === "report") void report(message.tabId, message.reason);
      if (message.type === "share-preview") void sharePreview(message.tabId);
      if (message.type === "share") void share(message.tabId);
      if (message.type === "share-cancel") void shareCancel(message.tabId);
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
    .filter((id) => id.endsWith("-connect-dev") || id.endsWith("-key-dev"));
  if (ids.length > 0) await chrome.scripting.unregisterContentScripts({ ids });
  if (!isDevBase(apiBase)) return;
  // Match patterns can't carry a port; the relay itself checks the exact origin.
  const { protocol, hostname } = new URL(apiBase);
  if (!(await chrome.permissions.contains({ origins: [`${protocol}//${hostname}/*`] }))) return;
  await chrome.scripting.registerContentScripts(
    DEV_RELAYS.map(({ id, path, js }) => ({
      id,
      matches: [`${protocol}//${hostname}${path}`],
      js: [js],
      runAt: "document_start" as const,
    })),
  );
}

chrome.runtime.onInstalled.addListener((details) => {
  void welcomeOnInstall(details);
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
