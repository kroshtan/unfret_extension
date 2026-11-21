/**
 * Variant pickers: the options a listing groups under one page (sizes, colours, styles, amounts), on any platform.
 * A port of the backend's `facts/variants.py`; the parity tests keep the two in step.
 *
 * Every option shares the listing's star rating and review pool, and a "from" price is the cheapest option's: the
 * backend checks whether the options are one product in different sizes or different products grouped as "sizes".
 * Read from the first source that names at least two options: Amazon's twister data, Walmart's `variantCriteria`,
 * Shopify's product JSON, WooCommerce's variations form, schema.org's `ProductGroup`, else the page's own picker
 * (a select or radio buttons named as a size, colour, style or variant).
 */

import type {
  HeadlineBasis,
  PageFacts,
  VariantDimension,
  VariantKind,
  VariantOption,
  Variants,
  VariantSource,
} from "../shared/facts.js";
import { attr, cut, rawDecode, squash, text } from "./dom.js";
import { parsePrice } from "./parse.js";

const MAX_OPTIONS = 100;
const MAX_DIMENSIONS = 5;
const MAX_VALUES = 100;

type Json = Record<string, unknown>;

// What a dimension varies, from its key and name (lower case), first match wins (see the backend for the order).
const KINDS: [VariantKind, RegExp][] = [
  [
    "count",
    /number of items|number_of_items|item_package_quantity|unit_count|quantity|anzahl|stückzahl|packung|aantal|nombre d|cantidad|quantità|pack|stuks|pieces|pcs/u,
  ],
  ["colour", /colou?r|farbe|couleur|kleur|colore|kolor|färg|farve|väri|renk/u],
  [
    "size",
    /size|größe|grösse|groesse|taille|maat|talla|tamaño|taglia|rozmiar|storlek|størrelse|koko|boyut|length|länge|lengte|longueur|capacity|kapazität|capaciteit|dimension|abmessung/u,
  ],
  ["pattern", /pattern|muster|motif|patroon|patrón|motivo|design/u],
  ["material", /material|materiaal|matériau|materiale/u],
  ["flavour", /flavou?r|geschmack|smaak|saveur|sabor|gusto|scent|duft|geur|parfum/u],
  [
    "style",
    /style|stil|stijl|estilo|stile|styl|model|modèle|modelo|modello|type|typ|soort|version|edition|configuration|variant|ausführung|uitvoering/u,
  ],
];

/** What a picker's dimension varies, from its key and its label. */
export function kindOf(key: string, name = ""): VariantKind {
  const words = `${key} ${name}`.toLowerCase();
  for (const [kind, pattern] of KINDS) if (pattern.test(words)) return kind;
  return "other";
}

/** Read the page's variant options into `facts.variants` (left null when it has fewer than two). */
export function extractVariants(doc: Document, url: string, facts: PageFacts): void {
  const products = jsonLdNodes(doc);
  let found: Variants | null = null;
  if (facts.platform === "amazon") found = amazon(doc);
  else if (facts.platform === "walmart") found = walmart(doc);
  const readers = [
    (): Variants | null => shopify(doc, url),
    (): Variants | null => woocommerce(doc),
    (): Variants | null => schemaOrg(products),
  ];
  for (const reader of readers) if (found === null) found = reader();
  if (found === null && facts.platform !== "amazon" && facts.platform !== "walmart") found = picker(doc);
  if (found === null) return;
  const fromPrice = facts.platform === "amazon" ? amazonRange(doc) : aggregateRange(products);
  facts.variants = withHeadline(found, facts.price, fromPrice);
}

function withHeadline(found: Variants, price: number | null, fromPrice: boolean): Variants {
  const options = found.options;
  const priced: [number, number][] = [];
  options.forEach((o, i) => {
    if (o.price !== null) priced.push([o.price, i]);
  });
  priced.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const same = priced.filter(([p]) => price !== null && Math.abs(p - price) < 0.005).map(([, i]) => i);
  const selected: number[] = [];
  options.forEach((o, i) => {
    if (o.selected) selected.push(i);
  });
  const first = selected[0];
  // A selection whose own price isn't the price on show doesn't say whose price it is.
  const shown =
    selected.length === 1 &&
    first !== undefined &&
    (price === null || options[first]?.price === null || same.includes(first));
  let headline: number | null = null;
  let basis: HeadlineBasis = "";
  const cheapest = priced[0];
  if (fromPrice && cheapest) {
    headline = cheapest[1];
    basis = "from";
  } else if (shown) {
    headline = first;
    basis = "selected";
  } else if (same.length > 0) {
    headline = Math.min(...same);
    basis = "price";
  }
  return { ...found, headline, headline_basis: basis, from_price: fromPrice };
}

function variants(
  source: VariantSource,
  dimensions: VariantDimension[],
  options: VariantOption[],
): Variants | null {
  const kept = options.filter((o) => o.label).slice(0, MAX_OPTIONS);
  if (new Set(kept.map((o) => o.label)).size < 2) return null;
  return {
    source,
    dimensions: dimensions.slice(0, MAX_DIMENSIONS),
    options: kept,
    headline: null,
    headline_basis: "",
    from_price: false,
  };
}

function dimension(key: string, name: string, values: string[]): VariantDimension {
  return {
    name: cut(name, 100),
    kind: kindOf(key, name),
    values: dedupe(values.map((v) => cut(v, 200))).slice(0, MAX_VALUES),
  };
}

function option(
  values: string[],
  price: number | null,
  {
    label = "",
    available = null,
    selected = false,
  }: { label?: string; available?: boolean | null; selected?: boolean } = {},
): VariantOption {
  const kept = values.map((v) => cut(v, 200)).slice(0, 5);
  return {
    label: cut(label || kept.filter(Boolean).join(" / "), 300),
    values: kept,
    price: price !== null && price > 0 ? price : null, // 0 is a placeholder, never a price
    available,
    selected,
  };
}

/** Python's comparison of two lists of numbers, then of labels. */
function compareRanked(a: [number[], VariantOption], b: [number[], VariantOption]): number {
  const [ra, rb] = [a[0], b[0]];
  for (let i = 0; i < Math.min(ra.length, rb.length); i++) {
    const d = (ra[i] ?? 0) - (rb[i] ?? 0);
    if (d !== 0) return d;
  }
  if (ra.length !== rb.length) return ra.length - rb.length;
  const [la, lb] = [a[1].label, b[1].label];
  return la < lb ? -1 : la > lb ? 1 : 0;
}

// ── Amazon ───────────────────────────────────────────────────────────────────────────────────────────────────

const TWISTER_SELECTORS =
  '#twister_feature_div li, #twister li, [id^="inline-twister-row"] li, #inline-twister li, #twisterContainer li';
const SWATCH_PRICE_SELECTORS =
  ".a-price .a-offscreen, .twisterSwatchPrice, .twister_swatch_price, .a-color-price";
const SWATCH_LABEL_SELECTORS =
  ".swatch-title-text-display, .swatch-title-text, .twisterTextDiv, .a-button-text";
const DP_ASIN_RE = /\/dp\/([A-Z0-9]{10})/u;
const ASIN_RE = /^[A-Z0-9]{10}$/u;
const CURRENT_ASIN_RE = /"currentAsin"\s*:\s*"([A-Z0-9]{10})"/u;
const RANGE_SELECTORS =
  "#corePrice_desktop .a-price-range, #corePrice_feature_div .a-price-range, #corePriceDisplay_desktop_feature_div .a-price-range";

function amazon(doc: Document): Variants | null {
  const prices = swatchPrices(doc);
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    const body = script.textContent;
    if (body.includes("dimensionValuesDisplayData")) return twister(body, prices);
  }
  return amazonPicker(doc, prices);
}

function twister(body: string, prices: Map<string, number>): Variants | null {
  const keys = list(after(body, "dimensions")).filter((k): k is string => typeof k === "string");
  const labels = dict(after(body, "variationDisplayLabels"));
  const values = dict(after(body, "variationValues"));
  const combos = dict(after(body, "dimensionValuesDisplayData"));
  const chosen = dict(after(body, "selectedVariationValues"));
  const current = CURRENT_ASIN_RE.exec(body)?.[1] ?? "";
  const allChosen = Object.values(chosen).every(
    (v) => typeof v === "number" && Number.isInteger(v) && v >= 0,
  );
  const dimensions = keys.map((key) =>
    dimension(
      key,
      str(labels[key]) || key,
      list(values[key]).filter((v): v is string => typeof v === "string"),
    ),
  );
  const order = dimensions.map((d) => d.values);
  const ranked: [number[], VariantOption][] = [];
  for (const [asin, combo] of Object.entries(combos)) {
    const names = list(combo).filter((v): v is string => typeof v === "string");
    if (names.length === 0) continue;
    const rank = names.map((v, i) => {
      const at = order[i]?.indexOf(v) ?? -1;
      return at >= 0 ? at : MAX_VALUES;
    });
    ranked.push([rank, option(names, prices.get(asin) ?? null, { selected: asin === current && allChosen })]);
  }
  ranked.sort(compareRanked);
  return variants(
    "amazon",
    dimensions,
    ranked.map(([, o]) => o),
  );
}

function swatchPrices(doc: Document): Map<string, number> {
  const prices = new Map<string, number>();
  for (const li of Array.from(doc.querySelectorAll(TWISTER_SELECTORS))) {
    const asin = swatchAsin(li);
    const node = li.querySelector(SWATCH_PRICE_SELECTORS);
    if (!asin || prices.has(asin) || node === null) continue;
    const value = text(node);
    const price = /\d/u.test(value) ? parsePrice(value)[0] : null;
    if (price !== null) prices.set(asin, price);
  }
  return prices;
}

function swatchAsin(li: Element): string {
  for (const name of ["data-asin", "data-defaultasin"]) {
    const value = attr(li, name);
    if (value && ASIN_RE.test(value)) return value;
  }
  return DP_ASIN_RE.exec(attr(li, "data-dp-url"))?.[1] ?? "";
}

function amazonPicker(doc: Document, prices: Map<string, number>): Variants | null {
  // Without the twister's data: one dimension's swatches.
  const rows = Array.from(doc.querySelectorAll('[id^="inline-twister-row-"], [id^="variation_"]'));
  const row = rows[0];
  if (rows.length !== 1 || !row) return null;
  let key = attr(row, "id");
  if (key.startsWith("inline-twister-row-")) key = key.slice("inline-twister-row-".length);
  if (key.startsWith("variation_")) key = key.slice("variation_".length);
  const options = Array.from(row.querySelectorAll("li")).map((li) => {
    const selected = li.classList.contains("swatchSelected") || attr(li, "data-initiallyselected") === "true";
    return option([swatchLabel(li)], prices.get(swatchAsin(li)) ?? null, { selected });
  });
  return variants(
    "amazon",
    [
      dimension(
        key,
        key,
        options.map((o) => o.label),
      ),
    ],
    options,
  );
}

function swatchLabel(li: Element): string {
  const node = li.querySelector(SWATCH_LABEL_SELECTORS);
  const label = node ? text(node) : "";
  if (label) return stripPrice(label);
  const image = li.querySelector("img");
  const alt = image ? attr(image, "alt").trim() : "";
  if (alt) return alt;
  return attr(li, "title")
    .replace(/^Click to select /u, "")
    .trim();
}

function amazonRange(doc: Document): boolean {
  return doc.querySelector(RANGE_SELECTORS) !== null;
}

// ── Walmart ──────────────────────────────────────────────────────────────────────────────────────────────────

function walmart(doc: Document): Variants | null {
  const script = doc.getElementById("__NEXT_DATA__");
  if (!script || script.tagName.toLowerCase() !== "script") return null;
  let data: unknown;
  try {
    data = JSON.parse(script.textContent);
  } catch {
    return null;
  }
  const product = dict(
    dict(dict(dict(dict(dict(data)["props"])["pageProps"])["initialData"])["data"])["product"],
  );
  const criteria = list(product["variantCriteria"])
    .map(dict)
    .filter((c) => Object.keys(c).length > 0);
  if (criteria.length === 0) return null;
  const current = str(product["usItemId"]);
  const dimensions: VariantDimension[] = [];
  const names: Map<string, [number, string]>[] = [];
  for (const criterion of criteria.slice(0, MAX_DIMENSIONS)) {
    const values = list(criterion["variantList"]).map(dict);
    const byId = new Map<string, [number, string]>();
    values.forEach((v, i) => {
      const id = str(v["id"]);
      if (id) byId.set(id, [i, str(v["name"])]);
    });
    names.push(byId);
    dimensions.push(
      dimension(
        str(criterion["id"]),
        str(criterion["name"]),
        values.map((v) => str(v["name"])),
      ),
    );
  }
  const ranked: [number[], VariantOption][] = [];
  for (const [itemId, entry] of Object.entries(dict(product["variantsMap"]))) {
    const variant = dict(entry);
    const ids = new Set(list(variant["variants"]).map(str));
    const picked = names.map((dim): [number, string] => {
      for (const [vid, n] of dim) if (ids.has(vid)) return n;
      return [MAX_VALUES, ""];
    });
    if (!picked.some(([, name]) => name)) continue;
    const price = dict(dict(variant["priceInfo"])["currentPrice"])["price"];
    const status = str(variant["availabilityStatus"]);
    ranked.push([
      picked.map(([i]) => i),
      option(
        picked.map(([, name]) => name),
        typeof price === "number" ? price : null,
        { available: status ? status === "IN_STOCK" : null, selected: itemId === current },
      ),
    ]);
  }
  ranked.sort(compareRanked);
  return variants(
    "walmart",
    dimensions,
    ranked.map(([, o]) => o),
  );
}

// ── Shopify ──────────────────────────────────────────────────────────────────────────────────────────────────

const SHOPIFY_META_RE = /var meta = (?=\{)/u;

function shopify(doc: Document, url: string): Variants | null {
  const candidates: Json[] = [];
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    const body = script.textContent;
    if (!body.includes('"variants"')) continue;
    if (attr(script, "type").toLowerCase() === "application/json") {
      try {
        candidates.push(...shopifyProducts(JSON.parse(body), 0));
      } catch {
        continue;
      }
    } else {
      const m = SHOPIFY_META_RE.exec(body);
      if (m) candidates.push(...shopifyProducts(dict(rawDecode(body, m.index + m[0].length))["product"], 0));
    }
  }
  const named = candidates.filter((p) => optionNames(p).length > 0);
  const chosen = named.length > 0 ? named : candidates;
  return chosen[0] ? shopifyVariants(chosen[0], url) : null;
}

function shopifyProducts(node: unknown, depth: number): Json[] {
  if (depth > 6) return [];
  if (Array.isArray(node)) return node.flatMap((item) => shopifyProducts(item, depth + 1));
  if (!isObject(node)) return [];
  const found = node["variants"];
  if (Array.isArray(found) && found.length > 0 && found.every((v) => isObject(v) && "price" in v))
    return [node];
  return Object.values(node).flatMap((value) => shopifyProducts(value, depth + 1));
}

function optionNames(product: Json): string[] {
  for (const key of ["options_with_values", "options"]) {
    const names = list(product[key]).map((o) =>
      isObject(o) ? str(o["name"]) : typeof o === "string" ? o : "",
    );
    if (names.length > 0 && names.every(Boolean)) return names;
  }
  return [];
}

function shopifyVariants(product: Json, url: string): Variants | null {
  const names = optionNames(product);
  let wanted = "";
  try {
    wanted = new URL(url).searchParams.get("variant") ?? "";
  } catch {
    // no URL: the first available variant is on show
  }
  const rows: [string, string[], number | null, boolean | null][] = [];
  for (const entry of list(product["variants"])) {
    const variant = dict(entry);
    let values = list(variant["options"]).filter((v): v is string => typeof v === "string");
    if (values.length === 0) {
      values = ["option1", "option2", "option3"]
        .map((k) => variant[k])
        .filter((o): o is string => typeof o === "string" && o !== "");
    }
    const title = str(variant["public_title"]) || str(variant["title"]);
    if (values.length === 0 && title) values = title.split(" / ");
    if (values.length === 0 || (values.length === 1 && values[0] === "Default Title")) continue;
    const available = variant["available"];
    rows.push([
      str(variant["id"]),
      values,
      shopifyPrice(variant["price"]),
      typeof available === "boolean" ? available : null,
    ]);
  }
  let onShow = rows.findIndex((row) => wanted !== "" && row[0] === wanted);
  if (onShow < 0) onShow = rows.findIndex((row) => row[3] !== false);
  const options = rows.map(([, values, price, available], i) =>
    option(values, price, { available, selected: i === onShow }),
  );
  const width = Math.max(0, ...options.map((o) => o.values.length));
  const dimensions = Array.from({ length: width }, (_, i) =>
    dimension(
      names[i] ?? "",
      names[i] ?? "",
      options.filter((o) => i < o.values.length).map((o) => o.values[i] ?? ""),
    ),
  );
  return variants("shopify", dimensions, options);
}

function shopifyPrice(value: unknown): number | null {
  // Shopify's product JSON states amounts in cents ("price": 3849); a decimal string is in the currency already.
  if (typeof value === "number") return Number.isInteger(value) ? Number((value / 100).toFixed(2)) : value;
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/u.test(value)) {
    return value.includes(".") ? Number(value) : Number((Number.parseInt(value, 10) / 100).toFixed(2));
  }
  return null;
}

// ── WooCommerce ──────────────────────────────────────────────────────────────────────────────────────────────

function woocommerce(doc: Document): Variants | null {
  const form = doc.querySelector("form.variations_form[data-product_variations]");
  if (!form) return null;
  let found: unknown;
  try {
    found = JSON.parse(attr(form, "data-product_variations"));
  } catch {
    return null;
  }
  if (!Array.isArray(found)) return null;
  const labels = new Map<string, string>();
  for (const label of Array.from(form.querySelectorAll("label[for]")))
    labels.set(attr(label, "for"), text(label));
  const keys: string[] = [];
  const texts: Map<string, string>[] = [];
  const defaults: string[] = [];
  const dimensions: VariantDimension[] = [];
  for (const select of Array.from(form.querySelectorAll('select[name^="attribute_"]')).slice(
    0,
    MAX_DIMENSIONS,
  )) {
    const key = attr(select, "name");
    const entries = Array.from(select.querySelectorAll("option"))
      .map((o): [string, string] => [attr(o, "value"), text(o)])
      .filter(([value]) => value);
    const chosen = select.querySelector("option[selected]");
    keys.push(key);
    texts.push(new Map(entries));
    defaults.push(chosen ? attr(chosen, "value") : "");
    let fallback = key.startsWith("attribute_") ? key.slice("attribute_".length) : key;
    if (fallback.startsWith("pa_")) fallback = fallback.slice(3);
    const name = labels.get(attr(select, "id")) || fallback;
    dimensions.push(
      dimension(
        key,
        name,
        entries.map(([, t]) => t),
      ),
    );
  }
  const options = found.map((entry) => {
    const variation = dict(entry);
    const attributes = dict(variation["attributes"]);
    const picked = keys.map((key) => str(attributes[key]));
    const values = picked.map((v, i) => (v ? (texts[i]?.get(v) ?? v) : "Any"));
    const price = variation["display_price"];
    const stock = variation["is_in_stock"];
    return option(values, typeof price === "number" ? price : null, {
      available: typeof stock === "boolean" ? stock : null,
      selected:
        keys.length > 0 &&
        defaults.every(Boolean) &&
        picked.length === defaults.length &&
        picked.every((v, i) => v === defaults[i]),
    });
  });
  return variants("woocommerce", dimensions, options);
}

// ── schema.org ProductGroup ──────────────────────────────────────────────────────────────────────────────────

const VARIES_BY = ["size", "color", "pattern", "material", "suggestedAge", "suggestedGender"];

function jsonLdNodes(doc: Document): Json[] {
  const nodes: Json[] = [];
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    if (attr(script, "type") !== "application/ld+json") continue;
    try {
      walk(JSON.parse(script.textContent), nodes, 0);
    } catch {
      continue;
    }
  }
  return nodes;
}

function walk(node: unknown, nodes: Json[], depth: number): void {
  if (depth > 6) return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, nodes, depth + 1);
  } else if (isObject(node)) {
    const kind = node["@type"];
    const kinds: unknown[] = Array.isArray(kind) ? kind : [kind];
    if (kinds.includes("Product") || kinds.includes("ProductGroup")) nodes.push(node);
    for (const key of ["@graph", "mainEntity", "itemListElement"])
      if (key in node) walk(node[key], nodes, depth + 1);
  }
}

function schemaOrg(nodes: Json[]): Variants | null {
  for (const node of nodes) {
    const found = list(node["hasVariant"])
      .map(dict)
      .filter((v) => Object.keys(v).length > 0);
    if (found.length < 2) continue;
    let terms = list(node["variesBy"])
      .map((t) => str(t).replace(/\/+$/u, "").split("/").at(-1) ?? "")
      .filter(Boolean);
    if (terms.length === 0) terms = VARIES_BY.filter((t) => found.some((v) => truthy(v[t])));
    const options = found.map((variant) => {
      const values = terms.map((t) => named(variant[t]));
      const offer = first(variant["offers"]);
      const availability = str(offer["availability"]);
      return option(values.some(Boolean) ? values : [str(variant["name"])], amount(offer["price"]), {
        available: availability ? availability.endsWith("InStock") : null,
      });
    });
    const dimensions = terms.map((t, i) =>
      dimension(
        t,
        t,
        options.filter((o) => i < o.values.length).map((o) => o.values[i] ?? ""),
      ),
    );
    const result = variants("schema_org", dimensions, options);
    if (result) return result;
  }
  return null;
}

function aggregateRange(nodes: Json[]): boolean {
  // An AggregateOffer from a lowest to a higher price: the page's price is a "from" price.
  for (const node of nodes) {
    const offers = node["offers"];
    for (const entry of Array.isArray(offers) ? offers : [offers]) {
      const offer = dict(entry);
      const low = amount(offer["lowPrice"]);
      const high = amount(offer["highPrice"]);
      if (low !== null && high !== null && high > low) return true;
    }
  }
  return false;
}

// ── The page's own picker ────────────────────────────────────────────────────────────────────────────────────

const PICKER_RE =
  /variant|size|colou?r|style|größe|farbe|maat|kleur|taille|couleur|talla|taglia|modell|model|pattern|flavou?r|scent|pack/iu;
const NOT_PICKER_RE =
  /quantity|qty|country|currency|language|locale|sort|filter|ship|deliver|pickup|payment|region|province|state|search|amount|menge|aantal/iu;
const PLACEHOLDER_RE =
  /^(?:choose|select|pick|please|kies|wähle|bitte|choisi|sélection|elige|selecciona|scegli|-+)/iu;
const TRAILING_PRICE_RE =
  /\s*[-–—:(]?\s*(?:[€$£]|EUR|USD|GBP)\s?\d[\d.,]*\)?\s*$|\s*[-–—:(]?\s*\d[\d.,]*\s?(?:€|EUR|zł|kr)\)?\s*$/u;
const ID_RE = /^\d{5,}$/u;
const PRICE_IN_LABEL_RE = /[€$£]|EUR|USD|GBP|zł|kr/u;

function picker(doc: Document): Variants | null {
  const labels = new Map<string, string>();
  for (const label of Array.from(doc.querySelectorAll("label[for]")))
    labels.set(attr(label, "for"), text(label));
  const dimensions: VariantDimension[] = [];
  const groups: [string, boolean][][] = [];
  for (const select of Array.from(doc.querySelectorAll("select"))) {
    const name = pickerName(select, labels);
    if (name === null) continue;
    const entries = Array.from(select.querySelectorAll("option"))
      .filter((o) => {
        const value = o.hasAttribute("value") ? attr(o, "value") : text(o);
        return value !== "" && !PLACEHOLDER_RE.test(text(o));
      })
      .map((o): [string, boolean] => [text(o), o.hasAttribute("selected")]);
    addGroup(dimensions, groups, name, entries);
  }
  const radios = new Map<string, Element[]>();
  for (const radio of Array.from(doc.querySelectorAll("input"))) {
    if (!/^radio$/iu.test(attr(radio, "type")) || !attr(radio, "name")) continue;
    const name = attr(radio, "name");
    radios.set(name, [...(radios.get(name) ?? []), radio]);
  }
  for (const [key, inputs] of radios) {
    const head = inputs[0];
    const name = head ? pickerName(head, labels, key) : null;
    if (name === null) continue;
    addGroup(
      dimensions,
      groups,
      name,
      inputs.map((r): [string, boolean] => [radioLabel(r, labels), r.hasAttribute("checked")]),
    );
  }
  const group = groups[0];
  if (!group) return null;
  // A picker doesn't say how dimensions combine: its first dimension's values are the options.
  const options = group.map(([label, selected]) => {
    // Only a price at the end of the label ("Single 140 x 200 cm – €89.00"): never a size's number.
    const tail = TRAILING_PRICE_RE.exec(label)?.[0] ?? "";
    const price = tail && PRICE_IN_LABEL_RE.test(tail) ? parsePrice(tail)[0] : null;
    return option([stripPrice(label)], price, { selected });
  });
  return variants("picker", dimensions, options);
}

function pickerName(tag: Element, labels: Map<string, string>, key = ""): string | null {
  if (tag.parentElement?.closest("header, nav, footer")) return null;
  const name = key || attr(tag, "name");
  const label = !name || tag.tagName.toLowerCase() === "select" ? (labels.get(attr(tag, "id")) ?? "") : "";
  const names = `${name} ${attr(tag, "id")} ${attr(tag, "aria-label")} ${label}`;
  if (!PICKER_RE.test(names) || NOT_PICKER_RE.test(names)) return null;
  const group = tag.parentElement?.closest("fieldset");
  const legend = group?.querySelector("legend");
  const legendText = legend ? text(legend) : "";
  return legendText || label || attr(tag, "aria-label") || name;
}

function radioLabel(radio: Element, labels: Map<string, string>): string {
  const label = labels.get(attr(radio, "id"));
  if (label) return label;
  const parent = radio.parentElement?.closest("label");
  return parent ? text(parent) : attr(radio, "value");
}

function addGroup(
  dimensions: VariantDimension[],
  groups: [string, boolean][][],
  name: string,
  entries: [string, boolean][],
): void {
  // A label that is only a long number is a product ID the page didn't name.
  const kept = entries
    .filter(([label]) => label && !ID_RE.test(label))
    .map(([label, selected]): [string, boolean] => [cut(label, 300), selected])
    .slice(0, MAX_OPTIONS);
  if (new Set(kept.map(([label]) => label)).size < 2 || dimensions.length >= MAX_DIMENSIONS) return;
  dimensions.push(
    dimension(
      name,
      name,
      kept.map(([label]) => stripPrice(label)),
    ),
  );
  groups.push(kept);
}

function stripPrice(label: string): string {
  return label.replace(TRAILING_PRICE_RE, "").trim() || label;
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────────

function after(body: string, key: string): unknown {
  const m = new RegExp(String.raw`"${key}"\s*:\s*(?=[\[{])`, "u").exec(body);
  return m ? rawDecode(body, m.index + m[0].length) : undefined;
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dict(value: unknown): Json {
  return isObject(value) ? value : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

function first(value: unknown): Json {
  return dict(Array.isArray(value) && value.length > 0 ? (value[0] as unknown) : value);
}

/** Python truthiness for JSON values. */
function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return Boolean(value);
}

function named(value: unknown): string {
  if (isObject(value)) return str(truthy(value["name"]) ? value["name"] : value["value"]);
  return str(value);
}

function amount(value: unknown): number | null {
  if (typeof value === "number") return value >= 0 ? value : null;
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/u.test(value.trim())) return Number(value.trim());
  return null;
}

function str(value: unknown): string {
  if (typeof value === "string") return squash(value);
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  return "";
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item || seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}
