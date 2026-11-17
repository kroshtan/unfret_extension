/**
 * Onboarding (0.11.0): the checkout page hands a new API key to the extension, the welcome page opens once after
 * installing, and the popup offers one next step when signed out or out of checks. 0.12.0: a free pass on install,
 * free quick checks.
 */

import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { manifest } from "../scripts/manifest.mjs";
import {
  receiveKey,
  receiveRef,
  WELCOME_URL,
  welcomeOnInstall,
  welcomeUrl,
} from "../src/background/onboarding.js";
import {
  acceptKeyMessage,
  acceptRefMessage,
  isKeyHandoffStatus,
  KEY_MESSAGE,
  REF_MESSAGE,
} from "../src/content/relay.js";
import { checkoutPath, type Session } from "../src/shared/settings.js";

const KEY = `ufk_abcdefghij_${"a".repeat(52)}`;
const OTHER_KEY = `ufk_zzzzzzzzzz_${"b".repeat(52)}`;
const ORIGIN = "https://unfret.net";
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

/** A chrome.storage area over a plain object. */
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

/** chrome.storage.local (and .sync) over plain objects. */
function stubStorage(data: Record<string, unknown>, sync: Record<string, unknown> = {}): void {
  vi.stubGlobal("chrome", {
    runtime: { id: "ext-id" },
    storage: { local: area(data), sync: area(sync) },
  });
}

describe("the key the checkout page posts (content script)", () => {
  const page = {};
  const event = (data: unknown, over: Partial<{ source: unknown; origin: string }> = {}) => ({
    source: page,
    origin: ORIGIN,
    data,
    ...over,
  });

  it("accepts a well-formed key from the page itself, on the configured Unfret site", () => {
    expect(acceptKeyMessage(event({ type: KEY_MESSAGE, key: KEY }), page, ORIGIN, ORIGIN)).toEqual({
      key: KEY,
      replace: false,
    });
    expect(
      acceptKeyMessage(event({ type: KEY_MESSAGE, key: KEY, replace: true }), page, ORIGIN, ORIGIN),
    ).toEqual({ key: KEY, replace: true });
  });

  it("ignores another window, another origin, or a page that isn't the configured Unfret site", () => {
    const message = { type: KEY_MESSAGE, key: KEY };
    expect(acceptKeyMessage(event(message, { source: {} }), page, ORIGIN, ORIGIN)).toBeNull(); // an iframe
    expect(
      acceptKeyMessage(event(message, { origin: "https://evil.example" }), page, ORIGIN, ORIGIN),
    ).toBeNull();
    expect(
      acceptKeyMessage(
        event(message, { origin: "https://evil.example" }),
        page,
        "https://evil.example",
        ORIGIN,
      ),
    ).toBeNull();
    // The production extension doesn't take keys from the dev deployment (Unfret Dev does, from there only).
    expect(
      acceptKeyMessage(
        event(message, { origin: "https://dev.unfret.net" }),
        page,
        "https://dev.unfret.net",
        ORIGIN,
      ),
    ).toBeNull();
  });

  it.each([
    ["no data", null],
    ["a string", KEY],
    ["the session message", { type: "veridex-session", key: KEY }],
    ["no key", { type: KEY_MESSAGE }],
    ["a number", { type: KEY_MESSAGE, key: 42 }],
    ["not a key", { type: KEY_MESSAGE, key: "ufk_short" }],
    ["a recovery code", { type: KEY_MESSAGE, key: `ufr_abcdefghij_${"a".repeat(52)}` }],
    ["spaces around it", { type: KEY_MESSAGE, key: ` ${KEY} ` }],
    ["upper case", { type: KEY_MESSAGE, key: KEY.toUpperCase() }],
  ])("ignores a malformed message: %s", (_name, data) => {
    expect(acceptKeyMessage(event(data), page, ORIGIN, ORIGIN)).toBeNull();
  });

  it("replaces only on an explicit true", () => {
    for (const replace of ["true", 1, {}, null]) {
      expect(
        acceptKeyMessage(event({ type: KEY_MESSAGE, key: KEY, replace }), page, ORIGIN, ORIGIN)?.replace,
      ).toBe(false);
    }
  });

  it("answers the page with a status only (and whether it is the extension's free pass)", () => {
    const relay = readFileSync("src/content/key-relay.ts", "utf8");
    expect(relay).toContain("{ type: KEY_RECEIVED_MESSAGE, status, free_pass: true }");
    expect(relay).toContain(": { type: KEY_RECEIVED_MESSAGE, status };");
    expect(relay).toContain("window.postMessage(answer, location.origin);");
    expect(isKeyHandoffStatus("signed-in")).toBe(true);
    expect(isKeyHandoffStatus(KEY)).toBe(false);
  });
});

describe("storing the handed-off key (background)", () => {
  let data: Record<string, unknown>;
  const checkout = { id: "ext-id", frameId: 0, url: `${ORIGIN}/checkout?mode=code` };

  beforeEach(() => {
    data = {};
    stubStorage(data);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("signs in with the key when signed out (or after an expired sign-in)", async () => {
    data.sessionExpired = true;
    expect(await receiveKey({ key: KEY }, checkout, "ext-id")).toEqual({ status: "signed-in" });
    expect(data.session).toEqual(keySessionOf(KEY));
    expect(data).not.toHaveProperty("sessionExpired");
  });

  it("says so when it already uses that key", async () => {
    data.session = keySessionOf(KEY);
    expect(await receiveKey({ key: KEY }, checkout, "ext-id")).toEqual({ status: "already" });
  });

  it.each([
    ["another key", keySessionOf(OTHER_KEY)],
    ["a wallet", WALLET],
  ])("asks before replacing %s, and replaces only once the user agreed", async (_name, current) => {
    data.session = current;
    expect(await receiveKey({ key: KEY }, checkout, "ext-id")).toEqual({ status: "other-account" });
    expect(data.session).toEqual(current); // never swapped silently
    expect(await receiveKey({ key: KEY, replace: "yes" }, checkout, "ext-id")).toEqual({
      status: "other-account",
    });
    expect(await receiveKey({ key: KEY, replace: true }, checkout, "ext-id")).toEqual({
      status: "signed-in",
    });
    expect(data.session).toEqual(keySessionOf(KEY));
  });

  it("says when it has its own free pass, and takes its free checks along on a switch", async () => {
    data.session = keySessionOf(OTHER_KEY);
    data.ownPass = { keyId: "zzzzzzzzzz", recoveryCode: `ufr_zzzzzzzzzz_${"c".repeat(52)}` };
    const calls: { url: string; auth: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>;
        calls.push({ url, auth: headers.Authorization ?? "", body: init.body as string });
        return Promise.resolve(new Response(JSON.stringify({ moved: 3 }), { status: 200 }));
      }),
    );
    expect(await receiveKey({ key: KEY }, checkout, "ext-id")).toEqual({
      status: "other-account",
      freePass: true,
    });
    expect(calls).toEqual([]);
    expect(await receiveKey({ key: KEY, replace: true }, checkout, "ext-id")).toEqual({
      status: "signed-in",
    });
    expect(calls).toEqual([
      {
        url: "https://unfret.net/v1/keys/move-free-checks",
        auth: `Bearer ${OTHER_KEY}`, // from the free pass, which the extension holds
        body: JSON.stringify({ to_key_id: "abcdefghij" }), // to the new pass, by its ID only
      },
    ]);
    expect(data.session).toEqual(keySessionOf(KEY));
  });

  it("switches even when the free checks can't be moved (offline)", async () => {
    data.session = keySessionOf(OTHER_KEY);
    data.ownPass = { keyId: "zzzzzzzzzz", recoveryCode: "x" };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );
    expect(await receiveKey({ key: KEY, replace: true }, checkout, "ext-id")).toEqual({
      status: "signed-in",
    });
    expect(data.session).toEqual(keySessionOf(KEY));
  });

  it.each([
    ["another extension", { ...checkout, id: "someone-else" }],
    ["a frame", { ...checkout, frameId: 3 }],
    ["another site", { ...checkout, url: "https://evil.example/checkout" }],
    [
      "the dev deployment, in the production extension",
      { ...checkout, url: "https://dev.unfret.net/checkout" },
    ],
    ["another page of the site", { ...checkout, url: `${ORIGIN}/connect` }],
    ["no address", { id: "ext-id", frameId: 0 }],
  ])("refuses a key from %s", async (_name, sender) => {
    expect(await receiveKey({ key: KEY }, sender, "ext-id")).toEqual({ status: "invalid" });
    expect(data).not.toHaveProperty("session");
  });

  it.each([[undefined], [42], ["ufk_nope"], [` ${KEY}`]])("refuses a malformed key: %s", async (key) => {
    expect(await receiveKey({ key }, checkout, "ext-id")).toEqual({ status: "invalid" });
    expect(data).not.toHaveProperty("session");
  });
});

describe("the welcome page", () => {
  let data: Record<string, unknown>;
  beforeEach(() => {
    data = {};
    stubStorage(data);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens once, after a new install, saying how many free checks the new pass has", async () => {
    const open = vi.fn();
    const makePass = vi.fn(() =>
      Promise.resolve({ ok: true as const, session: keySessionOf(KEY), freeChecks: 5 }),
    );
    expect(await welcomeOnInstall({ reason: "install" }, open, makePass)).toBe(true);
    expect(makePass).toHaveBeenCalledWith("https://unfret.net");
    expect(open).toHaveBeenCalledWith("https://unfret.net/welcome?free=5");
    expect(WELCOME_URL).toBe("https://unfret.net/welcome");
    expect(welcomeUrl(0)).toBe(WELCOME_URL);
  });

  it("offline at install: the welcome page anyway, and the popup tries again", async () => {
    const open = vi.fn();
    const makePass = vi.fn(() => Promise.resolve({ ok: false as const, reason: "offline" as const }));
    expect(await welcomeOnInstall({ reason: "install" }, open, makePass)).toBe(true);
    expect(open).toHaveBeenCalledWith("https://unfret.net/welcome");
    expect(data.passPending).toBe(true);
  });

  it.each(["update", "chrome_update", "browser_update", "shared_module_update"])(
    "not after %s",
    async (reason) => {
      const open = vi.fn();
      const makePass = vi.fn();
      expect(await welcomeOnInstall({ reason }, open, makePass)).toBe(false);
      expect(open).not.toHaveBeenCalled();
      expect(makePass).not.toHaveBeenCalled();
    },
  );

  it("is wired to onInstalled", () => {
    expect(readFileSync("src/background/index.ts", "utf8")).toContain("welcomeOnInstall(details);");
  });
});

describe("the content scripts", () => {
  it("cover the sign-in and checkout pages of this build's own site only", () => {
    const options = { version: "0.11.0", description: "x", publicKey: "KEY" };
    for (const [browser, origin] of [
      ["chrome", ORIGIN],
      ["firefox", ORIGIN],
      ["chrome-dev", "https://dev.unfret.net"],
    ] as const) {
      const m = manifest(browser, options) as { content_scripts: { matches: string[]; js: string[] }[] };
      expect(m.content_scripts).toEqual([
        { matches: [`${origin}/connect*`], js: ["connect-relay.js"], run_at: "document_start" },
        { matches: [`${origin}/checkout*`], js: ["key-relay.js"], run_at: "document_start" },
        { matches: [`${origin}/welcome*`], js: ["ref-relay.js"], run_at: "document_start" },
      ]);
      expect(m).not.toHaveProperty("host_permissions");
    }
  });
});

describe("getting more checks", () => {
  it("tops up a key by its ID, never with the key itself in the address", () => {
    expect(checkoutPath(keySessionOf(KEY))).toBe("/checkout?mode=topup&key_id=abcdefghij");
    expect(checkoutPath(keySessionOf(KEY))).not.toContain(KEY.slice(15));
    expect(checkoutPath({ ...keySessionOf(KEY), address: "key:BAD" })).toBe("/checkout?mode=topup");
  });

  it("keeps a wallet's checkout as it was", () => {
    expect(checkoutPath(WALLET)).toBe("/checkout");
    expect(checkoutPath(undefined)).toBe("/checkout");
  });

  it("is where the popup's and the options page's buttons go", () => {
    const popup = readFileSync("src/popup/popup.ts", "utf8");
    expect(popup.match(/openTab\(checkoutPath\(session\)\)/gu)).toHaveLength(1); // Buy checks
    expect(popup).not.toContain('? "/checkout?for=key" : "/checkout"'); // a key's top-up used to make a new key
    const options = readFileSync("src/options/options.ts", "utf8");
    expect(options).toContain('el("buy").setAttribute("href", `${apiBase}${checkoutPath(session)}`)');
  });
});

describe("the popup's next step", () => {
  let data: Record<string, unknown>;
  let opened: string[];
  let fetched: string[];
  let posted: unknown[];

  async function openPopup(
    credits: number | null,
    extra: Record<string, unknown> = {},
    url = "https://shop.example/p/1",
  ): Promise<void> {
    const body = /<body>([\s\S]*)<\/body>/u.exec(readFileSync("src/popup/popup.html", "utf8"))?.[1] ?? "";
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gu, "");
    stubStorage(data);
    const chromeStub = globalThis.chrome as unknown as Record<string, unknown>;
    chromeStub.storage = {
      ...(chromeStub.storage as object),
      session: {
        get: () => Promise.resolve({}),
        set: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
    };
    chromeStub.tabs = {
      query: () => Promise.resolve([{ id: 1, url }]),
      create: (props: { url: string }) => {
        opened.push(props.url);
        return Promise.resolve({});
      },
    };
    chromeStub.runtime = {
      id: "ext-id",
      connect: () => ({
        onMessage: { addListener: () => undefined },
        postMessage: (message: unknown) => posted.push(message),
      }),
      openOptionsPage: () => Promise.resolve(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        const path = new URL(input).pathname;
        fetched.push(path);
        // A slow price list (a cold server or a fresh browser) must not hold anything up: it never answers here.
        if (path === "/v1/pricing") return new Promise<Response>(() => undefined);
        const json =
          path === "/v1/pricing"
            ? { hot_wallet: "HOT", packs: [] }
            : { checks_remaining: credits, invite_eligible: false, ...extra };
        return Promise.resolve(new Response(JSON.stringify(json), { status: 200 }));
      }),
    );
    vi.stubGlobal("close", () => undefined);
    vi.resetModules();
    await import("../src/popup/popup.js");
    await vi.waitFor(() => {
      expect(document.getElementById("hint")?.textContent).not.toBe("");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const visible = (id: string): boolean => document.getElementById(id)?.hidden === false;

  beforeEach(() => {
    data = { consent: { version: 2 } };
    opened = [];
    fetched = [];
    posted = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("signed out: one primary step, Get started, and the sign-in choices behind a link", async () => {
    await openPopup(null);
    expect(visible("get-started-row")).toBe(true);
    expect(visible("sign-in-more-row")).toBe(true);
    for (const id of ["sign-in", "sign-in-phone", "sign-in-key"]) expect(visible(id)).toBe(false);
    const enabledPrimary = [...document.querySelectorAll<HTMLButtonElement>("button.primary")].filter(
      (b) => !b.disabled && !b.closest("[hidden]"),
    );
    expect(enabledPrimary.map((b) => b.id)).toEqual(["get-started"]);

    document.getElementById("get-started")?.click();
    expect(opened).toEqual(["https://unfret.net/welcome"]);

    document.getElementById("sign-in-more")?.click();
    for (const id of ["sign-in", "sign-in-phone", "sign-in-key"]) expect(visible(id)).toBe(true);
    expect(visible("sign-in-more-row")).toBe(false);
  });

  it("after an expired sign-in: signing in again is the step", async () => {
    data.sessionExpired = true;
    await openPopup(null);
    expect(visible("get-started-row")).toBe(false);
    expect(visible("sign-in-key")).toBe(true);
  });

  it("signed in with a key and no checks: a free quick check, and Buy checks tops up that key", async () => {
    data.session = keySessionOf(KEY);
    await openPopup(0);
    await vi.waitFor(() => {
      expect(document.getElementById("analyse")?.textContent).toBe("Quick check (free)");
    });
    const analyse = document.getElementById("analyse") as HTMLButtonElement;
    expect(analyse.disabled).toBe(false);
    expect(document.getElementById("hint")?.textContent).toContain("Quick checks are free");
    expect(visible("buy")).toBe(true);
    expect(visible("get-started-row")).toBe(false);
    analyse.click();
    expect(posted).toEqual([
      { type: "watch", tabId: 1 },
      { type: "analyze", tabId: 1, tier: "quick" },
    ]);
    document.getElementById("buy")?.click();
    expect(opened).toEqual(["https://unfret.net/checkout?mode=topup&key_id=abcdefghij"]);
  });

  it("a new free pass: You have 5 free checks, and Check this page", async () => {
    data.session = keySessionOf(KEY);
    await openPopup(5, { free_checks_remaining: 5 });
    await vi.waitFor(() => {
      expect(document.getElementById("credits")?.textContent).toBe("You have 5 free checks");
    });
    const analyse = document.getElementById("analyse") as HTMLButtonElement;
    expect(analyse.textContent).toBe("Check this page");
    analyse.click();
    expect(posted.at(-1)).toEqual({ type: "analyze", tabId: 1 });
  });

  it("free checks paused for the day: back tomorrow, and a quick check meanwhile", async () => {
    data.session = keySessionOf(KEY);
    await openPopup(3, { free_checks_remaining: 3, free_checks_paused: true });
    await vi.waitFor(() => {
      expect(document.getElementById("analyse")?.textContent).toBe("Quick check (free)");
    });
    expect(document.getElementById("hint")?.textContent).toBe(
      "Free deep checks are back tomorrow. Quick checks still work.",
    );
  });

  it("bought checks still run deep checks while the free ones are paused", async () => {
    data.session = keySessionOf(KEY);
    await openPopup(8, { free_checks_remaining: 3, free_checks_paused: true });
    await vi.waitFor(() => {
      expect(document.getElementById("credits")?.textContent).toBe("8 checks left");
    });
    expect(document.getElementById("analyse")?.textContent).toBe("Check this page");
  });

  it("signed in with checks: Check this page, and Buy checks tops up the key", async () => {
    data.session = keySessionOf(KEY);
    await openPopup(5);
    await vi.waitFor(() => {
      expect(visible("buy")).toBe(true);
    });
    expect(document.getElementById("analyse")?.textContent).toBe("Check this page");
    document.getElementById("buy")?.click();
    expect(opened).toEqual(["https://unfret.net/checkout?mode=topup&key_id=abcdefghij"]);
  });

  it('shows "Buy checks" at once, without waiting for the price list (0.12.0: it came seconds late)', async () => {
    data.session = keySessionOf(KEY);
    await openPopup(5);
    await vi.waitFor(() => {
      expect(document.getElementById("credits")?.textContent).toBe("5 checks left");
    });
    expect(visible("buy")).toBe(true);
    expect(fetched).not.toContain("/v1/pricing"); // the popup doesn't ask for it at all
  });

  it("out of checks on a page that can't be checked: the quick check waits for a page that can", async () => {
    data.session = keySessionOf(KEY);
    await openPopup(0, {}, "chrome://newtab/");
    await vi.waitFor(() => {
      expect(document.getElementById("analyse")?.textContent).toBe("Quick check (free)");
    });
    expect(document.getElementById("hint")?.textContent).toBe("This page can't be checked.");
    expect((document.getElementById("analyse") as HTMLButtonElement).disabled).toBe(true);
    expect(visible("buy")).toBe(true);
  });

  it("with checks on a page that can't be checked: the hint says so", async () => {
    data.session = keySessionOf(KEY);
    await openPopup(5, {}, "chrome://newtab/");
    await vi.waitFor(() => {
      expect(document.getElementById("credits")?.textContent).toBe("5 checks left");
    });
    expect(document.getElementById("hint")?.textContent).toBe("This page can't be checked.");
    expect((document.getElementById("analyse") as HTMLButtonElement).disabled).toBe(true);
  });

  it("signed in with a wallet and no checks: Buy checks opens the checkout as before", async () => {
    data.session = WALLET;
    await openPopup(0);
    await vi.waitFor(() => {
      expect(document.getElementById("analyse")?.textContent).toBe("Quick check (free)");
    });
    document.getElementById("buy")?.click();
    expect(opened).toEqual(["https://unfret.net/checkout"]);
  });
});

describe("an affiliate's code from the welcome page", () => {
  const page = {};
  const event = (data: unknown, over: Partial<{ source: unknown; origin: string }> = {}) => ({
    source: page,
    origin: ORIGIN,
    data,
    ...over,
  });
  let data: Record<string, unknown>;
  const welcome = { id: "ext-id", frameId: 0, url: `${ORIGIN}/welcome?free=5` };

  beforeEach(() => {
    data = {};
    stubStorage(data);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("takes a well-formed code from the welcome page itself only", () => {
    expect(acceptRefMessage(event({ type: REF_MESSAGE, code: "anna" }), page, ORIGIN, ORIGIN)).toBe("ANNA");
    expect(
      acceptRefMessage(event({ type: REF_MESSAGE, code: "anna" }, { source: {} }), page, ORIGIN, ORIGIN),
    ).toBeNull();
    const evil = "https://evil.example";
    expect(
      acceptRefMessage(event({ type: REF_MESSAGE, code: "ANNA" }, { origin: evil }), page, evil, ORIGIN),
    ).toBeNull();
    for (const code of ["x", "a b c", 42, "A".repeat(25), null]) {
      expect(acceptRefMessage(event({ type: REF_MESSAGE, code }), page, ORIGIN, ORIGIN)).toBeNull();
    }
  });

  it("tells the server with the extension's own pass, from the welcome page only", async () => {
    data.session = keySessionOf(KEY);
    const calls: { url: string; auth: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>;
        calls.push({ url, auth: headers.Authorization ?? "", body: init.body as string });
        return Promise.resolve(new Response(JSON.stringify({ status: "attributed" }), { status: 200 }));
      }),
    );

    expect(await receiveRef({ code: "ANNA" }, welcome, "ext-id")).toEqual({ status: "attributed" });
    expect(calls).toEqual([
      {
        url: `${ORIGIN}/v1/affiliates/attribute`,
        auth: `Bearer ${KEY}`,
        body: JSON.stringify({ code: "ANNA" }),
      },
    ]);

    const checkout = { ...welcome, url: `${ORIGIN}/checkout` };
    expect(await receiveRef({ code: "ANNA" }, checkout, "ext-id")).toEqual({ status: "invalid" });
    expect(await receiveRef({ code: "ANNA" }, { ...welcome, frameId: 3 }, "ext-id")).toEqual({
      status: "invalid",
    });
    expect(await receiveRef({ code: "<script>" }, welcome, "ext-id")).toEqual({ status: "invalid" });
    expect(calls).toHaveLength(1);
  });

  it("never for a wallet; without a pass or offline the page keeps the code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    expect(await receiveRef({ code: "ANNA" }, welcome, "ext-id")).toEqual({ status: "no-pass" });
    data.session = WALLET;
    expect(await receiveRef({ code: "ANNA" }, welcome, "ext-id")).toEqual({ status: "not_eligible" });
    data.session = keySessionOf(KEY);
    expect(await receiveRef({ code: "ANNA" }, welcome, "ext-id")).toEqual({ status: "error" });
  });
});
