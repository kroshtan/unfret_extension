/** The popup: account and credits, the "Analyse this page" button, live progress and the result. */

import { ApiError, type AnalysisResult, VeridexApi } from "../api/client.js";
import {
  ANALYSIS_PORT,
  type BackgroundUpdate,
  type PopupRequest,
  type TabState,
} from "../shared/messages.js";
import { clearSession, loadSettings, type Session, shortAddress } from "../shared/settings.js";
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

function renderAccount(): void {
  el("account-status").textContent = session
    ? `Signed in as ${shortAddress(session.address)}`
    : "Not signed in. Sign in with your Solana wallet to use your checks.";
  show("sign-in", !session);
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
