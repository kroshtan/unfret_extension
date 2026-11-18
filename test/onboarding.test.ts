/**
 * Onboarding (0.11.0): the checkout page hands a new API key to the extension, the welcome page opens once after
 * installing, and the popup offers one next step when signed out or out of checks. 0.12.0: a free pass on install,
 * free quick checks.
 */

import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { manifest } from "../scripts/manifest.mjs";
import {
  receiveFreeAsk,
  receiveKey,
  receiveRef,
  WELCOME_SETUP_URL,
  WELCOME_URL,
  welcomeOnInstall,
} from "../src/background/onboarding.js";
import {
  acceptFreeAsk,
  acceptKeyMessage,
  acceptRefMessage,
  FREE_ANSWER_MESSAGE,
  FREE_ASK_MESSAGE,
  isFreeStatus,
  isKeyHandoffStatus,
  KEY_MESSAGE,
  REF_MESSAGE,
} from "../src/content/relay.js";
import { makeFreePass } from "../src/shared/new-pass.js";
import { checkoutPath, type Session } from "../src/shared/settings.js";

const KEY = `ufk_abcdefghij_${"a".repeat(52)}`;
const OTHER_KEY = `ufk_zzzzzzzzzz_${"b".repeat(52)}`;
const FREE = `ufk_ffffffffff_${"f".repeat(52)}`;
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

/** chrome.storage.local (and .sync, .session) over plain objects; what tabs are told goes to `told`. */
function stubStorage(
  data: Record<string, unknown>,
  sync: Record<string, unknown> = {},
  session: Record<string, unknown> = {},
  told: unknown[] = [],
): void {
  vi.stubGlobal("chrome", {
    runtime: { id: "ext-id" },
    storage: { local: area(data), sync: area(sync), session: area(session) },
    tabs: {
      sendMessage: (tabId: number, message: unknown) => {
        told.push({ tabId, message });
        return Promise.resolve();
      },
    },
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
  let session: Record<string, unknown>;
  let told: unknown[];
  const ask = vi.fn(() => Promise.resolve({ windowId: 42 }));
  const checkout = {
    id: "ext-id",
    frameId: 0,
    url: `${ORIGIN}/checkout?mode=code`,
    tab: { id: 7 } as chrome.tabs.Tab,
  };

  beforeEach(() => {
    data = {};
    session = {};
    told = [];
    ask.mockClear();
    stubStorage(data, {}, session, told);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("signs in with the key when signed out (or after an expired sign-in), after a click on the page", async () => {
    data.sessionExpired = true;
    expect(await receiveKey({ key: KEY, activated: true }, checkout, "ext-id", ask)).toEqual({
      status: "signed-in",
    });
    expect(data.session).toEqual(keySessionOf(KEY));
    expect(data).not.toHaveProperty("sessionExpired");
    expect(ask).not.toHaveBeenCalled();
  });

  it("says so when it already uses that key", async () => {
    data.session = keySessionOf(KEY);
    expect(await receiveKey({ key: KEY }, checkout, "ext-id", ask)).toEqual({ status: "already" });
  });

  it.each([
    ["another key", keySessionOf(OTHER_KEY)],
    ["a wallet", WALLET],
  ])("never replaces %s on the page's word alone: it asks in its own window", async (_name, current) => {
    data.session = current;
    expect(await receiveKey({ key: KEY, activated: true }, checkout, "ext-id", ask)).toEqual({
      status: "other-account",
    });
    expect(await receiveKey({ key: KEY, replace: "yes", activated: true }, checkout, "ext-id", ask)).toEqual({
      status: "other-account",
    });
    expect(ask).not.toHaveBeenCalled();
    expect(await receiveKey({ key: KEY, replace: true, activated: true }, checkout, "ext-id", ask)).toEqual({
      status: "confirm",
    });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(data.session).toEqual(current); // never swapped by the page
  });

  it("says when it has its own free pass", async () => {
    data.session = keySessionOf(OTHER_KEY);
    data.ownPass = { keyId: "zzzzzzzzzz", recoveryCode: `ufr_zzzzzzzzzz_${"c".repeat(52)}` };
    expect(await receiveKey({ key: KEY }, checkout, "ext-id", ask)).toEqual({
      status: "other-account",
      freePass: true,
    });
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
    ["a longer path that starts the same", { ...checkout, url: `${ORIGIN}/checkout-evil` }],
    ["no address", { id: "ext-id", frameId: 0 }],
  ])("refuses a key from %s", async (_name, sender) => {
    expect(await receiveKey({ key: KEY, activated: true }, sender, "ext-id", ask)).toEqual({
      status: "invalid",
    });
    expect(data).not.toHaveProperty("session");
  });

  it.each([[undefined], [42], ["ufk_nope"], [` ${KEY}`]])("refuses a malformed key: %s", async (key) => {
    expect(await receiveKey({ key, activated: true }, checkout, "ext-id", ask)).toEqual({
      status: "invalid",
    });
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

  it("opens once, after a new install, to make the free pass there; nothing is made before", async () => {
    const open = vi.fn();
    expect(await welcomeOnInstall({ reason: "install" }, open)).toBe(true);
    expect(open).toHaveBeenCalledWith("https://unfret.net/welcome?setup=1");
    expect(WELCOME_SETUP_URL).toBe("https://unfret.net/welcome?setup=1");
    expect(WELCOME_URL).toBe("https://unfret.net/welcome");
    expect(data.passPending).toBe(true); // until the page has answered, the popup offers the free checks
    expect(data).not.toHaveProperty("session");
  });

  it("already signed in at install (a synced setting): the plain welcome page", async () => {
    data.session = keySessionOf(KEY);
    const open = vi.fn();
    expect(await welcomeOnInstall({ reason: "install" }, open)).toBe(true);
    expect(open).toHaveBeenCalledWith(WELCOME_URL);
    expect(data).not.toHaveProperty("passPending");
  });

  it.each(["update", "chrome_update", "browser_update", "shared_module_update"])(
    "not after %s",
    async (reason) => {
      const open = vi.fn();
      expect(await welcomeOnInstall({ reason }, open)).toBe(false);
      expect(open).not.toHaveBeenCalled();
      expect(data).not.toHaveProperty("passPending");
    },
  );

  it("is wired to onInstalled", () => {
    expect(readFileSync("src/background/index.ts", "utf8")).toContain("welcomeOnInstall(details);");
  });
});

describe("the content scripts", () => {
  it("cover the sign-in, checkout and welcome pages of this build's own site only", () => {
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

  let sync: Record<string, unknown>;
  /** The price list's answer (none: it never answers), and the free checks a new pass gets. */
  let pricing: unknown;
  let freeGiven: number;
  /** Hands the popup a background update, as the background's port does. */
  let deliver: (update: unknown) => void;

  async function openPopup(
    credits: number | null,
    extra: Record<string, unknown> = {},
    url = "https://shop.example/p/1",
  ): Promise<void> {
    const body = /<body>([\s\S]*)<\/body>/u.exec(readFileSync("src/popup/popup.html", "utf8"))?.[1] ?? "";
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gu, "");
    stubStorage(data, sync);
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
        onMessage: {
          addListener: (fn: (update: unknown) => void) => {
            deliver = fn;
          },
        },
        postMessage: (message: unknown) => posted.push(message),
      }),
      openOptionsPage: () => Promise.resolve(),
      // Unfret pages open through the background (which gives their tab its ticket): the page it would open.
      sendMessage: (message: { type: string; path: string }) => {
        if (message.type === "unfret-open") opened.push(`https://unfret.net${message.path}`);
        return Promise.resolve({ ok: true });
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        const path = new URL(input).pathname;
        fetched.push(path);
        // A slow price list (a cold server or a fresh browser) must not hold anything up: it never answers here.
        if (path === "/v1/pricing" && pricing === undefined) return new Promise<Response>(() => undefined);
        const json =
          path === "/v1/pricing"
            ? pricing
            : path === "/v1/keys/challenge"
              ? { challenge: "c", bits: 0 }
              : path === "/v1/keys"
                ? { key: FREE, key_id: "ffffffffff", recovery_code: "ufr_x", free_checks: freeGiven }
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
    sync = {};
    pricing = undefined;
    freeGiven = 5;
    opened = [];
    fetched = [];
    posted = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("signed out: one primary step, Get your free checks; the sign-in choices behind a link; gift codes a small link", async () => {
    await openPopup(null);
    expect(visible("get-free-row")).toBe(true);
    expect(document.getElementById("get-free")?.textContent).toBe("Get your free checks");
    expect(document.getElementById("account-status")?.textContent).toBe(
      "Get a few free checks to start: no account, no e-mail.",
    );
    expect(document.getElementById("account-status")?.textContent).not.toMatch(/with a code or by card/u);
    expect(visible("sign-in-more-row")).toBe(true);
    for (const id of ["sign-in", "sign-in-phone", "sign-in-key"]) expect(visible(id)).toBe(false);
    const enabledPrimary = [...document.querySelectorAll<HTMLButtonElement>("button.primary")].filter(
      (b) => !b.disabled && !b.closest("[hidden]"),
    );
    expect(enabledPrimary.map((b) => b.id)).toEqual(["get-free"]);
    const gift = document.getElementById("have-code");
    expect(gift?.textContent).toBe("Have a gift code from a friend?");
    expect(gift?.classList.contains("link")).toBe(true);
    gift?.click();
    expect(opened).toEqual(["https://unfret.net/checkout?mode=code"]);

    document.getElementById("sign-in-more")?.click();
    for (const id of ["sign-in", "sign-in-phone", "sign-in-key"]) expect(visible(id)).toBe(true);
    expect(visible("sign-in-more-row")).toBe(false);
  });

  it("Get your free checks opens the welcome page, which makes the free pass as installing does", async () => {
    await openPopup(null);
    document.getElementById("get-free")?.click();
    expect(opened).toEqual(["https://unfret.net/welcome?setup=1"]);
    expect(fetched).not.toContain("/v1/keys");
    expect(data).not.toHaveProperty("session");
  });

  it("an install that made no pass: Get your free checks again, nothing made behind the welcome page's back", async () => {
    data.passPending = true;
    await openPopup(null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetched).not.toContain("/v1/keys");
    expect(visible("get-free-row")).toBe(true);
  });

  it("an install that made no pass, in a profile that had its free checks: the empty pass at once", async () => {
    data.passPending = true;
    sync.freeChecksUsed = true;
    freeGiven = 0;
    await openPopup(null);
    await vi.waitFor(() => {
      expect(data.session).toEqual(keySessionOf(FREE));
    });
    const made = (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit?][]).find(
      ([u]) => new URL(u).pathname === "/v1/keys",
    );
    expect(JSON.parse(made?.[1]?.body as string)).not.toHaveProperty("free");
  });

  it("says how many free checks, from the price list", async () => {
    pricing = { hot_wallet: null, free: { checks_per_pass: 5 } };
    await openPopup(null);
    await vi.waitFor(() => {
      expect(document.getElementById("get-free")?.textContent).toBe("Get your 5 free checks");
    });
  });

  it("this browser had its free checks: it says so, and the button buys checks", async () => {
    sync.freeChecksUsed = true;
    await openPopup(null);
    expect(document.getElementById("account-status")?.textContent).toMatch(/has had its free checks/u);
    const main = document.getElementById("get-free");
    expect(main?.textContent).toBe("Buy checks");
    main?.click();
    expect(opened).toEqual(["https://unfret.net/checkout"]);
    expect(fetched).not.toContain("/v1/keys");
    expect(fetched).not.toContain("/v1/pricing");
  });

  it("after an expired sign-in: signing in again is the step", async () => {
    data.sessionExpired = true;
    await openPopup(null);
    expect(visible("get-free-row")).toBe(false);
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
    expect(visible("get-free-row")).toBe(false);
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

  /** A finished check that can be reported, as the background sends it. */
  function reportableResult(): void {
    deliver({
      type: "state",
      tabId: 1,
      state: {
        status: "done",
        findings: [],
        result: { score: 20, explanation: "Generic product.", report_token: "report-token.mac" },
        body: { url: "https://shop.example/p/1" },
      },
    });
  }
  const rewardLine = (): string | null | undefined => document.getElementById("report-reward")?.textContent;

  it("Wrong result?: the reward line says both rewards from the price list", async () => {
    data.session = keySessionOf(KEY);
    pricing = { hot_wallet: null, reports: { per_month: 15, reward_checks: 5, small_reward_checks: 1 } };
    await openPopup(5);
    reportableResult();
    await vi.waitFor(() => {
      expect(rewardLine()).toBe(
        "If Unfret was clearly wrong, you get 5 free checks; if it was somewhat off, 1 free check.",
      );
    });
    document.getElementById("report-open")?.click();
    const consent = document.querySelector("#report p")?.textContent.replace(/\s+/gu, " ") ?? "";
    expect(consent).toContain("an AI model may suggest a label, a person decides");
    expect(consent).not.toMatch(/3 free checks|far off/u);
    expect(fetched.filter((path) => path === "/v1/pricing")).toHaveLength(1);
    reportableResult(); // a later update asks no more
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetched.filter((path) => path === "/v1/pricing")).toHaveLength(1);
  });

  it("Wrong result? with an older server's price list (no reward numbers): the line without numbers", async () => {
    data.session = keySessionOf(KEY);
    pricing = { hot_wallet: null };
    await openPopup(5);
    reportableResult();
    await vi.waitFor(() => {
      expect(fetched).toContain("/v1/pricing");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rewardLine()).toBe("If the result was wrong, you may get free checks.");
  });

  it("Wrong result? while the price list doesn't answer: the line without numbers, and the report still opens", async () => {
    data.session = keySessionOf(KEY);
    await openPopup(5);
    reportableResult();
    expect(rewardLine()).toBe("If the result was wrong, you may get free checks.");
    document.getElementById("report-open")?.click();
    expect(visible("report")).toBe(true);
  });

  it("a sent report: the outcome line says free checks come if we got it wrong", async () => {
    data.session = keySessionOf(KEY);
    await openPopup(5);
    deliver({
      type: "state",
      tabId: 1,
      state: {
        status: "done",
        findings: [],
        result: { score: 20, explanation: "Generic product.", report_token: "report-token.mac" },
        body: { url: "https://shop.example/p/1" },
        report: { status: "sent", outcome: "queued" },
      },
    });
    expect(document.getElementById("report-status")?.textContent).toBe(
      "Thanks! We'll review this page. If we got it wrong, you get free checks.",
    );
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

describe("whether this browser had its free checks, from the welcome page (a reinstall without sync)", () => {
  const page = {};
  const event = (data: unknown, over: Partial<{ source: unknown; origin: string }> = {}) => ({
    source: page,
    origin: ORIGIN,
    data,
    ...over,
  });
  const welcome = { id: "ext-id", frameId: 0, url: `${ORIGIN}/welcome?setup=1` };
  let data: Record<string, unknown>;
  let sync: Record<string, unknown>;
  let created: Record<string, unknown>[];
  let freeGiven: number;

  /** The real free pass over a fake server: it gives `freeGiven` free checks when asked for them. */
  function serve(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => {
        const path = new URL(input).pathname;
        if (path === "/v1/keys") created.push(JSON.parse(init?.body as string) as Record<string, unknown>);
        const asked = created.at(-1)?.free === true;
        const json =
          path === "/v1/keys/challenge"
            ? { challenge: "c", bits: 0 }
            : { key: FREE, key_id: "ffffffffff", recovery_code: "ufr_x", free_checks: asked ? freeGiven : 0 };
        return Promise.resolve(new Response(JSON.stringify(json), { status: 200 }));
      }),
    );
  }

  beforeEach(() => {
    data = { passPending: true };
    sync = {};
    created = [];
    freeGiven = 5;
    stubStorage(data, sync);
    serve();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("takes a yes or no from the welcome page itself only", () => {
    expect(acceptFreeAsk(event({ type: FREE_ASK_MESSAGE, had: false }), page, ORIGIN, ORIGIN)).toBe(false);
    expect(acceptFreeAsk(event({ type: FREE_ASK_MESSAGE, had: true }), page, ORIGIN, ORIGIN)).toBe(true);
    expect(
      acceptFreeAsk(event({ type: FREE_ASK_MESSAGE, had: true }, { source: {} }), page, ORIGIN, ORIGIN),
    ).toBeNull();
    const evil = "https://evil.example";
    expect(
      acceptFreeAsk(event({ type: FREE_ASK_MESSAGE, had: false }, { origin: evil }), page, evil, ORIGIN),
    ).toBeNull();
    for (const had of ["false", 0, null, undefined, { id: "x" }]) {
      expect(acceptFreeAsk(event({ type: FREE_ASK_MESSAGE, had }), page, ORIGIN, ORIGIN)).toBeNull();
    }
    expect(acceptFreeAsk(event({ type: REF_MESSAGE, had: false }), page, ORIGIN, ORIGIN)).toBeNull();
    expect(FREE_ANSWER_MESSAGE).toBe("unfret-free-answer");
    expect(["free", "had-free", "none-today", "has-pass", "error", "invalid"].every(isFreeStatus)).toBe(true);
  });

  it("a first install: the pass with its free checks, and the page hears how many", async () => {
    expect(await receiveFreeAsk({ had: false }, welcome, "ext-id")).toEqual({ status: "free", free: 5 });
    expect(created).toEqual([expect.objectContaining({ free: true })]);
    expect(data.session).toEqual(keySessionOf(FREE));
    expect(data).not.toHaveProperty("passPending");
    expect(sync).toEqual({ freeChecksUsed: true });
  });

  it("a reinstall without sync: the website's note says this browser had them, so no free checks", async () => {
    expect(await receiveFreeAsk({ had: true }, welcome, "ext-id")).toEqual({ status: "had-free" });
    expect(created).toHaveLength(1);
    expect(created[0]).not.toHaveProperty("free");
    expect(data.session).toEqual(keySessionOf(FREE));
    expect(sync).toEqual({ freeChecksUsed: true }); // the popup says so from now on
  });

  it("a reinstall with sync (or the website's note cleared): the extension's own note is enough", async () => {
    sync.freeChecksUsed = true;
    expect(await receiveFreeAsk({ had: false }, welcome, "ext-id")).toEqual({ status: "had-free" });
    expect(created[0]).not.toHaveProperty("free");
  });

  it("asked, but the server had none to give: none-today", async () => {
    freeGiven = 0;
    expect(await receiveFreeAsk({ had: false }, welcome, "ext-id")).toEqual({ status: "none-today" });
    expect(created[0]).toMatchObject({ free: true });
  });

  it("makes one pass however often and from however many pages it is asked, and none with a pass already", async () => {
    const answers = await Promise.all([
      receiveFreeAsk({ had: false }, welcome, "ext-id"),
      receiveFreeAsk({ had: false }, { ...welcome, tab: { id: 9 } as chrome.tabs.Tab }, "ext-id"),
    ]);
    expect(answers).toEqual([
      { status: "free", free: 5 },
      { status: "free", free: 5 },
    ]);
    expect(await receiveFreeAsk({ had: false }, welcome, "ext-id")).toEqual({ status: "has-pass" });
    data.session = WALLET;
    expect(await receiveFreeAsk({ had: false }, welcome, "ext-id")).toEqual({ status: "has-pass" });
    expect(created).toHaveLength(1);
  });

  it("only from the welcome page of the configured site, top frame; offline: error, and nothing kept", async () => {
    for (const sender of [
      { ...welcome, url: `${ORIGIN}/checkout` },
      { ...welcome, url: `${ORIGIN}/welcomeX` },
      { ...welcome, url: "https://evil.example/welcome" },
      { ...welcome, frameId: 2 },
      { ...welcome, id: "other-extension" },
    ]) {
      expect(await receiveFreeAsk({ had: false }, sender, "ext-id")).toEqual({ status: "invalid" });
    }
    expect(await receiveFreeAsk({ had: "no" }, welcome, "ext-id")).toEqual({ status: "invalid" });
    expect(created).toEqual([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );
    expect(await receiveFreeAsk({ had: false }, welcome, "ext-id")).toEqual({ status: "error" });
    expect(data).not.toHaveProperty("session");
    expect(data.passPending).toBe(true);
  });

  it("is wired to the background, and the welcome page's content script relays it", () => {
    expect(readFileSync("src/background/index.ts", "utf8")).toContain(
      "receiveFreeAsk(m, sender, chrome.runtime.id)",
    );
    const relay = readFileSync("src/content/ref-relay.ts", "utf8");
    expect(relay).toContain("acceptFreeAsk(event, window, location.origin, apiBase)");
    expect(relay).toContain(
      "window.postMessage({ type: FREE_ANSWER_MESSAGE, status, free }, location.origin);",
    );
    expect(makeFreePass.length).toBe(1); // apiBase; the client and the website's answer are optional
  });
});
