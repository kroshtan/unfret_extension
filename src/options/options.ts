/** Options: the API base URL (production by default, a local origin for development), an Unfret pass, signing out. */

import { UnfretApi } from "../api/client.js";
import { checksText } from "../popup/view.js";
import { OPEN_MESSAGE } from "../shared/handoff.js";
import { CODE_CHECKOUT, inviteAdded, redeemInvite } from "../shared/invites.js";
import { KEY_FAILURE, signInWithKey } from "../shared/key-sign-in.js";
import { isOwnPass, ownPass } from "../shared/new-pass.js";
import {
  accountLabel,
  checkoutPath,
  clearSession,
  DEFAULT_API_BASE,
  expireSession,
  isDevBase,
  isKeySession,
  loadSettings,
  normaliseApiBase,
  PRIVACY_URL,
  saveApiBase,
  shortAddress,
} from "../shared/settings.js";
import { withoutSecrets } from "../shared/urls.js";

function el(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} missing`);
  return found;
}

/** A field's message, marked as good news or a problem so it reads as one (colour and weight, not colour alone). */
function say(id: string, text: string, kind: "ok" | "error" | "" = ""): void {
  const status = el(id);
  status.textContent = text;
  status.dataset.kind = kind;
}

function input(id: string): HTMLInputElement {
  const found = el(id);
  if (!(found instanceof HTMLInputElement)) throw new Error(`#${id} is not an input`);
  return found;
}

async function renderAccount(): Promise<void> {
  const { apiBase, session } = await loadSettings();
  el("account-status").textContent = !session
    ? "Not signed in."
    : isKeySession(session)
      ? `Using Unfret pass ${accountLabel(session)}.`
      : `Signed in as ${shortAddress(session.address)} until ${new Date(session.expiresAt).toLocaleDateString("en")}.`;
  el("sign-out").hidden = !session;
  // Signed in with a key: its own top-up, the key's ID filled in.
  el("buy").hidden = !session;
  el("buy").setAttribute("href", `${apiBase}${checkoutPath(session)}`);
  el("buy").textContent = isKeySession(session) ? "Buy checks for this pass" : "Buy checks";
  el("invite").hidden = !session;
  el("have-code-row").hidden = Boolean(session);
  // The pass Unfret made on install: its backup code was never shown anywhere else.
  const own = (await isOwnPass(session)) ? await ownPass() : undefined;
  el("backup").hidden = own === undefined;
  el("backup-code").textContent = own?.recoveryCode ?? "";
  if (session) {
    try {
      // Hide "Have an invite?" for an account that has had credit, where no code would be accepted.
      const credits = await new UnfretApi(apiBase, session.token).credits();
      if (credits.invite_eligible === false) el("invite").hidden = true;
    } catch {
      // Offline or an expired sign-in: keep the field; redeeming explains what's wrong.
    }
  }
  el("key-get").setAttribute(
    "href",
    `${apiBase}${isKeySession(session) ? checkoutPath(session) : "/checkout?for=key"}`,
  );
  el("have-code").setAttribute("href", `${apiBase}${CODE_CHECKOUT}`);
}

/** Check a pasted API key with the server (its balance), then use it in place of a wallet sign-in. */
async function useKey(value: string): Promise<void> {
  const { apiBase } = await loadSettings();
  const result = await signInWithKey(apiBase, value);
  if (result.ok) {
    input("api-key").value = "";
    input("api-key").removeAttribute("aria-invalid");
    say(
      "key-status",
      `Saved. Using Unfret pass ${accountLabel(result.session)}: ${checksText(result.checks)}.`,
      "ok",
    );
  } else {
    input("api-key").setAttribute("aria-invalid", "true");
    say("key-status", KEY_FAILURE[result.reason], "error");
  }
  await renderAccount();
}

/** "Have an invite?": redeem a code for the account in use (only a new one, that never had checks). */
async function useInvite(): Promise<void> {
  const { apiBase, session } = await loadSettings();
  if (!session) return;
  const outcome = await redeemInvite(apiBase, session.token, input("invite-input").value);
  if (outcome.ok) {
    input("invite-input").value = "";
    say("invite-status", `${inviteAdded(outcome.checksAdded)} ${checksText(outcome.checks)}.`, "ok");
    return;
  }
  say("invite-status", outcome.message, "error");
  if (outcome.signedOut) {
    await expireSession();
    await renderAccount();
  }
}

async function save(value: string): Promise<void> {
  const wanted = value.trim();
  const normalised = normaliseApiBase(wanted);
  if (wanted && normalised === DEFAULT_API_BASE && new URL(DEFAULT_API_BASE).origin !== safeOrigin(wanted)) {
    say(
      "server-status",
      "Only the default, or a local server on http://localhost / http://127.0.0.1, can be used.",
      "error",
    );
    return;
  }
  if (isDevBase(normalised)) {
    // Requested from this click (a user gesture), for the dev host only.
    const { protocol, hostname } = new URL(normalised);
    const granted = await chrome.permissions.request({ origins: [`${protocol}//${hostname}/*`] });
    if (!granted) {
      say("server-status", "Access to that address was not allowed; keeping the previous server.", "error");
      return;
    }
  }
  const previous = (await loadSettings()).apiBase;
  const stored = await saveApiBase(normalised);
  input("api-base").value = stored;
  // A different server means a different account: sign out.
  if (stored !== previous) await clearSession();
  await renderAccount();
  say("server-status", `Saved. Using ${stored}.`, "ok");
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

/**
 * The links to the Unfret site's checkout open through the background, as the popup's do, so their tab gets its ticket
 * (a first pass from it needs no further click). A middle click or a modifier opens the link as a plain link.
 */
function openThroughExtension(id: string): void {
  el(id).addEventListener("click", (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const href = el(id).getAttribute("href") ?? "";
    let path: string;
    try {
      const url = new URL(href);
      path = `${url.pathname}${url.search}`;
    } catch {
      return;
    }
    event.preventDefault();
    void chrome.runtime
      .sendMessage<{ type: string; path: string }, { ok?: boolean } | undefined>({ type: OPEN_MESSAGE, path })
      .then((reply) => {
        if (!reply?.ok) throw new Error("not opened");
      })
      .catch(() => chrome.tabs.create({ url: withoutSecrets(href) }));
  });
}

async function init(): Promise<void> {
  el("privacy-link").setAttribute("href", PRIVACY_URL);
  for (const id of ["buy", "key-get", "have-code"]) openThroughExtension(id);
  el("server-help").textContent =
    `The default is ${DEFAULT_API_BASE}. For development, http://localhost or http://127.0.0.1 (any port) can be ` +
    "used; the browser asks you to allow access to it. Testing against the dev deployment is done with the separate " +
    "Unfret Dev extension.";
  const { apiBase } = await loadSettings();
  input("api-base").value = apiBase;
  await renderAccount();
  el("save").addEventListener("click", () => void save(input("api-base").value));
  el("reset").addEventListener("click", () => void save(DEFAULT_API_BASE));
  el("key-use").addEventListener("click", () => void useKey(input("api-key").value));
  el("invite-use").addEventListener("click", () => void useInvite());
  el("sign-out").addEventListener("click", () => {
    void clearSession().then(renderAccount);
  });
}

void init();
