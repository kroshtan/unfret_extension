/**
 * Addresses the extension opens never carry pass or key material: a pass (`ufk_…`) or its backup code (`ufr_…`)
 * in an address ends up in the browser's history, in server logs and in the next page's referrer. The extension
 * builds its own addresses without any (a pass is named by its public ID only), and every address it opens or links
 * to goes through `withoutSecrets` as well, so one from the server or a future change can't carry one either.
 */

/** Query parameters that name pass or key material, whatever their value (`key_id`, a public ID, isn't one). */
const SECRET_PARAMS = new Set([
  "key",
  "pass",
  "token",
  "session",
  "secret",
  "recovery",
  "recovery_code",
  "backup",
  "backup_code",
  "api_key",
  "apikey",
  "access_token",
  "auth",
]);

/** A pass or a backup code anywhere in a value (also URL-encoded: the letters and `_` aren't escaped). */
const SECRET_VALUE_RE = /uf[kr]_[a-z2-7]{6,}/iu;

/**
 * `url` without query parameters that carry pass or key material, and without a fragment that does (`#pass=…`).
 * Anything that isn't an absolute URL comes back as it is.
 */
export function withoutSecrets(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  for (const name of [...new Set(parsed.searchParams.keys())]) {
    const secret =
      SECRET_PARAMS.has(name.toLowerCase()) ||
      parsed.searchParams.getAll(name).some((value) => SECRET_VALUE_RE.test(value));
    if (secret) parsed.searchParams.delete(name);
  }
  const fragment = parsed.hash.slice(1);
  if (fragment) {
    const names = [...new URLSearchParams(fragment).keys()].map((name) => name.toLowerCase());
    if (SECRET_VALUE_RE.test(fragment) || names.some((name) => SECRET_PARAMS.has(name))) parsed.hash = "";
  }
  return parsed.toString();
}

// ── The address of a page the user checks (audit L8) ─────────────────────────────────────────────────────────────
// A checked page's address goes to the server with the check: without its fragment, user name or password, and without
// query parameters that are about the visitor rather than the product. These lists are the backend's
// (`result_cache.is_tracking_param`), copied into test/fixtures/url-params.expected.json by `make parity` and compared
// in test/urls.test.ts, so the server keys an address the same whichever client sent it. What picks the product or its
// variant (`id`, `variant`, `th`, `size`, …) stays.

/** Tracking and referral parameters (compared in lower case). */
export const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  // ad clicks and campaigns
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "fbclid",
  "msclkid",
  "yclid",
  "ttclid",
  "twclid",
  "li_fat_id",
  "epik",
  "s_kwcid",
  "ef_id",
  "igshid",
  "igsh",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "_hsenc",
  "_hsmi",
  "mkt_tok",
  "oly_anon_id",
  "oly_enc_id",
  "vero_id",
  "vero_conv",
  "rb_clickid",
  "irclickid",
  "cjevent",
  "awc",
  "sscid",
  "ranmid",
  "raneaid",
  "ransiteid",
  "wickedid",
  // referrals and affiliate tags
  "ref",
  "ref_",
  "ref_src",
  "ref_url",
  "referrer",
  "tag",
  "aff_id",
  "affid",
  "linkcode",
  "linkid",
  "ascsubtag",
  "creativeasin",
  "si",
  "spm",
  "scm",
  "srsltid",
  // Amazon's search and placement trail (the product is the path's ASIN)
  "pd_rd_i",
  "pd_rd_r",
  "pd_rd_w",
  "pd_rd_wg",
  "pf_rd_i",
  "pf_rd_m",
  "pf_rd_p",
  "pf_rd_r",
  "pf_rd_s",
  "pf_rd_t",
  "psc",
  "qid",
  "sr",
  "keywords",
  "crid",
  "sprefix",
  "dib",
  "dib_tag",
  "content-id",
]);

/** Prefixes of tracking parameter names (`utm_source`, `hsa_cam`). */
export const TRACKING_PREFIXES: readonly string[] = ["utm_", "hsa_"];

/** Parameters that carry a session, a token or an e-mail address in a shop's own links. */
export const PRIVATE_PARAMS: ReadonlySet<string> = new Set([
  "token",
  "access_token",
  "auth_token",
  "id_token",
  "reset_token",
  "auth",
  "secret",
  "api_key",
  "apikey",
  "password",
  "pwd",
  "session",
  "sessionid",
  "session_id",
  "sid",
  "oscsid",
  "phpsessid",
  "jsessionid",
  "cfid",
  "cftoken",
  "email",
  "e-mail",
  "e_mail",
  "email_address",
]);

/** A value that is an e-mail address (also with its @ escaped), or an Unfret pass or backup code. */
const PRIVATE_VALUE_RE = /[^\s@/?#&=]+(?:@|%40)[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}|uf[kr]_[a-z2-7]{6,}/iu;

/** Whether a query parameter (its decoded name and value) is about the visitor rather than the product. */
export function isDroppedParam(name: string, value = ""): boolean {
  const lowered = name.toLowerCase();
  return (
    TRACKING_PARAMS.has(lowered) ||
    PRIVATE_PARAMS.has(lowered) ||
    TRACKING_PREFIXES.some((prefix) => lowered.startsWith(prefix)) ||
    PRIVATE_VALUE_RE.test(value)
  );
}

function decoded(part: string): string {
  try {
    return decodeURIComponent(part.replaceAll("+", " "));
  } catch {
    return part;
  }
}

/**
 * The address of a page as a check sends it: no fragment, no user name or password, no `;jsessionid=` in the path,
 * and no query parameter `isDroppedParam` names. The parameters that stay keep their order and spelling. Anything
 * that isn't an http(s) address comes back without its fragment only.
 */
export function checkedUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url.split("#", 1)[0] ?? "";
  }
  parsed.hash = "";
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return parsed.toString();
  parsed.username = "";
  parsed.password = "";
  parsed.pathname = parsed.pathname.replace(/;jsessionid=[^/]*/giu, "");
  const kept = parsed.search
    .slice(1)
    .split("&")
    .filter((pair) => {
      if (!pair) return false;
      const [name = "", ...rest] = pair.split("=");
      return !isDroppedParam(decoded(name), decoded(rest.join("=")));
    });
  parsed.search = kept.length > 0 ? `?${kept.join("&")}` : "";
  return parsed.toString();
}
