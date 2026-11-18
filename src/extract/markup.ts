/**
 * What the page's markup names, for the app and supplier traces the backend finds in raw HTML. A port of the
 * backend's `facts/markup.py`; the parity tests keep the two in step.
 *
 * A shop's apps leave their names in the markup rather than in the text: a review importer's widget class
 * (`loox-reviews-widget`), a dropshipping app's data attribute (`data-dsers-variant-sync`), a pop-up's class
 * (`sales-pop`), a product photo still on the supplier's image CDN (`ae01.alicdn.com`). The extension never sends
 * the raw HTML, so these facts carry the same traces, and a quick check gives the same answer for a page the server
 * fetched and one the extension read:
 *
 * - `markup_names`: the class names, ids and data-attribute names of the page's elements. Names only, never an
 *   attribute's value or any text, and only identifier-like names without a run of four digits (no customer or order
 *   numbers).
 * - `external_refs`: the other sites the page's elements refer to: for a link, the site and the path; for anything
 *   else (an image, a frame, a stylesheet), the site alone. Never a query string or a fragment, never on a private
 *   seller's ad.
 *
 * Areas that could hold the visitor's own details (forms and their fields, account menus, greetings, checkout; see
 * `business.ts`) give only their own element's names, never anything inside them.
 */

import { type PageFacts, PRIVATE_SELLER_PLATFORMS } from "../shared/facts.js";
import { isAddressMarked, isBusiness, isPrivate } from "./business.js";
import { attr, cut, dedupe, tagName } from "./dom.js";

export const MAX_NAMES = 500;
export const MAX_REFS = 200;
const MAX_REF_CHARS = 300;
const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{1,63}$/u;
const DIGITS_RE = /[0-9]{4}/u;
// An absolute or protocol-relative address: the host (with any user and port) and the path, up to a query or fragment.
const URL_RE = /^(?:https?:)?\/\/([^/?#\s]+)([^?#\s]*)/iu;
const PORT_RE = /:[0-9]*$/u;
// Their own names count, nothing inside them is read: scripts and styles (script URLs are in `script_srcs`),
// templates and noscript (markup a browser doesn't build, or holds as text).
const LEAF_TAGS = new Set(["script", "style", "template", "noscript"]);
const LINK_TAGS = new Set(["a", "area"]);

function isName(token: string): boolean {
  return NAME_RE.test(token) && !DIGITS_RE.test(token);
}

/** Whitespace-separated tokens, as Python's `str.split()` (and bs4's class lists) give them. */
function tokens(value: string): string[] {
  return value.split(/\s+/u).filter(Boolean);
}

/** The host (lower case, without user or port) and path of an absolute or protocol-relative address. */
export function hostAndPath(value: string): [string, string] | null {
  const match = URL_RE.exec(value.trim());
  if (!match) return null;
  const user = match[1] ?? "";
  const host = user
    .slice(user.lastIndexOf("@") + 1)
    .replace(PORT_RE, "")
    .toLowerCase();
  return host ? [host, match[2] ?? ""] : null;
}

function refs(el: Element, ownHost: string): string[] {
  const found: string[] = [];
  const link = LINK_TAGS.has(tagName(el));
  for (const { name, value } of Array.from(el.attributes)) {
    const candidates = name.endsWith("srcset")
      ? value
          .split(",")
          .map((part) => tokens(part)[0])
          .filter((part): part is string => part !== undefined)
      : [value];
    for (const candidate of candidates) {
      const address = hostAndPath(candidate);
      if (!address || address[0] === ownHost) continue;
      found.push(cut(link ? address[0] + address[1] : address[0], MAX_REF_CHARS));
    }
  }
  return found;
}

/**
 * Fill `markup_names` and `external_refs`. In document order, data-attribute names first, then ids, then class
 * names (a page with a thousand utility classes still sends its apps' attributes and ids).
 */
export function extractMarkup(doc: Document, url: string, facts: PageFacts): void {
  const ownHost = hostAndPath(url)?.[0] ?? "";
  const refsAllowed = !PRIVATE_SELLER_PLATFORMS.has(facts.platform);
  const data: string[] = [];
  const ids: string[] = [];
  const classes: string[] = [];
  const found: string[] = [];
  const stack: [Element, boolean][] = Array.from(doc.children)
    .reverse()
    .map((el): [Element, boolean] => [el, false]);
  for (let item = stack.pop(); item; item = stack.pop()) {
    const [el, business] = item;
    const inside = business || isBusiness(el);
    for (const { name } of Array.from(el.attributes)) if (name.startsWith("data-")) data.push(name);
    if (el.hasAttribute("id")) ids.push(...tokens(attr(el, "id")).slice(0, 1));
    classes.push(...tokens(attr(el, "class")));
    if (LEAF_TAGS.has(tagName(el)) || isPrivate(el) || (isAddressMarked(el) && !inside)) continue;
    if (refsAllowed) found.push(...refs(el, ownHost));
    for (const child of Array.from(el.children).reverse()) stack.push([child, inside]);
  }
  facts.markup_names = dedupe([...data, ...ids, ...classes])
    .filter(isName)
    .slice(0, MAX_NAMES);
  facts.external_refs = dedupe(found).slice(0, MAX_REFS);
}
