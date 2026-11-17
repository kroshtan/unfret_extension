/**
 * Onboarding (0.11.0): the checkout page hands a new API key to the extension, the welcome page opens once after
 * installing, and the popup offers one next step when signed out or out of checks.
 */

import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { manifest } from "../scripts/manifest.mjs";
import { receiveKey, WELCOME_URL, welcomeOnInstall } from "../src/background/onboarding.js";
import { acceptKeyMessage, isKeyHandoffStatus, KEY_MESSAGE } from "../src/content/relay.js";
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

/** chrome.storage.local over a plain object. */
function stubStorage(data: Record<string, unknown>): void {
  vi.stubGlobal("chrome", {
    runtime: { id: "ext-id" },
    storage: {
      local: {
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

  it("answers the page with a status only", () => {
    const relay = readFileSync("src/content/key-relay.ts", "utf8");
    expect(relay).toContain("window.postMessage({ type: KEY_RECEIVED_MESSAGE, status }, location.origin)");
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
    expect(await receiveKey({ key: KEY }, checkout, "ext-id")).toBe("signed-in");
    expect(data.session).toEqual(keySessionOf(KEY));
    expect(data).not.toHaveProperty("sessionExpired");
  });

  it("says so when it already uses that key", async () => {
    data.session = keySessionOf(KEY);
    expect(await receiveKey({ key: KEY }, checkout, "ext-id")).toBe("already");
  });

  it.each([
    ["another key", keySessionOf(OTHER_KEY)],
    ["a wallet", WALLET],
  ])("asks before replacing %s, and replaces only once the user agreed", async (_name, current) => {
    data.session = current;
    expect(await receiveKey({ key: KEY }, checkout, "ext-id")).toBe("other-account");
    expect(data.session).toEqual(current); // never swapped silently
    expect(await receiveKey({ key: KEY, replace: "yes" }, checkout, "ext-id")).toBe("other-account");
    expect(await receiveKey({ key: KEY, replace: true }, checkout, "ext-id")).toBe("signed-in");
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
    expect(await receiveKey({ key: KEY }, sender, "ext-id")).toBe("invalid");
    expect(data).not.toHaveProperty("session");
  });

  it.each([[undefined], [42], ["ufk_nope"], [` ${KEY}`]])("refuses a malformed key: %s", async (key) => {
    expect(await receiveKey({ key }, checkout, "ext-id")).toBe("invalid");
    expect(data).not.toHaveProperty("session");
  });
});

describe("the welcome page", () => {
  it("opens once, after a new install", () => {
    const open = vi.fn();
    expect(welcomeOnInstall({ reason: "install" }, open)).toBe(true);
    expect(open).toHaveBeenCalledWith("https://unfret.net/welcome");
    expect(WELCOME_URL).toBe("https://unfret.net/welcome");
  });

  it.each(["update", "chrome_update", "browser_update", "shared_module_update"])("not after %s", (reason) => {
    const open = vi.fn();
    expect(welcomeOnInstall({ reason }, open)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

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
    expect(popup.match(/openTab\(checkoutPath\(session\)\)/gu)).toHaveLength(2); // Buy checks, Get more checks
    expect(popup).not.toContain('? "/checkout?for=key" : "/checkout"'); // a key's top-up used to make a new key
    const options = readFileSync("src/options/options.ts", "utf8");
    expect(options).toContain('el("buy").setAttribute("href", `${apiBase}${checkoutPath(session)}`)');
  });
});

describe("the popup's next step", () => {
  let data: Record<string, unknown>;
  let opened: string[];
  let fetched: string[];

  async function openPopup(credits: number | null, url = "https://shop.example/p/1"): Promise<void> {
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
      connect: () => ({ onMessage: { addListener: () => undefined }, postMessage: () => undefined }),
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
            : { checks_remaining: credits, invite_eligible: false };
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

  it("signed in with a key and no checks: Get more checks opens that key's top-up", async () => {
    data.session = keySessionOf(KEY);
    await openPopup(0);
    await vi.waitFor(() => {
      expect(document.getElementById("analyse")?.textContent).toBe("Get more checks");
    });
    const analyse = document.getElementById("analyse") as HTMLButtonElement;
    expect(analyse.disabled).toBe(false);
    expect(visible("buy")).toBe(false); // one way, not two
    expect(visible("get-started-row")).toBe(false);
    analyse.click();
    expect(opened).toEqual(["https://unfret.net/checkout?mode=topup&key_id=abcdefghij"]);
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

  it("out of checks on a page that can't be checked: the hint says what the button does", async () => {
    data.session = keySessionOf(KEY);
    await openPopup(0, "chrome://newtab/");
    await vi.waitFor(() => {
      expect(document.getElementById("analyse")?.textContent).toBe("Get more checks");
    });
    expect(document.getElementById("hint")?.textContent).toBe("You have no checks left.");
    expect((document.getElementById("analyse") as HTMLButtonElement).disabled).toBe(false);
  });

  it("with checks on a page that can't be checked: the hint says so", async () => {
    data.session = keySessionOf(KEY);
    await openPopup(5, "chrome://newtab/");
    await vi.waitFor(() => {
      expect(document.getElementById("credits")?.textContent).toBe("5 checks left");
    });
    expect(document.getElementById("hint")?.textContent).toBe("This page can't be checked.");
    expect((document.getElementById("analyse") as HTMLButtonElement).disabled).toBe(true);
  });

  it("signed in with a wallet and no checks: the checkout as before", async () => {
    data.session = WALLET;
    await openPopup(0);
    await vi.waitFor(() => {
      expect(document.getElementById("analyse")?.textContent).toBe("Get more checks");
    });
    document.getElementById("analyse")?.click();
    expect(opened).toEqual(["https://unfret.net/checkout"]);
  });
});
