/**
 * Smoke test of the built Chrome extension (dist/chrome) in headless Chromium, against the local mock API.
 *
 * The shipped build holds no standing access to any shop: it can't read the Amazon page on its own, while the
 * browser applies its declarativeContent icon hint there. Reading a page needs activeTab, which Chromium grants when
 * the user clicks the toolbar button. A headless browser can't click the toolbar, so a second, test-only copy of the
 * build is granted that one site, the access a click gives, to check extraction (compared with the backend's output
 * for the same page) and full analyses: free deep checks with their proof of work, quick checks, and the pause.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type BrowserContext, chromium, type Worker } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Extraction } from "../../src/extract/index.js";
import type { TabState } from "../../src/shared/messages.js";
import { type MockApi, SHARE_DELETE_CODE, SHARE_ID, startMockApi } from "../mock-server.js";

const root = join(import.meta.dirname, "..", "..");
const shipped = join(root, "dist", "chrome");
const fixture = (name: string): string => readFileSync(join(root, "test", "fixtures", name), "utf8");
const AMAZON_URL = "https://www.amazon.com/dp/B0WATCH123";

const temp: string[] = [];

async function launch(
  extension: string,
  language = "en-US",
  phone = false,
): Promise<{ context: BrowserContext; worker: Worker }> {
  const userData = mkdtempSync(join(tmpdir(), "unfret-smoke-"));
  temp.push(userData);
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
      // unfret.net must never be reached from a test.
      "--host-resolver-rules=MAP unfret.net ~NOTFOUND, MAP *.unfret.net ~NOTFOUND",
    ],
  });
  await context.route("https://www.amazon.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: fixture("amazon-com.html") }),
  );
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  return { context, worker };
}

/** A copy of the build granted the Amazon site: the access a toolbar click (activeTab) gives for that tab. */
function grantedCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "unfret-granted-"));
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

/** Run a check of `tabId` through the background, from a popup page, and wait for its end. */
async function check(
  browser: { context: BrowserContext; worker: Worker },
  tabId: number,
  tier?: "quick",
): Promise<TabState> {
  const extensionId = new URL(browser.worker.url()).host;
  const popup = await browser.context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  const state = await popup.evaluate(
    ({ id, tier }) =>
      new Promise<TabState>((resolve) => {
        const port = chrome.runtime.connect({ name: "unfret-analysis" });
        port.onMessage.addListener((update: { tabId: number; state: TabState }) => {
          if (update.tabId === id && ["done", "error"].includes(update.state.status)) resolve(update.state);
        });
        port.postMessage(tier ? { type: "analyze", tabId: id, tier } : { type: "analyze", tabId: id });
      }),
    { id: tabId, tier },
  );
  await popup.close();
  return state;
}

async function amazonTab(browser: { context: BrowserContext; worker: Worker }): Promise<number> {
  const page = await browser.context.newPage();
  await page.goto(AMAZON_URL);
  return newestTabId(browser.worker);
}

const streamed = (): MockApi["requests"] => api.requests.filter((r) => r.path === "/v1/analyze/stream");

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
  it("declares no host permissions and no content scripts, and opens no page on install", async () => {
    const manifest = await plain.worker.evaluate(() => chrome.runtime.getManifest());
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(plain.context.pages().map((p) => p.url())).not.toContainEqual(
      expect.stringContaining("unfret.net"),
    );
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
    const tabId = await amazonTab(plain);
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

  it("deletes the pass or sign-in an older version stored, and never sends it", async () => {
    await plain.worker.evaluate(async () => {
      await chrome.storage.local.set({
        session: {
          token: "ufk_abcdefghij_" + "a".repeat(52),
          address: "key:abcdefghij",
          expiresAt: "2999-01-01",
        },
        ownPass: { keyId: "abcdefghij", recoveryCode: "ufr_x" },
        passPending: true,
        sessionExpired: true,
        passEnded: true,
        consent: { version: 2 },
      });
      await chrome.storage.sync.set({ freeChecksUsed: true });
    });
    const extensionId = new URL(plain.worker.url()).host;
    const popup = await plain.context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await expect
      .poll(() => plain.worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).sort()))
      .toEqual(["consent"]);
    expect(await plain.worker.evaluate(() => chrome.storage.sync.get(null))).toEqual({});
    await popup.close();
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

  it("opens on the consent screen, with Check this page disabled until I agree", async () => {
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
    expect(before.text).toMatch(/no account/iu);
    await popup.click("#consent-agree");
    await popup.waitForSelector("#consent", { state: "hidden" });
    const stored = await granted.worker.evaluate(() => chrome.storage.local.get("consent"));
    expect(stored.consent).toEqual({ version: 2 });
    await popup.close();
  });

  it("runs a free deep check: a solved challenge, no Authorization, nothing that names the user", async () => {
    await granted.worker.evaluate((base) => chrome.storage.local.set({ apiBase: base }), api.url);
    const tabId = await amazonTab(granted);
    analysedTab = tabId;
    const state = await check(granted, tabId);

    expect(state.status === "error" ? state.message : state.status).toBe("done");
    if (state.status === "done") {
      expect(state.result.score).toBe(18);
      expect(state.findings.map((f) => f.skill)).toEqual(["listing", "reviews"]);
      expect(state.body).not.toHaveProperty("proof_of_work"); // what a report would send back: the page only
    }
    expect(api.requests.some((r) => r.path === "/v1/analyze/challenge")).toBe(true);
    const request = streamed().at(-1);
    const body = request?.body as {
      page_facts: { title: string };
      page_content: string;
      proof_of_work: { challenge: string; solution: string };
    };
    expect(request?.auth).toBe("");
    expect(body.proof_of_work.challenge).toMatch(/^mock-/u);
    expect(body.page_facts.title).toMatch(/^NOVAXEL Smart Watch/u);
    expect(body.page_content).not.toMatch(/Jane/u);
    expect(api.requests.every((r) => r.auth === "")).toBe(true);
    // Score 18: the verdict symbol, not the number (0.7.2).
    expect(await granted.worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)).toBe("✕");
  });

  it("gets a new challenge once when the first one is refused", async () => {
    api.mode = "spent";
    const before = api.requests.filter((r) => r.path === "/v1/analyze/challenge").length;
    const state = await check(granted, await amazonTab(granted));
    expect(state.status).toBe("done");
    expect(api.requests.filter((r) => r.path === "/v1/analyze/challenge").length - before).toBe(2);
  });

  it("sends the page's address without its fragment or what is about the visitor (audit L8)", async () => {
    const page = await granted.context.newPage();
    await page.goto(
      `${AMAZON_URL}?th=1&utm_source=newsletter&email=me%40mail.example&ref_=nav#customerReviews`,
    );
    const state = await check(granted, await newestTabId(granted.worker));
    expect(state.status).toBe("done");
    const body = api.requests.filter((r) => r.path === "/v1/analyze/stream").at(-1)?.body as {
      url: string;
      page_facts: { url: string; policy_links: Record<string, string> };
    };
    expect(body.url).toBe(`${AMAZON_URL}?th=1`);
    expect(body.page_facts.url).toBe(`${AMAZON_URL}?th=1`);
    expect(JSON.stringify(body)).not.toMatch(/newsletter|mail\.example|customerReviews/u);
    await page.close();
  });

  it("keeps the result when the service worker sleeps, and shows it as a shopper reads it (English)", async () => {
    const tabId = analysedTab;
    const stored = await granted.worker.evaluate(
      async (id) => (await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`] as TabState | undefined,
      tabId,
    );
    expect(stored?.status).toBe("done"); // survives the worker stopping (session storage: memory only)
    expect(stored?.status === "done" && stored.steps).toContain("listing");
    expect(streamed()[0]?.language).toBe("en");

    const view = await renderedPopup(granted, tabId);
    expect(view.label).toBe("May not arrive, or may not be safe");
    expect(view.headings).toEqual(["Why", "What you can do", "What we checked · 12 checks"]);
    expect(view.reasons).toEqual(["Brand-new web shop Level 4", "Suspicious number of reviews Level 1"]);
    expect(view.text).toContain("Source: The reviews on the page");
    expect(view.text).toContain("Deep checks are free.");
    expect(view.text).not.toMatch(/listing\.|=\s*\d/u);
  });
});

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

describe("sharing a result, in the popup", () => {
  it("previews, then shares the result without Authorization, and shows the link and delete code", async () => {
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
});

describe('"Wrong result?" and the contributor key', () => {
  it("reports anonymously: a level and a wrong reason, with the request as analysed", async () => {
    const extensionId = new URL(granted.worker.url()).host;
    const page = await granted.context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${analysedTab}`);
    await page.click("#report-open");
    await page.waitForSelector("#report:not([hidden])");
    expect(await page.textContent("#report")).toMatch(/never\s+keeps\s+who sent it/u);
    expect(await page.textContent("#report-as")).toBe("It is sent anonymously.");
    expect(await page.textContent("#report-level")).toContain(
      "4 · May not arrive, or may not be safe (our answer)",
    );
    expect(await page.isDisabled("#report-send")).toBe(true);
    await page.check('#report input[name="level"][value="1"]');
    await page.check('#report input[name="wrong"][value="new_domain"]');
    await page.click("#report-send");
    await page.waitForSelector('#report-status[data-kind="ok"]');
    expect(await page.textContent("#report-status")).toBe("Thanks! A person will review this page.");
    expect(await page.isVisible("#report-open")).toBe(false); // one report per check
    const sent = api.requests.filter((r) => r.path === "/v1/labels").at(-1);
    const analysed = streamed()[0]?.body as Record<string, unknown>;
    const { proof_of_work: _spent, ...page_ } = analysed;
    expect(_spent).toBeDefined();
    expect(sent?.auth).toBe("");
    expect(sent?.body).toMatchObject({ label_token: "label-deep.mac", level: 1, wrong: ["new_domain"] });
    expect((sent?.body as { request: unknown }).request).toEqual(page_);
    expect(sent?.body).not.toHaveProperty("contributor_key");
    await page.close();
  });

  it("turned on in the settings, the key goes with reports and contributor calls, never with a check", async () => {
    const extensionId = new URL(granted.worker.url()).host;
    const options = await granted.context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options/options.html`);
    await options.check("#contributor-on");
    await options.waitForSelector("#contributor:not([hidden])");
    await options.waitForFunction(() => document.querySelector("#contributor-stats")?.textContent !== "");
    const { contributorKey: key } = await granted.worker.evaluate(() =>
      chrome.storage.local.get<{ contributorKey: string }>("contributorKey"),
    );
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    await options.fill("#handle", "sharp-eye");
    await options.check("#handle-public");
    await options.click("#handle-save");
    await options.waitForSelector('#contributor-status[data-kind="ok"]');
    await options.click("#leaderboard-box summary");
    await options.waitForFunction(() =>
      document.querySelector("#leaderboard")?.textContent.includes("sharp-eye"),
    );

    const tabId = await amazonTab(granted);
    const before = api.requests.length;
    const state = await check(granted, tabId);
    expect(state.status).toBe("done");
    const popup = await granted.context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${tabId}`);
    await popup.click("#report-open");
    await popup.waitForSelector("#report:not([hidden])");
    expect(await popup.textContent("#report-as")).toMatch(/contributor profile/u);
    await popup.click("#report-missing-set summary");
    await popup.check('#report input[name="missing"][value="drip_pricing"]');
    await popup.click("#report-send");
    await popup.waitForSelector('#report-status[data-kind="ok"]');
    const since = api.requests.slice(before);
    const withKey = since.filter((r) => JSON.stringify(r.body ?? "").includes(key)).map((r) => r.path);
    expect(withKey).toEqual(["/v1/labels"]);
    expect(
      api.requests.filter((r) => JSON.stringify(r.body ?? "").includes(key)).map((r) => r.path),
    ).not.toContain("/v1/analyze/stream");

    // Off: the profile is forgotten on the server and the key deleted here.
    await options.uncheck("#contributor-on");
    await options.waitForSelector('#contributor-status[data-kind="ok"]');
    expect(api.requests.at(-1)?.path).toBe("/v1/contributors/forget");
    expect(await granted.worker.evaluate(() => chrome.storage.local.get("contributorKey"))).toEqual({});
    await popup.close();
    await options.close();
  });
});

describe("the free quick check, and the pause", () => {
  it("runs a quick check from its own button, with no challenge", async () => {
    const tabId = await amazonTab(granted);
    const extensionId = new URL(granted.worker.url()).host;
    const popup = await granted.context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${tabId}`);
    await popup.waitForSelector("#quick-row:not([hidden])");
    expect(await popup.textContent("#analyse")).toBe("Check this page");
    expect(await popup.textContent("#quick")).toBe("Quick check (free)");
    const challenges = api.requests.filter((r) => r.path === "/v1/analyze/challenge").length;
    const before = streamed().length;
    await popup.click("#quick");
    await popup.waitForFunction(() =>
      document.querySelector("#result-body")?.textContent.includes("Quick check"),
    );
    const sent = streamed().slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.auth).toBe("");
    expect(sent[0]?.body).toMatchObject({ tier: "quick" });
    expect(api.requests.filter((r) => r.path === "/v1/analyze/challenge").length).toBe(challenges);
    expect(await popup.isVisible("#quick-row")).toBe(false); // under a result, not offered again
    expect(await popup.textContent("#deep-hint-action")).toBe("Run a deep check");
    await popup.close();
  });

  it("paused: says free checks run on donations, links to /donate, and the main button is the quick check", async () => {
    api.mode = "paused";
    try {
      const tabId = await amazonTab(granted);
      const extensionId = new URL(granted.worker.url()).host;
      const popup = await granted.context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${tabId}`);
      await popup.waitForSelector("#paused:not([hidden])");
      expect(await popup.textContent("#paused-text")).toMatch(
        /run on donations.*Quick checks still work.*next month/u,
      );
      expect(await popup.textContent("#analyse")).toBe("Quick check (free)");
      expect(await popup.isVisible("#quick-row")).toBe(false);
      await popup.close();

      // A deep check asked for anyway (an older popup): the challenge says paused, nothing is solved, a quick one runs.
      const solved = streamed().length;
      const state = await check(granted, tabId);
      expect(state.status).toBe("done");
      if (state.status === "done") {
        expect(state.result.tier).toBe("quick");
        expect(state.note).toMatch(/paused until next month/u);
        expect(state.pause?.message_key).toBe("free_checks_run_on_donations");
      }
      expect(
        streamed()
          .slice(solved)
          .map((r) => (r.body as { tier?: string }).tier),
      ).toEqual(["quick"]);

      const shown = await granted.context.newPage();
      await shown.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${tabId}`);
      await shown.waitForSelector("#deep-hint-action");
      expect(await shown.textContent("#deep-hint-action")).toBe("Support Unfret");
      const opening = granted.context.waitForEvent("page");
      await shown.click("#paused-donate");
      expect((await opening).url()).toBe(`${api.url}/donate`);
    } finally {
      api.mode = "ok";
    }
  });

  it("a deep check while too many came from this network: says to wait, and offers the quick check", async () => {
    api.mode = "busy";
    try {
      const state = await check(granted, await amazonTab(granted));
      expect(state.status === "error" && state.message).toBe(
        "Too many deep checks from your network this hour. Please wait 20 minutes, or run a quick check.",
      );
    } finally {
      api.mode = "ok";
    }
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
      (base) => chrome.storage.local.set({ apiBase: base, consent: { version: 2 } }),
      api.url,
    );
    const tabId = await amazonTab(dutch);
    const state = await check(dutch, tabId);
    expect(state.status === "error" ? state.message : state.status).toBe("done");
    expect(streamed().at(-1)?.language).toBe("en");

    const view = await renderedPopup(dutch, tabId);
    expect(view.lang).toBe("en");
    expect(view.headings).toEqual(["Why", "What you can do", "What we checked · 12 checks"]);
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
    ready = "#analyse",
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

  it("renders the popup without sideways scrolling or small targets", async () => {
    await phone.worker.evaluate(() => chrome.storage.local.set({ consent: { version: 2 } }));
    expect(await fit("popup/popup.html")).toEqual({ width: 360, overflow: false, small: [] });
  });

  it("renders a result with its actions the same way", async () => {
    const tabId = await amazonTab(phone);
    await phone.worker.evaluate(async (tabId) => {
      await chrome.storage.session.set({
        [`tab:${tabId}`]: {
          status: "done",
          findings: [],
          steps: [],
          body: { url: "https://www.amazon.com/dp/B0WATCH123" },
          result: {
            score: 14,
            explanation: "",
            charged: false,
            label_token: "label-deep.mac",
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
    }, tabId);
    const facts = await fit(`popup/popup.html?tab=${tabId}`, "#share-open");
    expect(facts).toEqual({ width: 360, overflow: false, small: [] });
  });

  it("renders the popup on a product page, with the quick check under the main button, the same way", async () => {
    const tabId = await amazonTab(phone);
    const facts = await fit(`popup/popup.html?tab=${tabId}`, "#quick");
    expect(facts).toEqual({ width: 360, overflow: false, small: [] });
  });

  it("renders the settings page the same way", async () => {
    expect(await fit("options/options.html", "#support-link")).toEqual({
      width: 360,
      overflow: false,
      small: [],
    });
  });
});
