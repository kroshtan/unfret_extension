/** Which pages the extension knows: supported marketplaces (badge, host permission) and analysable pages. */

import sites from "./sites.json";

const AMAZON_PRODUCT_RE = /\/(?:dp|gp\/product|gp\/aw\/d)\/[A-Z0-9]{10}/u;
const BOL_PRODUCT_RE = /\/p\/[^/]+\/\d+/u;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function onDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Match patterns for the manifest's host permissions. */
export function marketplacePatterns(): string[] {
  return [...sites.amazon, ...sites.bol].map((d) => `*://*.${d}/*`);
}

/** A product page on a supported marketplace (gets the "?" badge until analysed). */
export function isMarketplaceProduct(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  const host = hostOf(url);
  if (sites.amazon.some((d) => onDomain(host, d))) return AMAZON_PRODUCT_RE.test(path);
  if (sites.bol.some((d) => onDomain(host, d))) return BOL_PRODUCT_RE.test(path);
  return false;
}

/** Pages a browser never lets extensions script (and the Veridex site itself). */
export function isAnalysable(url: string | undefined, apiBase: string): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return false;
  const host = parsed.hostname;
  if (host === "chromewebstore.google.com" || host === "addons.mozilla.org") return false;
  if (host === "chrome.google.com" && parsed.pathname.startsWith("/webstore")) return false;
  return parsed.origin !== new URL(apiBase).origin;
}
