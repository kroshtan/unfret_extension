/**
 * The popup: the "Check this page" button (a free deep check) and the free quick check, live progress and the result.
 * No account: nothing here names the user.
 */

import { type Pause, UnfretApi } from "../api/client.js";
import {
  ANALYSIS_PORT,
  type BackgroundUpdate,
  type PopupRequest,
  type TabState,
} from "../shared/messages.js";
import { contributorKey } from "../shared/contributor.js";
import {
  LEVEL_CHOICES,
  missingChoices,
  REPORT_OUTCOME,
  reportable,
  shownFindings,
} from "../shared/report.js";
import { shareRequest } from "../shared/share.js";
import {
  consentGiven,
  forgetOldAccount,
  giveConsent,
  loadSettings,
  PRIVACY_URL,
} from "../shared/settings.js";
import { isAnalysable } from "../shared/sites.js";
import { withoutSecrets } from "../shared/urls.js";
import { CONSENT_HINT, DONATE_PATH, FREE_PAUSED, SUPPORT_PATH } from "../shared/text.js";
import {
  buildChecklist,
  checklistDone,
  type DeepHint,
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
let tabId: number | undefined;
let analysable = false;
let busy = false;
/** A result is on screen: the quick check isn't offered under it (a quick result offers the deep check itself). */
let resultShown = false;
let port: chrome.runtime.Port | undefined;
let consented = false;
/** Free deep checks are paused this month (the server's price list or the last check said so). */
let paused: Pause | undefined;

/** The consent screen: shown until accepted, and from "About & privacy" any time after. */
function showConsent(visible: boolean): void {
  show("consent", visible);
  document.body.dataset.consent = consented ? "given" : "needed";
  el("about").setAttribute("aria-expanded", String(visible));
  show("consent-agree", !consented);
  show("consent-agreed", consented);
  show("consent-close", consented);
}

/** Open a page of the Unfret site in a new tab, and close the popup. */
function openPage(path: string): void {
  void chrome.tabs.create({ url: withoutSecrets(`${apiBase}${path}`) }).finally(() => {
    window.close();
  });
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderCheck(): void {
  const analyse = button("analyse");
  // Paused, the main button runs the quick check (free deep checks are back next month).
  analyse.textContent = busy ? "Checking…" : paused ? "Quick check (free)" : "Check this page";
  analyse.disabled = busy || !consented || !analysable;
  // The free quick check, under the main button before a check. Paused, the main button is the quick check.
  show("quick-row", consented && analysable && !busy && !resultShown && !paused);
  button("quick").disabled = busy || !consented || !analysable;
  el("hint").textContent = !consented
    ? CONSENT_HINT
    : busy
      ? "You can close this popup: the check carries on, and its result waits here."
      : !analysable
        ? "This page can't be checked."
        : paused
          ? ""
          : "Deep checks are free. Nothing is sent until you click.";
  el("paused-text").textContent = FREE_PAUSED;
  show("paused", consented && paused !== undefined);
}

/** Whether free deep checks are paused, from the price list (no identity; it never holds anything up). */
async function loadPause(): Promise<void> {
  try {
    const free = (await new UnfretApi(apiBase).pricing()).free;
    paused = free?.paused === true ? (free.pause ?? {}) : undefined;
    renderCheck();
  } catch {
    // offline or an older server: a deep check finds out itself
  }
}

/** The origin of the API in use (thumbnails are only loaded from there). */
function apiOrigin(): string | undefined {
  try {
    return new URL(apiBase).origin;
  } catch {
    return undefined;
  }
}

/** What screen readers last heard about this check (said once per change, not on every update). */
let announced = "";

function announce(text: string): void {
  if (text === announced) return;
  announced = text;
  el("announce").textContent = text;
}

/**
 * Start a check of this tab: a free deep one, or the free quick one. Never two at once: `busy` is set synchronously,
 * so the buttons are disabled before any message round trip.
 */
function startCheck(quick: boolean): void {
  if (busy || !consented || tabId === undefined) return;
  busy = true;
  renderCheck();
  port?.postMessage(
    (quick ? { type: "analyze", tabId, tier: "quick" } : { type: "analyze", tabId }) satisfies PopupRequest,
  );
}

/**
 * A check this popup started has its result: the button that started it was disabled or hidden meanwhile, so the focus
 * went to the page. It goes to what comes next: the deep check a quick result offers, or checking the page again.
 */
function refocus(): void {
  if (document.activeElement !== null && document.activeElement !== document.body) return;
  const next = document.getElementById("deep-hint-action") ?? button("analyse");
  if (next instanceof HTMLButtonElement && !next.disabled) next.focus();
}

/** The button under a quick result: a deep check of the same page, or (paused) "Support Unfret". */
function deepHintAction(action: NonNullable<DeepHint["action"]>): void {
  if (action === "donate") openPage(DONATE_PATH);
  else startCheck(false);
}

const PROGRESS: Partial<Record<TabState["status"], string>> = {
  extracting: "Reading the page…",
  preparing: "Getting a free deep check ready…",
  analysing: "Checking… this usually takes 10–30 seconds.",
};

function render(state: TabState): void {
  const wasBusy = busy;
  busy = state.status === "extracting" || state.status === "preparing" || state.status === "analysing";
  resultShown = state.status === "done";
  document.body.dataset.phase = busy ? "busy" : state.status;
  show("progress", busy);
  show("result", state.status === "done");
  show("error", state.status === "error");
  if (state.status === "done" && state.pause) paused = state.pause;
  renderCheck();
  if (busy) {
    el("progress-status").textContent = PROGRESS[state.status] ?? "";
    const steps = el("steps");
    buildChecklist(steps);
    updateChecklist(steps, checklistDone(state.status === "analysing" ? (state.steps ?? []) : [], false));
    announce("Checking this page…");
  }
  if (state.status === "done") {
    el("result-note").textContent = state.note ?? "";
    show("result-note", state.note !== undefined);
    renderResult(el("result-body"), state.result, apiOrigin(), deepHintAction);
    announce(`Result: ${el("result-body").querySelector(".verdict .label")?.textContent ?? ""}`);
    renderReport(state);
    renderShare(state);
    if (wasBusy) refocus();
  } else if (state.status === "error") {
    el("error-message").textContent = state.message;
  }
}

// ── "Wrong result?" ─────────────────────────────────────────────────────────
// One flow: the level the shopper thinks is right, the shown findings that are wrong, findings that are missing. The
// background sends it (with the contributor key only when it is on); the popup shows each step.

/** The finished check on screen, for building the report form when it opens. */
let shownDone: Extract<TabState, { status: "done" }> | undefined;

function renderReport(state: Extract<TabState, { status: "done" }>): void {
  shownDone = state;
  const report = state.report;
  const can = reportable(state.result, state.body !== undefined);
  show("report-open-row", can && report === undefined && el("report").hidden === true);
  if (report !== undefined) show("report", false);
  const status = el("report-status");
  status.hidden = report === undefined;
  status.dataset.kind = report?.status === "sent" ? "ok" : report?.status === "error" ? "error" : "";
  if (report?.status === "sending") status.textContent = "Sending…";
  else if (report?.status === "sent")
    status.textContent = `${REPORT_OUTCOME[report.outcome]}${report.updated ? " It replaces your earlier report on this page." : ""}`;
  else if (report?.status === "error") status.textContent = report.message;
}

function choice(type: "radio" | "checkbox", name: string, value: string, text: string): HTMLLabelElement {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = type;
  input.name = name;
  input.value = value;
  label.append(input, document.createTextNode(` ${text}`));
  return label;
}

/** Fill the form for the result on screen: the levels (ours marked), its findings, what could be missing. */
async function buildReportForm(): Promise<void> {
  const result = shownDone?.result;
  if (!result) return;
  const ours = result.verdict?.risk?.level;
  const legend = el("report-legend");
  el("report-level").replaceChildren(
    legend,
    ...LEVEL_CHOICES.map((c) =>
      choice(
        "radio",
        "level",
        String(c.level),
        `${String(c.level)} · ${c.label}${c.level === ours ? " (our answer)" : ""}`,
      ),
    ),
  );
  const shown = shownFindings(result);
  el("report-wrong").replaceChildren(...shown.map((f) => choice("checkbox", "wrong", f.type, f.title)));
  show("report-wrong-set", shown.length > 0);
  el("report-missing").replaceChildren(
    ...missingChoices(result).map((c) => choice("checkbox", "missing", c.type, c.title)),
  );
  el("report-as").textContent = (await contributorKey())
    ? "It counts toward your contributor profile (Settings)."
    : "It is sent anonymously.";
  button("report-send").disabled = true;
}

function reportPicked(): { level?: number; wrong: string[]; missing: string[] } {
  const picked = (name: string): string[] =>
    [...document.querySelectorAll<HTMLInputElement>(`#report input[name="${name}"]:checked`)].map(
      (i) => i.value,
    );
  const [level] = picked("level");
  return {
    ...(level !== undefined ? { level: Number(level) } : {}),
    wrong: picked("wrong"),
    missing: picked("missing"),
  };
}

// ── "Share this result" ─────────────────────────────────────────────────────
// The background asks for the preview and makes the share (anonymously); the popup shows each step. The link and the
// delete code stay with the tab's result until the tab moves on, so closing the popup doesn't lose them.

/** The preview on screen, so a state update that doesn't change it doesn't rebuild it (an open "Show details"). */
let shownPreview = "";

function shareStatus(text: string): void {
  el("share-status").textContent = text;
  show("share-status", text !== "");
}

function renderShare(state: Extract<TabState, { status: "done" }>): void {
  const share = state.share;
  const shareable = shareRequest(state.body, state.result) !== null;
  show("share-area", shareable);
  const preview =
    share?.status === "preview" || share?.status === "sharing" || share?.status === "error"
      ? share.preview
      : undefined;
  show(
    "share-open-row",
    shareable &&
      (share === undefined || (share.status === "error" && !share.preview) || share.status === "loading"),
  );
  button("share-open").disabled = share?.status === "loading";
  show("share-preview", preview !== undefined);
  const previewKey = preview ? JSON.stringify(preview) : "";
  if (preview && previewKey !== shownPreview) {
    renderSharePreview(el("share-preview-body"), preview, apiOrigin());
    const notice = document.createElement("strong");
    notice.textContent = preview.notice;
    el("share-notice").replaceChildren(notice);
    if (!shownPreview) el("share-preview-heading").focus();
  }
  shownPreview = previewKey;
  button("share-confirm").disabled = share?.status === "sharing";
  show("share-done", share?.status === "shared");
  if (share?.status === "shared") {
    const link = el("share-link") as HTMLAnchorElement;
    link.href = withoutSecrets(share.link);
    link.textContent = link.href;
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

async function init(): Promise<void> {
  // Versions before free checks kept a pass or a wallet sign-in; it is never used, and deleted here too.
  void forgetOldAccount();
  ({ apiBase } = await loadSettings());
  consented = await consentGiven();
  showConsent(!consented);
  el("about").addEventListener("click", (event) => {
    event.preventDefault();
    // Before agreeing, the consent screen is all there is: the link only brings it into view.
    if (consented) showConsent(el("consent").hidden === true);
    if (!el("consent").hidden) el("consent").focus();
  });
  el("privacy").addEventListener("click", (event) => {
    event.preventDefault();
    void chrome.tabs.create({ url: PRIVACY_URL });
  });
  el("consent-agree").addEventListener("click", () => {
    void giveConsent().then(() => {
      consented = true;
      showConsent(false);
      renderCheck();
      void loadPause();
      if (!button("analyse").disabled) button("analyse").focus();
    });
  });
  el("consent-close").addEventListener("click", () => {
    showConsent(false);
  });
  el("options").addEventListener("click", (event) => {
    event.preventDefault();
    void chrome.runtime.openOptionsPage();
  });
  el("support").addEventListener("click", () => {
    openPage(SUPPORT_PATH);
  });
  el("paused-donate").addEventListener("click", () => {
    openPage(DONATE_PATH);
  });
  // `?tab=<id>` shows a given tab's analysis (the popup opened as a page, e.g. in tests); else the active tab.
  const forced = Number(new URLSearchParams(location.search).get("tab"));
  const [tab] =
    Number.isInteger(forced) && forced > 0
      ? [await chrome.tabs.get(forced).catch(() => undefined)]
      : await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  analysable = tabId !== undefined && isAnalysable(tab?.url, apiBase);
  renderCheck();
  if (consented) void loadPause();

  if (tabId === undefined) return;
  port = chrome.runtime.connect({ name: ANALYSIS_PORT });
  port.onMessage.addListener((update: BackgroundUpdate) => {
    if (update.tabId === tabId) render(update.state);
  });
  port.postMessage({ type: "watch", tabId } satisfies PopupRequest);
  el("objection-open").addEventListener("click", () => {
    // The shop owner's page on the Unfret site.
    if (apiBase) openPage("/objection");
  });
  el("report-open").addEventListener("click", (event) => {
    event.preventDefault();
    void buildReportForm().then(() => {
      show("report-open-row", false);
      show("report", true);
      el("report-legend").focus();
    });
  });
  el("report-cancel").addEventListener("click", () => {
    show("report", false);
    show("report-open-row", true);
    button("report-open").focus();
  });
  el("report").addEventListener("change", () => {
    const picked = reportPicked();
    button("report-send").disabled =
      picked.level === undefined && picked.wrong.length === 0 && picked.missing.length === 0;
  });
  el("report").addEventListener("submit", (event) => {
    event.preventDefault();
    if (tabId === undefined) return;
    button("report-send").disabled = true;
    port?.postMessage({ type: "report", tabId, label: reportPicked() } satisfies PopupRequest);
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
  // A second click before the first one's state arrives must not start two checks: startCheck checks `busy`.
  el("analyse").addEventListener("click", () => {
    startCheck(paused !== undefined);
  });
  el("quick").addEventListener("click", () => {
    startCheck(true);
  });
}

void init();
