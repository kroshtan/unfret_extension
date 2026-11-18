/**
 * Smoke test of the built Chrome extension (dist/chrome) in headless Chromium, against the local mock API.
 *
 * The shipped build holds no standing access to any shop: it can't read the Amazon page on its own, while the
 * browser applies its declarativeContent icon hint there; the session relay works on the sign-in page. Reading a
 * page needs activeTab, which Chromium grants when the user clicks the toolbar button. A headless browser can't
 * click the toolbar, so a second, test-only copy of the build is granted that one site, the access a click gives,
 * to check extraction (compared with the backend's output for the same page) and a full analysis.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type BrowserContext, chromium, type Page, type Worker } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Extraction } from "../../src/extract/index.js";
import type { TabState } from "../../src/shared/messages.js";
import {
  FREE_PASS,
  FREE_PASS_BACKUP,
  INVITE_OK,
  INVITE_USED_CODE,
  type MockApi,
  SHARE_DELETE_CODE,
  SHARE_ID,
  startMockApi,
} from "../mock-server.js";

const root = join(import.meta.dirname, "..", "..");
const shipped = join(root, "dist", "chrome");
const fixture = (name: string): string => readFileSync(join(root, "test", "fixtures", name), "utf8");
const AMAZON_URL = "https://www.amazon.com/dp/B0WATCH123";
const ADDRESS = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

// The connect page signs in with a wallet: it hands the session to the extension by itself once (as a page could
// without the user), and again on a click of #send. Its title is the extension's last answer.
const CONNECT_PAGE = `<!doctype html><title>connect</title><button id="send">Send</button><script>
  const say = (status) => { document.title = status; console.log("unfret-status:" + status); };
  const session = { type: "veridex-session", token: "good-token-${"x".repeat(20)}",
    address: "${ADDRESS}", expires_at: "2999-01-01T00:00:00Z" };
  addEventListener("message", (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.type === "veridex-session-received") say("received");
    if (e.data.type === "unfret-session-status") say(e.data.status);
  });
  const send = () => window.postMessage(session, location.origin);
  document.getElementById("send").addEventListener("click", send);
  setTimeout(send, 300);
</script>`;

// The checkout page shows a new key: it offers it to the extension by itself on loading, again on a click of #send,
// and with replace on a click of #replace (the user agreed on the page). Its title is the extension's last answer.
const NEW_KEY = `ufk_abcdefghij_${"k".repeat(52)}`;
const CHECKOUT_PAGE = `<!doctype html><title>checkout</title>
<button id="send">Send</button><button id="replace">Replace</button><script>
  const say = (status) => { document.title = status; console.log("unfret-status:" + status); };
  addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.type === "unfret-key-received") say(e.data.status);
  });
  const offer = (replace) => window.postMessage(
    replace ? { type: "unfret-key", key: "${NEW_KEY}", replace: true } : { type: "unfret-key", key: "${NEW_KEY}" },
    location.origin);
  document.getElementById("send").addEventListener("click", () => offer(false));
  document.getElementById("replace").addEventListener("click", () => offer(true));
  setTimeout(() => offer(false), 300);
</script>`;

// Another site, as an attacker would use it: a click there opens an Unfret page in a window of its own.
const EVIL_PAGE = `<!doctype html><title>evil</title><button id="go">Go</button><script>
  document.getElementById("go").addEventListener("click", () => window.open(new URLSearchParams(location.search).get("to")));
</script>`;

/** Open `url` the way another site can: from a click on its own page, with `window.open`. */
async function openedByAnotherSite(
  context: BrowserContext,
  url: string,
): Promise<{ page: Page; evil: Page }> {
  const evil = await context.newPage();
  await evil.goto(`https://evil.example/?to=${encodeURIComponent(url)}`);
  const opening = context.waitForEvent("page", { predicate: (p) => p.url().startsWith(url) });
  await evil.click("#go");
  return { page: await opening, evil };
}

/** What each test page heard from the extension, in order, from its console (see `answered`). */
const heard = new WeakMap<Page, string[]>();

/**
 * Wait until the extension's last answer to `page` is `status`. Read from the page's console, never by evaluating in
 * the page: Playwright evaluates with a user gesture, which would give the page the very user activation these tests
 * are about.
 */
async function answered(page: Page, status: string): Promise<void> {
  await expect.poll(() => heard.get(page)?.at(-1), { timeout: 10_000, interval: 100 }).toBe(status);
}

const temp: string[] = [];

async function launch(
  extension: string,
  language = "en-US",
  phone = false,
  profile?: string,
): Promise<{ context: BrowserContext; worker: Worker; userData: string }> {
  const userData = profile ?? mkdtempSync(join(tmpdir(), "unfret-smoke-"));
  if (!profile) temp.push(userData);
  const context = await chromium.launchPersistentContext(userData, {
    channel: "chromium",
    headless: true,
    locale: language,
    // Firefox for Android shows the popup as a page as wide as the phone: a small one, with touch.
    ...(phone
      ? { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : {}),
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      `--lang=${language}`,
      // The production build makes its free pass on install, before any route below exists: unfret.net must never
      // be reached from a test. Pages on it are still served by the routes (they never touch the network).
      "--host-resolver-rules=MAP unfret.net ~NOTFOUND, MAP *.unfret.net ~NOTFOUND",
    ],
  });
  await context.route("https://www.amazon.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: fixture("amazon-com.html") }),
  );
  await context.route("https://unfret.net/connect**", (route) =>
    route.fulfill({ contentType: "text/html", body: CONNECT_PAGE }),
  );
  await context.route("https://unfret.net/checkout**", (route) =>
    route.fulfill({ contentType: "text/html", body: CHECKOUT_PAGE }),
  );
  await context.route("https://evil.example/**", (route) =>
    route.fulfill({ contentType: "text/html", body: EVIL_PAGE }),
  );
  await context.route("https://unfret.net/welcome**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>welcome</title>" }),
  );
  context.on("page", (page) => {
    const statuses: string[] = [];
    heard.set(page, statuses);
    page.on("console", (message) => {
      const text = message.text();
      if (text.startsWith("unfret-status:")) statuses.push(text.slice("unfret-status:".length));
    });
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  // On install the extension opens the welcome page, which makes its free pass (a page that doesn't answer here, except
  // for a copy on the mock API): wait for it, so later tabs are newer.
  const welcomed = (): boolean => context.pages().some((p) => new URL(p.url()).pathname === "/welcome");
  for (let waited = 0; !welcomed() && waited < 30_000; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { context, worker, userData };
}

/**
 * A copy of the build granted the Amazon site: the access a toolbar click (activeTab) gives for that tab. With
 * `apiBase`, the copy talks to that API instead of unfret.net from the start (its built-in default replaced), so what it
 * does on install reaches the mock API.
 */
function grantedCopy(apiBase?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "unfret-granted-"));
  temp.push(dir);
  cpSync(shipped, dir, { recursive: true });
  if (apiBase) {
    for (const file of ["background.js", "popup/popup.js", "options/options.js", "ref-relay.js"]) {
      const path = join(dir, file);
      writeFileSync(
        path,
        readFileSync(path, "utf8").replaceAll('"https://unfret.net"', JSON.stringify(apiBase)),
      );
    }
  }
  const manifestPath = join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  // With `apiBase`, the welcome page's content script runs there too (a match pattern has no port).
  const scripts = (manifest.content_scripts ?? []) as { matches: string[]; js: string[] }[];
  const hosted = apiBase ? `${new URL(apiBase).protocol}//${new URL(apiBase).hostname}` : "";
  writeFileSync(
    manifestPath,
    JSON.stringify({
      ...manifest,
      host_permissions: ["https://www.amazon.com/*"],
      content_scripts: scripts.map((script) =>
        apiBase && script.js.includes("ref-relay.js")
          ? { ...script, matches: [`${hosted}/welcome*`] }
          : script,
      ),
    }),
  );
  return dir;
}

/** The most recently opened tab (the extension can't see tab URLs without host access, so not by URL). */
async function newestTabId(worker: Worker): Promise<number> {
  return worker.evaluate(async () => {
    const ids = (await chrome.tabs.query({})).map((t) => t.id ?? -1);
    return Math.max(...ids);
  });
}

let api: MockApi;
let plain: { context: BrowserContext; worker: Worker };
let granted: { context: BrowserContext; worker: Worker };
/** The Amazon tab analysed in the English run (later tests open popup pages, so not the newest tab). */
let analysedTab = -1;

beforeAll(async () => {
  api = await startMockApi();
  plain = await launch(shipped);
  granted = await launch(grantedCopy());
}, 180_000);

afterAll(async () => {
  await plain.context.close();
  await granted.context.close();
  await api.close();
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});

describe("the shipped extension (no host permissions)", () => {
  it("declares no host permissions", () => {
    const manifest = JSON.parse(readFileSync(join(shipped, "manifest.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest.permissions).toEqual(["activeTab", "storage", "scripting", "declarativeContent"]);
  });

  it("takes no first sign-in a page hands over by itself, only after a click there", async () => {
    const { page, evil } = await openedByAnotherSite(plain.context, "https://unfret.net/connect");
    await answered(page, "needs-click");
    let stored = await plain.worker.evaluate(() => chrome.storage.local.get("session"));
    expect(stored.session).toBeUndefined();

    await page.click("#send");
    await answered(page, "received");
    stored = await plain.worker.evaluate(() => chrome.storage.local.get("session"));
    expect(stored.session).toMatchObject({ address: ADDRESS });
    await page.close();
    await evil.close();
  });

  it("opened the welcome page once, on install", () => {
    const welcome = plain.context.pages().filter((p) => p.url() === "https://unfret.net/welcome?setup=1");
    expect(welcome).toHaveLength(1);
  });

  it("replaces the wallet with a new pass only on a yes in its own window", async () => {
    // Signed in with the wallet from the connect page above.
    const page = await plain.context.newPage();
    await page.goto("https://unfret.net/checkout?mode=code");
    await answered(page, "other-account");

    // The user agrees on the page: the extension asks in a window of its own, naming both accounts.
    let asking = plain.context.waitForEvent("page", {
      predicate: (p) => p.url().includes("/confirm/confirm.html"),
    });
    await page.click("#replace");
    let ask = await asking;
    await answered(page, "confirm");
    await ask.waitForSelector("#ask:not([hidden])");
    expect(await ask.textContent("#ask-current")).toBe("wallet 9xQe…VFin");
    expect(await ask.textContent("#ask-offered")).toBe("pass ABCDE-FGHIJ");
    let stored = await plain.worker.evaluate(() => chrome.storage.local.get("session"));
    expect(stored.session).toMatchObject({ address: ADDRESS }); // nothing changed yet

    // No: nothing changes, and the page hears so.
    await ask.click("#keep");
    await answered(page, "kept");
    stored = await plain.worker.evaluate(() => chrome.storage.local.get("session"));
    expect(stored.session).toMatchObject({ address: ADDRESS });
    await ask.close().catch(() => undefined);

    // Asked again, yes: the pass is used, and the page hears so.
    asking = plain.context.waitForEvent("page", {
      predicate: (p) => p.url().includes("/confirm/confirm.html"),
    });
    await page.click("#replace");
    ask = await asking;
    await ask.waitForSelector("#ask:not([hidden])");
    await ask.click("#use");
    await answered(page, "signed-in");
    stored = await plain.worker.evaluate(() => chrome.storage.local.get("session"));
    expect(stored.session).toEqual({
      token: NEW_KEY,
      address: "key:abcdefghij",
      expiresAt: "9999-12-31T00:00:00.000Z",
      kind: "key",
    });

    await page.reload();
    await answered(page, "already");
    await page.close();
  });

  it("a first pass: refused when the page hands it over by itself, taken after a click (redeeming a code)", async () => {
    const { session } = await plain.worker.evaluate(() => chrome.storage.local.get("session"));
    await plain.worker.evaluate(() => chrome.storage.local.remove("session"));
    const asking = plain.context.pages().filter((p) => p.url().includes("/confirm/")).length;
    const { page, evil } = await openedByAnotherSite(plain.context, "https://unfret.net/checkout?mode=code");
    await answered(page, "needs-click");
    let stored = await plain.worker.evaluate(() => chrome.storage.local.get("session"));
    expect(stored.session).toBeUndefined();
    expect(plain.context.pages().filter((p) => p.url().includes("/confirm/"))).toHaveLength(asking); // no window either

    await page.click("#send");
    await answered(page, "signed-in");
    stored = await plain.worker.evaluate(() => chrome.storage.local.get("session"));
    expect(stored.session).toMatchObject({ token: NEW_KEY });
    await page.close();
    await evil.close();
    await plain.worker.evaluate((s) => chrome.storage.local.set({ session: s }), session);
  });

  it("a first pass from a checkout tab the extension opened needs no click (buying after the popup)", async () => {
    const extensionId = new URL(plain.worker.url()).host;
    await plain.worker.evaluate(() => chrome.storage.local.remove("session"));
    await plain.worker.evaluate(() => chrome.storage.local.set({ consent: { version: 2 } }));
    const popup = await plain.context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForSelector("#have-code", { state: "visible" });
    // The next new tab: the extension creates it first, then loads the checkout in it.
    const opening = plain.context.waitForEvent("page");
    await popup.click("#have-code");
    const page = await opening;
    await page.waitForURL("https://unfret.net/checkout?mode=code");
    // The page hands the pass over on loading (a card payment's return): the tab's ticket lets it in.
    await answered(page, "signed-in");
    const stored = await plain.worker.evaluate(() => chrome.storage.local.get("session"));
    expect(stored.session).toMatchObject({ token: NEW_KEY });
    await page.close();
    await popup.close().catch(() => undefined);
  });

  it("registers the marketplace icon hint, matching the product page's URL", async () => {
    const rules = await plain.worker.evaluate(
      () =>
        new Promise<chrome.events.Rule[]>((resolve) => {
          const poll = (): void => {
            chrome.declarativeContent.onPageChanged.getRules((r) => {
              if (r.length > 0) resolve(r);
              else setTimeout(poll, 200);
            });
          };
          poll();
        }),
    );
    expect(rules).toHaveLength(1);
    const patterns = JSON.stringify(rules[0]?.conditions).match(/"urlMatches":"([^"]+)"/gu) ?? [];
    expect(patterns).toHaveLength(3); // Amazon, bol.com, Walmart
    expect(JSON.stringify(rules[0]?.actions)).toContain("SetIcon");
    const amazon = JSON.parse(`{${patterns[0] ?? ""}}`) as { urlMatches: string };
    expect(new RegExp(amazon.urlMatches, "u").test(AMAZON_URL)).toBe(true);
    const walmart = JSON.parse(`{${patterns[2] ?? ""}}`) as { urlMatches: string };
    expect(new RegExp(walmart.urlMatches, "u").test("https://www.walmart.com/ip/Lamp/11381374703")).toBe(
      true,
    );
  });

  it("can't read a shop page on its own", async () => {
    const page = await plain.context.newPage();
    await page.goto(AMAZON_URL);
    const tabId = await newestTabId(plain.worker);
    const outcome = await plain.worker.evaluate(async (id) => {
      try {
        await chrome.scripting.executeScript({ target: { tabId: id }, func: () => document.title });
        return "read";
      } catch (error) {
        return String(error);
      }
    }, tabId);
    expect(outcome).not.toBe("read");
    expect(outcome).toMatch(/permission|Cannot access/iu);
    expect(await plain.worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)).toBe("");
  });
});

describe("with the access a click grants (activeTab)", () => {
  it("extracts the same facts as the backend, without the user's personal text", async () => {
    const page = await granted.context.newPage();
    await page.goto(AMAZON_URL);
    const tabId = await newestTabId(granted.worker);
    const extraction = await granted.worker.evaluate(async (id) => {
      await chrome.scripting.executeScript({ target: { tabId: id }, files: ["extract.js"] });
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: () => window.__unfretExtract?.(),
      });
      return result?.result;
    }, tabId);
    const { facts, text } = extraction as Extraction;

    expect(facts).toEqual(JSON.parse(fixture("amazon-com.expected.json")));
    expect(text).toContain("NOVAXEL Smart Watch");
    expect(text).not.toMatch(/Jane|Deliver to/u);
  });

  it("opens on the consent screen, with Analyse disabled until I agree", async () => {
    const extensionId = new URL(granted.worker.url()).host;
    const popup = await granted.context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForSelector("#consent:not([hidden])");
    const before = await popup.evaluate(() => ({
      disabled: (document.querySelector("#analyse") as HTMLButtonElement).disabled,
      text: document.querySelector("#consent")?.textContent ?? "",
    }));
    expect(before.disabled).toBe(true);
    expect(before.text).toContain("unfret.net");
    await popup.click("#consent-agree");
    await popup.waitForSelector("#consent", { state: "hidden" });
    const stored = await granted.worker.evaluate(() => chrome.storage.local.get("consent"));
    expect(stored.consent).toEqual({ version: 2 });
    await popup.close();
  });

  it("runs a full analysis through the background against the API", async () => {
    await granted.worker.evaluate(
      ({ base, address }) =>
        chrome.storage.local.set({
          apiBase: base,
          session: { token: `good-token-${"x".repeat(20)}`, address, expiresAt: "2999-01-01T00:00:00.000Z" },
          consent: { version: 2 },
        }),
      { base: api.url, address: ADDRESS },
    );
    const tabId = await newestTabId(granted.worker);
    analysedTab = tabId;
    const extensionId = new URL(granted.worker.url()).host;
    const popup = await granted.context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const state = await popup.evaluate(
      (id) =>
        new Promise<TabState>((resolve) => {
          const port = chrome.runtime.connect({ name: "unfret-analysis" });
          port.onMessage.addListener((update: { tabId: number; state: TabState }) => {
            if (update.tabId === id && ["done", "error"].includes(update.state.status)) resolve(update.state);
          });
          port.postMessage({ type: "analyze", tabId: id });
        }),
      tabId,
    );

    expect(state.status === "error" ? state.message : state.status).toBe("done");
    if (state.status === "done") {
      expect(state.result.score).toBe(18);
      expect(state.findings.map((f) => f.skill)).toEqual(["listing", "reviews"]);
    }
    const request = api.requests.find((r) => r.path === "/v1/analyze/stream");
    const body = request?.body as { page_facts: { title: string }; page_content: string };
    expect(request?.auth).toBe("Bearer good-token-xxxxxxxxxxxxxxxxxxxx");
    expect(body.page_facts.title).toMatch(/^NOVAXEL Smart Watch/u);
    expect(body.page_content).not.toMatch(/Jane/u);
    // Score 18: the verdict symbol, not the number (0.7.2).
    expect(await granted.worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)).toBe("✕");
  });

  it("sends the page's address without its fragment or what is about the visitor (audit L8)", async () => {
    const page = await granted.context.newPage();
    await page.goto(
      `${AMAZON_URL}?th=1&utm_source=newsletter&email=me%40mail.example&ref_=nav#customerReviews`,
    );
    const tabId = await newestTabId(granted.worker);
    const extensionId = new URL(granted.worker.url()).host;
    const popup = await granted.context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    const state = await popup.evaluate(
      (id) =>
        new Promise<TabState>((resolve) => {
          const port = chrome.runtime.connect({ name: "unfret-analysis" });
          port.onMessage.addListener((update: { tabId: number; state: TabState }) => {
            if (update.tabId === id && ["done", "error"].includes(update.state.status)) resolve(update.state);
          });
          port.postMessage({ type: "analyze", tabId: id });
        }),
      tabId,
    );
    expect(state.status).toBe("done");
    const body = api.requests.filter((r) => r.path === "/v1/analyze/stream").at(-1)?.body as {
      url: string;
      page_facts: { url: string; policy_links: Record<string, string> };
    };
    expect(body.url).toBe(`${AMAZON_URL}?th=1`);
    expect(body.page_facts.url).toBe(`${AMAZON_URL}?th=1`);
    expect(JSON.stringify(body)).not.toMatch(/newsletter|mail\.example|customerReviews/u);
    await popup.close();
    await page.close();
  });

  it('shows one next step: signed in, no "Get your free checks"; signed out, that alone', async () => {
    const extensionId = new URL(granted.worker.url()).host;
    const popup = await granted.context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForSelector("#sign-out", { state: "visible" });
    expect(await popup.isVisible("#get-free")).toBe(false);
    expect(await popup.isVisible("#sign-in-key")).toBe(false);
    await popup.close();

    const { session } = await granted.worker.evaluate(() => chrome.storage.local.get("session"));
    await granted.worker.evaluate(() => chrome.storage.local.remove("session"));
    const signedOut = await granted.context.newPage();
    await signedOut.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await signedOut.waitForSelector("#get-free", { state: "visible" });
    expect(await signedOut.isVisible("#sign-out")).toBe(false);
    expect(await signedOut.isVisible("#sign-in-key")).toBe(false);
    await signedOut.close();
    await granted.worker.evaluate((s) => chrome.storage.local.set({ session: s }), session);
  });

  it("keeps the result when the service worker sleeps, and shows it as a shopper reads it (English)", async () => {
    const tabId = analysedTab;
    const stored = await granted.worker.evaluate(
      async (id) => (await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`] as TabState | undefined,
      tabId,
    );
    expect(stored?.status).toBe("done"); // survives the worker stopping (session storage: memory only)
    expect(stored?.status === "done" && stored.steps).toContain("listing");
    expect(api.requests.find((r) => r.path === "/v1/analyze/stream")?.language).toBe("en");

    const view = await renderedPopup(granted, tabId);
    expect(view.label).toBe("Serious concerns");
    expect(view.headings).toEqual(["What we noticed", "What you can do", "What we checked · 12 checks"]);
    expect(view.reasons).toEqual(["Suspicious number of reviews"]);
    expect(view.text).toContain("Source: The reviews on the page");
    expect(view.text).not.toMatch(/listing\.|=\s*\d/u);
  });
});

describe("reports and API keys", () => {
  it("reports a wrong result with the analysed request, only after choosing a reason", async () => {
    const extensionId = new URL(granted.worker.url()).host;
    const page = await granted.context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${analysedTab}`);
    await page.click("#report-open");
    expect(await page.isDisabled("#report-send")).toBe(true); // a reason first
    expect(await page.textContent("#report")).toMatch(
      /this one check's product facts, page text and result/u,
    );
    // The mock's price list has no reward numbers, as an older server's: the line without numbers.
    expect(await page.textContent("#report-reward")).toBe(
      "If the result was wrong, you may get free checks.",
    );
    await page.check('#report input[value="real_brand"]');
    await page.click("#report-send");
    await page.waitForFunction(() =>
      document.querySelector("#report-status")?.textContent.startsWith("Thanks"),
    );

    const sent = api.requests.find((r) => r.path === "/v1/reports");
    const analysed = api.requests.find((r) => r.path === "/v1/analyze/stream");
    expect(sent?.auth).toBe("Bearer good-token-xxxxxxxxxxxxxxxxxxxx");
    expect(sent?.body).toMatchObject({
      report_token: "report-token.mac",
      reason: "real_brand",
      consent: true,
      request: analysed?.body as object,
      explanation: "Generic product, inflated discount, implausibly fast reviews.",
    });
    expect(await page.isVisible("#report-open")).toBe(false); // one report per check
    await page.close();
  });

  it("uses a pasted API key instead of a wallet", async () => {
    const extensionId = new URL(granted.worker.url()).host;
    const page = await granted.context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);
    await page.fill("#api-key", "not a key");
    await page.click("#key-use");
    await page.waitForFunction(() => document.querySelector("#key-status")?.textContent !== "");
    expect(await page.textContent("#key-status")).toMatch(/doesn't look like an Unfret pass/u);

    const key = `ufk_abcdefghij_${"a".repeat(52)}`;
    await page.fill("#api-key", key);
    await page.click("#key-use");
    await page.waitForFunction(() => document.querySelector("#key-status")?.textContent.startsWith("Saved"));
    expect(await page.textContent("#account-status")).toBe("Using Unfret pass ABCDE-FGHIJ.");
    expect(await page.inputValue("#api-key")).toBe(""); // not left on screen
    expect(api.requests.at(-1)).toMatchObject({ path: "/v1/credits", auth: `Bearer ${key}` });
    const stored = await granted.worker.evaluate(
      async () => (await chrome.storage.local.get("session")).session,
    );
    expect(stored).toMatchObject({ token: key, address: "key:abcdefghij", kind: "key" });
    await page.close();
  });
});

/** Open the popup as a page for `tabId` and read what a shopper sees. */
async function renderedPopup(
  browser: { context: BrowserContext; worker: Worker },
  tabId: number,
): Promise<{
  lang: string;
  label: string;
  headings: string[];
  reasons: string[];
  text: string;
  analyse: string;
}> {
  const extensionId = new URL(browser.worker.url()).host;
  const page = await browser.context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${tabId}`);
  await page.waitForSelector("#result-body .verdict .label");
  const view = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    label: document.querySelector("#result-body .verdict .label")?.textContent ?? "",
    headings: [...document.querySelectorAll("#result-body h2")].map((h) => h.textContent),
    reasons: [...document.querySelectorAll("#result-body .reasons strong")].map((s) => s.textContent),
    text: document.querySelector("#result-body")?.textContent ?? "",
    analyse: document.querySelector("#analyse")?.textContent ?? "",
  }));
  await page.close();
  return view;
}

describe("sharing a result and redeeming an invite, in the popup", () => {
  it("previews, then shares the result without the sign-in, and shows the link and delete code", async () => {
    const extensionId = new URL(granted.worker.url()).host;
    const page = await granted.context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${analysedTab}`);
    await page.click("#share-open");
    await page.waitForSelector("#share-preview:not([hidden])");
    expect(await page.textContent("#share-preview-body .share-title")).toBe("NOVAXEL Smart Watch");
    expect(await page.textContent("#share-notice")).toMatch(/never says who checked/u);
    const analysed = api.requests.find((r) => r.path === "/v1/analyze/stream")?.body as { url: string };
    const preview = api.requests.find((r) => r.path === "/v1/shares/preview");
    expect(preview?.auth).toBe("");
    expect(preview?.body).toMatchObject({ share_token: "share-token.mac", url: analysed.url });
    expect(api.requests.some((r) => r.path === "/v1/shares")).toBe(false); // nothing public before "Share"

    await page.click("#share-confirm");
    await page.waitForSelector("#share-done:not([hidden])");
    expect(await page.textContent("#share-link")).toBe(`${api.url}/r/${SHARE_ID}`);
    expect(await page.textContent("#share-code")).toBe(SHARE_DELETE_CODE);
    expect(await page.textContent("#share-done")).toMatch(/Save it now: Unfret keeps only a fingerprint/u);
    expect(api.requests.filter((r) => r.path === "/v1/shares")).toHaveLength(1);
    expect(api.requests.find((r) => r.path === "/v1/shares")?.auth).toBe("");
    expect(await page.isVisible("#share-open")).toBe(false); // one share per check
    await page.close();
  });

  it("redeems an invite for the signed-in account and shows the new balance", async () => {
    const extensionId = new URL(granted.worker.url()).host;
    const page = await granted.context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${analysedTab}`);
    await page.click("#invite summary");
    await page.fill("#invite-input", INVITE_USED_CODE);
    await page.click("#invite-use");
    await page.waitForFunction(() => document.querySelector("#invite-status")?.textContent !== "");
    expect(await page.textContent("#invite-status")).toBe("This gift code has already been used.");

    await page.fill("#invite-input", INVITE_OK);
    await page.click("#invite-use");
    await page.waitForFunction(() => document.querySelector("#invite-status")?.textContent.startsWith("✓"));
    expect(await page.textContent("#invite-status")).toBe("✓ 3 checks added.");
    expect(await page.textContent("#credits")).toBe("3 checks left");
    expect(await page.inputValue("#invite-input")).toBe("");
    const redeemed = api.requests.filter((r) => r.path === "/v1/invites/redeem").at(-1);
    // The account's own sign-in: the API key the previous test pasted (a new key, as an invite needs).
    expect(redeemed?.auth).toBe(`Bearer ufk_abcdefghij_${"a".repeat(52)}`);
    expect(redeemed?.body).toEqual({ code: INVITE_OK });
    // The code isn't kept anywhere.
    const stored = await granted.worker.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      session: await chrome.storage.session.get(null),
    }));
    expect(JSON.stringify(stored)).not.toContain("ufi_");
    await page.close();
  });

  it('hides "Have an invite?" once the server says the account can\'t redeem one', async () => {
    const extensionId = new URL(granted.worker.url()).host;
    const page = await granted.context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${analysedTab}`);
    // The previous test redeemed an invite with this key, so /v1/credits now answers invite_eligible: false.
    await page.waitForFunction(() => document.querySelector("#credits")?.textContent !== "");
    expect(await page.isVisible("#invite")).toBe(false);
    await page.close();
  });
});

describe("in a Dutch browser", () => {
  let dutch: { context: BrowserContext; worker: Worker };

  beforeAll(async () => {
    dutch = await launch(grantedCopy(), "nl");
  }, 180_000);

  afterAll(async () => {
    await dutch.context.close();
  });

  it("stays in English and asks for English", async () => {
    await dutch.worker.evaluate(
      ({ base, address }) =>
        chrome.storage.local.set({
          apiBase: base,
          session: { token: `good-token-${"x".repeat(20)}`, address, expiresAt: "2999-01-01T00:00:00.000Z" },
          consent: { version: 2 },
        }),
      { base: api.url, address: ADDRESS },
    );
    const page = await dutch.context.newPage();
    await page.goto(AMAZON_URL);
    const tabId = await newestTabId(dutch.worker);
    const extensionId = new URL(dutch.worker.url()).host;
    const popup = await dutch.context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    const state = await popup.evaluate(
      (id) =>
        new Promise<TabState>((resolve) => {
          const port = chrome.runtime.connect({ name: "unfret-analysis" });
          port.onMessage.addListener((update: { tabId: number; state: TabState }) => {
            if (update.tabId === id && ["done", "error"].includes(update.state.status)) resolve(update.state);
          });
          port.postMessage({ type: "analyze", tabId: id });
        }),
      tabId,
    );
    expect(state.status === "error" ? state.message : state.status).toBe("done");
    expect(api.requests.filter((r) => r.path === "/v1/analyze/stream").at(-1)?.language).toBe("en");

    const view = await renderedPopup(dutch, tabId);
    expect(view.lang).toBe("en");
    expect(view.headings).toEqual(["What we noticed", "What you can do", "What we checked · 12 checks"]);
    expect(view.analyse).toBe("Check this page");
  });
});

describe("on a phone, 360×740 (Firefox for Android shows the popup as a full-width page)", () => {
  let phone: { context: BrowserContext; worker: Worker };

  beforeAll(async () => {
    phone = await launch(grantedCopy(), "en-US", true);
  }, 180_000);

  afterAll(async () => {
    await phone.context.close();
  });

  /** What doesn't fit a phone: sideways scrolling, and controls smaller than a fingertip (44×44 px). */
  async function fit(
    path: string,
    ready = "#account-status",
  ): Promise<{ width: number; overflow: boolean; small: string[] }> {
    const extensionId = new URL(phone.worker.url()).host;
    const page = await phone.context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${path}`);
    await page.waitForSelector(ready, { state: "visible" });
    await page.waitForTimeout(300);
    const facts = await page.evaluate(() => {
      const controls = [...document.querySelectorAll("button, a[href], input, summary, label")].filter(
        (e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && !e.closest("[hidden]");
        },
      );
      return {
        width: document.body.getBoundingClientRect().width,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        small: controls
          // A radio or checkbox is tapped through its label (the label is the target); a field's label isn't one.
          .filter((e) => !(e instanceof HTMLInputElement && e.closest("label")))
          .filter((e) => !(e instanceof HTMLLabelElement && !e.querySelector("input")))
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.height < 44 || r.width < 44;
          })
          .map((e) => `${e.tagName.toLowerCase()}#${e.id} "${(e.textContent || "").trim().slice(0, 30)}"`),
      };
    });
    await page.close();
    return facts;
  }

  it("renders the popup signed out, without sideways scrolling or small targets", async () => {
    await phone.worker.evaluate(() => chrome.storage.local.set({ consent: { version: 2 } }));
    expect(await fit("popup/popup.html")).toEqual({ width: 360, overflow: false, small: [] });
  });

  it("renders a result with its actions the same way", async () => {
    const shop = await phone.context.newPage();
    await shop.goto(AMAZON_URL);
    const tabId = await newestTabId(phone.worker);
    await phone.worker.evaluate(
      async ({ tabId, address }) => {
        await chrome.storage.local.set({
          session: { token: `good-token-${"x".repeat(20)}`, address, expiresAt: "2999-01-01T00:00:00.000Z" },
        });
        await chrome.storage.session.set({
          [`tab:${tabId}`]: {
            status: "done",
            findings: [],
            steps: [],
            body: { url: "https://www.amazon.com/dp/B0WATCH123" },
            result: {
              score: 14,
              explanation: "",
              charged: true,
              report_token: "report-token.mac",
              share_token: "share-token.mac",
              verdict: {
                band: "junk_or_scam",
                label: "Serious concerns",
                headline: "A countdown that resets and a brand-new web shop.",
                reasons: [
                  { type: "timer_resets", title: "Fake countdown", detail: "It restarts.", severity: "high" },
                ],
                positives: [],
              },
              assessment: { risk_score: 0.86, confidence: 0.7, model_version: "v1-test", flags: [] },
            },
          },
        });
      },
      { tabId, address: ADDRESS },
    );
    const facts = await fit(`popup/popup.html?tab=${tabId}`, "#share-open");
    expect(facts).toEqual({ width: 360, overflow: false, small: [] });
    await shop.close();
  });

  it("renders the settings page the same way", async () => {
    expect(await fit("options/options.html")).toEqual({ width: 360, overflow: false, small: [] });
  });
});

describe("a new install (0.12.0): a free pass, then a check", () => {
  let fresh: { context: BrowserContext; worker: Worker; userData: string };
  let extension: string;

  beforeAll(async () => {
    api.free.perPass = 5;
    extension = grantedCopy(api.url);
    fresh = await launch(extension);
  }, 180_000);

  afterAll(async () => {
    await fresh.context.close();
  });

  async function stored(): Promise<Record<string, unknown>> {
    return fresh.worker.evaluate(async () => ({
      ...(await chrome.storage.local.get(null)),
      sync: await chrome.storage.sync.get(null),
    }));
  }

  it("on install, the welcome page says this browser never had free checks: a pass with 5, and it says so", async () => {
    await expect.poll(async () => (await stored()).session, { timeout: 20_000 }).toBeTruthy();
    const made = api.requests.filter((r) => r.path === "/v1/keys");
    expect(made).toHaveLength(1);
    expect(made[0]?.body).toMatchObject({ challenge: "mock-challenge", free: true });
    const data = await stored();
    expect(data.session).toMatchObject({ token: FREE_PASS, address: "key:freepasszz", kind: "key" });
    expect(data.ownPass).toEqual({ keyId: "freepasszz", recoveryCode: FREE_PASS_BACKUP });
    expect(data.sync).toEqual({ freeChecksUsed: true });
    expect(data).not.toHaveProperty("passPending");
    await expect
      .poll(() => fresh.context.pages().some((p) => p.url() === `${api.url}/welcome?free=5`))
      .toBe(true);
    // The website's own note is set too: the link checker on unfret.net gives no second round.
    const welcome = fresh.context.pages().find((p) => p.url() === `${api.url}/welcome?free=5`);
    expect(await welcome?.evaluate(() => localStorage.getItem("unfret-free-pass"))).toBe("1");
  });

  it("shows You have 5 free checks, checks a page with one, then quick checks for free", async () => {
    await fresh.worker.evaluate(() => chrome.storage.local.set({ consent: { version: 2 } }));
    const page = await fresh.context.newPage();
    await page.goto(AMAZON_URL);
    const tabId = await newestTabId(fresh.worker);
    const extensionId = new URL(fresh.worker.url()).host;
    const popup = await fresh.context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${tabId}`);
    await popup.waitForFunction(
      () => document.querySelector("#credits")?.textContent === "You have 5 free checks",
    );
    expect(await popup.textContent("#analyse")).toBe("Check this page");

    await popup.click("#analyse");
    await popup.waitForSelector("#result:not([hidden])");
    const deep = api.requests.filter((r) => r.path === "/v1/analyze/stream").at(-1);
    expect(deep?.auth).toBe(`Bearer ${FREE_PASS}`);
    expect(deep?.body).not.toHaveProperty("tier");
    await popup.waitForFunction(
      () => document.querySelector("#credits")?.textContent === "You have 4 free checks",
    );

    // The free checks used up: the next check is a quick one, free, and says so.
    api.free.left = 0;
    await popup.reload();
    await popup.waitForFunction(
      () => document.querySelector("#analyse")?.textContent === "Quick check (free)",
    );
    await page.reload(); // a navigation clears the tab's result
    await popup.reload();
    await popup.waitForFunction(
      () => document.querySelector("#analyse")?.textContent === "Quick check (free)",
    );
    await popup.click("#analyse");
    await popup.waitForFunction(() =>
      document.querySelector("#result-body")?.textContent.includes("Quick check"),
    );
    const quick = api.requests.filter((r) => r.path === "/v1/analyze/stream").at(-1);
    expect(quick?.body).toMatchObject({ tier: "quick" });
    await popup.close();
    await page.close();
  });

  it("falls back to a quick check, saying why, when free deep checks are paused for the day", async () => {
    await fresh.worker.evaluate(
      (address) =>
        chrome.storage.local.set({
          session: { token: "paused", address, expiresAt: "2999-01-01T00:00:00.000Z" },
        }),
      ADDRESS,
    );
    const page = await fresh.context.newPage();
    await page.goto(AMAZON_URL);
    const tabId = await newestTabId(fresh.worker);
    const extensionId = new URL(fresh.worker.url()).host;
    const popup = await fresh.context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${tabId}`);
    const state = await popup.evaluate(
      (id) =>
        new Promise<TabState>((resolve) => {
          const port = chrome.runtime.connect({ name: "unfret-analysis" });
          port.onMessage.addListener((update: { tabId: number; state: TabState }) => {
            if (update.tabId === id && ["done", "error"].includes(update.state.status)) resolve(update.state);
          });
          port.postMessage({ type: "analyze", tabId: id });
        }),
      tabId,
    );
    expect(state.status).toBe("done");
    if (state.status === "done") {
      expect(state.result.tier).toBe("quick");
      expect(state.note).toContain("Free deep checks are back tomorrow");
    }
    await popup.waitForSelector("#result-note:not([hidden])");
    await popup.close();
    await page.close();
  });

  it("after a reinstall in the same profile (the sync flag kept): a pass without free checks", async () => {
    // What a reinstall leaves: no local storage, the sync flag. The popup makes the pass the install couldn't.
    await fresh.worker.evaluate(async () => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ passPending: true, consent: { version: 2 } });
    });
    const before = api.requests.filter((r) => r.path === "/v1/keys").length;
    const page = await fresh.context.newPage();
    await page.goto(AMAZON_URL);
    const tabId = await newestTabId(fresh.worker);
    const extensionId = new URL(fresh.worker.url()).host;
    const popup = await fresh.context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${tabId}`);
    await popup.waitForFunction(
      () => document.querySelector("#analyse")?.textContent === "Quick check (free)",
    );
    const made = api.requests.filter((r) => r.path === "/v1/keys").slice(before);
    expect(made).toHaveLength(1);
    expect(made[0]?.body).not.toHaveProperty("free");
    expect((await stored()).session).toMatchObject({ token: FREE_PASS });
    await popup.close();
    await page.close();
  });

  it("removed and installed again in the same profile, without browser sync: no new free checks", async () => {
    // Removing the extension wipes its storage, storage.sync included when the browser doesn't sync (it doesn't
    // here); the website's note in this profile stays. (`probe` shows the sync area was wiped.)
    await fresh.worker.evaluate(() => chrome.storage.sync.set({ probe: true }));
    await fresh.worker.evaluate(() => chrome.management.uninstallSelf()).catch(() => undefined);
    await fresh.context.close();
    const before = api.requests.filter((r) => r.path === "/v1/keys").length;
    fresh = await launch(extension, "en-US", false, fresh.userData);
    await expect
      .poll(async () => (await stored()).session, { timeout: 20_000 })
      .toMatchObject({ token: FREE_PASS });
    const made = api.requests.filter((r) => r.path === "/v1/keys").slice(before);
    expect(made).toHaveLength(1);
    expect(made[0]?.body).not.toHaveProperty("free");
    const data = await stored();
    expect(data.sync).toEqual({ freeChecksUsed: true }); // set again from the website's answer, no `probe`
    expect(data).not.toHaveProperty("consent"); // a new install: the old one's storage is gone
    await expect
      .poll(() => fresh.context.pages().some((p) => p.url() === `${api.url}/welcome?note=had-free`))
      .toBe(true);
  });
});
