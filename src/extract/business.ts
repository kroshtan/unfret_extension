/**
 * The business facts on a page: what a shop or service company publishes about itself, and nothing about the
 * visitor. A port of the backend's `facts/business.py`; the parity tests keep the two in step.
 *
 * Contacts, addresses and identity statements are read only from what the business publishes: structured data
 * (Organization/LocalBusiness JSON-LD), `tel:` and `mailto:` links, and contact areas (the footer, contact, legal and
 * imprint sections). Areas that could hold the visitor's own details are skipped whatever they contain: forms and
 * their fields, account menus, greetings, checkout, billing and delivery areas, and any element marked as an
 * address outside a contact area. In the browser the visitor may be logged in, so this matters here most.
 */

import {
  type Email,
  type Licence,
  type Link,
  type PageFacts,
  type Phone,
  type PhoneKind,
  PRIVATE_SELLER_PLATFORMS,
} from "../shared/facts.js";
import { attr, cut, dedupe, squash, stripChars, tagName, text, urljoin } from "./dom.js";
import { pyJsonLength } from "./pyjson.js";

type Json = Record<string, unknown>;

// ── Which areas are the visitor's and which the business's ──────────────────────────────────────────────────

const PRIVATE_TAGS = new Set(["form", "input", "textarea", "select"]);
// Amazon's account and delivery-location widgets.
const PRIVATE_IDS = new Set([
  "nav-belt",
  "nav-main",
  "nav-tools",
  "glow-ingress-block",
  "nav-global-location-slot",
  "contextualIngressPt",
  "deliveryBlockMessage",
]);
// Matched in id, class, data-testid and aria-label (lower case).
export const PRIVATE_WORDS = [
  "account",
  "greeting",
  "customer-name",
  "checkout",
  "billing",
  "deliver-to",
  "delivery-address",
  "shipping-address",
  "login",
  "signin",
  "sign-in",
  "user-menu",
  "usermenu",
];
// Matched in id and class: the areas where a business publishes its own details.
export const BUSINESS_WORDS = [
  "footer",
  "contact",
  "imprint",
  "impressum",
  "legal",
  "colofon",
  "colophon",
  "about",
  "company",
  "kontakt",
];
const BUSINESS_ITEMTYPES = ["organization", "localbusiness", "postaladdress"];
const SKIP_TAGS = new Set(["script", "style", "template"]);

/** Whether an element may hold the visitor's own details (its whole subtree is skipped). */
export function isPrivate(el: Element): boolean {
  if (PRIVATE_TAGS.has(tagName(el)) || el.hasAttribute("autocomplete") || PRIVATE_IDS.has(attr(el, "id"))) {
    return true;
  }
  const marks = ["id", "class", "data-testid", "aria-label"]
    .map((a) => attr(el, a))
    .join(" ")
    .toLowerCase();
  return PRIVATE_WORDS.some((word) => marks.includes(word));
}

/** Whether an element is an area where the business publishes its own details. */
export function isBusiness(el: Element): boolean {
  if (tagName(el) === "footer") return true;
  const marks = `${attr(el, "id")} ${attr(el, "class")}`.toLowerCase();
  const itemtype = attr(el, "itemtype").toLowerCase();
  return (
    BUSINESS_WORDS.some((w) => marks.includes(w)) || BUSINESS_ITEMTYPES.some((t) => itemtype.includes(t))
  );
}

/** Whether an element is an address (`<address>`, or "address" in its id or class): kept only in a business area. */
export function isAddressMarked(el: Element): boolean {
  return (
    tagName(el) === "address" || `${attr(el, "id")} ${attr(el, "class")}`.toLowerCase().includes("address")
  );
}

/** Whether an element is left out: private, or marked as an address outside a business area (`inside`). */
export function isExcluded(el: Element, inside: boolean): boolean {
  return isPrivate(el) || (isAddressMarked(el) && !inside);
}

interface Scan {
  public: string[];
  business: string[];
  links: [string, string][];
  alts: string[];
  addresses: string[];
}

function scanPage(doc: Document): Scan {
  // Document order, skipping private subtrees, as the backend walks the soup.
  const scan: Scan = { public: [], business: [], links: [], alts: [], addresses: [] };
  const stack: [Node, boolean][] = Array.from(doc.childNodes)
    .reverse()
    .map((n): [Node, boolean] => [n, false]);
  for (let item = stack.pop(); item; item = stack.pop()) {
    const [node, business] = item;
    if (node.nodeType === 1) {
      const el = node as Element;
      const inside = business || isBusiness(el);
      if (SKIP_TAGS.has(tagName(el)) || isExcluded(el, inside)) continue;
      collect(el, inside, scan);
      for (const child of Array.from(el.childNodes).reverse()) stack.push([child, inside]);
    } else if (node.nodeType === 3) {
      const data = (node as Text).data;
      // In a browser with scripting on, <noscript> holds its markup as raw text; that is not page text.
      if (node.parentElement?.tagName === "NOSCRIPT" && data.includes("<")) continue;
      scan.public.push(data);
      if (business) scan.business.push(data);
    }
  }
  return scan;
}

/** The page's text outside the areas that could hold the visitor's details (forms, account menus, checkout). */
export function publicText(doc: Document): string {
  return squash(scanPage(doc).public.join(" "));
}

function collect(el: Element, inside: boolean, scan: Scan): void {
  const name = tagName(el);
  if (name === "a" && el.hasAttribute("href")) scan.links.push([attr(el, "href"), text(el)]);
  else if (name === "img" && el.hasAttribute("alt")) scan.alts.push(attr(el, "alt"));
  const isAddress = name === "address" || attr(el, "itemprop") === "address";
  if (inside && isAddress && !el.querySelector("form,input,textarea,select")) scan.addresses.push(text(el));
}

// ── Patterns ────────────────────────────────────────────────────────────────────────────────────────────────

const PAYMENT_METHODS: [string, RegExp][] = [
  ["paypal", /paypal/iu],
  ["credit_card", /credit ?cards?|creditcard|kreditkarte|carte bancaire|carte de cr[ée]dit/iu],
  ["visa", /(?<![a-z0-9])visa(?![a-z0-9])/iu],
  ["mastercard", /master ?card/iu],
  ["amex", /american express|(?<![a-z0-9])amex(?![a-z0-9])/iu],
  ["maestro", /(?<![a-z0-9])maestro(?![a-z0-9])/iu],
  ["ideal", /(?<![A-Za-z0-9])iDEAL(?![A-Za-z0-9])/u],
  ["bancontact", /bancontact/iu],
  ["klarna", /klarna/iu],
  ["afterpay", /afterpay|clearpay|riverty/iu],
  ["sofort", /(?<![a-z0-9])sofort(?![a-z0-9])/iu],
  ["giropay", /giropay/iu],
  ["apple_pay", /apple ?pay/iu],
  ["google_pay", /google ?pay|g ?pay(?![a-z0-9])/iu],
  ["sepa", /(?<![a-z0-9])sepa(?![a-z0-9])/iu],
  ["bank_transfer", /bank ?transfer|wire transfer|overboeking|bankoverschrijving|überweisung|virement/iu],
  ["tikkie", /tikkie/iu],
  [
    "crypto",
    /bitcoin|cryptocurrenc|crypto ?(?:payment|currency|currencies)|ethereum|(?<![a-z0-9])usdt(?![a-z0-9])/iu,
  ],
  ["gift_card", /gift ?cards?|cadeaukaart|gutschein|itunes card|google play card|steam card/iu],
  ["western_union", /western union/iu],
  ["moneygram", /moneygram/iu],
  ["cash_on_delivery", /cash on delivery|rembours|nachnahme|contre-remboursement/iu],
  ["cash", /(?<![a-z0-9])cash(?![a-z0-9])|(?<![a-z0-9])contant(?![a-z0-9])/iu],
];
const FOUNDED_RE =
  /(?<![a-z0-9])(?:since|established(?: in)?|est\.|founded(?: in)?|opgericht(?: in)?|sinds|seit|gegr[üu]ndet(?: im jahr)?|depuis|fond[ée]e? en|desde)\s+(?:1[89]\d\d|20[0-3]\d)(?![0-9])/giu;
const KVK_RE =
  /(?<![a-z])(?:kvk|k\.v\.k\.|kamer van koophandel|chamber of commerce|coc)(?:[\s.:#-]|nummer|number|nr|no)*(\d{4} ?\d{4})(?![0-9])/giu;
const LICENCE_RE =
  /(?<![A-Za-z])(?:([A-Z]{2})\s+)?(?:[Ss]tate\s+)?(?:[Cc]ontractor'?s?\s+)?(?:[Ll]ic(?:ense|ence)?|LIC(?:ENSE|ENCE)?|CSLB|ROC)\.?\s*(?:#|[Nn]o\.?|[Nn]umber|[Nn]r\.?)?\s*:?\s*#?\s*([A-Z]{0,4}[-.]?\d{5,10})(?![0-9])/gu;
// Street addresses written out in a business area (a footer, a contact block) rather than marked up: a house number,
// a street and a ZIP, or a street, a number and a Dutch postcode. A post-office box is not one (backend parity).
const US_STREET_ADDRESS_RE =
  /(?<![A-Za-z0-9#])\d{1,6} (?:(?:[A-Z][A-Za-z.'-]*|\d{1,3}(?:st|nd|rd|th)) ){1,5}?(?:St|Street|Rd|Road|Dr|Drive|Ave|Avenue|Blvd|Boulevard|Ln|Lane|Way|Pkwy|Parkway|Hwy|Highway|Ct|Court|Cir|Circle|Pl|Place|Trl|Trail|Ter|Terrace|Pike|Loop|Sq|Square)\.?,?(?: (?:Ste|Suite|Unit|Apt|Bldg|#)\.? ?#?[A-Za-z0-9-]+,?)? (?:[A-Z][A-Za-z.'-]* ){0,3}?[A-Z][A-Za-z.'-]*,? (?:[A-Z]{2}|[A-Z][a-z]+(?: [A-Z][a-z]+)?) \d{5}(?:-\d{4})?(?![0-9])/gu;
const NL_STREET_ADDRESS_RE =
  /(?<![A-Za-zÀ-ÿ0-9.])[A-Z][a-zà-ÿ'-]+(?:[ -][A-Za-zà-ÿ'-]+){0,3} \d{1,5}(?: ?[a-zA-Z](?![a-zA-Z])| ?- ?\d{1,4})?,? [1-9]\d{3} ?[A-Z]{2}(?![A-Za-z])/gu;

/** Street addresses written out in the business areas' text (not marked up as an address), in page order. */
function textAddresses(business: string): string[] {
  const found = [...business.matchAll(US_STREET_ADDRESS_RE), ...business.matchAll(NL_STREET_ADDRESS_RE)];
  return found
    .sort((a, b) => a.index - b.index)
    .map((m) => m[0])
    .filter((a) => !a.toLowerCase().includes("postbus"));
}

/** Whether a written-out address is one already known in another spelling: its house number and postcode are in it. */
function alreadyKnown(address: string, known: string[]): boolean {
  const numbers = address.match(/[0-9]+/g) ?? [];
  const first = numbers[0];
  const last = numbers.at(-1);
  if (first === undefined || last === undefined) return false;
  return known.some((k) => k.includes(first) && k.includes(last));
}

const US_STATES = new Set(
  (
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK " +
    "OR PA RI SC SD TN TX UT VT VA WA WV WI WY"
  ).split(" "),
);
const CERTIFICATION_RE =
  /(?<![a-z])(?:licensed|insured|bonded|certified|gecertificeerd|erkend|keurmerk|techniek nederland|installq|(?<![a-z])vca(?![a-z])|gas safe|niceic|(?<![a-z])bbb(?![a-z])|kiwa|(?<![a-z])skg(?![a-z]))/giu;
const PROMISE_RE =
  /24\/7|24 uur|24 hours|24h(?![a-z0-9])|within \d+ (?:minutes|hours)|binnen \d+ (?:minuten|uur)|same[ -]day|(?:de)?zelfde dag|spoedservice|(?<![a-z])spoed(?![a-z])|emergency/giu;
const PRICING_RE =
  /call-?out(?: fee| charge)?|voorrijkosten|free (?:quote|estimate)|gratis offerte|vrijblijvende offerte|fixed price|vaste prijs|upfront|vooraf betalen|vooruitbetaling|aanbetaling|(?<![a-z])deposit(?![a-z])|cash only|alleen contant|per hour|per uur|uurtarief|hourly rate/giu;
const LEGAL_FORM_RE =
  /(?<![A-Za-z])(B\.V\.|BV|V\.O\.F\.|VOF|N\.V\.|NV|[Ee]enmanszaak|L\.L\.C\.|LLC|PLLC|LLP|Inc\.|Inc|Corp\.|Corp|Corporation|Ltd\.|Ltd|Limited|GmbH|SARL|SAS|S\.L\.|S\.r\.l\.)(?![A-Za-z])/u;
const EMAIL_RE =
  /(?<![A-Za-z0-9._%+-])([A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24})(?![A-Za-z0-9-])/gu;
const NOT_A_BUSINESS_EMAIL_RE =
  /@(?:example\.|sentry|wixpress\.com|shopify\.com|domain\.com|email\.com|yourdomain|test\.)|^(?:noreply|no-reply|donotreply|name|user|your|email|info@example)/iu;
const FILE_SUFFIX_RE = /\.(?:png|jpe?g|gif|webp|svg|css|js)$/iu;
const WEBMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.nl",
  "hotmail.co.uk",
  "outlook.com",
  "outlook.nl",
  "live.com",
  "live.nl",
  "msn.com",
  "yahoo.com",
  "yahoo.nl",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "aol.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "protonmail.com",
  "proton.me",
  "mail.com",
  "ziggo.nl",
  "kpnmail.nl",
  "planet.nl",
  "home.nl",
  "hetnet.nl",
  "casema.nl",
  "xs4all.nl",
  "telenet.be",
  "skynet.be",
  "comcast.net",
  "att.net",
  "verizon.net",
  "yandex.com",
]);
// Phone numbers in contact areas: with a country code, in Dutch national format (0 + nine digits; 0800/0900
// numbers), or in US format with separators. tel: links take any number.
const PHONE_RE =
  /(?<![A-Za-z0-9+])(?:\+\d{1,3}[\s.-]?(?:\(0\)[\s.-]?)?\d[\d\s.-]{6,16}\d|0[89]0[069][\s-]?\d{4}(?:\d{3})?|0(?:[\s.-]?\d){9}|(?:1[\s.-])?\(?[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4})(?![0-9])/gu;
const BANK_RE = /iban|rekening|bank/iu;
const US_TOLL_FREE = ["800", "888", "877", "866", "855", "844", "833"];
const COUNTRY_CODES: Record<string, string> = { "31": "NL", "32": "BE", "44": "GB", "49": "DE", "33": "FR" };
const PHONE_PREFIXES: Record<string, [string, PhoneKind][]> = {
  NL: [
    ["0800", "toll_free"],
    ["090", "premium"],
    ["084", "national"],
    ["085", "national"],
    ["087", "national"],
    ["088", "national"],
    ["091", "national"],
    ["06", "mobile"],
  ],
  US: [
    ...[...US_TOLL_FREE].sort().map((code): [string, PhoneKind] => [code, "toll_free"]),
    ["900", "premium"],
  ],
};
const ORG_TYPES = new Set([
  "organization",
  "corporation",
  "localbusiness",
  "onlinestore",
  "onlinebusiness",
  "store",
  "professionalservice",
  "homeandconstructionbusiness",
  "plumber",
  "electrician",
  "locksmith",
  "hvacbusiness",
  "roofingcontractor",
  "generalcontractor",
  "housepainter",
  "movingcompany",
  "emergencyservice",
  "automotivebusiness",
  "autorepair",
  "dentist",
  "legalservice",
  "attorney",
  "accountingservice",
  "financialservice",
  "realestateagent",
  "travelagency",
  "healthandbeautybusiness",
  "childcare",
  "drycleaningorlaundry",
]);
const ORG_KEYS = [
  "@type",
  "name",
  "legalName",
  "telephone",
  "email",
  "address",
  "areaServed",
  "foundingDate",
  "vatID",
  "taxID",
  "priceRange",
  "aggregateRating",
  "sameAs",
];
const ASIN_RE = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?![A-Za-z0-9])/u;
const ID_KEYS = ["gtin", "gtin8", "gtin12", "gtin13", "gtin14", "mpn"];
const HOST_RE = /^(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/([^/?#]*)/u;
const MAX_SNIPPETS = 20;

// ── Extraction ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Fill the business fields of `facts`; runs after the product extraction (it reads the JSON-LD products). On a
 * platform where the seller may be a private person, only the product IDs and payment methods are read: the rest
 * would describe the platform, or name the seller.
 */
export function extractBusiness(doc: Document, url: string, facts: PageFacts): void {
  const scan = scanPage(doc);
  const publicText = squash(scan.public.join(" "));
  const businessText = squash(scan.business.join(" "));
  const host = hostOf(url);

  facts.product_ids = productIds(facts, url);
  const paymentText = `${publicText} ${scan.alts.join(" ")}`;
  facts.payment_methods = PAYMENT_METHODS.filter(([, re]) => re.test(paymentText)).map(([name]) => name);
  if (PRIVATE_SELLER_PLATFORMS.has(facts.platform)) return;
  const orgs = organizations(doc);
  facts.organization_ld = orgs.slice(0, 10).map(trim);
  facts.phones = phones(scan, businessText, orgs, host);
  facts.emails = emails(scan, businessText, orgs, host);
  const known = [...orgs.map((o) => ldAddress(o.address)), ...scan.addresses];
  const written = textAddresses(businessText).filter((a) => !alreadyKnown(a, known));
  facts.addresses = dedupe([...known, ...written]).slice(0, 20);
  const founding = orgs
    .filter((o) => typeof o.foundingDate === "string")
    .map((o) => `foundingDate ${String(o.foundingDate)}`);
  facts.founded_claims = dedupe([
    ...Array.from(publicText.matchAll(FOUNDED_RE), (m) => m[0]),
    ...founding,
  ]).slice(0, 10);
  const name = orgs.map((o) => textValue(o.name)).find(Boolean) ?? "";
  facts.business_name = cut(name, 300);
  const legalName = orgs.map((o) => textValue(o.legalName)).find(Boolean) ?? "";
  facts.legal_form = legalForm([name, legalName, ...facts.copyright_lines]);
  facts.kvk_numbers = dedupe(
    Array.from(publicText.matchAll(KVK_RE), (m) => (m[1] ?? "").replaceAll(" ", "")),
  ).slice(0, 10);
  facts.licences = licences(publicText);
  facts.certifications = dedupe(snippets(CERTIFICATION_RE, publicText, 60, 100)).slice(0, MAX_SNIPPETS);
  facts.promises = dedupe(snippets(PROMISE_RE, publicText, 60, 100)).slice(0, MAX_SNIPPETS);
  facts.pricing_terms = dedupe(snippets(PRICING_RE, publicText, 60, 100)).slice(0, MAX_SNIPPETS);
  facts.cities_served = dedupe(orgs.flatMap((o) => areas(o.areaServed))).slice(0, 100);
  facts.internal_links = internalLinks(scan.links, url, host);
}

/** The host of a URL as the backend reads it (by hand, the same way in both): lower case, without `www.`. */
export function hostOf(url: string): string {
  const m = HOST_RE.exec(url.trim());
  if (!m) return "";
  const netloc = m[1] ?? "";
  const host = netloc.slice(netloc.lastIndexOf("@") + 1).split(":")[0] ?? "";
  return host.toLowerCase().replace(/^www\./u, "");
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A JSON value Python would take as `str | int` (not a bool), as its `str()`; null otherwise. */
function scalar(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  return null;
}

function snippets(re: RegExp, value: string, before: number, after: number): string[] {
  return Array.from(value.matchAll(re), (m) => {
    const start = m.index;
    const end = start + m[0].length;
    let head = value.slice(Math.max(start - before, 0), start);
    const tail = value.slice(end, Math.min(end + after, value.length));
    if (head.includes(".")) head = head.slice(head.lastIndexOf(".") + 1);
    const stop = tail.indexOf(".");
    return squash(head + m[0] + (stop >= 0 ? tail.slice(0, stop) : tail));
  });
}

function textValue(value: unknown): string {
  return typeof value === "string" ? squash(value) : "";
}

function productIds(facts: PageFacts, url: string): Record<string, string> {
  const ids: Record<string, string> = {};
  const product = facts.json_ld[0] ?? {};
  for (const key of ID_KEYS) {
    const value = scalar(product[key]);
    if (value !== null && value.trim()) ids[key] = cut(value.trim(), 40);
  }
  const asin = facts.platform === "amazon" ? ASIN_RE.exec(url.split("?")[0] ?? "") : null;
  if (asin?.[1]) ids.asin = asin[1];
  return ids;
}

function kinds(node: Json): string[] {
  const kind = node["@type"] ?? "";
  return (Array.isArray(kind) ? kind : [kind]).filter((k): k is string => typeof k === "string" && k !== "");
}

/** The page's Organization and LocalBusiness JSON-LD nodes, untrimmed, in document order. */
export function organizations(doc: Document): Json[] {
  const orgs: Json[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else if (isObject(node)) {
      if (kinds(node).some((k) => ORG_TYPES.has(k.toLowerCase()))) {
        orgs.push(node);
        return;
      }
      for (const key of ["@graph", "mainEntity", "itemListElement", "publisher", "provider"]) {
        if (key in node) walk(node[key]);
      }
    }
  };
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    if (attr(script, "type") !== "application/ld+json") continue;
    try {
      walk(JSON.parse(script.textContent));
    } catch {
      continue;
    }
  }
  return orgs;
}

function trim(node: Json): Json {
  const trimmed: Json = {};
  for (const k of ORG_KEYS) if (k in node) trimmed[k] = node[k];
  if (pyJsonLength(trimmed) <= 4000) return trimmed;
  const small: Json = {};
  for (const k of ["@type", "name", "legalName"]) if (k in trimmed) small[k] = trimmed[k];
  return small;
}

function ldAddress(value: unknown): string {
  if (Array.isArray(value)) return value.length > 0 ? ldAddress(value[0]) : "";
  if (typeof value === "string") return cut(squash(value), 300);
  if (!isObject(value)) return "";
  const parts: string[] = [];
  for (const key of ["streetAddress", "postalCode", "addressLocality", "addressRegion", "addressCountry"]) {
    let part = value[key];
    if (isObject(part)) part = part.name;
    const s = scalar(part);
    if (s !== null && s.trim()) parts.push(squash(s));
  }
  return cut(parts.join(", "), 300);
}

function areas(value: unknown): string[] {
  const items: unknown[] = Array.isArray(value) ? value : [value];
  return items
    .map((item): unknown => (isObject(item) ? item.name : item))
    .filter((n): n is string => typeof n === "string" && n.trim() !== "")
    .map((n) => cut(squash(n), 300));
}

function ldStrings(orgs: Json[], key: string): string[] {
  return orgs.flatMap((org) => {
    const value = org[key];
    return (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === "string");
  });
}

/** A published phone number, normalised and typed (as the backend's `business.phone`). */
export function phone(raw: string, host = ""): Phone | null {
  const plus = raw.trim().startsWith("+");
  const digits = raw.replaceAll("(0)", "").replace(/\D/gu, "");
  if (digits.length < 7 || digits.length > 15 || new Set(digits).size < 3) return null;
  let country = "";
  let national = "";
  let number: string;
  if (plus || digits.startsWith("00")) {
    const full = plus ? digits : digits.replace(/^00/u, "");
    const code = COUNTRY_CODES[full.slice(0, 2)];
    if (full.startsWith("1") && full.length === 11) {
      country = "US";
      national = full.slice(1);
    } else if (code !== undefined) {
      country = code;
      national = "0" + full.slice(2);
    }
    number = "+" + full;
  } else if (digits.startsWith("0") && host.endsWith(".nl")) {
    country = "NL";
    national = digits;
    number = "+31" + digits.slice(1);
  } else if (
    !digits.startsWith("0") &&
    (digits.length === 10 || (digits.length === 11 && digits.startsWith("1")))
  ) {
    country = "US";
    national = digits.slice(-10);
    number = "+1" + national;
  } else {
    number = digits;
  }
  if (country === "NL" && (national.length < 8 || national.length > 11)) {
    country = "";
    number = (plus ? "+" : "") + digits;
  }
  return { number: cut(number, 20), kind: phoneKind(country, national), country };
}

function phoneKind(country: string, national: string): PhoneKind {
  const prefixes = PHONE_PREFIXES[country];
  if (prefixes === undefined) return "unknown";
  return prefixes.find(([prefix]) => national.startsWith(prefix))?.[1] ?? "local";
}

function phones(scan: Scan, business: string, orgs: Json[], host: string): Phone[] {
  const raw = scan.links
    .map(([href]) => href.trim())
    .filter((href) => href.toLowerCase().startsWith("tel:"))
    .map((href) => href.slice(4));
  raw.push(...ldStrings(orgs, "telephone"));
  // Not a bank account number written in groups ("IBAN NL91 ABNA 0417 1643 00").
  for (const m of business.matchAll(PHONE_RE)) {
    if (!BANK_RE.test(business.slice(Math.max(m.index - 30, 0), m.index))) raw.push(m[0]);
  }
  const found: Phone[] = [];
  const seen = new Set<string>();
  for (const candidate of raw) {
    const p = phone(candidate, host);
    if (p !== null && !seen.has(p.number)) {
      seen.add(p.number);
      found.push(p);
    }
  }
  return found.slice(0, 20);
}

/** A published e-mail address and whether it is on the page's own domain or a webmail service. */
export function email(raw: string, host: string): Email | null {
  const address = stripChars(raw.trim(), ".").toLowerCase();
  if (!address.includes("@") || NOT_A_BUSINESS_EMAIL_RE.test(address) || FILE_SUFFIX_RE.test(address))
    return null;
  const domain = address.slice(address.lastIndexOf("@") + 1);
  if (WEBMAIL_DOMAINS.has(domain)) return { address: cut(address, 254), kind: "webmail" };
  const own = host !== "" && (domain === host || host.endsWith("." + domain) || domain.endsWith("." + host));
  return { address: cut(address, 254), kind: own ? "own_domain" : "other" };
}

function emails(scan: Scan, business: string, orgs: Json[], host: string): Email[] {
  const raw = scan.links
    .map(([href]) => href.trim())
    .filter((href) => href.toLowerCase().startsWith("mailto:"))
    .map((href) => href.slice(7).split("?")[0] ?? "");
  raw.push(...ldStrings(orgs, "email"));
  raw.push(...Array.from(business.matchAll(EMAIL_RE), (m) => m[1] ?? ""));
  const found: Email[] = [];
  const seen = new Set<string>();
  for (const candidate of raw) {
    const e = email(candidate, host);
    if (e !== null && !seen.has(e.address)) {
      seen.add(e.address);
      found.push(e);
    }
  }
  return found.slice(0, 20);
}

function legalForm(names: string[]): string {
  for (const name of names) {
    const m = LEGAL_FORM_RE.exec(name);
    if (m?.[1]) return cut(m[1].replaceAll(".", "").toUpperCase(), 20);
  }
  return "";
}

function licences(value: string): Licence[] {
  const found: Licence[] = [];
  const seen = new Set<string>();
  for (const m of value.matchAll(LICENCE_RE)) {
    const number = m[2] ?? "";
    if (seen.has(number)) continue;
    seen.add(number);
    const state = m[1] !== undefined && US_STATES.has(m[1]) ? m[1] : "";
    found.push({ number: cut(number, 40), state });
  }
  return found.slice(0, 10);
}

function internalLinks(links: [string, string][], url: string, host: string): Link[] {
  const found: Link[] = [];
  const seen = new Set<string>();
  for (const [raw, label] of links) {
    const href = raw.trim();
    if (!href || href.startsWith("#") || /^(?:mailto|tel|javascript|data):/iu.test(href)) continue;
    const target = urljoin(url, href);
    const targetHost = hostOf(target);
    if ((targetHost && targetHost !== host) || seen.has(target)) continue;
    seen.add(target);
    found.push({ text: cut(label, 300), url: cut(target, 500) });
    if (found.length >= 100) break;
  }
  return found;
}
