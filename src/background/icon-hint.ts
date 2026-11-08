/**
 * The marketplace hint: on supported marketplace product pages the toolbar icon gets a small marker, set by the
 * browser through `declarativeContent` rules. The extension never sees those pages (no host permission); the browser
 * matches the URL and swaps the icon, and reverts it when the page no longer matches. Firefox has no
 * `declarativeContent`, so there the hint is simply absent.
 */

import { AMBER } from "./badge.js";
import { marketplaceUrlPatterns } from "../shared/sites.js";

const SIZES = [16, 32] as const;

/** The default icon at `size` with a marker dot in the bottom-right corner. */
async function markedIcon(size: number): Promise<ImageData> {
  const response = await fetch(chrome.runtime.getURL(`icons/icon-${size}.png`));
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0, size, size);
  const r = size * 0.24;
  const c = size - r - size * 0.04;
  ctx.beginPath();
  ctx.arc(c, c, r + size * 0.06, 0, 2 * Math.PI);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(c, c, r, 0, 2 * Math.PI);
  ctx.fillStyle = AMBER;
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

/** (Re)register the rules. Safe to call on every install, update and startup. */
export async function registerMarketplaceHint(): Promise<void> {
  // Firefox (and any browser without the API): no hint, nothing to register.
  if (typeof chrome.declarativeContent === "undefined") return;
  const imageData: Record<number, ImageData> = {};
  for (const size of SIZES) imageData[size] = await markedIcon(size);
  const dc = chrome.declarativeContent;
  await new Promise<void>((resolve) => {
    dc.onPageChanged.removeRules(undefined, () => {
      dc.onPageChanged.addRules(
        [
          {
            conditions: marketplaceUrlPatterns().map(
              (urlMatches) => new dc.PageStateMatcher({ pageUrl: { urlMatches } }),
            ),
            actions: [new dc.SetIcon({ imageData })],
          },
        ],
        () => {
          resolve();
        },
      );
    });
  });
}
