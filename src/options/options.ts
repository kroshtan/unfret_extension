/** Options: "Your reports" (the optional contributor key and leaderboard), the API base URL. */

import { ApiError, type Contributor, UnfretApi } from "../api/client.js";
import { contributorKey, dropContributorKey, ensureContributorKey } from "../shared/contributor.js";
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

// ── Your reports: the contributor key ──────────────────────────────────────────

const CONTRIBUTOR_ERROR: Record<string, string> = {
  BAD_HANDLE: "A nickname is 3–24 letters, digits, - or _.",
  HANDLE_TAKEN: "That nickname is taken. Try another one.",
  BAD_CONTRIBUTOR_KEY: "Your contributor key isn't valid. Turn it off and on again.",
  LABELS_OFF: "Reports aren't taken right now. Please try again later.",
};

function contributorError(error: unknown): string {
  if (!(error instanceof ApiError)) return "Couldn't reach Unfret. Check your connection.";
  return CONTRIBUTOR_ERROR[error.code] ?? "That didn't work. Please try again later.";
}

function showProfile(profile: Contributor): void {
  const parts = [
    `Reports sent: ${String(profile.labels)}`,
    `agreed with the final answer: ${String(profile.agreed)} of ${String(profile.settled)} settled`,
  ];
  if (typeof profile.rank === "number") parts.push(`leaderboard place: ${String(profile.rank)}`);
  el("contributor-stats").textContent = `${parts.join(" · ")}.`;
  input("handle").value = profile.handle ?? "";
  input("handle-public").checked = profile.public;
}

async function api(): Promise<UnfretApi> {
  return new UnfretApi((await loadSettings()).apiBase);
}

/** Show the contributor part as stored: off, or on with the profile (made on the server at the first call). */
async function renderContributor(): Promise<void> {
  const key = await contributorKey();
  input("contributor-on").checked = key !== undefined;
  el("contributor").hidden = key === undefined;
  if (!key) return;
  try {
    showProfile(await (await api()).contributor(key));
  } catch (error) {
    say("contributor-status", contributorError(error), "error");
  }
}

async function toggleContributor(on: boolean): Promise<void> {
  say("contributor-status", "");
  if (on) {
    await ensureContributorKey();
    await renderContributor();
    return;
  }
  const key = await contributorKey();
  await dropContributorKey();
  el("contributor").hidden = true;
  if (!key) return;
  try {
    await (await api()).forgetContributor(key);
    say("contributor-status", "Your contributor key and profile are deleted.", "ok");
  } catch {
    say(
      "contributor-status",
      "The key is deleted from this browser. Unfret couldn't be reached to delete the profile; nobody can use it without the key.",
    );
  }
}

async function saveHandle(): Promise<void> {
  const key = await contributorKey();
  if (!key) return;
  try {
    const profile = await (
      await api()
    ).contributor(key, {
      handle: input("handle").value.trim(),
      public: input("handle-public").checked,
    });
    showProfile(profile);
    say("contributor-status", "Saved.", "ok");
    void renderLeaderboard();
  } catch (error) {
    say("contributor-status", contributorError(error), "error");
  }
}

async function renderLeaderboard(): Promise<void> {
  try {
    const entries = await (await api()).leaderboard(10);
    el("leaderboard").replaceChildren(
      ...entries.map((e) => {
        const li = document.createElement("li");
        li.textContent = `${e.handle}: ${String(e.agreed)} of ${String(e.settled)} agreed`;
        return li;
      }),
    );
    el("leaderboard-status").textContent = entries.length ? "" : "Nobody is on the leaderboard yet.";
  } catch {
    el("leaderboard-status").textContent = "The leaderboard couldn't be loaded.";
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
  void renderContributor();
  input("contributor-on").addEventListener(
    "change",
    () => void toggleContributor(input("contributor-on").checked),
  );
  el("handle-save").addEventListener("click", () => void saveHandle());
  el("leaderboard-box").addEventListener("toggle", () => {
    if ((el("leaderboard-box") as HTMLDetailsElement).open) void renderLeaderboard();
  });
  el("save").addEventListener("click", () => void save(input("api-base").value));
  el("reset").addEventListener("click", () => void save(DEFAULT_API_BASE));
}

void init();
