/**
 * The background (service worker in Chrome, event page in Firefox):
 *
 * - registers the marketplace icon hint (declarativeContent: the browser matches URLs, the extension reads nothing);
 * - runs an analysis only when the user asks, for the active tab (activeTab, granted by that click): injects the
 *   extractor, solves a free deep check's proof of work (off the popup), streams the result. It holds no standing
 *   access to any shop, and no account: no check names the user;
 * - deletes what versions before free checks kept about an account (a pass, a wallet sign-in).
 *
 * Results live in memory per tab for the popup to show, mirrored to `chrome.storage.session` (memory only, cleared
 * when the browser closes) so they survive the service worker sleeping. Nothing about pages is written to disk.
 */

import { type AnalyzeBody, ApiError, type Pause, UnfretApi } from "../api/client.js";
import {
  ANALYSIS_PORT,
  type BackgroundUpdate,
  type PopupRequest,
  type TabState,
} from "../shared/messages.js";
import { PowAborted, solve } from "../shared/pow.js";
import { consentGiven, forgetOldAccount, loadSettings } from "../shared/settings.js";
import { createShare, previewShare, shareRequest } from "../shared/share.js";
import { isAnalysable } from "../shared/sites.js";
import { CONSENT_HINT, DEEP_UNAVAILABLE, FREE_PAUSED_QUICK } from "../shared/text.js";
import { checkedUrl } from "../shared/urls.js";
import { badgeFor } from "./badge.js";
import { checkFailed } from "./failure.js";
import { registerMarketplaceHint } from "./icon-hint.js";
import { extractFromTab } from "./inject.js";

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

/** Uploaded text is capped: the server reads the first 20,000 characters, and sending more only costs bandwidth. */
export const MAX_UPLOAD_TEXT_CHARS = 24_000;

/** A free deep check that can't run, and a quick check runs instead: what to say, and the pause if that is why. */
interface Fallback {
  note: string;
  pause?: Pause;
}

/** The pause as the server describes it, or an empty one (the extension's own words cover it). */
function pauseOf(value: unknown): Pause {
  return typeof value === "object" && value !== null ? value : {};
}

/** Why a deep check can't run now, when a quick check is offered instead; null for any other failure. */
function quickBecause(error: unknown): Fallback | null {
  if (!(error instanceof ApiError)) return null;
  if (error.freePaused) return { note: FREE_PAUSED_QUICK, pause: pauseOf(error.metadata) };
  if (error.serviceOff) return { note: DEEP_UNAVAILABLE };
  return null;
}

/** Calls an extension API now and then while the proof of work runs, so Chrome doesn't stop the worker as idle. */
function keepAlive(): void {
  try {
    void chrome.runtime.getPlatformInfo();
  } catch {
    // not available: the work is a few seconds anyway
  }
}

/**
 * A free deep check's proof of work: a new challenge, solved here (the popup stays responsive). Paused: the challenge
 * says so, and nothing is solved.
 */
type Proof = NonNullable<AnalyzeBody["proof_of_work"]>;

async function proofOfWork(api: UnfretApi): Promise<Proof | Fallback> {
  const challenge = await api.challenge();
  if (challenge.paused) return { note: FREE_PAUSED_QUICK, pause: pauseOf(challenge.pause) };
  const solution = await solve(challenge.challenge, challenge.bits, { onSlice: keepAlive });
  return { challenge: challenge.challenge, solution };
}

function isFallback(value: Proof | Fallback): value is Fallback {
  return "note" in value;
}

async function runAnalysis(tabId: number, tier?: "quick"): Promise<void> {
  const current = states.get(tabId);
  if (current?.status === "extracting" || current?.status === "preparing" || current?.status === "analysing")
    return;
  const { apiBase } = await loadSettings();
  if (!(await consentGiven())) {
    // Nothing leaves the browser before the consent screen was accepted, whoever asks.
    setState(tabId, { status: "error", message: CONSENT_HINT });
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
    });
    return;
  }
  setState(tabId, { status: "extracting" });
  let quick = tier === "quick";
  try {
    const { facts, text } = await extractFromTab(tabId);
    const api = new UnfretApi(apiBase);
    const upload = text.slice(0, MAX_UPLOAD_TEXT_CHARS);
    // The address as extract-entry cleaned it; once more here, so nothing about the visitor in it reaches the server.
    const url = checkedUrl(facts.url);
    const page: AnalyzeBody = {
      url,
      page_facts: { ...facts, url },
      ...(upload ? { page_content: upload } : {}),
    };
    // A deep check that can't run now (free deep checks paused, or not available) becomes a quick check, saying why.
    // A spent or expired challenge gets one new one.
    let fallback: Fallback | undefined;
    let retried = false;
    for (;;) {
      // What the result keeps (and a report sends back): the page as analysed, without the proof of work.
      const body: AnalyzeBody = quick ? { ...page, tier: "quick" } : page;
      try {
        let sent = body;
        if (!quick) {
          setState(tabId, { status: "preparing" });
          const proof = await proofOfWork(api);
          if (isFallback(proof)) {
            fallback = proof;
            quick = true;
            continue;
          }
          sent = { ...body, proof_of_work: proof };
        }
        let state: Extract<TabState, { status: "analysing" }> = {
          status: "analysing",
          findings: [],
          steps: [],
        };
        setState(tabId, state);
        for await (const event of api.analyze(sent)) {
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
              ...(fallback ? { note: fallback.note } : {}),
              ...(fallback?.pause ? { pause: fallback.pause } : {}),
            });
            return;
          }
          setState(tabId, state);
        }
        return;
      } catch (error) {
        if (!quick && error instanceof ApiError && error.needsProof && !retried) {
          retried = true;
          continue;
        }
        const because = quick ? null : quickBecause(error);
        if (because === null) throw error;
        fallback = because;
        quick = true;
      }
    }
  } catch (error) {
    if (error instanceof PowAborted) return;
    setState(tabId, checkFailed(error, quick));
  }
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

// ── "Share this result" ──────────────────────────────────────────────────────
// Anonymous: the client never sends Authorization. Each step
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
      if (message.type === "share-preview") void sharePreview(message.tabId);
      if (message.type === "share") void share(message.tabId);
      if (message.type === "share-cancel") void shareCancel(message.tabId);
    });
  });
  port.onDisconnect.addListener(() => {
    for (const tabId of watched) watchers.get(tabId)?.delete(port);
  });
});

// ── Install, update and start-up ───────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  // Versions before free checks kept a pass or a wallet sign-in: it is deleted, never sent again.
  void forgetOldAccount();
  void registerMarketplaceHint();
});
chrome.runtime.onStartup.addListener(() => {
  void forgetOldAccount();
  void registerMarketplaceHint();
});
