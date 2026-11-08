/** The popup: account and credits, the "Analyse this page" button, live progress and the result. */

import { ApiError, type Pairing, VeridexApi } from "../api/client.js";
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
  clearSession,
  expireSession,
  loadSettings,
  saveSession,
  type Session,
  shortAddress,
} from "../shared/settings.js";
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
    const credits = await new VeridexApi(apiBase, session.token).credits();
    checks = credits.checks_remaining;
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
  el("phone-qr").replaceChildren(qrSvg(encodeQr(pairing.connect_url), t("phone_qr_label")));
  el("phone-code").textContent = pairing.confirm_code;
  phoneStatus(t("phone_waiting"));
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
  el("account-status").textContent = session
    ? t("signed_in_as", [shortAddress(session.address)])
    : expired
      ? t("session_expired")
      : t("not_signed_in");
  el("account-until").textContent = session ? untilText(session.expiresAt) : "";
  show("account-until", Boolean(session));
  show("sign-in", !session);
  show("sign-in-phone", !session);
  show("sign-out", Boolean(session));
  show("buy", Boolean(session) && purchasesOn);
  el("credits").textContent = checks === undefined ? "" : checksText(checks);
  show("credits", Boolean(session) && checks !== undefined);

  const noChecks = Boolean(session) && checks === 0;
  const analyse = button("analyse");
  analyse.textContent = busy ? t("analysing") : noChecks ? t("buy_to_analyse") : t("analyse");
  analyse.disabled = busy || !session || !analysable || (noChecks && !purchasesOn);
  el("hint").textContent = !analysable
    ? t("hint_not_analysable")
    : !session
      ? t("hint_sign_in")
      : noChecks
        ? t("hint_no_checks")
        : t("hint_ready");
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
    renderResult(el("result-body"), state.result);
    if (state.result.balance_lamports !== undefined) void refreshCredits();
  } else if (state.status === "error") {
    el("error-message").textContent = state.message;
    show("error-refunded", state.refunded === true);
    show("error-sign-in", state.needsSignIn);
    show("error-buy", state.needsCredits && purchasesOn);
    if (state.needsSignIn) void sessionRejected();
  }
}

async function init(): Promise<void> {
  document.documentElement.lang = uiLanguage();
  localise(document);
  ({ apiBase, session, expired } = await loadSettings());
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
      openTab("/checkout");
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
  el("analyse").addEventListener("click", () => {
    if (session && checks === 0) {
      if (purchasesOn) openTab("/checkout");
      return;
    }
    if (tabId !== undefined) port?.postMessage({ type: "analyze", tabId } satisfies PopupRequest);
  });
}

void init();
