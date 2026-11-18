// Real results for the store screenshots: Unfret Dev (dist/chrome-dev, API on https://dev.unfret.net, never
// production) checks the pages below the way a user would, and each result is written to
// store/screenshots/results/<name>.json, which `make screenshots` then shows in the store build's popup.
//
// The extension gets its pass as on a real install (the welcome page on dev.unfret.net makes a free one), or uses
// the Unfret pass in $UNFRET_DEV_PASS (a pass on dev, with checks). A network gets 2 free passes a day: a third comes
// without checks, and then only the quick checks below can run.
//
// Run `make build` first; needs `npx playwright install chromium`. Usage:
//   node scripts/screenshots-capture.mjs [name ...]      (default: every page below)
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "store", "screenshots", "results");
const DEV = "https://dev.unfret.net";

/**
 * The pages, all public. The test shop is Unfret's own made-up shop (every trick on it is fake on purpose, and it says
 * so on every view); the clean result is a well-known shop's product page, shown only in the popup.
 */
export const PAGES = [
  { name: "test-shop", url: `${DEV}/test-shop` },
  { name: "clean", url: "https://www.ikea.com/us/en/p/kallax-shelf-unit-white-20631663/" },
];

const wanted = process.argv.slice(2);
const pages = wanted.length ? PAGES.filter((p) => wanted.includes(p.name)) : PAGES;
if (pages.length === 0) throw new Error(`no such page; one of ${PAGES.map((p) => p.name).join(", ")}`);

// A copy of Unfret Dev that may read the pages above without a toolbar click (what activeTab grants on a click).
const extension = mkdtempSync(join(tmpdir(), "unfret-capture-ext-"));
cpSync(join(root, "dist", "chrome-dev"), extension, { recursive: true });
const manifestPath = join(extension, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.host_permissions = [...new Set(pages.map((p) => `${new URL(p.url).origin}/*`))];
writeFileSync(manifestPath, JSON.stringify(manifest));

const userData = mkdtempSync(join(tmpdir(), "unfret-capture-profile-"));
const context = await chromium.launchPersistentContext(userData, {
  channel: "chromium",
  headless: true,
  locale: "en-US",
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--lang=en-US"],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  await worker.evaluate(async () => chrome.storage.local.set({ consent: { version: 2 } })); // CONSENT_VERSION
  const pass = process.env.UNFRET_DEV_PASS?.trim();
  if (pass) {
    // The pass as the settings page would keep it after "Use this pass".
    await worker.evaluate(async (key) => {
      const res = await fetch("https://dev.unfret.net/v1/credits", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`the pass in UNFRET_DEV_PASS was refused (${String(res.status)})`);
      const { address } = await res.json();
      await chrome.storage.local.set({
        session: { token: key, address, expiresAt: "9999-12-31T00:00:00.000Z", kind: "key" },
      });
    }, pass);
  } else {
    // The welcome page opened on install makes the free pass.
    let session;
    for (let i = 0; i < 60 && !session; i++) {
      session = await worker.evaluate(async () => (await chrome.storage.local.get("session")).session);
      if (!session) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!session) {
      // No free checks today for this network: a pass without them, which runs quick checks. The popup makes one by
      // itself once this profile's own note says it had its free checks (retryFreePass in popup.ts).
      console.warn("no free checks: only quick checks will run (UNFRET_DEV_PASS for deep ones)");
      await worker.evaluate(async () => {
        for (let i = 0; ; i++) {
          try {
            await chrome.storage.sync.set({ freeChecksUsed: true }); // FREE_FLAG (src/shared/new-pass.ts)
            break;
          } catch (error) {
            if (i > 10) throw error; // a fresh profile's sync storage can refuse its first writes
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
        await chrome.storage.local.set({ passPending: true });
      });
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/popup/popup.html`);
      for (let i = 0; i < 120 && !session; i++) {
        session = await worker.evaluate(async () => (await chrome.storage.local.get("session")).session);
        if (!session) await new Promise((r) => setTimeout(r, 1000));
      }
      await popup.close();
      if (!session) throw new Error("couldn't get a pass on dev.unfret.net");
    }
  }
  mkdirSync(out, { recursive: true });

  for (const page of pages) {
    const tab = await context.newPage();
    await tab.goto(page.url, { waitUntil: "load", timeout: 60_000 }).catch(() => {});
    await tab.waitForTimeout(3000);
    const tabId = await worker.evaluate(async () =>
      Math.max(...(await chrome.tabs.query({})).map((t) => t.id ?? -1)),
    );
    // A click on "Check this page", as a user would.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/popup.html?tab=${String(tabId)}`);
    await popup.waitForSelector("#analyse:not([disabled])", { timeout: 30_000 });
    await popup.click("#analyse");
    const state = await waitForResult(worker, tabId);
    await popup.close();
    await tab.close();
    if (state?.status !== "done" || !state.result) {
      console.error(`${page.name}: no result (${JSON.stringify(state?.error ?? state?.status ?? null)})`);
      process.exitCode = 1;
      continue;
    }
    if (state.result.tier === "quick") {
      // Out of checks, the extension runs a quick check instead: not the deep result this page is for.
      console.error(`${page.name}: no checks left for a deep check; kept the earlier result`);
      process.exitCode = 1;
      continue;
    }
    // Only what the popup shows: no tokens, no balance.
    const dropped = new Set(["share_token", "report_token", "balance_usd_micros", "balance_lamports"]);
    const result = Object.fromEntries(Object.entries(state.result).filter(([key]) => !dropped.has(key)));
    const file = join(out, `${page.name}.json`);
    const kept = { url: page.url, checked: new Date().toISOString().slice(0, 10), result };
    // As production shows it: the dev deployment's host in the result's text and addresses becomes unfret.net.
    writeFileSync(file, `${JSON.stringify(kept, null, 2).replaceAll("dev.unfret.net", "unfret.net")}\n`);
    console.log(`${page.name}: ${String(result.verdict?.label ?? result.score)} → ${file}`);
    if (page.name === "test-shop" && !result.verdict?.same_product) {
      console.warn(
        "test-shop: no “same product, sold elsewhere” match (the sister shop's photo), which shot 2 shows",
      );
    }
  }
} finally {
  await context.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(extension, { recursive: true, force: true });
}

/** The tab's state once its check is done or failed (the background keeps it in session storage). */
async function waitForResult(worker, tabId) {
  for (let i = 0; i < 180; i++) {
    const state = await worker.evaluate(
      async (key) => (await chrome.storage.session.get(key))[key],
      `tab:${String(tabId)}`,
    );
    if (state && (state.status === "done" || state.status === "error")) return state;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return undefined;
}
