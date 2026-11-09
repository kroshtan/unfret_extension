// Chrome Web Store screenshots (1280x800, English): the real popup of dist/chrome, opened as a page in headless
// Chromium with a staged result, framed with a caption. The API is answered by routes (no network, no real
// account); results are written into the extension's session storage the way the background stores them.
// Run `make build` first; needs `npx playwright install chromium`.
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extension = join(root, "dist", "chrome");
const out = join(root, "store", "screenshots");
const API = "https://unfret.kroshtan.com";
const SHOP = "https://shop.example/products/smart-watch";
const ADDRESS = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const MARK = `data:image/svg+xml;base64,${readFileSync(join(root, "brand", "unfret.svg")).toString("base64")}`;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'DejaVu Sans', Arial, sans-serif";

const MANY = {
  score: 14,
  explanation: "",
  charged: true,
  verdict: {
    band: "junk_or_scam",
    label: "Many warning signs",
    headline: "Many warning signs: fake countdown, unknown brand and a brand-new web shop.",
    reasons: [
      {
        type: "timer_resets",
        title: "Fake countdown",
        detail: "This countdown restarts when you reload the page: the deadline isn't real.",
        severity: "high",
      },
      {
        type: "generic_brand",
        title: "Unknown brand",
        detail:
          "“NOVAXEL” isn't a recognizable brand: usually a sign of generic factory goods sold under a made-up name.",
        severity: "medium",
      },
      {
        type: "new_domain",
        title: "Brand-new web shop",
        detail: "This web shop's address was registered only 3 weeks ago.",
        severity: "medium",
      },
      {
        type: "implausible_discount",
        title: "Unbelievable discount",
        detail: "78% off: discounts this deep are almost always measured against a price nobody paid.",
        severity: "medium",
      },
    ],
    positives: [],
    language: "en",
  },
};

const FINE = {
  score: 91,
  explanation: "",
  charged: true,
  verdict: {
    band: "reliable",
    label: "Looks fine",
    headline: "Nothing worrying stood out on this page.",
    reasons: [],
    positives: [
      { type: "known_brand", title: "Known brand", detail: "Philips is an established brand." },
      { type: "sold_by_brand", title: "Sold by the brand", detail: "Sold by the brand itself." },
      {
        type: "natural_reviews",
        title: "Natural-looking reviews",
        detail: "Ratings are mixed and spread over time, as you'd expect from real buyers.",
      },
      {
        type: "established_domain",
        title: "Established shop",
        detail: "This web shop's address has existed for 12 years.",
      },
    ],
    language: "en",
  },
};

const SHOTS = [
  {
    file: "1-many-warning-signs.png",
    title: "Know before you buy",
    line: "One click checks a product page for fake countdowns, made-up brands, brand-new shops and too-good discounts.",
    result: MANY,
  },
  {
    file: "2-looks-fine.png",
    title: "Plain words, not a score",
    line: "When a page looks fine, Unfret says so, and shows what looked good.",
    result: FINE,
  },
  {
    file: "3-consent.png",
    title: "Nothing is sent until you click",
    line: "Unfret reads a page only when you ask it to. No tracking, no affiliate links, no browsing history.",
    consent: true,
  },
];

function frame(shot, popup) {
  return `<body style="margin:0;width:1280px;height:800px;display:flex;align-items:center;gap:64px;padding:0 88px;
    box-sizing:border-box;background:linear-gradient(135deg,#f3faf7,#dff1ea);font-family:${FONT};color:#123b32">
    <div style="flex:1">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:28px">
        <img src="${MARK}" width="48" height="48"><span style="font-size:30px;font-weight:700">Unfret</span></div>
      <div style="font-size:50px;font-weight:700;line-height:1.1;letter-spacing:-0.01em">${shot.title}</div>
      <div style="font-size:24px;line-height:1.45;margin-top:22px;color:#1f5f50">${shot.line}</div>
    </div>
    <img src="data:image/png;base64,${popup.toString("base64")}" style="width:400px;max-height:720px;object-fit:contain;object-position:top;border-radius:14px;
      box-shadow:0 18px 50px rgba(18,59,50,.22);background:#fff">
  </body>`;
}

const userData = mkdtempSync(join(tmpdir(), "unfret-shots-"));
const context = await chromium.launchPersistentContext(userData, {
  channel: "chromium",
  headless: true,
  locale: "en-US",
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--lang=en-US"],
});
try {
  await context.route(`${API}/v1/credits`, (route) =>
    route.fulfill({ json: { address: ADDRESS, balance_usd_micros: 4_600_000, checks_remaining: 23 } }),
  );
  await context.route(`${API}/v1/pricing**`, (route) =>
    route.fulfill({
      json: { hot_wallet: "HotWa11etHotWa11etHotWa11etHotWa11etHotWa11", network: "solana-mainnet" },
    }),
  );
  await context.route(`${SHOP}**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Smart watch</title><h1>Smart watch</h1>",
    }),
  );
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  mkdirSync(out, { recursive: true });

  for (const shot of SHOTS) {
    const shop = await context.newPage();
    await shop.goto(SHOP);
    const tabId = await worker.evaluate(async () =>
      Math.max(...(await chrome.tabs.query({})).map((t) => t.id ?? -1)),
    );
    await worker.evaluate(
      async ({ tabId, result, consent, address }) => {
        await chrome.storage.local.set({
          session: { token: `t-${"x".repeat(30)}`, address, expiresAt: "2999-01-01T00:00:00.000Z" },
        });
        if (consent) await chrome.storage.local.remove("consent");
        else await chrome.storage.local.set({ consent: { version: 1 } });
        await chrome.storage.session.set({
          [`tab:${tabId}`]: result ? { status: "done", findings: [], steps: [], result } : { status: "idle" },
        });
      },
      { tabId, result: shot.result ?? null, consent: shot.consent === true, address: ADDRESS },
    );
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 600 });
    await popup.goto(`chrome-extension://${id}/popup/popup.html?tab=${tabId}`);
    await popup.waitForSelector(shot.consent ? "#consent:not([hidden])" : "#result:not([hidden])");
    await popup.waitForTimeout(400);
    // A cropped view: the result (or the consent screen) without the parts around it. In a headless browser the
    // shop tab isn't one the popup may check (no toolbar click), so its button would show as unavailable.
    await popup.addStyleTag({
      content: shot.consent
        ? "#account, #analyse, #hint { display: none !important; } section:has(#analyse) { display: none !important; }"
        : "section:has(#analyse) { display: none !important; }",
    });
    const height = await popup.evaluate(() =>
      Math.ceil(Math.max(...[...document.body.children].map((e) => e.getBoundingClientRect().bottom)) + 12),
    );
    await popup.setViewportSize({ width: 360, height: Math.min(Math.max(height, 300), 640) });
    const image = await popup.screenshot();
    const canvas = await context.newPage();
    await canvas.setViewportSize({ width: 1280, height: 800 });
    await canvas.setContent(frame(shot, image));
    await canvas.screenshot({ path: join(out, shot.file), scale: "css" });
    await Promise.all([canvas.close(), popup.close(), shop.close()]);
  }
} finally {
  await context.close();
  rmSync(userData, { recursive: true, force: true });
}
console.log(`screenshots in ${out}`);
