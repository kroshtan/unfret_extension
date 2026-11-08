/**
 * Smoke test of the built Chrome extension (dist/chrome) in headless Chromium, against the local mock API:
 * the session relay, the "?" badge, extraction in a real browser (compared with the backend's output for the
 * same page) and a full analysis through the background. Run with `npm run smoke` (builds first).
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type BrowserContext, chromium, type Worker } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Extraction } from "../../src/extract/index.js";
import type { TabState } from "../../src/shared/messages.js";
import { type MockApi, startMockApi } from "../mock-server.js";

const root = join(import.meta.dirname, "..", "..");
const extension = join(root, "dist", "chrome");
const fixture = (name: string): string => readFileSync(join(root, "test", "fixtures", name), "utf8");
const AMAZON_URL = "https://www.amazon.com/dp/B0WATCH123";
const ADDRESS = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

const CONNECT_PAGE = `<!doctype html><title>connect</title><script>
  addEventListener("message", (e) => { if (e.data && e.data.type === "veridex-session-received") document.title = "received"; });
  setTimeout(() => window.postMessage({ type: "veridex-session", token: "good-token-${"x".repeat(20)}",
    address: "${ADDRESS}", expires_at: "2999-01-01T00:00:00Z" }, location.origin), 300);
</script>`;

let api: MockApi;
let context: BrowserContext;
let worker: Worker;
let userData: string;

beforeAll(async () => {
  api = await startMockApi();
  userData = mkdtempSync(join(tmpdir(), "veridex-smoke-"));
  context = await chromium.launchPersistentContext(userData, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.route("https://www.amazon.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: fixture("amazon-com.html") }),
  );
  await context.route("https://veridex.kroshtan.com/connect**", (route) =>
    route.fulfill({ contentType: "text/html", body: CONNECT_PAGE }),
  );
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
}, 120_000);

afterAll(async () => {
  await context.close();
  await api.close();
  rmSync(userData, { recursive: true, force: true });
});

async function amazonTabId(): Promise<number> {
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://www.amazon.com/*" });
    return tab?.id ?? -1;
  });
}

describe("the built extension in Chromium", () => {
  it("stores the session the connect page relays", async () => {
    const page = await context.newPage();
    await page.goto("https://veridex.kroshtan.com/connect");
    await page.waitForFunction(() => document.title === "received", undefined, { timeout: 10_000 });
    const stored = await worker.evaluate(() => chrome.storage.local.get("session"));
    expect(stored.session).toMatchObject({ address: ADDRESS });
    await page.close();
  });

  it("marks a marketplace product page with ?", async () => {
    const page = await context.newPage();
    await page.goto(AMAZON_URL);
    const tabId = await amazonTabId();
    await expect
      .poll(() => worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId))
      .toBe("?");
  });

  it("extracts the same facts as the backend, without the user's personal text", async () => {
    const tabId = await amazonTabId();
    const extraction = await worker.evaluate(async (id) => {
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

  it("runs a full analysis through the background against the API", async () => {
    await worker.evaluate((base) => chrome.storage.local.set({ apiBase: base }), api.url);
    const tabId = await amazonTabId();
    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
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

    expect(state.status).toBe("done");
    if (state.status === "done") {
      expect(state.result.score).toBe(18);
      expect(state.findings.map((f) => f.skill)).toEqual(["listing", "reviews"]);
    }
    const request = api.requests.find((r) => r.path === "/v1/analyze/stream");
    const body = request?.body as { page_facts: { title: string }; page_content: string };
    expect(request?.auth).toBe("Bearer good-token-xxxxxxxxxxxxxxxxxxxx");
    expect(body.page_facts.title).toMatch(/^NOVAXEL Smart Watch/u);
    expect(body.page_content).not.toMatch(/Jane/u);
    expect(await worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)).toBe("18");
  });
});
