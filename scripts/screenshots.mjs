// Store screenshots (1280x800, English, for the Chrome Web Store and addons.mozilla.org): the real popup of
// dist/chrome, opened as a page in headless Chromium, showing real results, framed with a caption.
//
// The results are real checks, made on the dev deployment by `make screenshots-capture`
// (scripts/screenshots-capture.mjs) and kept in store/screenshots/results/*.json: the Unfret test shop (Unfret's own
// made-up shop, every trick on it fake on purpose, a banner on every view) and a well-known shop's product page for a
// clean result, shown only inside the popup. They are put into the extension's session storage the way the
// background keeps a finished check; the account is answered by routes (no real pass). The test shop page behind the
// first screenshot and the result's photo thumbnails are loaded from https://dev.unfret.net.
//
// Run `make build` first; needs `npx playwright install chromium`. Usage:
//   node scripts/screenshots.mjs [--dark] [--out dir]   (default: light, into store/screenshots)
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dark = args.includes("--dark");
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : join(root, "store", "screenshots");
const API = "https://unfret.net";
const DEV = "https://dev.unfret.net";
const TEST_SHOP = `${DEV}/test-shop`;
// The tab each popup is opened on (a fresh one per screenshot: the background keeps a tab's result in memory).
const TAB = "https://shop.example/products/star-projector";
// The popup's own width (its body's, padding included).
const POPUP_WIDTH = 360;
const ADDRESS = "key:k7m2q9xw4t";
const MARK = `data:image/svg+xml;base64,${readFileSync(join(root, "brand", "unfret.svg")).toString("base64")}`;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'DejaVu Sans', Arial, sans-serif";

/** A captured result (scripts/screenshots-capture.mjs). */
const result = (name) =>
  JSON.parse(readFileSync(join(root, "store", "screenshots", "results", `${name}.json`), "utf8"));
const testShop = result("test-shop");
const clean = result("clean");

// The verdict heads alone, in the popup's own style, for "four answers" (no reasons: just the names).
const BANDS = [
  ["reliable", "Looks fine"],
  ["concerns", "Worth a look"],
  ["careful", "Think twice"],
  ["junk_or_scam", "Serious concerns"],
];

const TEST_SHOP_NOTE = "Shown: the Unfret test shop, a made-up shop where every trick is fake on purpose.";

const SHOTS = [
  {
    file: "1-fake-sellers.png",
    title: "Is this shop legit? Know before you pay.",
    line: "Fake sellers on big marketplaces, fake shops everywhere else: one click checks the seller, the shop and the deal.",
    note: TEST_SHOP_NOTE,
    popup: { result: testShop, height: 560 },
    page: TEST_SHOP,
  },
  {
    file: "2-same-product.png",
    title: "The same product, sold elsewhere for less",
    line: "Spots dropshipped goods, fake countdowns and “was” prices nobody paid. Every finding says where it comes from.",
    note: TEST_SHOP_NOTE,
    popup: { result: testShop, height: 720 },
  },
  {
    file: "3-what-we-checked.png",
    title: "What we checked, and what you can do",
    line: "Every area Unfret looked at, what stood out in each, and a clear next step before you pay.",
    note: TEST_SHOP_NOTE,
    popup: { result: testShop, height: 600, scrollTo: ".next-step" },
  },
  {
    file: "4-four-answers.png",
    title: "Four plain answers, not a score",
    line: "When the seller and the shop check out, Unfret says so too, and shows why.",
    popup: { result: clean, height: 720 },
    bands: true,
  },
  {
    file: "5-free-checks.png",
    title: "Free to start. No account.",
    line: "5 free deep checks when you install, then unlimited free quick checks. No e-mail, no tracking, and nothing is read until you click.",
    popups: [
      { credits: { checks: 5, free: 5 }, label: "When you install" },
      { credits: { checks: 0, free: 0 }, label: "Out of deep checks" },
    ],
  },
];

const theme = dark
  ? {
      bg: "linear-gradient(135deg,#0f1f1b,#132b25)",
      ink: "#e6f2ee",
      soft: "#a9cfc4",
      note: "#7fa79c",
      card: "#1b2421",
    }
  : {
      bg: "linear-gradient(135deg,#f3faf7,#dff1ea)",
      ink: "#123b32",
      soft: "#1f5f50",
      note: "#4f7d72",
      card: "#fff",
    };

const png = (buffer) => `data:image/png;base64,${buffer.toString("base64")}`;

function caption(shot, extra = "") {
  return `<div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:28px">
        <img src="${MARK}" width="44" height="44"><span style="font-size:28px;font-weight:700">Unfret</span></div>
      <div style="font-size:46px;font-weight:700;line-height:1.12;letter-spacing:-0.01em">${shot.title}</div>
      <div style="font-size:23px;line-height:1.45;margin-top:22px;color:${theme.soft}">${shot.line}</div>
      ${extra}
    </div>`;
}

const popupStyle = `border-radius:14px;box-shadow:0 18px 50px rgba(18,59,50,.25);background:${theme.card}`;

function frame(shot, images) {
  const note = shot.note
    ? `<div style="position:absolute;left:88px;bottom:34px;font-size:15px;color:${theme.note}">${shot.note}</div>`
    : "";
  const body = (inner) =>
    `<body style="margin:0;width:1280px;height:800px;position:relative;overflow:hidden;background:${theme.bg};
      font-family:${FONT};color:${theme.ink}">${inner}${note}</body>`;
  if (shot.page) {
    // The shop page in a browser window, the popup open over it under the toolbar, as on a real click.
    return body(`<div style="display:flex;align-items:center;gap:40px;height:100%;padding:0 0 0 88px;box-sizing:border-box">
      <div style="width:360px;flex:none">${caption(shot)}</div>
      <div style="position:relative;flex:none;width:792px;height:640px;border-radius:14px 0 0 14px;overflow:hidden;
        box-shadow:0 18px 50px rgba(18,59,50,.22);background:#fff">
        <div style="height:40px;background:#e9eeec;display:flex;align-items:center;gap:8px;padding:0 14px">
          <span style="width:11px;height:11px;border-radius:50%;background:#e06c5c"></span>
          <span style="width:11px;height:11px;border-radius:50%;background:#e8b84a"></span>
          <span style="width:11px;height:11px;border-radius:50%;background:#62b85b"></span>
          <span style="margin-left:14px;flex:1;height:24px;border-radius:12px;background:#fff;font-size:13px;color:#555;
            display:flex;align-items:center;padding-left:12px">unfret.net/test-shop</span>
          <img src="${MARK}" width="22" height="22" style="margin-left:8px;margin-right:14px">
        </div>
        <img src="${png(images.page)}" style="display:block;width:792px">
        <img src="${png(images.popups[0])}" style="position:absolute;top:46px;right:44px;width:330px;${popupStyle}">
      </div></div>`);
  }
  const bands = shot.bands
    ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:34px;max-width:560px">${images.bands
        .map((b) => `<img src="${png(b)}" style="width:100%;border-radius:12px">`)
        .join("")}</div>`
    : "";
  const labels = (shot.popups ?? []).map((p) => p.label);
  const popups = images.popups
    .map(
      (p, i) =>
        `<figure style="margin:0">${labels[i] ? `<figcaption style="font-size:18px;font-weight:600;margin:0 0 12px 4px;color:${theme.soft}">${labels[i]}</figcaption>` : ""}
        <img src="${png(p)}" style="display:block;width:${images.popups.length > 1 ? 340 : 400}px;max-height:720px;
          object-fit:contain;object-position:top;${popupStyle}"></figure>`,
    )
    .join("");
  return body(`<div style="display:flex;align-items:center;gap:56px;height:100%;padding:0 88px;box-sizing:border-box">
      ${caption(shot, bands)}
      <div style="display:flex;gap:24px;align-items:center">${popups}</div></div>`);
}

// A copy of the store build that may read the shop tab's address (what a toolbar click grants with activeTab), so the
// popup treats it as a page it can check.
const extension = mkdtempSync(join(tmpdir(), "unfret-shots-ext-"));
cpSync(join(root, "dist", "chrome"), extension, { recursive: true });
const manifestPath = join(extension, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.host_permissions = ["https://shop.example/*"];
writeFileSync(manifestPath, JSON.stringify(manifest));

const userData = mkdtempSync(join(tmpdir(), "unfret-shots-"));
const context = await chromium.launchPersistentContext(userData, {
  channel: "chromium",
  headless: true,
  locale: "en-US",
  deviceScaleFactor: 2,
  colorScheme: dark ? "dark" : "light",
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--lang=en-US"],
});
let credits = { checks: 23, free: 0 };
try {
  await context.route(`${API}/v1/credits`, (route) =>
    route.fulfill({
      json: {
        address: ADDRESS,
        balance_lamports: 0,
        checks_remaining: credits.checks,
        free_checks_remaining: credits.free,
        invite_eligible: false,
      },
    }),
  );
  await context.route("https://shop.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Star projector</title><h1>Star projector</h1>",
    }),
  );
  await context.route(`${API}/v1/pricing**`, (route) =>
    route.fulfill({ json: { network: "solana-mainnet" } }),
  );
  // The result's thumbnails, as production will serve them, from the dev deployment the check ran on.
  await context.route(`${API}/v1/images/**`, async (route) => {
    const response = await fetch(route.request().url().replace(API, DEV));
    await route.fulfill({
      status: response.status,
      contentType: response.headers.get("content-type") ?? "image/jpeg",
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  await worker.evaluate(
    async (address) =>
      chrome.storage.local.set({
        session: {
          token: `ufk_${"x".repeat(40)}`,
          address,
          expiresAt: "9999-12-31T00:00:00.000Z",
          kind: "key",
        },
        consent: { version: 2 }, // CONSENT_VERSION (src/shared/settings.ts)
      }),
    ADDRESS,
  );
  const shop = await context.newPage();
  await shop.setViewportSize({ width: 1180, height: 1000 });
  await shop.goto(TEST_SHOP, { waitUntil: "load" });
  await shop.waitForTimeout(1000);
  let tabId = -1;
  mkdirSync(out, { recursive: true });

  /** The shop tab's finished check, as the background keeps it (none: before a check). */
  async function stage(captured) {
    const tab = await context.newPage();
    await tab.goto(TAB);
    tabId = await worker.evaluate(async () =>
      Math.max(...(await chrome.tabs.query({})).map((t) => t.id ?? -1)),
    );
    await worker.evaluate(
      async ({ tabId, captured }) => {
        const key = `tab:${String(tabId)}`;
        if (!captured) return chrome.storage.session.remove(key);
        // With a share token, as a real check has, so "Share this result" shows.
        await chrome.storage.session.set({
          [key]: {
            status: "done",
            findings: [],
            steps: [],
            body: { url: captured.url },
            result: { share_token: "t.mac", ...captured.result },
          },
        });
      },
      { tabId, captured: captured ?? null },
    );
  }

  async function openPopup(height, ready) {
    const popup = await context.newPage();
    await popup.setViewportSize({ width: POPUP_WIDTH, height });
    await popup.goto(`chrome-extension://${id}/popup/popup.html?tab=${String(tabId)}`);
    await popup.waitForSelector(ready);
    await popup.waitForLoadState("networkidle");
    await popup.waitForTimeout(500);
    return popup;
  }

  /** The popup on the shop's tab: a result (cropped to the result card), or the account before a check. */
  async function popupShot({ result: captured, height = 600, scrollTo, credits: given }) {
    credits = given ?? { checks: 23, free: 0 };
    await stage(captured);
    const popup = await openPopup(
      height,
      captured ? "#result:not([hidden]) .verdict" : "#credits:not([hidden])",
    );
    await popup.addStyleTag({
      content: `html { scrollbar-width: none; } ${captured ? "#check, #account" : "#invite"} { display: none !important; }`,
    });
    if (scrollTo) {
      // Scrolled down, as the popup (at most 600 px high) shows a long result.
      await popup.evaluate((selector) => {
        const top = document.querySelector(selector)?.getBoundingClientRect().top ?? 0;
        window.scrollTo(0, top + window.scrollY - 56);
      }, scrollTo);
    } else {
      const bottom = await popup.evaluate(() =>
        Math.ceil(Math.max(...[...document.body.children].map((e) => e.getBoundingClientRect().bottom)) + 12),
      );
      await popup.setViewportSize({ width: POPUP_WIDTH, height: Math.min(bottom, height) });
    }
    await popup.waitForTimeout(200);
    const image = await popup.screenshot();
    await popup.close();
    return image;
  }

  /** A verdict head alone, as the popup shows it. */
  async function bandShot([band, label]) {
    await stage({
      url: TEST_SHOP,
      result: { score: 50, explanation: "", verdict: { band, label, headline: "" } },
    });
    const popup = await openPopup(400, "#result:not([hidden]) .verdict");
    const head = await popup.locator("#result-body .verdict").screenshot();
    await popup.close();
    return head;
  }

  for (const shot of SHOTS) {
    const images = {
      popups: [],
      bands: [],
      page: undefined,
    };
    for (const p of shot.popups ?? [shot.popup]) images.popups.push(await popupShot(p));
    if (shot.bands) for (const band of BANDS) images.bands.push(await bandShot(band));
    if (shot.page) images.page = await shop.screenshot({ clip: { x: 0, y: 0, width: 1180, height: 930 } });
    const canvas = await context.newPage();
    await canvas.setViewportSize({ width: 1280, height: 800 });
    await canvas.setContent(frame(shot, images));
    await canvas.waitForLoadState("load");
    await canvas.screenshot({ path: join(out, shot.file), scale: "css" });
    await canvas.close();
  }
} finally {
  await context.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(extension, { recursive: true, force: true });
}
console.log(`screenshots in ${out}`);
