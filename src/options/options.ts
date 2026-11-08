/** Options: the API base URL (production by default, a local origin for development) and signing out. */

import {
  clearSession,
  DEFAULT_API_BASE,
  isDevBase,
  loadSettings,
  normaliseApiBase,
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
  const { session } = await loadSettings();
  el("account-status").textContent = session
    ? `Signed in as ${shortAddress(session.address)} until ${new Date(session.expiresAt).toLocaleDateString()}.`
    : "Not signed in.";
  el("sign-out").hidden = !session;
}

async function save(value: string): Promise<void> {
  const status = el("server-status");
  const wanted = value.trim();
  const normalised = normaliseApiBase(wanted);
  if (wanted && normalised === DEFAULT_API_BASE && new URL(DEFAULT_API_BASE).origin !== safeOrigin(wanted)) {
    status.textContent = "Only https:// URLs, or http://localhost / http://127.0.0.1, are allowed.";
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
  const { apiBase } = await loadSettings();
  input("api-base").value = apiBase;
  await renderAccount();
  el("save").addEventListener("click", () => void save(input("api-base").value));
  el("reset").addEventListener("click", () => void save(DEFAULT_API_BASE));
  el("sign-out").addEventListener("click", () => {
    void clearSession().then(renderAccount);
  });
}

void init();
