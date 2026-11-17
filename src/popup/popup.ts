/** The popup: account and credits, the "Analyse this page" button, live progress and the result. */

import { ApiError, type Pairing, type ReportReason, UnfretApi } from "../api/client.js";
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
  checkoutPath,
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
import { CODE_CHECKOUT, inviteAdded, redeemInvite } from "../shared/invites.js";
import { KEY_FAILURE, signInWithKey } from "../shared/key-sign-in.js";
import { OPEN_MESSAGE } from "../shared/handoff.js";
import { isAnalysable } from "../shared/sites.js";
import { freeChecksUsed, makeFreePass } from "../shared/new-pass.js";
import { withoutSecrets } from "../shared/urls.js";
import { CONSENT_HINT, FREE_PAUSED, OFFLINE, SESSION_EXPIRED } from "../shared/text.js";
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
/** Of `checks`, the free ones; and whether today's free deep checks are all used (then only quick checks are free). */
let freeLeft = 0;
let freePaused = false;
/** From the server: false once the account has had credit, when "Have an invite?" can no longer work. */
let inviteEligible: boolean | undefined;
let tabId: number | undefined;
let analysable = false;
let busy = false;
let port: chrome.runtime.Port | undefined;
let consented = false;
/** Not signed in: the sign-in choices are behind "Sign in with an Unfret pass or wallet" until asked for. */
let signInOpen = false;

/** The consent screen: shown until accepted, and from "About & privacy" any time after. */
function showConsent(visible: boolean): void {
  show("consent", visible);
  document.body.dataset.consent = consented ? "given" : "needed";
  el("about").setAttribute("aria-expanded", String(visible));
  show("consent-agree", !consented);
  show("consent-agreed", consented);
  show("consent-close", consented);
}

/**
 * Open a page of the Unfret site. The background opens it, so the tab gets its ticket (a first pass from it needs
 * no further click) even though this popup closes as the tab takes the focus.
 */
function openTab(path: string): void {
  void chrome.runtime
    .sendMessage<{ type: string; path: string }, { ok?: boolean } | undefined>({ type: OPEN_MESSAGE, path })
    .then((reply) => {
      if (!reply?.ok) throw new Error("not opened");
    })
    .catch(() => chrome.tabs.create({ url: withoutSecrets(`${apiBase}${path}`) }))
    .finally(() => {
      window.close();
    });
}

async function sessionRejected(): Promise<void> {
  await expireSession();
  session = undefined;
  expired = true;
  checks = undefined;
  freeLeft = 0;
  inviteEligible = undefined;
  renderAccount();
}

async function refreshCredits(): Promise<void> {
  if (!session) return;
  try {
    const credits = await new UnfretApi(apiBase, session.token).credits();
    checks = credits.checks_remaining;
    freeLeft = credits.free_checks_remaining ?? 0;
    freePaused = credits.free_checks_paused === true;
    inviteEligible = credits.invite_eligible;
    renderAccount();
  } catch (error) {
    if (error instanceof ApiError && error.needsSignIn) await sessionRejected();
  }
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
    ? `${usingKey ? "Using Unfret pass" : "Signed in as"} ${accountLabel(session)}`
    : expired
      ? SESSION_EXPIRED
      : freeUsed
        ? "This browser has had its free checks. Buy checks to start, or sign in with the pass or wallet you have."
        : "Get a few free checks to start: no account, no e-mail.";
  el("account-until").textContent = session && !usingKey ? untilText(session.expiresAt) : "";
  show("account-until", Boolean(session) && !usingKey);
  // Not signed in: one next step (the free checks, or buying checks once this browser had them), the sign-in choices
  // one click away. After an expired sign-in, signing in again is the next step.
  const choosing = !session && (signInOpen || expired);
  show("get-free-row", !session && !expired);
  const getFree = button("get-free");
  getFree.textContent = freeUsed
    ? "Buy checks"
    : gettingPass
      ? "Getting your free checks…"
      : freePerPass
        ? `Get your ${freePerPass} free checks`
        : "Get your free checks";
  getFree.disabled = gettingPass;
  show("sign-in-more-row", !session && !choosing);
  show("sign-in-choices", choosing);
  show("sign-in", choosing);
  show("sign-in-phone", choosing);
  show("sign-in-key", choosing);
  document.body.dataset.auth = session ? "in" : expired ? "expired" : "out";
  show("have-code-row", !session);
  if (session) show("key", false);
  show("sign-out", Boolean(session));
  show("account-actions", Boolean(session));
  show("invite", Boolean(session) && inviteEligible !== false);
  el("credits").textContent = checks === undefined ? "" : checksText(checks, freeLeft);
  show("credits", Boolean(session) && checks !== undefined);

  // Out of checks, or only free ones while they're paused for the day: the button runs a free quick check, and
  // "Buy checks" is next to it (a pass's own top-up). Shown at once: whether checks can be bought is the checkout
  // page's to say (card and crypto each switch off on their own there).
  const quickOnly = quickChecksOnly();
  show("buy", Boolean(session));
  const analyse = button("analyse");
  analyse.textContent = busy ? "Checking…" : quickOnly ? "Quick check (free)" : "Check this page";
  analyse.disabled = busy || !consented || !session || !analysable;
  el("hint").textContent = !consented
    ? CONSENT_HINT
    : busy
      ? "You can close this popup: the check carries on, and its result waits here."
      : !analysable
        ? "This page can't be checked."
        : !session
          ? gettingPass
            ? "Getting your free checks…"
            : freeUsed
              ? "Buy checks or sign in to check this page."
              : "Get your free checks or sign in to check this page."
          : checks === 0
            ? "You have no checks left. Quick checks are free: they read this page only."
            : quickOnly
              ? FREE_PAUSED
              : "One check per page. Nothing is sent until you click.";
}

/** No checks left, or only free ones while today's are all used: only a quick check can run. */
function quickChecksOnly(): boolean {
  if (!session || checks === undefined) return false;
  return checks === 0 || (freePaused && freeLeft === checks);
}

let gettingPass = false;
/** Signed out: whether this browser profile already had its free checks, and how many a new pass gets (server's). */
let freeUsed = false;
let freePerPass: number | undefined;

/** Signed out, before the free checks: the number for the button, from the price list (it never holds anything up). */
async function loadFreePerPass(): Promise<void> {
  try {
    const n = (await new UnfretApi(apiBase).pricing()).free?.checks_per_pass;
    freePerPass = typeof n === "number" && n > 0 ? n : undefined;
    renderAccount();
  } catch {
    // offline or an older server: "Get your free checks"
  }
}

/**
 * "Get your free checks", signed out: make the extension's free pass as installing does (free checks only once per
 * browser profile; the server may have none left today). Once this browser had them, the button buys checks instead.
 */
async function getFreeChecks(): Promise<void> {
  if (freeUsed) {
    openTab(checkoutPath(undefined));
    return;
  }
  if (gettingPass || session) return;
  gettingPass = true;
  el("free-status").textContent = "";
  renderAccount();
  const made = await makeFreePass(apiBase);
  gettingPass = false;
  if (made.ok) {
    session = made.session;
    expired = false;
    checks = made.freeChecks;
    freeLeft = made.freeChecks;
    freeUsed = true;
    if (made.freeChecks === 0) {
      el("free-status").textContent =
        "No free checks this time: this browser has had them, or today's are all given out. Buy checks to start.";
      el("free-status").dataset.kind = "error";
    }
    void refreshCredits();
  } else {
    el("free-status").textContent =
      made.reason === "offline"
        ? OFFLINE
        : "Unfret couldn't make your pass just now. Please try again later.";
    el("free-status").dataset.kind = "error";
  }
  renderAccount();
}

/** The free pass the extension makes on install, when that failed (offline): tried again when the popup opens. */
async function retryFreePass(): Promise<void> {
  const pending = await chrome.storage.local.get<{ passPending?: boolean }>("passPending");
  if (session || pending.passPending !== true) return;
  gettingPass = true;
  renderAccount();
  const made = await makeFreePass(apiBase);
  gettingPass = false;
  if (made.ok) {
    session = made.session;
    expired = false;
    checks = made.freeChecks;
    freeLeft = made.freeChecks;
    void refreshCredits();
  }
  renderAccount();
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

function render(state: TabState): void {
  busy = state.status === "extracting" || state.status === "analysing";
  document.body.dataset.phase = busy ? "busy" : state.status;
  show("progress", busy);
  show("result", state.status === "done");
  // Signed out or out of checks, the account and the main button already offer the way on (and say why): no second
  // card repeats it; screen readers hear the message.
  const ownCard = state.status === "error" && !state.needsSignIn && !state.needsCredits;
  show("error", ownCard);
  if (state.status === "error" && state.needsCredits) checks = 0;
  renderAccount();
  if (busy) {
    el("progress-status").textContent =
      state.status === "extracting" ? "Reading the page…" : "Checking… this usually takes 10–30 seconds.";
    const steps = el("steps");
    buildChecklist(steps);
    updateChecklist(steps, checklistDone(state.status === "analysing" ? (state.steps ?? []) : [], false));
    announce("Checking this page…");
  }
  if (state.status === "done") {
    el("result-note").textContent = state.note ?? "";
    show("result-note", state.note !== undefined);
    renderResult(el("result-body"), state.result, apiOrigin());
    announce(`Result: ${el("result-body").querySelector(".verdict .label")?.textContent ?? ""}`);
    renderReport(state);
    renderShare(state);
    if (state.result.balance_lamports !== undefined) void refreshCredits();
  } else if (state.status === "error") {
    el("error-message").textContent = state.message;
    show("error-refunded", state.refunded === true);
    if (!ownCard) announce(state.message);
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
  status.dataset.kind = report?.status === "sent" ? "ok" : report?.status === "error" ? "error" : "";
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
      status.dataset.kind = "ok";
      checks = outcome.checks;
      renderAccount();
    } else {
      status.textContent = outcome.message;
      status.dataset.kind = "error";
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
      renderAccount();
      // The next step gets the focus: checking this page, or getting started.
      if (!button("analyse").disabled) button("analyse").focus();
      else if (!el("get-free-row").hidden) button("get-free").focus();
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
  freeUsed = await freeChecksUsed();
  renderAccount();
  void refreshCredits();
  void retryFreePass();
  if (!session && !freeUsed) void loadFreePerPass();

  el("options").addEventListener("click", (event) => {
    event.preventDefault();
    void chrome.runtime.openOptionsPage();
  });
  el("sign-in").addEventListener("click", () => {
    openTab("/connect");
  });
  el("buy").addEventListener("click", () => {
    openTab(checkoutPath(session));
  });
  el("get-free").addEventListener("click", () => void getFreeChecks());
  el("sign-in-more").addEventListener("click", (event) => {
    event.preventDefault();
    signInOpen = true;
    renderAccount();
    button("sign-in-key").focus();
  });
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
    el("key-input").removeAttribute("aria-invalid");
    el("key-input").focus();
  });
  el("key-cancel").addEventListener("click", () => {
    show("key", false);
  });
  el("key-get").addEventListener("click", (event) => {
    event.preventDefault();
    openTab("/checkout?for=key");
  });
  // "Have a code?": the website makes a new API key and redeems the invite or intro code onto it, in one step.
  for (const id of ["have-code", "key-code"]) {
    el(id).addEventListener("click", (event) => {
      event.preventDefault();
      openTab(CODE_CHECKOUT);
    });
  }
  const useKey = async (): Promise<void> => {
    const field = el("key-input") as HTMLInputElement;
    const result = await signInWithKey(apiBase, field.value);
    if (!result.ok) {
      el("key-status").textContent = KEY_FAILURE[result.reason];
      el("key-status").dataset.kind = "error";
      field.setAttribute("aria-invalid", "true");
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
    el("report-legend").focus();
  });
  el("report-cancel").addEventListener("click", () => {
    show("report", false);
    show("report-open-row", true);
    button("report-open").focus();
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
    if (tabId === undefined) return;
    const quick = quickChecksOnly();
    busy = true; // synchronously: the button is disabled before any message round trip
    renderAccount();
    port?.postMessage(
      (quick ? { type: "analyze", tabId, tier: "quick" } : { type: "analyze", tabId }) satisfies PopupRequest,
    );
  });
}

void init();
