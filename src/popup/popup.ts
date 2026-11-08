/** The popup: account and credits, the "Analyse this page" button, live progress and the result. */

import { ApiError, type AnalysisResult, type Pairing, VeridexApi } from "../api/client.js";
import {
  ANALYSIS_PORT,
  type BackgroundUpdate,
  type PopupRequest,
  type TabState,
} from "../shared/messages.js";
import { waitForPairing } from "../shared/pairing.js";
import { encodeQr, qrSvg } from "../shared/qr.js";
import { clearSession, loadSettings, saveSession, type Session, shortAddress } from "../shared/settings.js";
import { isAnalysable } from "../shared/sites.js";
import { checksText, flagName, scoreClass, scoreLabel } from "./view.js";

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
let tabId: number | undefined;
let analysable = false;
let port: chrome.runtime.Port | undefined;
let purchasesOn = false;

function openTab(path: string): void {
  void chrome.tabs.create({ url: `${apiBase}${path}` });
  window.close();
}

async function refreshCredits(): Promise<void> {
  if (!session) return;
  try {
    const credits = await new VeridexApi(apiBase, session.token).credits();
    el("credits").textContent = checksText(credits.checks_remaining);
    show("credits", true);
  } catch (error) {
    if (error instanceof ApiError && error.needsSignIn) {
      await clearSession();
      session = undefined;
      renderAccount();
    }
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
            : "Couldn't reach Veridex. Check your connection.";
    phoneStatus(message, true);
  }
}

function renderAccount(): void {
  el("account-status").textContent = session
    ? `Signed in as ${shortAddress(session.address)}`
    : "Not signed in. Sign in with your Solana wallet to use your checks.";
  show("sign-in", !session);
  show("sign-in-phone", !session);
  show("buy", Boolean(session) && purchasesOn);
  if (!session) show("credits", false);
  button("analyse").disabled = !session || !analysable;
  el("hint").textContent = !analysable
    ? "This page can't be analysed."
    : session
      ? "One check per analysis. Nothing is sent until you click."
      : "Sign in to analyse this page.";
}

function renderResult(result: AnalysisResult): void {
  const score = el("score");
  score.className = `score ${scoreClass(result.score)}`.trim();
  score.textContent = result.score < 0 ? "–" : String(result.score);
  score.setAttribute("aria-label", scoreLabel(result.score));
  el("explanation").textContent = result.explanation;
  const flags = el("flags");
  flags.replaceChildren();
  for (const flag of result.assessment?.flags ?? []) {
    const li = document.createElement("li");
    const type = document.createElement("span");
    type.className = "type";
    type.textContent = `${flagName(flag.type)}: `;
    li.append(type, document.createTextNode(flag.evidence));
    flags.append(li);
  }
  show("flags-heading", flags.children.length > 0);
  const parts: string[] = [];
  if (result.assessment?.model_version) parts.push(`Model ${result.assessment.model_version}`);
  if (result.assessment) parts.push(`confidence ${Math.round(result.assessment.confidence * 100)}%`);
  el("meta").textContent = parts.join(" · ");
  show("result", true);
  void refreshCredits();
}

function render(state: TabState): void {
  show("progress", state.status === "extracting" || state.status === "analysing");
  show("result", false);
  show("error", false);
  const busy = state.status === "extracting" || state.status === "analysing";
  button("analyse").disabled = busy || !session || !analysable;
  el("analyse").textContent = busy ? "Analysing…" : "Analyse this page";
  if (state.status === "extracting") {
    el("progress-status").textContent = "Reading the page…";
    el("steps").replaceChildren();
  } else if (state.status === "analysing" || state.status === "done") {
    el("progress-status").textContent = state.pageType
      ? `Checking (${state.pageType.replace(/_/gu, " ")})…`
      : "Checking…";
    const steps = el("steps");
    steps.replaceChildren(
      ...state.findings.map((f) => {
        const li = document.createElement("li");
        const skill = document.createElement("strong");
        skill.textContent = `${f.skill}: `;
        li.append(skill, document.createTextNode(f.evidence));
        return li;
      }),
    );
    if (state.status === "done") renderResult(state.result);
  } else if (state.status === "error") {
    el("error-message").textContent = state.message;
    show("error-sign-in", state.needsSignIn);
    show("error-buy", state.needsCredits && purchasesOn);
    show("error", true);
    if (state.needsSignIn) {
      void clearSession().then(() => {
        session = undefined;
        renderAccount();
      });
    }
  }
}

async function init(): Promise<void> {
  ({ apiBase, session } = await loadSettings());
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
    if (tabId !== undefined) port?.postMessage({ type: "analyze", tabId } satisfies PopupRequest);
  });
}

void init();
