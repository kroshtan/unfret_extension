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
  ];
}

/** A product page on a supported marketplace (gets the icon hint), by the same patterns the browser uses. */
export function isMarketplaceProduct(url: string): boolean {
  return marketplaceUrlPatterns().some((pattern) => new RegExp(pattern, "u").test(url));
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
