// Store screenshots (1280x800, US English, for the Chrome Web Store, addons.mozilla.org and Edge Add-ons): the real
// popup of dist/chrome, opened as a page in headless Chromium, showing a result, framed with a caption.
//
// Checks are free and there is no account, so nothing about a pass is staged. The results are in
// store/screenshots/results/*.json: test-shop.json is a real free deep check of the Unfret test shop (Unfret's own
// made-up shop, every trick on it fake on purpose, a banner on every view), made on the dev deployment by
// `make screenshots-capture` (scripts/screenshots-capture.mjs); level-0, level-2 and level-3.json are
// made up by hand for made-up shops on .example addresses, so no real shop, brand or product appears. They are put
// into the extension's session storage the way the background keeps a finished check. The price list (whether free
// deep checks are paused) and the "Wrong result?" catalogue (catalogue.json, dev's) are answered by routes. The test
// shop page behind the first screenshot and the result's photo thumbnails are loaded from https://dev.unfret.net.
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
const MARK = `data:image/svg+xml;base64,${readFileSync(join(root, "brand", "unfret.svg")).toString("base64")}`;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'DejaVu Sans', Arial, sans-serif";

/** A result to show (store/screenshots/results). */
const result = (name) =>
  JSON.parse(readFileSync(join(root, "store", "screenshots", "results", `${name}.json`), "utf8"));
const testShop = result("test-shop");
const catalogue = result("catalogue");

// The pause as the server sends it (contract: "the pause"), for the price list and a paused check.
const PAUSE = {
  reason: "spend_ceiling",
  scope: "day",
  retry_after_s: 20_000,
  quick_checks: true,
  message_key: "free_checks_run_on_donations",
  donate_url: `${API}/donate`,
};
const TEST_SHOP_NOTE = "Shown: the Unfret test shop, a made-up shop where every trick is fake on purpose.";
const MADE_UP_NOTE = "Shown: made-up example shops, products and brands.";

const SHOTS = [
  {
    file: "1-risk-level.png",
    title: "How risky is this page? Know before you pay.",
    line: "One risk level from 0 to 4, with every finding behind it and where it comes from. Fake shops, fake deals and fake reviews.",
    note: TEST_SHOP_NOTE,
    popup: { result: testShop, height: 600 },
    page: TEST_SHOP,
  },
  {
    file: "2-levels.png",
    title: "Not only fake shops",
    line: "Claims the specs contradict, generic goods at a brand price: Unfret says what the risk is, and why.",
    note: MADE_UP_NOTE,
    popups: [
      { result: result("level-3"), height: 640, label: "3 · May not work as described" },
      { result: result("level-2"), height: 640, label: "2 · May cost more than it's worth" },
    ],
  },
  {
    file: "3-no-concerns.png",
    title: "When nothing's wrong, it says so",
    line: "No score to decode: “No concerns found”, what looks good, and what Unfret checked.",
    note: MADE_UP_NOTE,
    popup: { result: result("level-0"), height: 600 },
  },
  {
    file: "4-wrong-result.png",
    title: "Wrong result? Tell us",
    line: "Pick the level you think is right and mark what's wrong or missing. Your report keeps the page, never who sent it.",
    note: MADE_UP_NOTE,
    popup: { result: result("level-3"), height: 600, report: true },
  },
  {
    file: "5-free.png",
    title: "Free. No account, no pass.",
    line: "Quick and deep checks are free, and nothing is read until you click. On a busy day deep checks pause until tomorrow; quick checks keep working.",
    popups: [
      { label: "Before a check", height: 400 },
      { paused: true, height: 400, label: "When today's free deep checks are used up" },
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
      ${caption(shot)}
      <div style="display:flex;gap:24px;align-items:flex-start">${popups}</div></div>`);
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
/** Whether the price list says free deep checks are paused (set per screenshot). */
let paused = false;
try {
  await context.route(`${API}/v1/pricing**`, (route) =>
    route.fulfill({
      json: {
        free: {
          quick_checks: true,
          deep_checks: true,
          paused,
          back_at: "00:00 UTC",
          ...(paused ? { pause: PAUSE } : {}),
          donate_url: `${API}/donate`,
        },
      },
    }),
  );
  await context.route(`${API}/v1/catalogue/findings`, (route) => route.fulfill({ json: catalogue }));
  await context.route("https://shop.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Example product</title><h1>Example product</h1>",
    }),
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
  await worker.evaluate(async () => chrome.storage.local.set({ consent: { version: 2 } })); // CONSENT_VERSION
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
        // With a share and a label token and the request, as a real check has, so "Share this result" and
        // "Wrong result?" show.
        await chrome.storage.session.set({
          [key]: {
            status: "done",
            findings: [],
            steps: [],
            body: { url: captured.url },
            result: { share_token: "t.mac", label_token: "store-screenshots", ...captured.result },
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

  /**
   * The popup on the shop's tab: a result (the check button hidden, as after a check), the "Wrong result?" form
   * opened on it, or the popup before a check (`paused`: free deep checks paused until tomorrow).
   */
  async function popupShot({ result: captured, height = 600, report, paused: pausedCheck = false }) {
    paused = pausedCheck;
    await stage(captured);
    const popup = await openPopup(
      height,
      captured
        ? "#result:not([hidden]) .verdict"
        : pausedCheck
          ? "#paused:not([hidden])"
          : "#analyse:not([disabled])",
    );
    // After a check the screenshot is about the result: the check button hidden.
    const hidden = captured ? ["#check"] : [];
    await popup.addStyleTag({
      content: `html { scrollbar-width: none; } ${hidden.length ? `${hidden.join(", ")} { display: none !important; }` : ""}`,
    });
    if (report) {
      // "Wrong result?" opened, a level picked and one finding marked wrong, as a shopper would.
      await popup.click("#report-open");
      await popup.waitForSelector("#report:not([hidden]) #report-wrong input");
      await popup.check('#report input[name="level"][value="2"]');
      await popup.locator('#report input[name="wrong"]').nth(1).check();
      await popup.evaluate(() => {
        const top = document.querySelector("#report")?.getBoundingClientRect().top ?? 0;
        window.scrollTo(0, top + window.scrollY - 16);
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
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

  for (const shot of SHOTS) {
    const images = { popups: [], page: undefined };
    for (const p of shot.popups ?? [shot.popup]) images.popups.push(await popupShot(p));
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
