/**
 * Unfret's new free start (backend 0.13.0): the passes made before it are retired on the server, which then answers
 * them as unknown (401 INVALID_API_KEY). The extension forgets such a pass, says so calmly once, and offers the free
 * pass again, with the free checks if this browser never had them. A wallet's 401 stays an expired sign-in.
 */

import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../src/api/client.js";
import { checkFailed } from "../src/background/failure.js";
import { redeemInvite } from "../src/shared/invites.js";
import {
  endPass,
  makeFreePass,
  passEndedBy,
  rejectSession,
  WELCOME_RENEWED_PATH,
} from "../src/shared/new-pass.js";
import type { BackgroundUpdate } from "../src/shared/messages.js";
import { loadSettings, type Session } from "../src/shared/settings.js";
import { PASS_ENDED, PASS_ENDED_PAID, SESSION_EXPIRED } from "../src/shared/text.js";

const KEY = `ufk_abcdefghij_${"a".repeat(52)}`;
const OTHER_KEY = `ufk_zzzzzzzzzz_${"b".repeat(52)}`;
const FREE = `ufk_ffffffffff_${"f".repeat(52)}`;
const keySessionOf = (key: string): Session => ({
  token: key,
  address: `key:${key.slice(4, 14)}`,
  expiresAt: "9999-12-31T00:00:00.000Z",
  kind: "key",
});
const WALLET: Session = {
  token: "wallet-session-token-xxxxxxxx",
  address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  expiresAt: "2999-01-01T00:00:00.000Z",
};
const RETIRED = new ApiError(401, "INVALID_API_KEY", "Unknown or revoked API key.");
const EXPIRED = new ApiError(401, "UNAUTHORIZED", "Sign in first.");

function area(data: Record<string, unknown>): Record<string, unknown> {
  return {
    get: (keys: string | string[]) =>
      Promise.resolve(
        Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys]).filter((k) => k in data).map((k) => [k, data[k]]),
        ),
      ),
    set: (items: Record<string, unknown>) => {
      Object.assign(data, items);
      return Promise.resolve();
    },
    remove: (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) Reflect.deleteProperty(data, k);
      return Promise.resolve();
    },
  };
}

let local: Record<string, unknown>;
let sync: Record<string, unknown>;

beforeEach(() => {
  local = {};
  sync = {};
  vi.stubGlobal("chrome", { runtime: { id: "ext-id" }, storage: { local: area(local), sync: area(sync) } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("a pass the server no longer knows", () => {
  it("is a 401 INVALID_API_KEY on a pass; a wallet's 401 never is", () => {
    expect(RETIRED.passEnded).toBe(true);
    expect(EXPIRED.passEnded).toBe(false);
    expect(new ApiError(402, "INVALID_API_KEY", "").passEnded).toBe(false);
    expect(passEndedBy(keySessionOf(KEY), RETIRED)).toBe(true);
    expect(passEndedBy(WALLET, RETIRED)).toBe(false);
    expect(passEndedBy(keySessionOf(KEY), EXPIRED)).toBe(false);
    expect(passEndedBy(undefined, RETIRED)).toBe(false);
  });

  it("the extension's own pass: forgotten with its backup code, not 'expired', and the free pass offered again", async () => {
    Object.assign(local, {
      session: keySessionOf(KEY),
      ownPass: { keyId: "abcdefghij", recoveryCode: "ufr_x" },
      sessionExpired: true,
      consent: { version: 2 },
    });
    sync.freeChecksUsed = true;
    expect(await rejectSession(keySessionOf(KEY), RETIRED)).toBe("ended");
    expect(local).toEqual({ consent: { version: 2 }, passEnded: true, passPending: true });
    expect(sync).toEqual({ freeChecksUsed: true }); // the free checks' note stays as it was
    expect(await loadSettings()).toMatchObject({ expired: false, passEnded: true });
    expect((await loadSettings()).session).toBeUndefined();
  });

  it("a pass from the website (bought, or handed over): forgotten; the extension's own backup code stays", async () => {
    Object.assign(local, {
      session: keySessionOf(OTHER_KEY),
      ownPass: { keyId: "abcdefghij", recoveryCode: "ufr_x" },
    });
    await endPass(keySessionOf(OTHER_KEY));
    expect(local).toEqual({
      ownPass: { keyId: "abcdefghij", recoveryCode: "ufr_x" },
      passEnded: true,
      passPending: true,
    });
  });

  it("leaves a newer sign-in alone", async () => {
    local.session = WALLET;
    await endPass(keySessionOf(KEY));
    expect(local).toEqual({ session: WALLET });
  });

  it("a wallet's 401, or a pass's other 401: the expired sign-in, as before", async () => {
    local.session = WALLET;
    expect(await rejectSession(WALLET, RETIRED)).toBe("expired");
    expect(local).toEqual({ sessionExpired: true });
    local.session = keySessionOf(KEY);
    expect(await rejectSession(keySessionOf(KEY), EXPIRED)).toBe("expired");
    expect(local).toEqual({ sessionExpired: true });
  });

  it("the note goes once a new pass is made", async () => {
    Object.assign(local, { passEnded: true, passPending: true });
    const api = {
      keyChallenge: () => Promise.resolve({ challenge: "c", bits: 0, expires_at: 9e9 }),
      createKey: () =>
        Promise.resolve({
          key_id: "ffffffffff",
          key: FREE,
          recovery_code: "ufr_f",
          account: "key:ffffffffff",
          balance_usd_micros: 0,
          free_checks: 5,
        }),
    };
    const made = await makeFreePass("https://unfret.net", api as never);
    expect(made).toMatchObject({ ok: true, freeChecks: 5, asked: true });
    expect(local).not.toHaveProperty("passEnded");
    expect(local).not.toHaveProperty("passPending");
    expect(local.session).toEqual(keySessionOf(FREE));
    expect(sync).toEqual({ freeChecksUsed: true });
  });

  it("a check that fails on it: forgotten at once (the popup may be closed), in calm words", async () => {
    Object.assign(local, { session: keySessionOf(KEY), ownPass: { keyId: "abcdefghij", recoveryCode: "r" } });
    expect(await checkFailed(keySessionOf(KEY), RETIRED)).toEqual({
      status: "error",
      message: PASS_ENDED,
      needsSignIn: true,
      needsCredits: false,
      passEnded: true,
      refunded: false,
    });
    expect(local).toEqual({ passEnded: true, passPending: true });

    local.session = WALLET;
    expect(await checkFailed(WALLET, EXPIRED)).toEqual({
      status: "error",
      message: SESSION_EXPIRED,
      needsSignIn: true,
      needsCredits: false,
      refunded: false,
    });
    expect(local.session).toEqual(WALLET); // the popup expires a wallet's sign-in, as before
    expect(readFileSync("src/background/index.ts", "utf8")).toContain("await checkFailed(session, error)");
  });

  it("redeeming a gift code on it: the same calm words, and the popup and settings are told it ended", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ detail: "Unknown or revoked API key.", error_code: "INVALID_API_KEY" }),
            {
              status: 401,
            },
          ),
        ),
      ),
    );
    expect(await redeemInvite("https://unfret.net", KEY, "FRIENDS")).toEqual({
      ok: false,
      message: PASS_ENDED,
      signedOut: true,
      passEnded: true,
    });
    expect(await redeemInvite("https://unfret.net", WALLET.token, "FRIENDS")).toEqual({
      ok: false,
      message: SESSION_EXPIRED,
      signedOut: true,
    });
  });

  it("is the copy agreed with the website, without alarming words", () => {
    expect(PASS_ENDED).toBe("Unfret has a new free start: your old pass has ended.");
    expect(PASS_ENDED_PAID).toBe("Quick checks stay free; deep checks come in packs.");
    expect(WELCOME_RENEWED_PATH).toBe("/welcome?setup=1&renewed=1");
    for (const text of [PASS_ENDED, PASS_ENDED_PAID])
      expect(text).not.toMatch(/error|expired|invalid|sorry/iu);
  });
});

describe("the popup, after the server stopped knowing the pass", () => {
  let opened: string[];
  let fetched: string[];
  let listener: ((update: BackgroundUpdate) => void) | undefined;
  /** What `/v1/credits` answers for the stored session: 200, or a 401 with this code. */
  let creditsRefusal: string | null;

  async function openPopup(): Promise<void> {
    const body = /<body>([\s\S]*)<\/body>/u.exec(readFileSync("src/popup/popup.html", "utf8"))?.[1] ?? "";
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gu, "");
    vi.stubGlobal("chrome", {
      storage: {
        local: area(local),
        sync: area(sync),
        session: {
          get: () => Promise.resolve({}),
          set: () => Promise.resolve(),
          remove: () => Promise.resolve(),
        },
      },
      tabs: {
        query: () => Promise.resolve([{ id: 1, url: "https://shop.example/p/1" }]),
        create: (props: { url: string }) => {
          opened.push(props.url);
          return Promise.resolve({});
        },
      },
      runtime: {
        id: "ext-id",
        connect: () => ({
          onMessage: {
            addListener: (fn: (update: BackgroundUpdate) => void) => {
              listener = fn;
            },
          },
          postMessage: () => undefined,
        }),
        openOptionsPage: () => Promise.resolve(),
        sendMessage: (message: { type: string; path: string }) => {
          if (message.type === "unfret-open") opened.push(`https://unfret.net${message.path}`);
          return Promise.resolve({ ok: true });
        },
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => {
        const path = new URL(input).pathname;
        fetched.push(path);
        const answer = (json: unknown, status = 200): Promise<Response> =>
          Promise.resolve(new Response(JSON.stringify(json), { status }));
        if (path === "/v1/pricing") return answer({ hot_wallet: null, free: { checks_per_pass: 5 } });
        if (path === "/v1/keys/challenge") return answer({ challenge: "c", bits: 0 });
        if (path === "/v1/keys")
          return answer({ key: FREE, key_id: "ffffffffff", recovery_code: "ufr_f", free_checks: 0 }, 201);
        const auth = new Headers(init?.headers).get("authorization") ?? "";
        if (creditsRefusal !== null && !auth.includes(FREE))
          return answer({ detail: "Unknown or revoked API key.", error_code: creditsRefusal }, 401);
        return answer({ checks_remaining: 0, invite_eligible: false });
      }),
    );
    vi.stubGlobal("close", () => undefined);
    vi.resetModules();
    await import("../src/popup/popup.js");
    await vi.waitFor(() => {
      expect(document.getElementById("hint")?.textContent).not.toBe("");
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  const visible = (id: string): boolean => document.getElementById(id)?.hidden === false;
  const text = (id: string): string => document.getElementById(id)?.textContent ?? "";

  beforeEach(() => {
    local.consent = { version: 2 };
    opened = [];
    fetched = [];
    listener = undefined;
    creditsRefusal = "INVALID_API_KEY";
  });

  it("a browser that never had its free checks: the note, and its 5 free deep checks one click away", async () => {
    Object.assign(local, { session: keySessionOf(KEY), ownPass: { keyId: "abcdefghij", recoveryCode: "r" } });
    await openPopup();
    await vi.waitFor(() => {
      expect(visible("pass-ended")).toBe(true);
    });
    expect(text("pass-ended")).toBe(PASS_ENDED);
    expect(local).not.toHaveProperty("session");
    expect(local).not.toHaveProperty("ownPass");
    expect(local).not.toHaveProperty("sessionExpired");
    expect(local.passEnded).toBe(true);
    expect(document.body.dataset.auth).toBe("out"); // not "expired": nothing to sign in to again
    expect(visible("get-free-row")).toBe(true);
    await vi.waitFor(() => {
      expect(text("get-free")).toBe("Get your 5 free deep checks");
    });
    expect(text("account-status")).not.toBe(SESSION_EXPIRED);
    expect(opened).toEqual([]); // no tab opened uninvited
    expect(fetched).not.toContain("/v1/keys"); // the welcome page makes the pass, as after installing
    document.getElementById("get-free")?.click();
    expect(opened).toEqual(["https://unfret.net/welcome?setup=1&renewed=1"]);
  });

  it("opened again before the new pass: the note is still there", async () => {
    Object.assign(local, { passEnded: true, passPending: true });
    await openPopup();
    expect(visible("pass-ended")).toBe(true);
    document.getElementById("get-free")?.click();
    expect(opened).toEqual(["https://unfret.net/welcome?setup=1&renewed=1"]);
  });

  it("a browser that had its free checks: the note says so, and the empty pass is made at once", async () => {
    sync.freeChecksUsed = true;
    local.session = keySessionOf(KEY);
    await openPopup();
    await vi.waitFor(() => {
      expect(local.session).toEqual(keySessionOf(FREE));
    });
    const made = (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit?][]).find(
      ([u]) => new URL(u).pathname === "/v1/keys",
    );
    expect(JSON.parse(made?.[1]?.body as string)).not.toHaveProperty("free");
    expect(local).not.toHaveProperty("passEnded"); // stored note gone with the new pass…
    await vi.waitFor(() => {
      expect(text("account-status")).toMatch(/^Using Unfret pass FFFFF-FFFFF/u);
    });
    expect(visible("pass-ended")).toBe(true); // …but this popup still says what happened
    expect(text("pass-ended")).toBe(`${PASS_ENDED} ${PASS_ENDED_PAID}`);
    expect(opened).toEqual([]);
  });

  it("a check that found the pass ended: the same note", async () => {
    local.session = keySessionOf(KEY);
    creditsRefusal = null; // the pass still worked when the popup opened
    await openPopup();
    expect(visible("pass-ended")).toBe(false);
    local.passEnded = true; // the background forgot the pass when the check failed
    delete local.session;
    listener?.({
      type: "state",
      tabId: 1,
      state: {
        status: "error",
        message: PASS_ENDED,
        needsSignIn: true,
        needsCredits: false,
        passEnded: true,
        refunded: false,
      },
    });
    await vi.waitFor(() => {
      expect(visible("pass-ended")).toBe(true);
    });
    expect(visible("get-free-row")).toBe(true);
    expect(local).not.toHaveProperty("sessionExpired");
  });

  it("a wallet's sign-in that expired: as before, sign in again, no note", async () => {
    local.session = WALLET;
    creditsRefusal = "UNAUTHORIZED";
    await openPopup();
    await vi.waitFor(() => {
      expect(text("account-status")).toBe(SESSION_EXPIRED);
    });
    expect(visible("pass-ended")).toBe(false);
    expect(local.sessionExpired).toBe(true);
    expect(local).not.toHaveProperty("passEnded");
    expect(visible("sign-in-key")).toBe(true);
  });
});

describe("the settings page, after the server stopped knowing the pass", () => {
  it("forgets it and says where the new pass is", async () => {
    Object.assign(local, { session: keySessionOf(KEY), ownPass: { keyId: "abcdefghij", recoveryCode: "r" } });
    const body = /<body>([\s\S]*)<\/body>/u.exec(readFileSync("src/options/options.html", "utf8"))?.[1] ?? "";
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gu, "");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ detail: "Unknown or revoked API key.", error_code: "INVALID_API_KEY" }),
            {
              status: 401,
            },
          ),
        ),
      ),
    );
    vi.resetModules();
    await import("../src/options/options.js");
    await vi.waitFor(() => {
      expect(document.getElementById("account-status")?.textContent).toBe(
        `${PASS_ENDED} Open Unfret from the toolbar for your new pass.`,
      );
    });
    expect(local).toEqual({ passEnded: true, passPending: true });
    expect(document.getElementById("backup")?.hidden).toBe(true);
  });
});

describe("updating from 0.11.0, which took a retired pass for an expired sign-in", () => {
  it("turns that signed-out state into the ended pass's, once", async () => {
    const { passEndedOnUpdate } = await import("../src/background/onboarding.js");
    local.sessionExpired = true;
    expect(await passEndedOnUpdate({ reason: "update", previousVersion: "0.11.0" })).toBe(true);
    expect(local).toEqual({ passEnded: true, passPending: true });
    expect(await loadSettings()).toMatchObject({ expired: false, passEnded: true });
    expect(readFileSync("src/background/index.ts", "utf8")).toContain("void passEndedOnUpdate(details);");
  });

  it("leaves a stored session, a later version, an install and a plain signed-out state alone", async () => {
    const { passEndedOnUpdate } = await import("../src/background/onboarding.js");
    Object.assign(local, { sessionExpired: true, session: keySessionOf(KEY) });
    expect(await passEndedOnUpdate({ reason: "update", previousVersion: "0.11.0" })).toBe(false);
    delete local.session;
    expect(await passEndedOnUpdate({ reason: "update", previousVersion: "0.12.0" })).toBe(false);
    expect(await passEndedOnUpdate({ reason: "install" })).toBe(false);
    expect(local).toEqual({ sessionExpired: true });
    delete local.sessionExpired;
    expect(await passEndedOnUpdate({ reason: "update", previousVersion: "0.10.0" })).toBe(false);
    expect(local).toEqual({});
  });
});
