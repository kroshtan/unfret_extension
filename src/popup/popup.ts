/** The popup: account and credits, the "Analyse this page" button, live progress and the result. */

import { ApiError, type Pairing, type ReportReason, VeridexApi } from "../api/client.js";
import {
  ANALYSIS_PORT,
  type BackgroundUpdate,
  type PopupRequest,
  type TabState,
} from "../shared/messages.js";
import { waitForPairing } from "../shared/pairing.js";
import { encodeQr, qrSvg } from "../shared/qr.js";
import { shareRequest } from "../shared/share.js";
import {
  accountLabel,
  clearSession,
  expireSession,
  isKeySession,
  loadSettings,
  consentGiven,
  giveConsent,
  PRIVACY_URL,
  saveSession,
  type Session,
} from "../shared/settings.js";
import { inviteAdded, redeemInvite } from "../shared/invites.js";
import { KEY_FAILURE, signInWithKey } from "../shared/key-sign-in.js";
import { isAnalysable } from "../shared/sites.js";
import { CONSENT_HINT, OFFLINE, SESSION_EXPIRED } from "../shared/text.js";
import {
  buildChecklist,
  checklistDone,
  checksText,
  renderResult,
  renderSharePreview,
  updateChecklist,
} from "./view.js";

function el(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} missing`);
  return found;
}

function button(id: string): HTMLButtonElement {
  const found = el(id);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`#${id} is not a button`);
  return found;
}

function show(id: string, visible: boolean): void {
  el(id).hidden = !visible;
}

let apiBase = "";
let session: Session | undefined;
let expired = false;
let checks: number | undefined;
/** From the server: false once the account has had credit, when "Have an invite?" can no longer work. */
let inviteEligible: boolean | undefined;
let tabId: number | undefined;
let analysable = false;
let busy = false;
let port: chrome.runtime.Port | undefined;
let purchasesOn = false;
let consented = false;

/** The consent screen: shown until accepted, and from "About & privacy" any time after. */
function showConsent(visible: boolean): void {
  show("consent", visible);
  show("consent-agree", !consented);
  show("consent-agreed", consented);
  show("consent-close", consented);
}

function openTab(path: string): void {
  void chrome.tabs.create({ url: `${apiBase}${path}` });
  window.close();
}

async function sessionRejected(): Promise<void> {
  await expireSession();
  session = undefined;
  expired = true;
  checks = undefined;
  inviteEligible = undefined;
  renderAccount();
}

async function refreshCredits(): Promise<void> {
  if (!session) return;
  try {
    const credits = await new VeridexApi(apiBase, session.token).credits();
    checks = credits.checks_remaining;
    inviteEligible = credits.invite_eligible;
    renderAccount();
  } catch (error) {
    if (error instanceof ApiError && error.needsSignIn) await sessionRejected();
  }
}

async function refreshPricing(): Promise<void> {
  try {
    purchasesOn = (await new VeridexApi(apiBase).pricing()).hot_wallet !== null;
  } catch {
    purchasesOn = false;
  }
  renderAccount();
}

// ── Sign in with phone ─────────────────────────────────────────────────────────
// The pending pairing is kept in session storage (memory, cleared when the browser closes) so closing and reopening
// the popup while the phone signs in resumes the same pairing instead of starting over.

const PAIRING_KEY = "pendingPairing";
let pairingAbort: AbortController | undefined;

async function storedPairing(): Promise<Pairing | undefined> {
  try {
    const stored = await chrome.storage.session.get<{ pendingPairing?: Pairing }>(PAIRING_KEY);
    const pairing = stored.pendingPairing;
    return pairing && Date.parse(pairing.expires_at) > Date.now() ? pairing : undefined;
  } catch {
    return undefined;
  }
}

async function forgetPairing(): Promise<void> {
  try {
    await chrome.storage.session.remove(PAIRING_KEY);
  } catch {
    // session storage unavailable: nothing was kept
  }
}

function phoneStatus(text: string, retry = false): void {
  el("phone-status").textContent = text;
  show("phone-retry", retry);
}

function stopPairing(): void {
  pairingAbort?.abort();
  pairingAbort = undefined;
}

async function showPairing(pairing: Pairing): Promise<void> {
  stopPairing();
  show("phone", true);
  el("phone-qr").replaceChildren(qrSvg(encodeQr(pairing.connect_url), "QR code to sign in on your phone"));
  el("phone-code").textContent = pairing.confirm_code;
  phoneStatus("Waiting for your phone…");
  const abort = new AbortController();
  pairingAbort = abort;
  const outcome = await waitForPairing(new VeridexApi(apiBase), pairing.pair_id, {
    expiresAt: pairing.expires_at,
    signal: abort.signal,
  });
  if (pairingAbort !== abort) return; // superseded by a retry or cancel
  pairingAbort = undefined;
  await forgetPairing();
  if (outcome.kind === "signed-in") {
    await saveSession(outcome.session);
    session = outcome.session;
    expired = false;
    show("phone", false);
    renderAccount();
    void refreshCredits();
  } else if (outcome.kind === "expired") {
    el("phone-qr").replaceChildren();
    phoneStatus("This sign-in request expired.", true);
  } else if (outcome.kind === "failed") {
    el("phone-qr").replaceChildren();
    phoneStatus(outcome.message, true);
  }
}

async function startPhoneSignIn(): Promise<void> {
  stopPairing();
  show("phone", true);
  el("phone-qr").replaceChildren();
  el("phone-code").textContent = "";
  phoneStatus("Preparing…");
  try {
    const pairing = await new VeridexApi(apiBase).startPairing();
    try {
      await chrome.storage.session.set({ [PAIRING_KEY]: pairing });
    } catch {
      // without session storage, closing the popup simply ends this attempt
    }
    await showPairing(pairing);
  } catch (error) {
    const message =
      error instanceof ApiError && error.serviceOff
        ? "Sign-in isn't available yet."
        : error instanceof ApiError && error.status === 429
          ? "Too many attempts; wait a few minutes."
          : error instanceof ApiError
            ? error.message
            : OFFLINE;
    phoneStatus(message, true);
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

function untilText(expiresAt: string): string {
  const date = new Date(expiresAt);
  return `Signed in until ${date.toLocaleDateString("en", { day: "numeric", month: "long" })}`;
}

function renderAccount(): void {
  const usingKey = isKeySession(session);
  el("account-status").textContent = session
    ? `${usingKey ? "Using API key" : "Signed in as"} ${accountLabel(session)}`
    : expired
      ? SESSION_EXPIRED
      : "Not signed in. Sign in with your Solana wallet to use your checks.";
  el("account-until").textContent = session && !usingKey ? untilText(session.expiresAt) : "";
  show("account-until", Boolean(session) && !usingKey);
  show("sign-in", !session);
  show("sign-in-phone", !session);
  show("sign-in-key", !session);
  if (session) show("key", false);
  show("sign-out", Boolean(session));
  show("invite", Boolean(session) && inviteEligible !== false);
  show("buy", Boolean(session) && purchasesOn);
  el("credits").textContent = checks === undefined ? "" : checksText(checks);
  show("credits", Boolean(session) && checks !== undefined);

  const noChecks = Boolean(session) && checks === 0;
  const analyse = button("analyse");
  analyse.textContent = busy ? "Checking…" : noChecks ? "Buy checks to start" : "Check this page";
  analyse.disabled = busy || !consented || !session || !analysable || (noChecks && !purchasesOn);
  el("hint").textContent = !consented
    ? CONSENT_HINT
    : !analysable
      ? "This page can't be checked."
      : !session
        ? "Sign in to check this page."
        : noChecks
          ? "You have no checks left."
          : "One check per page. Nothing is sent until you click.";
}

/** The origin of the API in use (thumbnails are only loaded from there). */
function apiOrigin(): string | undefined {
  try {
    return new URL(apiBase).origin;
  } catch {
    return undefined;
  }
}

function render(state: TabState): void {
  busy = state.status === "extracting" || state.status === "analysing";
  show("progress", busy);
  show("result", state.status === "done");
  show("error", state.status === "error");
  renderAccount();
  if (busy) {
    el("progress-status").textContent =
      state.status === "extracting" ? "Reading the page…" : "Checking… this usually takes 10–30 seconds.";
    const steps = el("steps");
    buildChecklist(steps);
    updateChecklist(steps, checklistDone(state.status === "analysing" ? (state.steps ?? []) : [], false));
  }
  if (state.status === "done") {
    renderResult(el("result-body"), state.result, apiOrigin());
    renderReport(state);
    renderShare(state);
    if (state.result.balance_lamports !== undefined) void refreshCredits();
  } else if (state.status === "error") {
    el("error-message").textContent = state.message;
    show("error-refunded", state.refunded === true);
    show("error-sign-in", state.needsSignIn);
    show("error-buy", state.needsCredits && purchasesOn);
    if (state.needsSignIn) void sessionRejected();
  }
}

// ── "This is wrong" ──────────────────────────────────────────────────────────

const REPORT_OUTCOME = {
  queued: "Thanks! We'll review this page. If we got it badly wrong, you get free checks.",
  already_reported: "Thanks! Someone reported this page first; your report counts as confirmation.",
  already_known: "Thanks! We reviewed this page recently.",
} as const;

function renderReport(state: Extract<TabState, { status: "done" }>): void {
  const report = state.report;
  const reportable = Boolean(state.body && state.result.report_token && session);
  show("report-open-row", reportable && report === undefined && el("report").hidden === true);
  if (report !== undefined) show("report", false);
  const status = el("report-status");
  status.hidden = report === undefined;
  if (report?.status === "sending") status.textContent = "Sending…";
  else if (report?.status === "sent") status.textContent = REPORT_OUTCOME[report.outcome];
  else if (report?.status === "error") status.textContent = report.message;
}

function reportReason(): ReportReason | undefined {
  const picked = document.querySelector<HTMLInputElement>('#report input[name="reason"]:checked');
  return (picked?.value as ReportReason | undefined) ?? undefined;
}

// ── "Share this result" ─────────────────────────────────────────────────────
// The background asks for the preview and makes the share (without the sign-in); the popup shows each step. The link
// and the delete code stay with the tab's result until the tab moves on, so closing the popup doesn't lose them.

/** The preview on screen, so a state update that doesn't change it doesn't rebuild it (an open "Show details"). */
let shownPreview = "";

function shareStatus(text: string): void {
  el("share-status").textContent = text;
  show("share-status", text !== "");
}

function renderShare(state: Extract<TabState, { status: "done" }>): void {
  const share = state.share;
  show("share-area", shareRequest(state.body, state.result) !== null);
  const preview =
    share?.status === "preview" || share?.status === "sharing" || share?.status === "error"
      ? share.preview
      : undefined;
  show(
    "share-open-row",
    share === undefined || (share.status === "error" && !share.preview) || share.status === "loading",
  );
  button("share-open").disabled = share?.status === "loading";
  show("share-preview", preview !== undefined);
  const previewKey = preview ? JSON.stringify(preview) : "";
  if (preview && previewKey !== shownPreview) {
    renderSharePreview(el("share-preview-body"), preview, apiOrigin());
    const notice = document.createElement("strong");
    notice.textContent = preview.notice;
    el("share-notice").replaceChildren(notice);
  }
  shownPreview = previewKey;
  button("share-confirm").disabled = share?.status === "sharing";
  show("share-done", share?.status === "shared");
  if (share?.status === "shared") {
    const link = el("share-link") as HTMLAnchorElement;
    link.href = share.link;
    link.textContent = share.link;
    el("share-code").textContent = share.deleteCode;
  } else {
    el("share-code").textContent = "";
  }
  shareStatus(
    share?.status === "loading"
      ? "Preparing the preview…"
      : share?.status === "sharing"
        ? "Sharing…"
        : share?.status === "error"
          ? share.message
          : "",
  );
}

/** Copy `text`, saying so on `target` (or how to copy it by hand). */
async function copy(text: string, target: HTMLButtonElement, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    target.textContent = done;
  } catch {
    target.textContent = "Select it and copy it";
  }
}

// ── "Have an invite?" ─────────────────────────────────────────────────────

async function useInvite(): Promise<void> {
  if (!session) return;
  const field = el("invite-input") as HTMLInputElement;
  const status = el("invite-status");
  button("invite-use").disabled = true;
  try {
    const outcome = await redeemInvite(apiBase, session.token, field.value);
    if (outcome.ok) {
      field.value = "";
      status.textContent = inviteAdded(outcome.checksAdded);
      checks = outcome.checks;
      renderAccount();
    } else {
      status.textContent = outcome.message;
      if (outcome.signedOut) await sessionRejected();
    }
  } finally {
    button("invite-use").disabled = false;
  }
}

async function init(): Promise<void> {
  ({ apiBase, session, expired } = await loadSettings());
  consented = await consentGiven();
  showConsent(!consented);
  el("about").addEventListener("click", (event) => {
    event.preventDefault();
    showConsent(el("consent").hidden === true);
  });
  el("privacy").addEventListener("click", (event) => {
    event.preventDefault();
    void chrome.tabs.create({ url: PRIVACY_URL });
  });
  el("consent-agree").addEventListener("click", () => {
    void giveConsent().then(() => {
      consented = true;
      showConsent(false);
      renderAccount();
    });
  });
  el("consent-close").addEventListener("click", () => {
    showConsent(false);
  });
  // `?tab=<id>` shows a given tab's analysis (the popup opened as a page, e.g. in tests); else the active tab.
  const forced = Number(new URLSearchParams(location.search).get("tab"));
  const [tab] =
    Number.isInteger(forced) && forced > 0
      ? [await chrome.tabs.get(forced).catch(() => undefined)]
      : await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  analysable = tabId !== undefined && isAnalysable(tab?.url, apiBase);
  renderAccount();
  void refreshPricing();
  void refreshCredits();

  el("options").addEventListener("click", (event) => {
    event.preventDefault();
    void chrome.runtime.openOptionsPage();
  });
  for (const id of ["sign-in", "error-sign-in"]) {
    el(id).addEventListener("click", () => {
      openTab("/connect");
    });
  }
  for (const id of ["buy", "error-buy"]) {
    el(id).addEventListener("click", () => {
      openTab(isKeySession(session) ? "/checkout?for=key" : "/checkout");
    });
  }
  el("sign-out").addEventListener("click", () => {
    void clearSession().then(() => {
      session = undefined;
      expired = false;
      checks = undefined;
      inviteEligible = undefined;
      renderAccount();
    });
  });
  el("sign-in-phone").addEventListener("click", () => {
    void startPhoneSignIn();
  });
  el("sign-in-key").addEventListener("click", () => {
    show("key", true);
    el("key-status").textContent = "";
    el("key-input").focus();
  });
  el("key-cancel").addEventListener("click", () => {
    show("key", false);
  });
  el("key-get").addEventListener("click", (event) => {
    event.preventDefault();
    openTab("/checkout?for=key");
  });
  const useKey = async (): Promise<void> => {
    const field = el("key-input") as HTMLInputElement;
    const result = await signInWithKey(apiBase, field.value);
    if (!result.ok) {
      el("key-status").textContent = KEY_FAILURE[result.reason];
      return;
    }
    field.value = "";
    session = result.session;
    expired = false;
    checks = result.checks;
    inviteEligible = result.inviteEligible;
    renderAccount();
  };
  el("key-use").addEventListener("click", () => void useKey());
  el("invite-use").addEventListener("click", () => void useInvite());
  el("invite-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") void useInvite();
  });
  el("key-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") void useKey();
  });
  el("phone-retry").addEventListener("click", () => {
    void startPhoneSignIn();
  });
  el("phone-cancel").addEventListener("click", () => {
    stopPairing();
    void forgetPairing();
    show("phone", false);
  });
  if (!session) {
    const pending = await storedPairing();
    if (pending) void showPairing(pending);
  }

  if (tabId === undefined) return;
  port = chrome.runtime.connect({ name: ANALYSIS_PORT });
  port.onMessage.addListener((update: BackgroundUpdate) => {
    if (update.tabId === tabId) render(update.state);
  });
  port.postMessage({ type: "watch", tabId } satisfies PopupRequest);
  el("report-open").addEventListener("click", (event) => {
    event.preventDefault();
    show("report-open-row", false);
    show("report", true);
  });
  el("report-cancel").addEventListener("click", () => {
    show("report", false);
    show("report-open-row", true);
  });
  el("report").addEventListener("change", () => {
    button("report-send").disabled = reportReason() === undefined;
  });
  el("share-open").addEventListener("click", () => {
    if (tabId !== undefined) port?.postMessage({ type: "share-preview", tabId } satisfies PopupRequest);
  });
  el("share-cancel").addEventListener("click", () => {
    if (tabId !== undefined) port?.postMessage({ type: "share-cancel", tabId } satisfies PopupRequest);
  });
  el("share-confirm").addEventListener("click", () => {
    if (tabId === undefined) return;
    button("share-confirm").disabled = true; // until the background's state arrives: one share per click
    port?.postMessage({ type: "share", tabId } satisfies PopupRequest);
  });
  el("share-copy").addEventListener("click", () => {
    void copy((el("share-link") as HTMLAnchorElement).href, button("share-copy"), "Link copied");
  });
  el("share-code-copy").addEventListener("click", () => {
    void copy(el("share-code").textContent, button("share-code-copy"), "Delete code copied");
  });
  el("report").addEventListener("submit", (event) => {
    event.preventDefault();
    const reason = reportReason();
    if (!reason || tabId === undefined) return;
    button("report-send").disabled = true;
    port?.postMessage({ type: "report", tabId, reason } satisfies PopupRequest);
  });
  el("analyse").addEventListener("click", () => {
    if (busy || !consented) return; // a second click before the first one's state arrives must not charge twice
    if (session && checks === 0) {
      if (purchasesOn) openTab(isKeySession(session) ? "/checkout?for=key" : "/checkout");
      return;
    }
    if (tabId === undefined) return;
    busy = true; // synchronously: the button is disabled before any message round trip
    renderAccount();
    port?.postMessage({ type: "analyze", tabId } satisfies PopupRequest);
  });
}

void init();
