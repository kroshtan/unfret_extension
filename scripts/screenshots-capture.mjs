// Real results for the store screenshots: Unfret Dev (dist/chrome-dev, API on https://dev.unfret.net, never
// production) checks the pages below the way a user would, and each result is written to
// store/screenshots/results/<name>.json, which `make screenshots` then shows in the store build's popup.
//
// Free checks (contract: "Free checks for shoppers"): no pass, no account; the extension solves each deep check's
// proof of work itself, as for a user. While free deep checks are paused (the free pool), a deep check can't run: try
// again after 00:00 UTC.
//
// Only the Unfret test shop is checked for real; the other results the screenshots show (store/screenshots/results)
// are made up by hand, for made-up shops on .example addresses, so no real shop appears in a screenshot.
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

/** The pages, all public: the test shop is Unfret's own made-up shop (every trick on it is fake on purpose, and it
 * says so on every view). */
export const PAGES = [{ name: "test-shop", url: `${DEV}/test-shop` }];

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
      // Free deep checks paused (or busy): the extension ran a quick check instead, not the deep result wanted.
      console.error(
        `${page.name}: no deep check now (${state.note ?? "quick result"}); kept the earlier result`,
      );
      process.exitCode = 1;
      continue;
    }
    // Only what the popup shows: no tokens (the screenshots stage their own).
    const dropped = new Set([
      "share_token",
      "report_token",
      "label_token",
      "balance_usd_micros",
      "balance_lamports",
    ]);
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
