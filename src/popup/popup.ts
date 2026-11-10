/** The popup: account and credits, the "Analyse this page" button, live progress and the result. */

import { ApiError, type Pairing, type ReportReason, UnfretApi } from "../api/client.js";
import { localise, t, uiLanguage } from "../shared/i18n.js";
import {
  ANALYSIS_PORT,
  type BackgroundUpdate,
  type PopupRequest,
  type TabState,
} from "../shared/messages.js";
import { waitForPairing } from "../shared/pairing.js";
import { encodeQr, qrSvg } from "../shared/qr.js";
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
import { KEY_FAILURE, signInWithKey } from "../shared/key-sign-in.js";
import { isAnalysable } from "../shared/sites.js";
import { buildChecklist, checklistDone, checksText, renderResult, updateChecklist } from "./view.js";

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
  renderAccount();
}

async function refreshCredits(): Promise<void> {
  if (!session) return;
  try {
    const credits = await new UnfretApi(apiBase, session.token).credits();
    checks = credits.checks_remaining;
    renderAccount();
  } catch (error) {
    if (error instanceof ApiError && error.needsSignIn) await sessionRejected();
  }
}

async function refreshPricing(): Promise<void> {
  try {
    purchasesOn = (await new UnfretApi(apiBase).pricing()).hot_wallet !== null;
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
  el("phone-qr").replaceChildren(qrSvg(encodeQr(pairing.connect_url), t("phone_qr_label")));
  el("phone-code").textContent = pairing.confirm_code;
  phoneStatus(t("phone_waiting"));
  const abort = new AbortController();
  pairingAbort = abort;
  const outcome = await waitForPairing(new UnfretApi(apiBase), pairing.pair_id, {
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
    phoneStatus(t("phone_expired"), true);
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
  phoneStatus(t("phone_preparing"));
  try {
    const pairing = await new UnfretApi(apiBase).startPairing();
    try {
      await chrome.storage.session.set({ [PAIRING_KEY]: pairing });
    } catch {
      // without session storage, closing the popup simply ends this attempt
    }
    await showPairing(pairing);
  } catch (error) {
    const message =
      error instanceof ApiError && error.serviceOff
        ? t("phone_unavailable")
        : error instanceof ApiError && error.status === 429
          ? t("phone_too_many")
          : error instanceof ApiError
            ? error.message
            : t("offline");
    phoneStatus(message, true);
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

function untilText(expiresAt: string): string {
  const date = new Date(expiresAt);
  return t("signed_in_until", [date.toLocaleDateString(uiLanguage(), { day: "numeric", month: "long" })]);
}

function renderAccount(): void {
  const usingKey = isKeySession(session);
  el("account-status").textContent = session
    ? t(usingKey ? "signed_in_key" : "signed_in_as", [accountLabel(session)])
    : expired
      ? t("session_expired")
      : t("not_signed_in");
  el("account-until").textContent = session && !usingKey ? untilText(session.expiresAt) : "";
  show("account-until", Boolean(session) && !usingKey);
  show("sign-in", !session);
  show("sign-in-phone", !session);
  show("sign-in-key", !session);
  if (session) show("key", false);
  show("sign-out", Boolean(session));
  show("buy", Boolean(session) && purchasesOn);
  el("credits").textContent = checks === undefined ? "" : checksText(checks);
  show("credits", Boolean(session) && checks !== undefined);

  const noChecks = Boolean(session) && checks === 0;
  const analyse = button("analyse");
  analyse.textContent = busy ? t("analysing") : noChecks ? t("buy_to_analyse") : t("analyse");
  analyse.disabled = busy || !consented || !session || !analysable || (noChecks && !purchasesOn);
  el("hint").textContent = !consented
    ? t("hint_consent")
    : !analysable
      ? t("hint_not_analysable")
      : !session
        ? t("hint_sign_in")
        : noChecks
          ? t("hint_no_checks")
          : t("hint_ready");
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
    el("progress-status").textContent = t(
      state.status === "extracting" ? "progress_reading" : "progress_checking",
    );
    const steps = el("steps");
    buildChecklist(steps);
    updateChecklist(steps, checklistDone(state.status === "analysing" ? (state.steps ?? []) : [], false));
  }
  if (state.status === "done") {
    renderResult(el("result-body"), state.result, undefined, apiOrigin());
    renderReport(state);
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
  queued: "report_queued",
  already_reported: "report_already_reported",
  already_known: "report_already_known",
} as const;

function renderReport(state: Extract<TabState, { status: "done" }>): void {
  const report = state.report;
  const reportable = Boolean(state.body && state.result.report_token && session);
  show("report-open-row", reportable && report === undefined && el("report").hidden === true);
  if (report !== undefined) show("report", false);
  const status = el("report-status");
  status.hidden = report === undefined;
  if (report?.status === "sending") status.textContent = t("report_sending");
  else if (report?.status === "sent") status.textContent = t(REPORT_OUTCOME[report.outcome]);
  else if (report?.status === "error") status.textContent = report.message;
}

function reportReason(): ReportReason | undefined {
  const picked = document.querySelector<HTMLInputElement>('#report input[name="reason"]:checked');
  return (picked?.value as ReportReason | undefined) ?? undefined;
}

async function init(): Promise<void> {
  document.documentElement.lang = uiLanguage();
  localise(document);
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
      el("key-status").textContent = t(KEY_FAILURE[result.reason]);
      return;
    }
    field.value = "";
    session = result.session;
    expired = false;
    checks = result.checks;
    renderAccount();
  };
  el("key-use").addEventListener("click", () => void useKey());
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
