/** Options: the API base URL (production by default, a local origin for development), an API key, signing out. */

import { VeridexApi } from "../api/client.js";
import { checksText } from "../popup/view.js";
import { inviteAdded, redeemInvite } from "../shared/invites.js";
import { KEY_FAILURE, signInWithKey } from "../shared/key-sign-in.js";
import {
  accountLabel,
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

function el(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} missing`);
  return found;
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
      ? `Using API key ${accountLabel(session)}.`
      : `Signed in as ${shortAddress(session.address)} until ${new Date(session.expiresAt).toLocaleDateString("en")}.`;
  el("sign-out").hidden = !session;
  el("invite").hidden = !session;
  if (session) {
    try {
      // Hide "Have an invite?" for an account that has had credit, where no code would be accepted.
      const credits = await new VeridexApi(apiBase, session.token).credits();
      if (credits.invite_eligible === false) el("invite").hidden = true;
    } catch {
      // Offline or an expired sign-in: keep the field; redeeming explains what's wrong.
    }
  }
  el("key-get").setAttribute("href", `${apiBase}/checkout?for=key`);
}

/** Check a pasted API key with the server (its balance), then use it in place of a wallet sign-in. */
async function useKey(value: string): Promise<void> {
  const status = el("key-status");
  const { apiBase } = await loadSettings();
  const result = await signInWithKey(apiBase, value);
  if (result.ok) {
    input("api-key").value = "";
    status.textContent = `Saved. Using API key ${accountLabel(result.session)}: ${checksText(result.checks)}.`;
  } else {
    status.textContent = KEY_FAILURE[result.reason];
  }
  await renderAccount();
}

/** "Have an invite?": redeem a code for the account in use (only a new one, that never had checks). */
async function useInvite(): Promise<void> {
  const status = el("invite-status");
  const { apiBase, session } = await loadSettings();
  if (!session) return;
  const outcome = await redeemInvite(apiBase, session.token, input("invite-input").value);
  if (outcome.ok) {
    input("invite-input").value = "";
    status.textContent = `${inviteAdded(outcome.checksAdded)} ${checksText(outcome.checks)}.`;
    return;
  }
  status.textContent = outcome.message;
  if (outcome.signedOut) {
    await expireSession();
    await renderAccount();
  }
}

async function save(value: string): Promise<void> {
  const status = el("server-status");
  const wanted = value.trim();
  const normalised = normaliseApiBase(wanted);
  if (wanted && normalised === DEFAULT_API_BASE && new URL(DEFAULT_API_BASE).origin !== safeOrigin(wanted)) {
    status.textContent =
      "Only the default, or a local server on http://localhost / http://127.0.0.1, can be used.";
    return;
  }
  if (isDevBase(normalised)) {
    // Requested from this click (a user gesture), for the dev host only.
    const { protocol, hostname } = new URL(normalised);
    const granted = await chrome.permissions.request({ origins: [`${protocol}//${hostname}/*`] });
    if (!granted) {
      status.textContent = "Access to that address was not allowed; keeping the previous server.";
      return;
    }
  }
  const previous = (await loadSettings()).apiBase;
  const stored = await saveApiBase(normalised);
  input("api-base").value = stored;
  // A different server means a different account: sign out.
  if (stored !== previous) await clearSession();
  await renderAccount();
  status.textContent = `Saved. Using ${stored}.`;
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

async function init(): Promise<void> {
  el("privacy-link").setAttribute("href", PRIVACY_URL);
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
