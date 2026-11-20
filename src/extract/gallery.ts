/**
 * A product page's photo gallery, on any shop system or marketplace: a port of the backend's `facts/gallery.py`.
 *
 * The product's photos go first in `image_urls`, large and in order: the main photo the extraction already put
 * first (structured data, else a product's Open Graph image), a marketplace's own data (AliExpress's
 * `imagePathList`, Temu's `gallery`), a Shopify theme's product JSON, then gallery markup (zoom and full-size
 * attributes; images inside a gallery, carousel or slider, never in a header, menu, footer, video or related
 * products). One photo in several sizes counts once (`photoKey`); at most `GALLERY_MAX`; only on a product page.
 */

import type { PageFacts } from "../shared/facts.js";
import { attr, hostname, rawDecode, urljoin } from "./dom.js";

export const GALLERY_MAX = 12;

const ZOOM_ATTRS = [
  "data-zoom-image",
  "data-zoom-image-url",
  "data-zoom-src",
  "data-zoom",
  "data-large_image",
  "data-large-image",
  "data-full",
  "data-full-src",
  "data-full-size",
  "data-big",
  "data-a-hires",
  "data-old-hires",
];
const LAZY_ATTRS = ["data-src", "data-lazy-src", "data-original", "src"];
const SRCSET_ATTRS = ["data-srcset", "srcset"];
const CONTAINER_RE =
  /gallery|carousel|slider|slideshow|swiper|slick|splide|flickity|filmstrip|thumbnails?\b|product[-_]?(?:media|images?|photos?|single__photo|slides?)/iu;
const NOT_PRODUCT_RE =
  /related|recommend|upsell|up-sell|cross-?sell|similar|recently|also[-_]?(?:bought|viewed|like)|reviews?\b|testimonial|logo|payment|banner|instagram|blog|video/iu;
const OUTSIDE_TAGS = new Set(["header", "nav", "footer", "aside"]);
const ANCESTORS = 8;
const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp|avif)(?:$|[?#_])/iu;
const PRODUCT_OG_TYPES = new Set(["product", "product.item", "product.group", "og:product"]);
const ALIEXPRESS_HOST_RE = /(?:^|\.)aliexpress\.[a-z.]+$/u;
const TEMU_HOST_RE = /(?:^|\.)temu\.com$/u;
const ALIEXPRESS_RE = /"imagePathList"\s*:\s*/u;
const TEMU_RE = /"gallery"\s*:\s*/u;
const SHOPIFY_JSON_ID_RE = /^ProductJson/iu;
const MARKETPLACES = new Set(["bol.com", "ebay", "walmart"]);

// The same photo's size variants, as photoKey strips them.
const KEY_PATTERNS: [RegExp, string][] = [
  [/\._[^/]*_(?=\.[a-z0-9]+$)/gu, ""], // Amazon's ._AC_SL1500_
  [/(\.(?:jpe?g|png|webp))_[^/]*$/gu, "$1"], // AliExpress's .jpg_220x220q75.jpg_.webp
  [
    /_(?:\d+x\d*|\d*x\d+|pico|icon|thumb|small|compact|medium|large|grande|original|master)(?:_crop_[a-z]+)?(?:@\dx)?(?=\.[a-z0-9]+$)/gu,
    "",
  ], // Shopify's _800x, _grande
  [/-(?:\d+x\d+|scaled|e\d{9,})(?=\.[a-z0-9]+$)/gu, ""], // WordPress's -300x300, -scaled
  [/\/s-l\d+(?=\.[a-z0-9]+$)/gu, "/s-l"], // eBay's s-l1600
  [/\/\d+x\d+(?=\.[a-z0-9]+$)/gu, ""], // bol.com's /550x550.jpg
];

/** One key for a photo's copies in every size: host and path, lower case, without query and size markers. */
export function photoKey(url: string): string {
  let key = (url.split("#")[0] ?? "").split("?")[0] ?? "";
  key = key.toLowerCase().replace(/^https?:/u, "");
  for (const [pattern, replacement] of KEY_PATTERNS) key = key.replace(pattern, replacement);
  return key;
}

/** The URLs with each photo once (`photoKey`), the first seen kept. */
export function dedupePhotos(urls: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (!url) continue;
    const key = photoKey(url);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(url);
    }
  }
  return out;
}

/** Put the product's gallery first in `facts.image_urls` (`main`: the photos already first). */
export function extract(doc: Document, url: string, facts: PageFacts, main: string[]): void {
  const host = hostname(url);
  const found = [...marketplaceJson(doc, host), ...shopJson(doc)];
  const productPage =
    main.length > 0 || found.length > 0 || PRODUCT_OG_TYPES.has(meta(doc, "og:type").trim().toLowerCase());
  if (!productPage && !MARKETPLACES.has(facts.platform)) return;
  const photos = [...main, ...found, ...markup(doc)]
    .map((p) => absolute(url, p))
    .filter((u) => u.startsWith("https://") && !u.includes("{") && IMAGE_EXT_RE.test(u));
  const gallery = dedupePhotos(photos).slice(0, GALLERY_MAX);
  if (gallery.length > dedupePhotos(main).length) {
    facts.image_urls = dedupePhotos([...gallery, ...facts.image_urls]).slice(0, 50);
  }
}

function absolute(base: string, url: string): string {
  const trimmed = url.trim();
  return trimmed.startsWith("//") ? `https:${trimmed}` : urljoin(base, trimmed);
}

function meta(doc: Document, key: string): string {
  const metas = Array.from(doc.querySelectorAll("meta"));
  const tag =
    metas.find((m) => m.getAttribute("property") === key) ??
    metas.find((m) => m.getAttribute("name") === key);
  return tag ? attr(tag, "content") : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeAfter(body: string, pattern: RegExp): unknown {
  const m = pattern.exec(body);
  return m ? rawDecode(body, m.index + m[0].length) : undefined;
}

/** Strings of a list, or each object's first string under `keys`. */
function urls(items: unknown, ...keys: string[]): string[] {
  const out: string[] = [];
  for (const item of Array.isArray(items) ? (items as unknown[]) : []) {
    let value: unknown = item;
    if (isRecord(item)) {
      const key = keys.find((k) => typeof item[k] === "string");
      value = key === undefined ? "" : item[key];
    }
    if (typeof value === "string" && value) out.push(value);
  }
  return out;
}

function marketplaceJson(doc: Document, host: string): string[] {
  let pattern: RegExp;
  let keys: string[] = [];
  if (ALIEXPRESS_HOST_RE.test(host)) pattern = ALIEXPRESS_RE;
  else if (TEMU_HOST_RE.test(host)) {
    pattern = TEMU_RE;
    keys = ["url", "imgUrl", "src"];
  } else return [];
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    const body = script.textContent;
    if (!pattern.test(body)) continue;
    const found = urls(decodeAfter(body, pattern), ...keys);
    if (found.length > 0) return found;
  }
  return [];
}

function shopJson(doc: Document): string[] {
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    if (attr(script, "type") !== "application/json") continue;
    if (!script.hasAttribute("data-product-json") && !SHOPIFY_JSON_ID_RE.test(attr(script, "id"))) continue;
    let data: unknown;
    try {
      data = JSON.parse(script.textContent);
    } catch {
      continue;
    }
    const product = isRecord(data) && isRecord(data["product"]) ? data["product"] : data;
    if (!isRecord(product)) continue;
    const mediaList = Array.isArray(product["media"]) ? (product["media"] as unknown[]) : [];
    const media = mediaList.filter((m) => isRecord(m) && m["media_type"] === "image");
    const imageUrls = urls(product["images"], "src");
    const found = imageUrls.length > 0 ? imageUrls : urls(media, "src");
    if (found.length > 0) return found;
  }
  return [];
}

function markup(doc: Document): string[] {
  const found: string[] = [];
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    const isImg = el.tagName.toLowerCase() === "img";
    const zoomAttr = ZOOM_ATTRS.find((a) => attr(el, a));
    if (!isImg && zoomAttr === undefined) continue;
    const zoom = zoomAttr === undefined ? "" : attr(el, zoomAttr);
    if (!inProductBlock(el) || (!zoom && !inGallery(el))) continue;
    const lazy = LAZY_ATTRS.find((a) => attr(el, a));
    const src = zoom || largest(el) || (lazy === undefined ? "" : attr(el, lazy));
    if (src && !src.startsWith("data:")) found.push(src);
  }
  return found;
}

function names(el: Element): string {
  return `${(attr(el, "class").match(/\S+/gu) ?? []).join(" ")} ${attr(el, "id")}`;
}

function inProductBlock(el: Element): boolean {
  let node: Element | null = el;
  while (node && node.tagName.toLowerCase() !== "body") {
    if (OUTSIDE_TAGS.has(node.tagName.toLowerCase()) || NOT_PRODUCT_RE.test(names(node))) return false;
    node = node.parentElement;
  }
  return true;
}

function inGallery(el: Element): boolean {
  let node: Element | null = el;
  for (let i = 0; i < ANCESTORS; i++) {
    if (!node || node.tagName.toLowerCase() === "body") return false;
    if (CONTAINER_RE.test(names(node))) return true;
    node = node.parentElement;
  }
  return false;
}

function largest(el: Element): string {
  let best = "";
  let width = -1;
  for (const name of SRCSET_ATTRS) {
    for (const part of attr(el, name).split(",")) {
      const bits = part.trim().split(/\s+/u).filter(Boolean);
      const w = bits[1];
      if (bits.length === 2 && w && /^\d+w$/u.test(w) && Number(w.slice(0, -1)) > width) {
        best = bits[0] ?? "";
        width = Number(w.slice(0, -1));
      }
    }
    if (best) return best;
  }
  return "";
}
