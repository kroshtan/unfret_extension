// Render the brand assets from the SVG sources in brand/: the toolbar and store icons (icons/icon-*.png), Unfret Dev's
// grey icons with a DEV label (icons-dev/icon-*.png) and the
// Chrome Web Store promo images (store/assets). Uses the Chromium that Playwright installs for the smoke tests
// (`npx playwright install chromium`); the PNGs are committed, so a normal build needs none of this.
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = (name) => readFileSync(join(root, "brand", name), "utf8");
const dataUrl = (text) => `data:image/svg+xml;base64,${Buffer.from(text).toString("base64")}`;
const MARK = dataUrl(svg("unfret.svg"));
const SMALL = dataUrl(svg("unfret-small.svg"));

// Icon sizes: 16 px uses the simplified mark (the eyes vanish at that size). The 128 px icon keeps 16 px of
// transparent padding around 96 px of artwork, as the Chrome Web Store asks.
const ICONS = [
  { size: 16, src: SMALL, pad: 0 },
  { size: 32, src: MARK, pad: 0 },
  { size: 48, src: MARK, pad: 0 },
  { size: 128, src: MARK, pad: 16 },
];

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'DejaVu Sans', Arial, sans-serif";

function promo(width, height, { mark, title, line, sub }) {
  return `<body style="margin:0;width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;
    gap:${Math.round(height * 0.09)}px;background:linear-gradient(135deg,#f3faf7,#dff1ea);font-family:${FONT};color:#123b32">
    <img src="${MARK}" width="${mark}" height="${mark}">
    <div><div style="font-size:${title}px;font-weight:700;letter-spacing:-0.02em;line-height:1">Unfret</div>
    <div style="font-size:${line}px;margin-top:${Math.round(line * 0.5)}px;color:#1f5f50">Shop without the worry.</div>
    ${sub ? `<div style="font-size:${sub}px;margin-top:${Math.round(sub * 0.6)}px;color:#3d6e62;max-width:${Math.round(width * 0.5)}px">Fake discounts, made-up brands, dropshipped goods and pushy tricks, spotted before you buy.</div>` : ""}
    </div></body>`;
}

const browser = await chromium.launch();
try {
  for (const { size, src, pad } of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const art = size - 2 * pad;
    await page.setContent(
      `<body style="margin:0;background:transparent"><img src="${src}" width="${art}" height="${art}" style="display:block;margin:${pad}px"></body>`,
    );
    await page.screenshot({ path: join(root, "icons", `icon-${size}.png`), omitBackground: true });
    // Unfret Dev: the same mark in grey, with a DEV label along the bottom (just grey at 16 px, too small for text).
    const label = size >= 32 ? Math.round(size * 0.36) : 0;
    await page.setContent(
      `<body style="margin:0;background:transparent;position:relative;width:${size}px;height:${size}px">
      <img src="${src}" width="${art}" height="${art}" style="display:block;margin:${pad}px;filter:grayscale(1) brightness(0.9)">
      ${label ? `<div style="position:absolute;left:${pad}px;right:${pad}px;bottom:${pad}px;height:${label}px;background:#b42318;color:#fff;font:700 ${Math.round(label * 0.8)}px/${label}px ${FONT};text-align:center;border-radius:${Math.round(label * 0.2)}px">DEV</div>` : ""}</body>`,
    );
    mkdirSync(join(root, "icons-dev"), { recursive: true });
    await page.screenshot({ path: join(root, "icons-dev", `icon-${size}.png`), omitBackground: true });
    await page.close();
  }
  mkdirSync(join(root, "store", "assets"), { recursive: true });
  for (const [name, width, height, opts] of [
    ["promo-small-440x280.png", 440, 280, { mark: 112, title: 52, line: 20 }],
    ["promo-marquee-1400x560.png", 1400, 560, { mark: 240, title: 120, line: 44, sub: 28 }],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(promo(width, height, opts));
    await page.screenshot({ path: join(root, "store", "assets", name) });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log("rendered icons/icon-{16,32,48,128}.png, icons-dev/ and store/assets/promo-*.png");
