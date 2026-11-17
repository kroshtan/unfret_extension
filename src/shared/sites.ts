/** Which pages the extension knows: supported marketplaces (icon hint) and analysable pages. */

import sites from "./sites.json";

function escaped(domain: string): string {
  return domain.replaceAll(".", "\\.");
}

/**
 * Full-URL patterns for marketplace product pages, in the subset of syntax that both RE2 (Chromium's
 * `declarativeContent` `urlMatches`) and JavaScript accept. The browser matches them without any access to the page.
 */
export function marketplaceUrlPatterns(): string[] {
  const host = (domains: string[]): string =>
    `^https?://(?:[a-z0-9-]+\\.)*(?:${domains.map(escaped).join("|")})(?::[0-9]+)?/`;
  return [
    `${host(sites.amazon)}(?:[^?#]*/)?(?:dp|gp/product|gp/aw/d)/[A-Z0-9]{10}`,
    `${host(sites.bol)}(?:[^?#]*/)?p/[^/?#]+/[0-9]+`,
    `${host(sites.walmart)}ip/(?:[^/?#]+/)?[0-9]+`,
  ];
}

/** A product page on a supported marketplace (gets the icon hint), by the same patterns the browser uses. */
export function isMarketplaceProduct(url: string): boolean {
  return marketplaceUrlPatterns().some((pattern) => new RegExp(pattern, "u").test(url));
}

/**
 * The Unfret test shop: a made-up store on Unfret's own site with every trick Unfret catches, for demos, the store
 * screenshots and trying the extension out. Its product page and its checkout are the only Unfret pages to check.
 */
export const TEST_SHOP_PATH = "/test-shop";

function isTestShop(pathname: string): boolean {
  return pathname === TEST_SHOP_PATH || pathname.startsWith(`${TEST_SHOP_PATH}/`);
}

/** Pages a browser never lets extensions script, and the Unfret site itself (except its test shop). */
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
  return parsed.origin !== new URL(apiBase).origin || isTestShop(parsed.pathname);
}
