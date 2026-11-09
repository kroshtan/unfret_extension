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

import { type BrowserContext, chromium, type Worker } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Extraction } from "../../src/extract/index.js";
import type { TabState } from "../../src/shared/messages.js";
import { type MockApi, startMockApi } from "../mock-server.js";

const root = join(import.meta.dirname, "..", "..");
const shipped = join(root, "dist", "chrome");
const fixture = (name: string): string => readFileSync(join(root, "test", "fixtures", name), "utf8");
const AMAZON_URL = "https://www.amazon.com/dp/B0WATCH123";
const ADDRESS = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

const CONNECT_PAGE = `<!doctype html><title>connect</title><script>
  addEventListener("message", (e) => { if (e.data && e.data.type === "veridex-session-received") document.title = "received"; });
  setTimeout(() => window.postMessage({ type: "veridex-session", token: "good-token-${"x".repeat(20)}",
    address: "${ADDRESS}", expires_at: "2999-01-01T00:00:00Z" }, location.origin), 300);
</script>`;

const temp: string[] = [];

async function launch(
  extension: string,
  language = "en-US",
): Promise<{ context: BrowserContext; worker: Worker }> {
  const userData = mkdtempSync(join(tmpdir(), "veridex-smoke-"));
  temp.push(userData);
  const context = await chromium.launchPersistentContext(userData, {
    channel: "chromium",
    headless: true,
    locale: language,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, `--lang=${language}`],
  });
  await context.route("https://www.amazon.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: fixture("amazon-com.html") }),
  );
  await context.route("https://unfret.kroshtan.com/connect**", (route) =>
    route.fulfill({ contentType: "text/html", body: CONNECT_PAGE }),
  );
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  return { context, worker };
}

/** A copy of the build granted the Amazon site: the access a toolbar click (activeTab) gives for that tab. */
function grantedCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "veridex-granted-"));
  temp.push(dir);
  cpSync(shipped, dir, { recursive: true });
  const manifestPath = join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  writeFileSync(
    manifestPath,
    JSON.stringify({ ...manifest, host_permissions: ["https://www.amazon.com/*"] }),
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

  it("stores the session the connect page relays", async () => {
    const page = await plain.context.newPage();
    await page.goto("https://unfret.kroshtan.com/connect");
    await page.waitForFunction(() => document.title === "received", undefined, { timeout: 10_000 });
    const stored = await plain.worker.evaluate(() => chrome.storage.local.get("session"));
    expect(stored.session).toMatchObject({ address: ADDRESS });
    await page.close();
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
        func: () => window.__veridexExtract?.(),
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
    expect(before.text).toContain("unfret.kroshtan.com");
    await popup.click("#consent-agree");
    await popup.waitForSelector("#consent", { state: "hidden" });
    const stored = await granted.worker.evaluate(() => chrome.storage.local.get("consent"));
    expect(stored.consent).toEqual({ version: 1 });
    await popup.close();
  });

  it("runs a full analysis through the background against the API", async () => {
    await granted.worker.evaluate(
      ({ base, address }) =>
        chrome.storage.local.set({
          apiBase: base,
          session: { token: `good-token-${"x".repeat(20)}`, address, expiresAt: "2999-01-01T00:00:00.000Z" },
          consent: { version: 1 },
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
          const port = chrome.runtime.connect({ name: "veridex-analysis" });
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
    expect(view.label).toBe("Many warning signs");
    expect(view.headings).toEqual(["What we noticed"]);
    expect(view.reasons).toEqual(["Suspicious number of reviews"]);
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
    expect(await page.textContent("#key-status")).toMatch(/isn't an API key/u);

    const key = `ufk_abcdefghij_${"a".repeat(52)}`;
    await page.fill("#api-key", key);
    await page.click("#key-use");
    await page.waitForFunction(() => document.querySelector("#key-status")?.textContent.startsWith("Saved"));
    expect(await page.textContent("#account-status")).toBe("Using API key abcdefghij.");
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

describe("in Dutch", () => {
  let dutch: { context: BrowserContext; worker: Worker };

  beforeAll(async () => {
    dutch = await launch(grantedCopy(), "nl");
  }, 180_000);

  afterAll(async () => {
    await dutch.context.close();
  });

  it("asks for and shows the verdict in Dutch", async () => {
    await dutch.worker.evaluate(
      ({ base, address }) =>
        chrome.storage.local.set({
          apiBase: base,
          session: { token: `good-token-${"x".repeat(20)}`, address, expiresAt: "2999-01-01T00:00:00.000Z" },
          consent: { version: 1 },
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
          const port = chrome.runtime.connect({ name: "veridex-analysis" });
          port.onMessage.addListener((update: { tabId: number; state: TabState }) => {
            if (update.tabId === id && ["done", "error"].includes(update.state.status)) resolve(update.state);
          });
          port.postMessage({ type: "analyze", tabId: id });
        }),
      tabId,
    );
    expect(state.status === "error" ? state.message : state.status).toBe("done");
    expect(api.requests.filter((r) => r.path === "/v1/analyze/stream").at(-1)?.language).toBe("nl");

    const view = await renderedPopup(dutch, tabId);
    expect(view.lang).toBe("nl");
    expect(view.label).toBe("Veel waarschuwingssignalen");
    expect(view.headings).toEqual(["Wat ons opviel"]);
    expect(view.reasons).toEqual(["Verdacht veel reviews"]);
  });
});
