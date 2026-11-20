/**
 * Peer-to-peer ads (Marktplaats, 2dehands, eBay, Vinted, Craigslist, Facebook Marketplace): the item, the deal and
 * the seller as the platform shows them, never the seller's name. A port of the backend's `facts/p2p.py`; the
 * parity tests keep the two in step.
 *
 * Each platform gets a few areas of its page (the ad text, the seller box, the item details, the price), found by
 * CSS selectors or, where the markup has no stable names (Facebook), by the heading above them. What is read from
 * those areas is matched by wording (Dutch, English, German, French), so a redesign that keeps the words keeps the
 * facts. Anything not found stays empty. The seller box is read for what it says about the account, never for who
 * it is; the ad text is sent for the check only.
 *
 * Marktplaats and 2dehands carry the ad as JSON in a script (`window.__CONFIG__`), which `adevintaListing` reads:
 * the deal (price type, bidding, pickup or shipping, payment protection, date placed, town) and the account
 * (private or business, how long on the platform). That JSON names the seller too; only the listed fields are
 * copied out of it, so the name never leaves the parser. Nothing else in the page's scripts is read (the header's
 * JSON describes the visitor).
 */

import type { Delivery, ListingDetails, PageFacts, SellerProfile, SellerType } from "../shared/facts.js";
import { cut, rawDecode, squash, stripChars, text } from "./dom.js";
import { parseCount, parseDate, parseNumber, parsePrice, parseSince } from "./parse.js";

interface Areas {
  title?: string;
  description?: string;
  seller?: string;
  details?: string;
  price?: string;
  location?: string;
  listed?: string;
  deal?: string;
  descriptionHeadings?: string[];
  sellerHeadings?: string[];
  detailsHeadings?: string[];
  /** The platform always (true) or never (false) offers payment protection. */
  protection?: boolean;
}

const ADEVINTA: Areas = {
  // Marktplaats and 2dehands share their markup.
  description: '#vip-ad-description, [data-testid="vip-ad-description"], .Description-description',
  seller: '[data-testid="seller-info"], .SellerInfo, .seller-info',
  details: '[data-testid="attributes"], .Attributes, .Listing-attributes',
  price: '[data-testid="price"], .Listing-price, .Price-price',
  location: '[data-testid="location"], .SellerInfo-location, .Location-name',
  listed: '[data-testid="listing-stats"], .Stats',
  deal: '[data-testid="buy-box"], .BuyBlock, .Listing-payment',
  descriptionHeadings: ["beschrijving", "omschrijving", "description"],
};
export const AREAS: Record<string, Areas> = {
  marktplaats: ADEVINTA,
  "2dehands": ADEVINTA,
  ebay: {
    description: '[data-testid="x-item-description-child"], #ds_div',
    seller: '[data-testid="x-sellercard-atf"], [data-testid="str-about-seller"], .x-sellercard-atf',
    details:
      '[data-testid="x-item-condition"], [data-testid="ux-labels-values--shipping"], ' +
      '[data-testid="ux-labels-values--itemLocation"], [data-testid="x-about-this-item"]',
    price: '[data-testid="x-price-primary"], .x-price-primary',
    location: '[data-testid="ux-labels-values--itemLocation"] .ux-labels-values__values',
    deal: '[data-testid="x-buybox"], [data-testid="x-ebay-money-back"]',
    descriptionHeadings: ["item description from the seller", "artikelbeschrijving", "artikelbeschreibung"],
  },
  vinted: {
    description: '[itemprop="description"], [data-testid="item-description"]',
    seller: '[data-testid="profile-section"], [data-testid="item-seller"]',
    details: '[data-testid="item-details"], .details-list',
    price: '[data-testid="item-price"]',
    location: '[data-testid="item-location"]',
    listed: '[data-testid="item-upload-date"]',
    deal: '[data-testid="item-buyer-protection"], [data-testid="item-sidebar"]',
    protection: true,
  },
  craigslist: {
    title: "#titletextonly",
    description: "#postingbody",
    details: ".attrgroup",
    price: ".postingtitletext .price",
    location: ".postingtitletext small",
    listed: ".postinginfos",
    protection: false,
  },
  facebook: {
    descriptionHeadings: [
      "seller's description",
      "beschrijving van de verkoper",
      "description",
      "beschrijving",
    ],
    sellerHeadings: ["seller information", "seller details", "informatie over verkoper", "verkopergegevens"],
    detailsHeadings: ["details"],
    price: '[data-testid="marketplace-price"]',
  },
};
const HEADING_TAGS = "h1, h2, h3, h4, h5, strong, span, div, dt";

const re = (pattern: string): RegExp => new RegExp(pattern, "iu");

// ── The seller box ───────────────────────────────────────────────────────────────────────────────────────────

const MEMBER_SINCE_RE = re(
  String.raw`(?<![a-z])(?:member since|lid sinds|actief sinds|op (?:marktplaats|2dehands) sinds` +
    String.raw`|joined(?: (?:facebook|ebay|vinted|marketplace))?(?: in| on)?|membre depuis|mitglied seit|sinds|since|seit` +
    String.raw`|depuis)\s*:?\s*([^·|,()]{0,30}?(?:19|20)\d\d)(?!\d)`,
);
const RATING_RE = re(
  String.raw`(?<![\d.,])(\d(?:[.,]\d{1,2})?)\s*(?:/\s*5|out of 5|uit 5|van 5|van de 5|sur 5|von 5|sterren|stars?|★)`,
);
const RATING_COUNT_RE = re(
  String.raw`(?<![\d.,])(\d[\d.,]*)\s*(?:reviews?|beoordelingen|recensies|ratings?|evaluaties|évaluations?|bewertungen` +
    String.raw`|feedback|waarderingen)(?![a-z])`,
);
const NO_RATINGS_RE = re(
  String.raw`no (?:reviews|ratings|feedback)(?: yet)?|nog geen (?:reviews|beoordelingen)|geen (?:reviews|beoordelingen)` +
    String.raw`|pas encore d'évaluation|noch keine bewertungen`,
);
const POSITIVE_SHARE_RE = re(String.raw`(\d{2,3}(?:[.,]\d)?)\s*%\s*(?:positive|positieve|positiv)`); // eBay
const FEEDBACK_SCORE_RE = /\((\d[\d.,]*)\)/u; // eBay: the feedback score next to the name, "(1,234)"
const BADGES: [string, RegExp][] = [
  [
    "Verified ID",
    re(String.raw`(?:id|identiteit|identity)\s*(?:geverifieerd|verified)|verified id|identité vérifiée`),
  ],
  ["Verified phone", re(String.raw`(?:telefoon(?:nummer)?|phone(?: number)?)\s*(?:geverifieerd|verified)`)],
  ["Verified bank account", re(String.raw`(?:bank(?:rekening)?|bank account)\s*(?:geverifieerd|verified)`)],
  ["Verified e-mail", re(String.raw`e-?mail(?:adres)?\s*(?:geverifieerd|verified)`)],
  ["Top seller", re(String.raw`top[- ]rated(?: seller| plus)?|top seller|topverkoper|top-verkoper`)],
  ["Highly rated", re(String.raw`highly rated|hoog gewaardeerd`)],
];
const VERIFIED_RE = re(String.raw`(?<![a-z])(?<!not )(?<!niet )(?:geverifieerd|verified|vérifié)(?![a-z])`);
const OTHER_LISTINGS_RE = re(
  String.raw`(?<![\d.,])(\d[\d.,]*)\s*(?:andere |other |overige )?(?:advertenties|ads|listings|items(?: for sale)?|artikelen` +
    String.raw`|annonces|anzeigen|articles)(?![a-z])`,
);
const TIME_UNIT = String.raw`(?:minutes?|minuten|uur|uren|hours?|dagen|dag|days?|weken|week|weeks?|stunden?|tagen?|heures?|jours?)(?![a-z])`;
const RESPONSE_TIME_RE = re(
  String.raw`(?:(?:typically|usually|meestal)\s+)?(?:responds|replies|reageert|antwoordt|antwortet|répond)` +
    String.raw`(?:\s+(?:meestal|usually|typically|normaal))?\s+(?:within|binnen|innerhalb|en|in)\s+` +
    String.raw`(?:(?:an?|een|één|a few|enkele|einer?|\d+)\s+)?${TIME_UNIT}` +
    String.raw`|(?:reactietijd|response time|antwoordtijd)\s*:?\s*(?:(?:\d+|een|an?)\s+)?${TIME_UNIT}`,
);
const RESPONSE_RATE_RE = re(
  String.raw`(\d{1,3})\s*%\s*(?:response rate|reactiepercentage|antwoordpercentage)` +
    String.raw`|(?:response rate|reactiepercentage|antwoordpercentage)\s*:?\s*(\d{1,3})\s*%`,
);
const BUSINESS_RE = re(
  String.raw`(?<![a-z])(?:zakelijke verkoper|zakelijk|bedrijf|business seller|registered as a business|professional seller` +
    String.raw`|vendeur professionnel|gewerblicher verkäufer|händler)(?![a-z])`,
);
const PRIVATE_RE = re(
  String.raw`(?<![a-z])(?:private seller|particuliere verkoper|particulier|vendeur particulier|privater verkäufer` +
    String.raw`|privatverkäufer)(?![a-z])`,
);

// ── The deal ─────────────────────────────────────────────────────────────────────────────────────────────────

const FIXED_RE = re(
  String.raw`vaste prijs|fixed price|prijs is vast|no offers|geen bod|non-negotiable|niet onderhandelbaar|festpreis` +
    String.raw`|prix ferme`,
);
const NEGOTIABLE_RE = re(
  String.raw`n\.?o\.?t\.?k(?![a-z])|nader overeen te komen|onderhandelbaar|bespreekbaar|or best offer|best offer` +
    String.raw`|(?<![a-z])obo(?![a-z])|negotiable|verhandelbar|à négocier|à débattre|make (?:an )?offer|doe een bod` +
    String.raw`|faire une offre` +
    String.raw`|preisvorschlag`,
);
const BIDDING_RE = re(
  String.raw`(?<![a-z])(?:bieden|bod uitbrengen|biedingen|place bid|bids?|enchères?|gebote?|auction|veiling)(?![a-z])`,
);
const CONDITION_RE = re(
  String.raw`(?<![a-z])(?:conditie|staat|condition|item condition|zustand|état|toestand)\s*:?\s*` +
    String.raw`(nieuw met prijskaartje|nieuw zonder prijskaartje|nieuw met kaartje|nieuw zonder kaartje|zo goed als nieuw` +
    String.raw`|nieuw in doos|nieuw|zeer goed|heel goed|gebruikt|goed|redelijk|matig|defect|voor onderdelen` +
    String.raw`|new with tags|new without tags|new with box|new other|brand new|used - like new|used - good|used - fair` +
    String.raw`|like new|new|open box|excellent|very good|good|fair|poor|used|pre-owned|refurbished` +
    String.raw`|for parts or not working|for parts|salvage|neuf|très bon état|bon état|wie neu|neu|gebraucht)(?![a-z])`,
);
const LD_CONDITIONS: Record<string, string> = {
  newcondition: "New",
  usedcondition: "Used",
  refurbishedcondition: "Refurbished",
  damagedcondition: "Damaged",
};
const LOCATION_LABEL_RE = re(
  String.raw`^(?:located in|item location|locatie|location|standort|ophalen in|plaats|lieu)\s*:?\s*`,
);
const LISTED_LINE_RE = re(String.raw`^(?:listed|geplaatst|posted|placed)(?![a-z]).{0,100}$`);
const LISTED_IN_RE = re(String.raw`\s(?:in|te)\s+(.{2,80})$`);
const PICKUP_RE = re(
  String.raw`ophalen|afhalen|pick ?-?up|collection|abholung|abholen|retrait|remise en main propre|meet ?up`,
);
const SHIPPING_RE = re(
  String.raw`verzenden|verzending|verzonden|shipping|postage|delivery|bezorg|versand|livraison|envoi` +
    String.raw`|(?<![a-z])ships?(?![a-z])`,
);
const NO_SHIPPING_RE = re(
  String.raw`local pickup only|pickup only|pick-up only|collection only|alleen ophalen|enkel ophalen|uitsluitend ophalen` +
    String.raw`|nur abholung|does not ship|no shipping|geen verzending|niet verzenden|wordt niet verzonden`,
);
const NO_PICKUP_RE = re(
  String.raw`shipping only|alleen verzenden|enkel verzenden|uitsluitend verzenden|geen ophalen|niet ophalen|no pickup` +
    String.raw`|no local pickup|nur versand|kan niet opgehaald`,
);
const PROTECTION_RE = re(
  String.raw`gelijk oversteken|betaal veilig|veilig betalen|kopersbescherming|koperbescherming|buyer protection` +
    String.raw`|purchase protection|money back guarantee|geld-terug-garantie|käuferschutz|protection acheteurs?` +
    String.raw`|betalen via (?:marktplaats|2dehands)|checkout with facebook|facebook checkout`,
);

// ── What the ad text asks for ────────────────────────────────────────────────────────────────────────────────

// A mobile or international number as sellers write them ("06-11223344", "+31 6 1122 3344", "(415) 555-0134").
const PHONE_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9+])(?:(?:\+|00)\d{2}[\s.\-]?(?:\(0\)[\s.\-]?)?\d(?:[\s.\-]?\d){7,10}` +
    String.raw`|0(?:[\s.\-]?\d){9}` +
    String.raw`|\(?[2-9]\d{2}\)?[\s.\-]\d{3}[\s.\-]\d{4})(?![0-9])`,
  "gu",
);
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/u;
const BANK_BEFORE_RE = /iban|rekening|bank|account/iu;
const CONTACT_PATTERNS: [string, RegExp][] = [
  [
    "whatsapp",
    re(
      String.raw`whats ?app|(?<![a-z])wa\.me|(?<![a-z])app (?:me|mij|even)(?![a-z])` +
        String.raw`|stuur (?:me |mij )?(?:een )?app(?:je)?(?![a-z])|(?<![a-z])appen(?![a-z])`,
    ),
  ],
  ["telegram", re(String.raw`telegram|(?<![a-z])t\.me/`)],
  [
    "phone",
    re(
      String.raw`(?<![a-z])(?:bel (?:me|mij)|call me|text me|sms (?:me|mij)|bellen|ruf (?:mich )?an)(?![a-z])`,
    ),
  ],
  [
    "email",
    re(
      String.raw`(?<![a-z])(?:e-?mail (?:me|mij)|mail (?:me|mij)|stuur (?:me |mij )?een (?:e-?)?mail)(?![a-z])`,
    ),
  ],
];
const PAYMENT_PATTERNS: [string, RegExp][] = [
  [
    "bank_transfer",
    re(
      String.raw`overmaken|overboeken|overboeking|overschrijving|bank ?transfer|wire transfer|(?<![a-z])iban(?![a-z])` +
        String.raw`|rekeningnummer|virement|überweisung`,
    ),
  ],
  ["payment_link", re(String.raw`tikkie|betaalverzoek|payment link|betaal ?link`)],
  [
    "deposit",
    re(
      String.raw`aanbetaling|vooruitbetal|vooraf (?:betalen|overmaken|maken)|(?:betaling|betalen) vooraf` +
        String.raw`|eerst (?:betalen|overmaken|betaling)` +
        String.raw`|borg (?:vooraf|eerst|overmaken)|deposit|advance payment|pay(?:ment)? (?:up ?front|in advance|first)` +
        String.raw`|upfront payment|acompte|anzahlung|vorkasse|reserveringskosten|reservation fee|holding fee`,
    ),
  ],
  [
    "gift_card",
    re(
      String.raw`gift ?cards?|cadeaukaart|cadeaubon|itunes|google play (?:card|kaart)|steam ?(?:card|kaart)` +
        String.raw`|paysafe ?card|amazon (?:card|voucher|gift)`,
    ),
  ],
  ["crypto", re(String.raw`bitcoin|(?<![a-z])(?:btc|usdt|tether)(?![a-z])|crypto|ethereum`)],
  ["money_transfer", re(String.raw`western union|moneygram|(?<![a-z])ria money|worldremit`)],
  [
    "payment_app",
    re(
      String.raw`(?<![a-z])(?:zelle|venmo|cash ?app)(?![a-z])|paypal (?:vrienden|friends)|friends (?:and|&) family` +
        String.raw`|vrienden (?:en|&) familie|(?<![a-z])f&f(?![a-z])`,
    ),
  ],
];
// "Never pay in advance", "no bank transfer": a payment the ad rules out isn't one it asks for.
const NEGATED_RE = re(
  String.raw`(?:^|[^a-z])(?:nooit|never|niet|not|geen|no|don't|dont|do not|kein|keine|pas de)(?:\s+[^\s.!?]+){0,4}\s*$`,
);
const NEGATION_WINDOW = 40;
const QR_LABEL_RE = /^QR Code Link to This Post\s*/iu; // Craigslist's print label
const MAX_DESCRIPTION = 5_000;

type Json = Record<string, unknown>;

function labels(el: Element): string[] {
  // The rating stars and badges some platforms only name in an aria-label.
  return Array.from(el.querySelectorAll("[aria-label]"))
    .map((e) => e.getAttribute("aria-label") ?? "")
    .filter((label) => label);
}

/** Every element the selector matches, its text and aria-labels, joined. */
function area(doc: Document, selector: string | undefined): string {
  if (!selector) return "";
  const parts: string[] = [];
  for (const el of Array.from(doc.querySelectorAll(selector))) parts.push(text(el), ...labels(el));
  return squash(parts.join(" "));
}

function firstText(doc: Document, selector: string | undefined): string {
  return selector ? text(doc.querySelector(selector)) : "";
}

function heading(doc: Document, headings: string[] | undefined): Element | null {
  if (!headings?.length) return null;
  for (const el of Array.from(doc.querySelectorAll(HEADING_TAGS))) {
    if (headings.includes(text(el).replace(/:+$/u, "").trim().toLowerCase())) return el;
  }
  return null;
}

/** The text of the section a heading opens (its parent element), or "". */
function section(doc: Document, headings: string[] | undefined): string {
  const parent = heading(doc, headings)?.parentElement;
  return parent ? squash([text(parent), ...labels(parent)].join(" ")) : "";
}

/** The text of the element right after a heading, or "". */
function afterHeading(doc: Document, headings: string[] | undefined): string {
  return text(heading(doc, headings)?.nextElementSibling);
}

/** Whether the words just before a match rule it out ("never pay in advance", "geen aanbetaling"). */
function negated(value: string, start: number): boolean {
  return NEGATED_RE.test(value.slice(Math.max(start - NEGATION_WINDOW, 0), start));
}

function phonesIn(value: string): string[] {
  return Array.from(value.matchAll(PHONE_RE))
    .filter((m) => !BANK_BEFORE_RE.test(value.slice(Math.max(m.index - 30, 0), m.index)))
    .map((m) => m[0]);
}

/** The contact methods and payment requests an ad's text mentions, in a fixed order. */
export function adSignals(value: string): [string[], string[]] {
  const contacts = CONTACT_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
  if (phonesIn(value).length && !contacts.includes("phone")) contacts.push("phone");
  if (EMAIL_RE.test(value) && !contacts.includes("email")) contacts.push("email");
  const order = CONTACT_PATTERNS.map(([name]) => name);
  contacts.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const payments = PAYMENT_PATTERNS.filter(([, pattern]) => {
    const global = new RegExp(pattern.source, "giu");
    return Array.from(value.matchAll(global)).some((m) => !negated(value, m.index));
  }).map(([name]) => name);
  return [contacts, payments];
}

// ── Marktplaats and 2dehands: the ad's JSON ─────────────────────────────────────────────────────────────────

const CONFIG_RE = /window\.__CONFIG__\s*=\s*/u;
const SINCE_DIFF_RE =
  /(\d+)\s*(jaar|jaren|years?|ans?|maanden|maand|months?|mois|weken|week|weeks?|semaines?|dagen|dag|days?|jours?)/iu;
// By prefix; anything else is years.
const UNIT_DAYS: [string, number][] = [
  ["jour", 1],
  ["dag", 1],
  ["day", 1],
  ["we", 7],
  ["sem", 7],
  ["m", 30],
];
const SELLER_TYPES: Record<string, SellerType> = {
  CONSUMER: "private",
  TRADER: "business",
  BUSINESS: "business",
};
const NEGOTIABLE_PRICE_TYPES: Record<string, boolean> = { NOTK: true, FIXED: false };
const IMAGE_SIZE = "$_85"; // the gallery's "$_#" placeholder, as a large photo

/** Today: "on the platform for 4 months" counts back from it (the parity tests fix the clock). */
function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function daysBefore(days: number): string {
  const d = today();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** What Unfret reads from a Marktplaats or 2dehands ad's JSON. Deliberately no name, id or profile link. */
export interface AdevintaListing {
  title: string;
  price: number | null;
  priceType: string;
  bidding: boolean | null;
  delivery: Delivery[];
  paymentProtection: boolean | null;
  listed: string | null;
  location: string;
  category: string;
  sellerType: SellerType;
  memberSince: string | null;
  imageUrls: string[];
}

function config(doc: Document): Json | null {
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    const body = script.textContent;
    const m = CONFIG_RE.exec(body);
    if (!m) continue;
    const value = rawDecode(body, m.index + m[0].length);
    return isObject(value) ? value : null;
  }
  return null;
}

function dict(value: unknown, key: string): Json {
  const found = isObject(value) ? value[key] : undefined;
  return isObject(found) ? found : {};
}

function str(value: unknown, key: string): string {
  const found = isObject(value) ? value[key] : undefined;
  return typeof found === "string" ? found.trim() : "";
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function memberSince(seller: Json): string | null {
  const m = SINCE_DIFF_RE.exec(str(seller, "activeSinceDiff"));
  if (m) {
    const unit = (m[2] ?? "").toLowerCase();
    return daysBefore(Number(m[1]) * (UNIT_DAYS.find(([prefix]) => unit.startsWith(prefix))?.[1] ?? 365));
  }
  const years = seller.activeYears;
  return isInt(years) && years >= 1 ? daysBefore(years * 365) : null;
}

function adDelivery(listing: Json): Delivery[] {
  const kind = str(
    dict(dict(listing, "shippingInformation"), "deliveryType"),
    "attributeValueKey",
  ).toLowerCase();
  const kinds: Delivery[] = [];
  if (kind.includes("verzenden") || kind.includes("envoi") || kind.includes("livraison"))
    kinds.push("shipping");
  if (kind.includes("ophalen") || kind.includes("enlèvement") || kind.includes("retrait"))
    kinds.push("pickup");
  return kinds;
}

/** The ad as a Marktplaats or 2dehands page carries it in `window.__CONFIG__`, without the seller's name. */
export function adevintaListing(doc: Document): AdevintaListing | null {
  const listing = dict(config(doc), "listing");
  if (Object.keys(listing).length === 0) return null;
  const seller = dict(listing, "seller");
  const place = dict(seller, "location");
  let town = str(place, "cityName");
  const country = str(place, "countryName");
  if (town && place.isAbroad === true && country) town = `${town}, ${country}`;
  const category = dict(listing, "category");
  const images = dict(listing, "gallery").imageUrls;
  const bids = dict(listing, "bidsInfo").isBiddingEnabled;
  const cents = dict(listing, "priceInfo").priceCents;
  return {
    title: cut(str(listing, "title"), 2_000),
    price: isInt(cents) && cents > 0 ? cents / 100 : null,
    priceType: str(dict(listing, "priceInfo"), "priceType").toUpperCase(),
    bidding: typeof bids === "boolean" ? bids : null,
    delivery: adDelivery(listing),
    paymentProtection: listing.buyersProtectionAllowed === true ? true : null,
    listed: parseDate(str(dict(listing, "stats"), "since").slice(0, 10)),
    location: cut(town, 300),
    category: cut([str(category, "parentName"), str(category, "name")].filter((c) => c).join(" > "), 300),
    sellerType: SELLER_TYPES[str(seller, "sellerType").toUpperCase()] ?? "",
    memberSince: memberSince(seller),
    imageUrls: (Array.isArray(images) ? images : [])
      .filter((u): u is string => typeof u === "string" && (u.startsWith("//") || u.startsWith("https://")))
      .map((u) => (u.startsWith("//") ? `https:${u}` : u).replaceAll("$_#", IMAGE_SIZE))
      .slice(0, 50),
  };
}

/** Complete an ad's facts from its JSON: where it has a value, it is the platform's own word. */
function withAdevinta(doc: Document, facts: PageFacts): void {
  const ad = adevintaListing(doc);
  const listing = facts.listing;
  if (!ad || !listing) return;
  if (ad.title && !facts.title) facts.title = ad.title;
  if (ad.price !== null && facts.price === null) {
    facts.price = ad.price;
    facts.currency = facts.currency || "EUR";
  }
  if (ad.imageUrls.length > facts.image_urls.length) facts.image_urls = ad.imageUrls;
  const negotiable = NEGOTIABLE_PRICE_TYPES[ad.priceType];
  facts.listing = {
    ...listing,
    negotiable: negotiable ?? listing.negotiable,
    bidding: ad.bidding ?? listing.bidding,
    delivery: ad.delivery.length ? ad.delivery : listing.delivery,
    payment_protection: ad.paymentProtection ?? listing.payment_protection,
    listed: ad.listed ?? listing.listed,
    location: ad.location || listing.location,
    category: ad.category || listing.category,
  };
  if (ad.sellerType || ad.memberSince) {
    const profile: SellerProfile = facts.seller_profile ?? {
      seller_type: "",
      member_since: null,
      rating: null,
      rating_count: null,
      badges: [],
      other_listings: null,
      response_time: "",
      response_rate: null,
      jobs_completed: null,
      years_in_business: null,
    };
    facts.seller_profile = {
      ...profile,
      seller_type: ad.sellerType || profile.seller_type,
      member_since: ad.memberSince ?? profile.member_since,
    };
  }
}

/**
 * Fill `facts.listing` and `facts.seller_profile` for an ad on a peer-to-peer platform (or eBay). Runs after the
 * generic extraction (JSON-LD has given the price, the title and the photos where the platform has it).
 */
export function extract(doc: Document, facts: PageFacts): void {
  const areas = AREAS[facts.platform];
  if (!areas) return;
  const title = firstText(doc, areas.title);
  if (title) facts.title = cut(title, 2_000);
  let description = firstText(doc, areas.description) || afterHeading(doc, areas.descriptionHeadings);
  description = cut(description.replace(QR_LABEL_RE, ""), MAX_DESCRIPTION);
  const seller = squash(`${area(doc, areas.seller)} ${section(doc, areas.sellerHeadings)}`);
  const details = squash(`${area(doc, areas.details)} ${section(doc, areas.detailsHeadings)}`);
  const priceText = firstText(doc, areas.price);
  const deal = squash(`${priceText} ${details} ${area(doc, areas.deal)}`);

  if (facts.price === null && priceText) {
    const [price, currency] = parsePrice(priceText);
    facts.price = price;
    facts.currency = facts.currency || currency;
  }
  const line = listedLine(doc);
  const [contacts, payments] = adSignals(description);
  const listing: ListingDetails = {
    negotiable: negotiable(deal),
    bidding: deal ? BIDDING_RE.test(deal) : null,
    condition: condition(details, facts),
    category: category(doc, facts.title),
    listed: listed(doc, areas.listed) ?? parseDate(line),
    location: location(doc, areas.location, line),
    delivery: delivery(deal),
    payment_protection: PROTECTION_RE.test(deal) ? true : (areas.protection ?? null),
    contact_methods: contacts,
    payment_requests: payments,
    description,
  };
  facts.listing = listing;
  if (seller) facts.seller_profile = sellerProfile(seller, facts);
  if (facts.platform === "marktplaats" || facts.platform === "2dehands") withAdevinta(doc, facts);
  const share = facts.platform === "ebay" ? POSITIVE_SHARE_RE.exec(seller) : null;
  if (share) {
    const value = parseNumber(share[1] ?? "");
    facts.seller_rating = value !== null && value <= 100 ? value : facts.seller_rating;
  }
}

function negotiable(value: string): boolean | null {
  if (FIXED_RE.test(value)) return false;
  return NEGOTIABLE_RE.test(value) ? true : null;
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function condition(details: string, facts: PageFacts): string {
  const m = CONDITION_RE.exec(details);
  if (m) return cut(m[1] ?? "", 100);
  const offers = facts.json_ld[0]?.offers;
  const offer: unknown = Array.isArray(offers) ? offers[0] : offers;
  const value = isObject(offer) ? offer.itemCondition : undefined;
  if (typeof value === "string") return LD_CONDITIONS[(value.split("/").pop() ?? "").toLowerCase()] ?? "";
  return "";
}

function category(doc: Document, title: string): string {
  const kept: string[] = [];
  for (const a of Array.from(
    doc.querySelectorAll('[class*="readcrumb"] a, nav[aria-label*="readcrumb"] a'),
  )) {
    const crumb = text(a);
    if (crumb && !kept.includes(crumb) && crumb.toLowerCase() !== title.toLowerCase()) kept.push(crumb);
  }
  return cut(kept.join(" > "), 300);
}

function listed(doc: Document, selector: string | undefined): string | null {
  const el = selector ? doc.querySelector(selector) : null;
  if (!el) return null;
  const time = el.querySelector("time");
  const found = time ? parseDate(time.getAttribute("datetime") ?? "") : null;
  return found ?? parseDate(text(el));
}

function listedLine(doc: Document): string {
  // Facebook's "Listed 3 days ago in Utrecht, NL": a short line of its own.
  for (const el of Array.from(doc.querySelectorAll("span, div, p"))) {
    const line = text(el);
    if (LISTED_LINE_RE.test(line)) return line;
  }
  return "";
}

function location(doc: Document, selector: string | undefined, line: string): string {
  let value = firstText(doc, selector);
  if (!value) value = LISTED_IN_RE.exec(line)?.[1] ?? "";
  return cut(stripChars(value.replace(LOCATION_LABEL_RE, ""), "()").trim(), 300);
}

function delivery(value: string): Delivery[] {
  const shipping = SHIPPING_RE.test(value) && !NO_SHIPPING_RE.test(value);
  const pickup = PICKUP_RE.test(value) && !NO_PICKUP_RE.test(value);
  const kinds: Delivery[] = [];
  if (shipping) kinds.push("shipping");
  if (pickup) kinds.push("pickup");
  return kinds;
}

function sellerType(value: string): SellerType {
  const business = BUSINESS_RE.test(value);
  const isPrivate = PRIVATE_RE.test(value);
  if (business !== isPrivate) return business ? "business" : "private";
  return "";
}

function sellerProfile(value: string, facts: PageFacts): SellerProfile {
  const since = MEMBER_SINCE_RE.exec(value);
  const rating = RATING_RE.exec(value);
  const stars = rating ? parseNumber(rating[1] ?? "") : null;
  const count = RATING_COUNT_RE.exec(value);
  let ratings = count ? parseCount(count[1] ?? "") : null;
  if (ratings === null && NO_RATINGS_RE.test(value)) ratings = 0;
  const score = facts.platform === "ebay" && ratings === null ? FEEDBACK_SCORE_RE.exec(value) : null;
  if (score) ratings = parseCount(score[1] ?? "");
  const badges = BADGES.filter(([, pattern]) => pattern.test(value)).map(([label]) => label);
  if (!badges.some((b) => b.startsWith("Verified")) && VERIFIED_RE.test(value)) badges.push("Verified");
  const listings = OTHER_LISTINGS_RE.exec(value);
  const response = RESPONSE_TIME_RE.exec(value);
  const rate = RESPONSE_RATE_RE.exec(value);
  const rateValue = rate ? parseNumber(rate[1] || rate[2] || "") : null;
  return {
    seller_type: sellerType(value),
    member_since: since ? parseSince(since[1] ?? "") : null,
    rating: stars !== null && stars <= 5 ? stars : null,
    rating_count: ratings,
    badges,
    other_listings: listings ? parseCount(listings[1] ?? "") : null,
    response_time: response ? cut(squash(response[0]), 100) : "",
    response_rate: rateValue !== null && rateValue <= 100 ? rateValue : null,
    jobs_completed: null,
    years_in_business: null,
  };
}
