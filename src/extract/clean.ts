/**
 * The page text sent for the content analysis: the backend's `strip_to_text` (noise tags removed, strings joined
 * by newlines, whitespace collapsed), plus privacy stripping, because the live page belongs to a logged-in user:
 * account menus, delivery addresses, greetings and forms never leave the browser.
 */

import { rawText } from "./dom.js";

const NOISE_TAGS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "img",
  "header",
  "footer",
  "nav",
  "aside",
  "form",
  "button",
  "meta",
  "link",
  "head",
];

// Personal areas on marketplaces and shops (Amazon, bol.com, generic account/address widgets).
const PRIVATE_SELECTORS = [
  "#nav-belt",
  "#nav-main",
  "#nav-tools",
  "#glow-ingress-block",
  "#nav-global-location-slot",
  "#contextualIngressPt",
  "#deliveryBlockMessage",
  "[id*='account' i]",
  "[class*='account' i]",
  "[id*='address' i]",
  "[class*='address' i]",
  "[id*='greeting' i]",
  "[class*='greeting' i]",
  "[id*='customer-name' i]",
  "[class*='customer-name' i]",
  "[data-testid*='account' i]",
  "[aria-label*='account' i]",
  "[autocomplete]",
  "input",
  "textarea",
  "select",
];

const MAX_TEXT_CHARS = 200_000;

/** Visible product text from a copy of `root` (the live page is never modified). */
export function cleanText(root: Element): string {
  const copy = root.cloneNode(true) as Element;
  for (const el of Array.from(copy.querySelectorAll([...NOISE_TAGS, ...PRIVATE_SELECTORS].join(","))))
    el.remove();
  const joined = rawText(copy, "\n")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return joined.slice(0, MAX_TEXT_CHARS);
}
