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
