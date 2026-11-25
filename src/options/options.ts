/** Options: the API base URL (production by default, a local origin for development). */

import {
  DEFAULT_API_BASE,
  forgetOldAccount,
  isDevBase,
  loadSettings,
  normaliseApiBase,
  PRIVACY_URL,
  saveApiBase,
} from "../shared/settings.js";
import { SUPPORT_PATH } from "../shared/text.js";

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
  const stored = await saveApiBase(normalised);
  input("api-base").value = stored;
  say("server-status", `Saved. Using ${stored}.`, "ok");
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

async function init(): Promise<void> {
  void forgetOldAccount();
  el("privacy-link").setAttribute("href", PRIVACY_URL);
  el("server-help").textContent =
    `The default is ${DEFAULT_API_BASE}. For development, http://localhost or http://127.0.0.1 (any port) can be ` +
    "used; the browser asks you to allow access to it. Testing against the dev deployment is done with the separate " +
    "Unfret Dev extension.";
  const { apiBase } = await loadSettings();
  input("api-base").value = apiBase;
  el("support-link").setAttribute("href", `${apiBase}${SUPPORT_PATH}`);
  el("save").addEventListener("click", () => void save(input("api-base").value));
  el("reset").addEventListener("click", () => void save(DEFAULT_API_BASE));
}

void init();
