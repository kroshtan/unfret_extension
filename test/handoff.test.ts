/**
 * Taking a pass or wallet sign-in from unfret.net (0.12.0): only after a click on the page or from a tab the extension
 * opened itself, and never in place of another account without the user's yes in the extension's own window. A site
 * that opens unfret.net in a window it controls can make the page hand something over, but it can't click there for
 * the user, it has no ticketed tab, and it can't answer the extension's window.
 */

import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fromExtensionPage,
  openUnfretTab,
  receiveKey,
  receiveSession,
  unfretPageUrl,
  welcomeOnInstall,
} from "../src/background/onboarding.js";
import {
  ANSWER_MESSAGE,
  KEY_MESSAGE,
  KEY_RECEIVED_MESSAGE,
  SESSION_STATUS_MESSAGE,
  userActivated,
} from "../src/content/relay.js";
import {
  answerOffer,
  grantTicket,
  hasTicket,
  type Offer,
  OFFER_MS,
  pendingOffer,
  TICKET_MS,
} from "../src/shared/handoff.js";
import type { Session } from "../src/shared/settings.js";
import { withoutSecrets } from "../src/shared/urls.js";

const KEY = `ufk_abcdefghij_${"a".repeat(52)}`;
const OTHER_KEY = `ufk_zzzzzzzzzz_${"b".repeat(52)}`;
const ORIGIN = "https://unfret.net";
const keySessionOf = (key: string): Session => ({
  token: key,
  address: `key:${key.slice(4, 14)}`,
  expiresAt: "9999-12-31T00:00:00.000Z",
  kind: "key",
});
const WALLET_ADDRESS = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const OTHER_WALLET = "So11111111111111111111111111111111111111112";
const wallet = (address: string, token = "wallet-session-token-xxxxxxxx"): Session => ({
  token,
  address,
  expiresAt: "2999-01-01T00:00:00.000Z",
});
/** The session as the connect page posts it. */
const posted = (s: Session): Record<string, string> => ({
  token: s.token,
  address: s.address,
  expires_at: s.expiresAt,
});

function area(data: Record<string, unknown>): Record<string, unknown> {
  return {
    get: (keys: string | string[]) =>
      Promise.resolve(
        Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys]).filter((k) => k in data).map((k) => [k, data[k]]),
        ),
      ),
    set: (items: Record<string, unknown>) => {
      Object.assign(data, structuredClone(items));
      return Promise.resolve();
    },
    remove: (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) Reflect.deleteProperty(data, k);
      return Promise.resolve();
    },
  };
}

let local: Record<string, unknown>;
let memory: Record<string, unknown>;
let told: { tabId: number; message: unknown }[];
let created: string[];
const ask = vi.fn(() => Promise.resolve({ windowId: 42 }));

beforeEach(() => {
  local = {};
  memory = {};
  told = [];
  created = [];
  ask.mockClear();
  vi.stubGlobal("chrome", {
    runtime: { id: "ext-id" },
    storage: { local: area(local), sync: area({}), session: area(memory) },
    tabs: {
      create: (props: { url: string }) => {
        created.push(props.url);
        return Promise.resolve({ id: 99 });
      },
      sendMessage: (tabId: number, message: unknown) => {
        told.push({ tabId, message });
        return Promise.resolve();
      },
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const checkout = (tab = 7) => ({
  id: "ext-id",
  frameId: 0,
  url: `${ORIGIN}/checkout?paid=1`,
  tab: { id: tab } as chrome.tabs.Tab,
});
const connect = (tab = 7) => ({
  id: "ext-id",
  frameId: 0,
  url: `${ORIGIN}/connect`,
  tab: { id: tab } as chrome.tabs.Tab,
});

describe("a first pass (the extension has none)", () => {
  it("is refused when the page hands it over by itself, without a click: nothing is kept", async () => {
    expect(await receiveKey({ key: KEY }, checkout(), "ext-id", ask)).toEqual({ status: "needs-click" });
    expect(await receiveKey({ key: KEY, activated: "true" }, checkout(), "ext-id", ask)).toEqual({
      status: "needs-click",
    });
    expect(local).not.toHaveProperty("session");
    expect(ask).not.toHaveBeenCalled(); // and no window pops up on a page's say-so
  });

  it("is taken right after a click on the page", async () => {
    expect(await receiveKey({ key: KEY, activated: true }, checkout(), "ext-id", ask)).toEqual({
      status: "signed-in",
    });
    expect(local.session).toEqual(keySessionOf(KEY));
  });

  it("is taken without a click from a tab the extension opened itself (its ticket), once", async () => {
    await grantTicket(7);
    await grantTicket(8);
    expect(await receiveKey({ key: KEY }, checkout(9), "ext-id", ask)).toEqual({ status: "needs-click" });
    expect(await receiveKey({ key: KEY }, checkout(7), "ext-id", ask)).toEqual({ status: "signed-in" });
    expect(local.session).toEqual(keySessionOf(KEY));
    // Signed in: the tickets did their job, none is left for later.
    expect(await hasTicket(7)).toBe(false);
    expect(await hasTicket(8)).toBe(false);
  });

  it("a ticket runs out after an hour", async () => {
    const now = Date.now();
    await grantTicket(7, now - TICKET_MS - 1);
    expect(await hasTicket(7)).toBe(false);
    expect(await receiveKey({ key: KEY }, checkout(7), "ext-id", ask)).toEqual({ status: "needs-click" });
  });

  it("a wallet sign-in follows the same rule", async () => {
    const s = wallet(WALLET_ADDRESS);
    expect(await receiveSession({ session: posted(s) }, connect(), "ext-id", ask)).toEqual({
      ok: false,
      status: "needs-click",
    });
    expect(local).not.toHaveProperty("session");
    expect(await receiveSession({ session: posted(s), activated: true }, connect(), "ext-id", ask)).toEqual({
      ok: true,
    });
    expect(local.session).toEqual(s);
  });

  it("a wallet sign-in in a tab the extension opened needs no further click", async () => {
    await grantTicket(7);
    const s = wallet(WALLET_ADDRESS);
    expect(await receiveSession({ session: posted(s) }, connect(7), "ext-id", ask)).toEqual({ ok: true });
    expect(local.session).toEqual(s);
  });
});

describe("replacing a different pass or wallet", () => {
  it.each([
    ["another pass", keySessionOf(OTHER_KEY)],
    ["a wallet", wallet(WALLET_ADDRESS)],
  ])(
    "with %s: always asks in the extension's own window, even after a click and in a ticketed tab",
    async (_n, current) => {
      local.session = current;
      await grantTicket(7);
      expect(await receiveKey({ key: KEY, replace: true }, checkout(7), "ext-id", ask)).toEqual({
        status: "other-account",
      });
      expect(ask).not.toHaveBeenCalled(); // replace without a click: the page asks again first
      expect(
        await receiveKey({ key: KEY, replace: true, activated: true }, checkout(7), "ext-id", ask),
      ).toEqual({
        status: "confirm",
      });
      expect(ask).toHaveBeenCalledTimes(1);
      expect(local.session).toEqual(current);
      const offer = await pendingOffer();
      expect(offer).toMatchObject({
        kind: "key",
        session: keySessionOf(KEY),
        current,
        tabId: 7,
        windowId: 42,
      });
    },
  );

  it("switches on a yes there, and tells the page", async () => {
    local.session = keySessionOf(OTHER_KEY);
    await receiveKey({ key: KEY, replace: true, activated: true }, checkout(), "ext-id", ask);
    const offer = (await pendingOffer()) as Offer;
    expect(await answerOffer(offer.id, true)).toBe("signed-in");
    expect(local.session).toEqual(keySessionOf(KEY));
    expect(await pendingOffer()).toBeUndefined();
    expect(told).toEqual([{ tabId: 7, message: { type: ANSWER_MESSAGE, kind: "key", status: "signed-in" } }]);
  });

  it("keeps the current one on a no (or the window closed), and tells the page", async () => {
    local.session = keySessionOf(OTHER_KEY);
    await receiveKey({ key: KEY, replace: true, activated: true }, checkout(), "ext-id", ask);
    const offer = (await pendingOffer()) as Offer;
    expect(await answerOffer(offer.id, false)).toBe("kept");
    expect(local.session).toEqual(keySessionOf(OTHER_KEY));
    expect(told).toEqual([{ tabId: 7, message: { type: ANSWER_MESSAGE, kind: "key", status: "kept" } }]);
    expect(await answerOffer(offer.id, true)).toBe("gone"); // answered: a second answer changes nothing
    expect(local.session).toEqual(keySessionOf(OTHER_KEY));
  });

  it("a question runs out after ten minutes", async () => {
    local.session = keySessionOf(OTHER_KEY);
    await receiveKey({ key: KEY, replace: true, activated: true }, checkout(), "ext-id", ask);
    const offer = (await pendingOffer()) as Offer;
    vi.useFakeTimers({ now: Date.now() + OFFER_MS + 1, toFake: ["Date"] });
    expect(await answerOffer(offer.id, true)).toBe("gone");
    expect(local.session).toEqual(keySessionOf(OTHER_KEY));
  });

  it("a newer question replaces an older one, whose page hears it was kept", async () => {
    local.session = keySessionOf(OTHER_KEY);
    await receiveKey({ key: KEY, replace: true, activated: true }, checkout(7), "ext-id", ask);
    const first = (await pendingOffer()) as Offer;
    const third = `ufk_cccccccccc_${"c".repeat(52)}`;
    await receiveKey({ key: third, replace: true, activated: true }, checkout(8), "ext-id", ask);
    expect(told).toEqual([{ tabId: 7, message: { type: ANSWER_MESSAGE, kind: "key", status: "kept" } }]);
    expect(await answerOffer(first.id, true)).toBe("gone");
    expect(local.session).toEqual(keySessionOf(OTHER_KEY));
    const second = (await pendingOffer()) as Offer;
    expect(second.session).toEqual(keySessionOf(third));
    expect(second.windowId).toBe(42); // the same window asks
  });

  it("the extension's free pass: its free checks left move to the new pass on a yes", async () => {
    local.session = keySessionOf(OTHER_KEY);
    local.ownPass = { keyId: "zzzzzzzzzz", recoveryCode: `ufr_zzzzzzzzzz_${"c".repeat(52)}` };
    const calls: { url: string; auth: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>;
        calls.push({ url, auth: headers.Authorization ?? "", body: init.body as string });
        return Promise.resolve(new Response(JSON.stringify({ moved: 3 }), { status: 200 }));
      }),
    );
    await receiveKey({ key: KEY, replace: true, activated: true }, checkout(), "ext-id", ask);
    const offer = (await pendingOffer()) as Offer;
    expect(offer.freePass).toBe(true);
    expect(calls).toEqual([]); // nothing moves before the yes
    expect(await answerOffer(offer.id, true)).toBe("signed-in");
    expect(calls).toEqual([
      {
        url: "https://unfret.net/v1/keys/move-free-checks",
        auth: `Bearer ${OTHER_KEY}`, // from the free pass, which the extension holds
        body: JSON.stringify({ to_key_id: "abcdefghij" }), // to the new pass, by its ID only
      },
    ]);
    expect(local.session).toEqual(keySessionOf(KEY));
  });

  it("switches even when the free checks can't be moved (offline)", async () => {
    local.session = keySessionOf(OTHER_KEY);
    local.ownPass = { keyId: "zzzzzzzzzz", recoveryCode: "x" };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );
    await receiveKey({ key: KEY, replace: true, activated: true }, checkout(), "ext-id", ask);
    expect(await answerOffer(((await pendingOffer()) as Offer).id, true)).toBe("signed-in");
    expect(local.session).toEqual(keySessionOf(KEY));
  });

  it("another wallet: asks after a click (or in a ticketed tab), never by itself", async () => {
    const current = wallet(WALLET_ADDRESS);
    local.session = current;
    const other = wallet(OTHER_WALLET, "other-wallet-session-token-xx");
    expect(await receiveSession({ session: posted(other) }, connect(), "ext-id", ask)).toEqual({
      ok: false,
      status: "needs-click",
    });
    expect(ask).not.toHaveBeenCalled();
    expect(
      await receiveSession({ session: posted(other), activated: true }, connect(), "ext-id", ask),
    ).toEqual({ ok: false, status: "confirm" });
    expect(local.session).toEqual(current);
    const offer = (await pendingOffer()) as Offer;
    expect(offer).toMatchObject({ kind: "wallet", session: other, current });
    expect(await answerOffer(offer.id, true)).toBe("signed-in");
    expect(local.session).toEqual(other);
    expect(told).toEqual([
      { tabId: 7, message: { type: ANSWER_MESSAGE, kind: "wallet", status: "signed-in" } },
    ]);
  });

  it("a pass, then a wallet sign-in: asks too", async () => {
    local.session = keySessionOf(KEY);
    await grantTicket(7);
    expect(
      await receiveSession({ session: posted(wallet(WALLET_ADDRESS)) }, connect(7), "ext-id", ask),
    ).toEqual({
      ok: false,
      status: "confirm",
    });
    expect(local.session).toEqual(keySessionOf(KEY));
  });

  it("the same wallet signing in again (a renewed session) needs no question", async () => {
    local.session = wallet(WALLET_ADDRESS, "old-wallet-session-token-xxxx");
    const renewed = wallet(WALLET_ADDRESS, "new-wallet-session-token-xxxx");
    expect(await receiveSession({ session: posted(renewed) }, connect(), "ext-id", ask)).toEqual({
      ok: true,
    });
    expect(local.session).toEqual(renewed);
  });

  it("refuses a sign-in from anywhere but the connect page itself", async () => {
    const s = posted(wallet(WALLET_ADDRESS));
    for (const sender of [
      { ...connect(), url: `${ORIGIN}/connect-evil` },
      { ...connect(), url: `${ORIGIN}/checkout` },
      { ...connect(), frameId: 2 },
      { ...connect(), url: "https://evil.example/connect" },
    ]) {
      expect(await receiveSession({ session: s, activated: true }, sender, "ext-id", ask)).toEqual({
        ok: false,
      });
    }
    expect(local).not.toHaveProperty("session");
  });
});

describe("the tabs the extension opens", () => {
  it("open with a ticket, and never with pass or key material in the address", async () => {
    expect(await openUnfretTab(`${ORIGIN}/checkout?mode=code&key=${KEY}#pass=${KEY}`)).toBe(99);
    expect(created).toEqual([`${ORIGIN}/checkout?mode=code`]);
    expect(await hasTicket(99)).toBe(true);
  });

  it("the welcome page after installing is one of them", async () => {
    await welcomeOnInstall({ reason: "install" });
    await vi.waitFor(async () => {
      expect(await hasTicket(99)).toBe(true);
    });
    expect(created).toEqual([`${ORIGIN}/welcome?setup=1`]);
  });

  it("only a path on the API's own site, asked for by the extension's own pages", () => {
    expect(unfretPageUrl(ORIGIN, "/checkout?mode=code")).toBe(`${ORIGIN}/checkout?mode=code`);
    for (const path of ["https://evil.example/", "//evil.example/x", "checkout", 42, undefined]) {
      expect(unfretPageUrl(ORIGIN, path)).toBeNull();
    }
    expect(
      fromExtensionPage({ id: "ext-id", url: "chrome-extension://ext-id/popup/popup.html" }, "ext-id"),
    ).toBe(true);
    expect(
      fromExtensionPage({ id: "ext-id", url: "moz-extension://ext-id/options/options.html" }, "ext-id"),
    ).toBe(true);
    // A content script's messages come with the page's address: it can't ask for a ticketed tab.
    expect(
      fromExtensionPage({ id: "ext-id", url: `${ORIGIN}/checkout`, tab: { id: 7 } } as never, "ext-id"),
    ).toBe(false);
    expect(fromExtensionPage({ id: "other", url: "chrome-extension://other/x.html" }, "ext-id")).toBe(false);
  });

  it("the popup and the settings page open Unfret pages through the background", () => {
    const popup = readFileSync("src/popup/popup.ts", "utf8");
    expect(popup).toContain("({ type: OPEN_MESSAGE, path })");
    expect(popup).not.toMatch(/tabs\.create\(\{ url: `\$\{apiBase\}\$\{path\}` \}\)/u);
    const options = readFileSync("src/options/options.ts", "utf8");
    expect(options).toContain('for (const id of ["buy", "key-get", "have-code"]) openThroughExtension(id);');
  });
});

describe("addresses without secrets", () => {
  it.each([
    [`${ORIGIN}/checkout?key=abc&mode=topup`, `${ORIGIN}/checkout?mode=topup`],
    [`${ORIGIN}/check#pass=${KEY}`, `${ORIGIN}/check`],
    [`${ORIGIN}/x?next=%2Fy%3Fk%3D${KEY}`, `${ORIGIN}/x`],
    [`${ORIGIN}/x?r=ufr_abcdefghij_${"a".repeat(52)}`, `${ORIGIN}/x`],
    [`${ORIGIN}/x?Token=t&session=s&recovery_code=r`, `${ORIGIN}/x`],
    [`${ORIGIN}/checkout?mode=topup&key_id=abcdefghij`, `${ORIGIN}/checkout?mode=topup&key_id=abcdefghij`],
    [`${ORIGIN}/welcome?free=5`, `${ORIGIN}/welcome?free=5`],
    [`${ORIGIN}/welcome#have-key`, `${ORIGIN}/welcome#have-key`],
    [`${ORIGIN}/s/abc123`, `${ORIGIN}/s/abc123`],
    ["not a url", "not a url"],
  ])("%s", (url, expected) => {
    expect(withoutSecrets(url)).toBe(expected);
  });
});

describe("the content scripts", () => {
  it("read the page's user activation, which only a real click sets", () => {
    expect(userActivated({ userActivation: { isActive: true } })).toBe(true);
    expect(userActivated({ userActivation: { isActive: false, hasBeenActive: true } })).toBe(false);
    expect(userActivated({})).toBe(false);
    expect(userActivated(undefined)).toBe(false);
  });

  async function relay(
    script: string,
    data: unknown,
    active: boolean,
    reply: unknown,
  ): Promise<{ sent: unknown[]; posted: unknown[]; deliver: (m: unknown) => void }> {
    const sent: unknown[] = [];
    const postedToPage: unknown[] = [];
    let listener: ((m: unknown, sender: { id: string }) => void) | undefined;
    vi.stubGlobal("chrome", {
      runtime: {
        id: "ext-id",
        sendMessage: (message: unknown) => {
          sent.push(message);
          return Promise.resolve(reply);
        },
        onMessage: {
          addListener: (fn: typeof listener) => {
            listener = fn;
          },
        },
      },
      storage: { local: area({}) },
    });
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      value: { isActive: active, hasBeenActive: true },
    });
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      postedToPage.push(message);
    });
    const add = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation(((type: string, fn: EventListener) => {
      attached.push(fn);
      add(type, fn);
    }) as typeof window.addEventListener);
    vi.resetModules();
    await import(script);
    window.dispatchEvent(new MessageEvent("message", { data, origin: ORIGIN, source: window }));
    await vi.waitFor(() => {
      expect(sent.length).toBeGreaterThan(0);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    return {
      sent,
      posted: postedToPage,
      deliver: (m) => {
        listener?.(m, { id: "ext-id" });
      },
    };
  }

  /** The relays' page listeners, removed after each test (each test imports a relay afresh). */
  const attached: EventListener[] = [];

  beforeEach(() => {
    vi.stubGlobal("location", new URL(`${ORIGIN}/checkout`));
  });
  afterEach(() => {
    for (const fn of attached.splice(0)) window.removeEventListener("message", fn);
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "userActivation");
  });

  it("the checkout relay says whether the user just clicked, and passes on the extension's later answer", async () => {
    const {
      sent,
      posted: toPage,
      deliver,
    } = await relay("../src/content/key-relay.js", { type: KEY_MESSAGE, key: KEY, replace: true }, true, {
      status: "confirm",
    });
    expect(sent).toEqual([{ type: KEY_MESSAGE, key: KEY, replace: true, activated: true }]);
    expect(toPage).toEqual([{ type: KEY_RECEIVED_MESSAGE, status: "confirm" }]);
    deliver({ type: ANSWER_MESSAGE, kind: "key", status: "signed-in" });
    deliver({ type: ANSWER_MESSAGE, kind: "wallet", status: "signed-in" }); // not this page's
    deliver({ type: ANSWER_MESSAGE, kind: "key", status: KEY }); // nothing but a status ever reaches the page
    expect(toPage).toEqual([
      { type: KEY_RECEIVED_MESSAGE, status: "confirm" },
      { type: KEY_RECEIVED_MESSAGE, status: "signed-in" },
    ]);
  });

  it("a hand-off on loading, without a click, goes with activated: false", async () => {
    const { sent, posted: toPage } = await relay(
      "../src/content/key-relay.js",
      { type: KEY_MESSAGE, key: KEY },
      false,
      { status: "needs-click" },
    );
    expect(sent).toEqual([{ type: KEY_MESSAGE, key: KEY, replace: false, activated: false }]);
    expect(toPage).toEqual([{ type: KEY_RECEIVED_MESSAGE, status: "needs-click" }]);
  });

  it("the connect relay tells a page that must ask for a click, in a message older pages ignore", async () => {
    vi.stubGlobal("location", new URL(`${ORIGIN}/connect`));
    const s = posted(wallet(WALLET_ADDRESS));
    const {
      sent,
      posted: toPage,
      deliver,
    } = await relay("../src/content/connect-relay.js", { type: "veridex-session", ...s }, false, {
      ok: false,
      status: "needs-click",
    });
    expect(sent).toEqual([
      {
        type: "veridex-session",
        session: { token: s.token, address: s.address, expiresAt: "2999-01-01T00:00:00.000Z" },
        activated: false,
      },
    ]);
    expect(toPage).toEqual([{ type: SESSION_STATUS_MESSAGE, status: "needs-click" }]);
    deliver({ type: ANSWER_MESSAGE, kind: "wallet", status: "signed-in" });
    expect(toPage.at(-1)).toEqual({ type: "veridex-session-received" }); // the page's own naming
  });
});
