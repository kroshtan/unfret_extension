/**
 * The page text sent for the content analysis: the backend's `strip_to_text` (noise tags removed, strings joined
 * by newlines, whitespace collapsed), plus privacy stripping, because the live page belongs to a logged-in user:
 * account menus, greetings, forms and their fields, checkout, billing and delivery areas never leave the browser.
 * An element marked as an address is kept only inside an area where the business publishes its own details (a
 * contact, legal or imprint section, Organization or address microdata; see `business.ts`), so a shop's or service
 * company's published address can be read while the visitor's own address is still stripped. When in doubt, strip.
 */

import { isBusiness, isExcluded } from "./business.js";
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

const MAX_TEXT_CHARS = 200_000;

/** The outermost elements under `root` (itself included) that may hold the visitor's own details. */
export function privateElements(root: Element): Element[] {
  const found: Element[] = [];
  const stack: [Element, boolean][] = [[root, false]];
  for (let item = stack.pop(); item; item = stack.pop()) {
    const [el, business] = item;
    const inside = business || isBusiness(el);
    if (isExcluded(el, inside)) {
      found.push(el);
      continue;
    }
    for (const child of Array.from(el.children).reverse()) stack.push([child, inside]);
  }
  return found;
}

/** Visible product text from a copy of `root` (the live page is never modified). */
export function cleanText(root: Element): string {
  const copy = root.cloneNode(true) as Element;
  for (const el of Array.from(copy.querySelectorAll(NOISE_TAGS.join(",")))) el.remove();
  const excluded = privateElements(copy);
  if (excluded.includes(copy)) return ""; // the whole page is an account, checkout or login page
  for (const el of excluded) el.remove();
  const joined = rawText(copy, "\n")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return joined.slice(0, MAX_TEXT_CHARS);
}
