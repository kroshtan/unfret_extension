// Submit the store packages in dist/store (`make store-package` first) to the Chrome Web Store and addons.mozilla.org:
//   node scripts/store-publish.mjs [--chrome] [--firefox] [--dry-run] [--gate-only]
// With neither --chrome nor --firefox it does both. The "Release to the extension stores" workflow runs it; the steps
// it replaces are in store/SUBMIT.md and store/AMO.md.
//
// First the order guard: production's backend (https://unfret.net/v1/health) must run at least package.json's
// `minBackendVersion`, the backend release that accepts this extension's page data (an older one refuses new fields
// and platform values with 422). Then, per store, independently:
//   Chrome Web Store (API v2): get an access token, skip if this version is already submitted or published, upload
//     unfret-chrome-<version>.zip to item CWS_ITEM_ID and submit it for review (published when approved). Needs
//     CWS_PUBLISHER_ID and a service account linked to the publisher, CWS_SERVICE_ACCOUNT_KEY (its JSON key; the
//     token comes from a signed JWT, RFC 7523), or else the fallback: an OAuth client's CWS_CLIENT_ID,
//     CWS_CLIENT_SECRET and CWS_REFRESH_TOKEN (scripts/cws-refresh-token.mjs).
//   addons.mozilla.org (API v5, JWT auth): skip if this version exists, upload unfret-firefox-<version>.zip as a
//     listed upload, wait for validation, create the version with unfret-source-<version>.zip as its source, then
//     set its compatibility to Firefox desktop only (AMO_ANDROID=1 keeps the manifest's Android too). Needs
//     AMO_JWT_ISSUER and AMO_JWT_SECRET; AMO_APPROVAL_NOTES, if set, become the version's notes to the reviewer.
// A store whose secrets are missing is skipped with a notice; an API error fails the run. Secrets are never printed:
// tokens are masked in CI (`::add-mask::`) and the dry run shows <NAME> placeholders.
//
// --dry-run makes no store call at all and needs no secrets: it checks the packages and the backend version (a
// failed gate is reported, not fatal) and prints every request a real run would send, in order.
// --gate-only checks the backend version and stops.
import { createHmac, createSign, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const HEALTH_URL = "https://unfret.net/v1/health";
export const CWS_ITEM_ID = "giiengbpechhnphignbicmlcbklmcpjo";
export const CWS_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const CWS_API = "https://chromewebstore.googleapis.com";
export const AMO_API = "https://addons.mozilla.org/api/v5/addons/";
export const AMO_SLUG = "unfret";
const USER_AGENT = "unfret-store-publish";

// ── Versions and the order guard ───────────────────────────────────────────────────────────────────────────────

/** `x.y.z` with an optional pre-release (`0.11.0-rc.1`) as numbers and a pre-release string; throws otherwise. */
export function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-.]([0-9A-Za-z.]+))?$/u.exec(String(version).trim());
  if (!match) throw new Error(`not a version: ${JSON.stringify(version)}`);
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? "" };
}

/** Negative, zero or positive as `a` is older than, the same as or newer than `b`; a pre-release is older. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** The order guard: why `running` is too old for `minimum` (null when it is new enough). */
export function gateProblem(running, minimum) {
  if (running === undefined || running === null || running === "") return "the backend reports no version";
  try {
    if (compareVersions(running, minimum) >= 0) return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return (
    `production runs backend ${running}, this extension needs ${minimum} or newer (package.json ` +
    "minBackendVersion): deploy the backend to production first"
  );
}

/** Ask production's health endpoint for its version and check it; `{ running, problem }`. */
export async function checkBackend({ fetch: fetchFn = fetch, url = HEALTH_URL, minimum }) {
  let running;
  try {
    const response = await fetchFn(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    if (!response.ok) return { running, problem: `${url}: HTTP ${response.status}` };
    running = (await response.json()).version;
  } catch (error) {
    return { running, problem: `${url}: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { running, problem: gateProblem(running, minimum) };
}

// ── HTTP: real or dry run ────────────────────────────────────────────────────────────────────────────────────────

/** Thrown for a store API error: the request, the status and the response body (which never holds our secrets). */
export class StoreApiError extends Error {}

/** How a request body is shown in the dry run and the log. */
function describeBody(body) {
  if (body === undefined) return "";
  if (typeof body === "string") return ` ${body}`;
  if (body instanceof URLSearchParams) return ` (form: ${body.toString().replaceAll("&", ", ")})`;
  if (body instanceof FormData) {
    const parts = [...body.entries()].map(([key, value]) =>
      typeof value === "string" ? `${key}=${value}` : `${key}=@${value.name} (${value.size} bytes)`,
    );
    return ` (multipart: ${parts.join(", ")})`;
  }
  if (body instanceof Blob) return ` (${body.type || "binary"}, ${body.size} bytes)`;
  return "";
}

/**
 * A small client: `send(request)` performs it (or, in a dry run, prints it and returns `request.dry`). A request is
 * `{ method, url, headers, body, shown, dry, accept }`: `shown` replaces the body in what is printed (to hide
 * secrets), `accept` lists extra statuses that are not errors (e.g. 404 for "doesn't exist yet").
 */
export function httpClient({ fetch: fetchFn = fetch, dryRun = false, log = console.log } = {}) {
  const sent = [];
  async function send({ method = "GET", url, headers = {}, body, shown, dry = {}, accept = [], file }) {
    const line = `${method} ${url}${shown ?? describeBody(body)}${file ? ` (${file})` : ""}`;
    sent.push(line);
    if (dryRun) {
      log(`[dry run] ${line}`);
      return { status: dry.status ?? 200, data: dry.data ?? {} };
    }
    log(`→ ${method} ${url}`);
    const response = await fetchFn(url, {
      method,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
      body,
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { text };
    }
    if (!response.ok && !accept.includes(response.status)) {
      throw new StoreApiError(`${method} ${url}: HTTP ${response.status}: ${text.slice(0, 4000)}`);
    }
    return { status: response.status, data };
  }
  return { send, sent };
}

/** In CI, tell the runner to hide `value` from the log from here on. */
function mask(value) {
  if (value && (process.env.CI || process.env.FORGEJO_ACTIONS || process.env.GITHUB_ACTIONS)) {
    console.log(`::add-mask::${value}`);
  }
}

const base64url = (data) => Buffer.from(data).toString("base64url");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Chrome Web Store ─────────────────────────────────────────────────────────────────────────────────────────────

export const CWS_SCOPE = "https://www.googleapis.com/auth/chromewebstore";

/** A service account's key file (the JSON Google Cloud downloads), checked for the fields the token needs. */
export function readServiceAccount(json) {
  let key = json;
  if (typeof json === "string") {
    try {
      key = JSON.parse(json);
    } catch {
      // Not JSON.parse's message: it quotes the text, which is a private key.
      throw new Error("the service account key is not valid JSON");
    }
  }
  for (const field of ["client_email", "private_key"]) {
    if (!key?.[field]) throw new Error(`the service account key has no ${field}`);
  }
  return key;
}

/**
 * The signed JWT a service account trades for an access token (Google's OAuth 2.0 for service accounts, "HTTP/REST"):
 * RS256, iss = the account's e-mail, the Chrome Web Store scope, aud = the token endpoint, at most an hour.
 */
export function cwsServiceAccountAssertion(key, { now = Date.now(), lifetime = 3600 } = {}) {
  if (lifetime > 3600) throw new Error("Google accepts assertions of at most an hour");
  const iat = Math.floor(now / 1000);
  const header = base64url(
    JSON.stringify({ alg: "RS256", typ: "JWT", ...(key.private_key_id ? { kid: key.private_key_id } : {}) }),
  );
  const payload = base64url(
    JSON.stringify({ iss: key.client_email, scope: CWS_SCOPE, aud: CWS_TOKEN_URL, iat, exp: iat + lifetime }),
  );
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${payload}`)
    .sign(key.private_key, "base64url");
  return `${header}.${payload}.${signature}`;
}

/** The JWT-bearer grant (RFC 7523) for a service account's assertion. */
export function cwsServiceAccountTokenRequest(assertion) {
  return {
    method: "POST",
    url: CWS_TOKEN_URL,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  };
}

/** The refresh-token exchange (RFC 6749 §6) Google's OAuth server expects: the fallback to a service account. */
export function cwsTokenRequest({ clientId, clientSecret, refreshToken }) {
  return {
    method: "POST",
    url: CWS_TOKEN_URL,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  };
}

/** The Chrome Web Store API v2 URLs for one item. */
export function cwsUrls(publisherId, itemId = CWS_ITEM_ID) {
  const name = `publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(itemId)}`;
  return {
    upload: `${CWS_API}/upload/v2/${name}:upload`,
    publish: `${CWS_API}/v2/${name}:publish`,
    status: `${CWS_API}/v2/${name}:fetchStatus`,
  };
}

const CWS_DONE = new Set(["PENDING_REVIEW", "STAGED", "PUBLISHED", "PUBLISHED_TO_TESTERS"]);

/** The state this version already has in the store (pending review or published), or null. */
export function cwsExistingState(status, version) {
  for (const revision of [status.submittedItemRevisionStatus, status.publishedItemRevisionStatus]) {
    if (!revision || !CWS_DONE.has(revision.state)) continue;
    if ((revision.distributionChannels ?? []).some((channel) => channel.crxVersion === version)) {
      return revision.state;
    }
  }
  return null;
}

/** Upload `zipPath` to the item and submit it for review. Returns what happened, for the summary. */
export async function publishChrome({
  http,
  credentials,
  zipPath,
  version,
  itemId = CWS_ITEM_ID,
  wait = pause,
  dryRun = false,
}) {
  const { publisherId, serviceAccount, clientId, clientSecret, refreshToken } = credentials;
  let token;
  if (serviceAccount) {
    const assertion = dryRun
      ? "<RS256 JWT signed with CWS_SERVICE_ACCOUNT_KEY>"
      : cwsServiceAccountAssertion(serviceAccount);
    if (!dryRun) mask(assertion);
    token = {
      ...cwsServiceAccountTokenRequest(assertion),
      shown:
        " (form: grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer, assertion=<RS256 JWT: iss " +
        `${serviceAccount.client_email}, scope ${CWS_SCOPE}, signed with CWS_SERVICE_ACCOUNT_KEY>)`,
    };
  } else {
    token = {
      ...cwsTokenRequest({ clientId, clientSecret, refreshToken }),
      shown:
        ` (form: client_id=${clientId}, client_secret=<CWS_CLIENT_SECRET>, refresh_token=<CWS_REFRESH_TOKEN>, ` +
        "grant_type=refresh_token)",
    };
  }
  const { data: tokenData } = await http.send({
    ...token,
    dry: { data: { access_token: "<access token>", expires_in: 3599, token_type: "Bearer" } },
  });
  const accessToken = tokenData.access_token;
  if (!accessToken) throw new StoreApiError("Google's token response has no access_token");
  mask(accessToken);
  const auth = { Authorization: `Bearer ${accessToken}` };
  const urls = cwsUrls(publisherId, itemId);

  const { data: before } = await http.send({ url: urls.status, headers: auth, dry: { data: {} } });
  const existing = cwsExistingState(before, version);
  if (existing) return `Chrome Web Store: ${version} is already ${existing}; nothing uploaded`;

  const zip = readFileSync(zipPath);
  const { data: upload } = await http.send({
    method: "POST",
    url: urls.upload,
    headers: { ...auth, "Content-Type": "application/zip" },
    body: new Blob([zip], { type: "application/zip" }),
    file: basename(zipPath),
    dry: { data: { uploadState: "SUCCEEDED", crxVersion: version, itemId } },
  });
  let state = upload.uploadState;
  let crxVersion = upload.crxVersion;
  for (let i = 0; state === "IN_PROGRESS" && i < 60; i++) {
    await wait(5000);
    const { data: status } = await http.send({ url: urls.status, headers: auth });
    state = status.lastAsyncUploadState;
    crxVersion = status.submittedItemRevisionStatus?.distributionChannels?.[0]?.crxVersion ?? crxVersion;
  }
  if (state !== "SUCCEEDED") throw new StoreApiError(`Chrome Web Store upload ended as ${state}`);
  if (crxVersion && crxVersion !== version) {
    throw new StoreApiError(
      `the Chrome Web Store read version ${crxVersion} from the upload, expected ${version}`,
    );
  }

  const { data: published } = await http.send({
    method: "POST",
    url: urls.publish,
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ publishType: "DEFAULT_PUBLISH" }),
    dry: { data: { state: "PENDING_REVIEW", itemId } },
  });
  for (const warning of published.warningInfo?.warnings ?? []) {
    console.log(`::warning::Chrome Web Store: ${JSON.stringify(warning)}`);
  }
  if (!CWS_DONE.has(published.state)) {
    throw new StoreApiError(`the Chrome Web Store answered the submission with state ${published.state}`);
  }
  return `Chrome Web Store: ${version} uploaded and submitted (${published.state}); it is published when approved`;
}

// ── addons.mozilla.org ───────────────────────────────────────────────────────────────────────────────────────────

/** An AMO API token: HS256 JWT with iss, a unique jti, iat and exp (at most five minutes later). */
export function amoJwt({ issuer, secret, now = Date.now(), jti = randomUUID(), lifetime = 60 }) {
  if (lifetime > 300) throw new Error("AMO accepts tokens of at most five minutes");
  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iss: issuer, jti, iat, exp: iat + lifetime }));
  const signature = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/** The URLs of AMO's API v5 for the add-on. */
export function amoUrls(slug = AMO_SLUG, api = AMO_API) {
  return {
    upload: `${api}upload/`,
    uploadDetail: (uuid) => `${api}upload/${encodeURIComponent(uuid)}/`,
    versions: `${api}addon/${encodeURIComponent(slug)}/versions/`,
    version: (id) => `${api}addon/${encodeURIComponent(slug)}/versions/${encodeURIComponent(id)}/`,
  };
}

/** The validator's errors, one per line, for a failed upload. */
function validationErrors(validation) {
  const messages = (validation?.messages ?? []).filter((m) => m.type === "error");
  if (messages.length === 0) return JSON.stringify(validation ?? {}).slice(0, 4000);
  return messages.map((m) => `${m.message ?? m.id}${m.file ? ` (${m.file})` : ""}`).join("\n  ");
}

/** Submit `zipPath` as a new listed version with `sourcePath` as its source. Returns what happened. */
export async function publishFirefox({
  http,
  credentials,
  zipPath,
  sourcePath,
  version,
  android = false,
  approvalNotes = "",
  slug = AMO_SLUG,
  wait = pause,
  dryRun = false,
}) {
  const { issuer, secret } = credentials;
  const auth = () => {
    if (dryRun) return { Authorization: "JWT <AMO_JWT_ISSUER/AMO_JWT_SECRET HS256 token>" };
    const token = amoJwt({ issuer, secret });
    mask(token);
    return { Authorization: `JWT ${token}` };
  };
  const urls = amoUrls(slug);

  const { status: existing } = await http.send({
    url: urls.version(version),
    headers: auth(),
    accept: [404],
    dry: { status: 404 },
  });
  if (existing === 200) return `addons.mozilla.org: ${version} already exists; nothing uploaded`;

  const upload = new FormData();
  upload.set("channel", "listed");
  upload.set("upload", new Blob([readFileSync(zipPath)], { type: "application/zip" }), basename(zipPath));
  const { data: created } = await http.send({
    method: "POST",
    url: urls.upload,
    headers: auth(),
    body: upload,
    dry: { data: { uuid: "<upload uuid>", processed: true, valid: true } },
  });
  let detail = created;
  for (let i = 0; !detail.processed && i < 120; i++) {
    await wait(5000);
    detail = (await http.send({ url: urls.uploadDetail(created.uuid), headers: auth() })).data;
  }
  if (!detail.processed)
    throw new StoreApiError("addons.mozilla.org: validation didn't finish in 10 minutes");
  if (!detail.valid) {
    throw new StoreApiError(
      `addons.mozilla.org: the upload failed validation:\n  ${validationErrors(detail.validation)}`,
    );
  }

  // Source can only be sent as multipart, and compatibility only as JSON: two requests, as AMO's docs say.
  const versionForm = new FormData();
  versionForm.set("upload", created.uuid);
  versionForm.set(
    "source",
    new Blob([readFileSync(sourcePath)], { type: "application/zip" }),
    basename(sourcePath),
  );
  const { data: newVersion } = await http.send({
    method: "POST",
    url: urls.versions,
    headers: auth(),
    body: versionForm,
    dry: {
      data: {
        id: "<version id>",
        version,
        edit_url: `https://addons.mozilla.org/developers/addon/${slug}/versions/`,
      },
    },
  });
  if (!newVersion.id) throw new StoreApiError("addons.mozilla.org: the version create returned no id");

  const patch = {};
  if (!android) patch.compatibility = ["firefox"];
  if (approvalNotes) patch.approval_notes = approvalNotes;
  if (Object.keys(patch).length > 0) {
    const shown = { ...patch, ...(approvalNotes ? { approval_notes: "<AMO_APPROVAL_NOTES>" } : {}) };
    await http.send({
      method: "PATCH",
      url: urls.version(newVersion.id),
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify(patch),
      shown: ` ${JSON.stringify(shown)}`,
    });
  }
  return (
    `addons.mozilla.org: ${version} submitted as a listed version with its source` +
    `${newVersion.edit_url ? ` (${newVersion.edit_url})` : ""}; Firefox updates installed copies once it is approved`
  );
}

// ── The command line ─────────────────────────────────────────────────────────────────────────────────────────────

/** Which secrets of `names` are missing from `env`. */
export function missing(env, names) {
  return names.filter((name) => !env[name]);
}

/** Run everything the arguments ask for; returns the process exit code. */
export async function main(argv = process.argv.slice(2), env = process.env, fetchFn = fetch) {
  const dryRun = argv.includes("--dry-run");
  const only = ["chrome", "firefox"].filter((store) => argv.includes(`--${store}`));
  const stores = only.length > 0 ? only : ["chrome", "firefox"];
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const { version, minBackendVersion } = pkg;
  if (!minBackendVersion) throw new Error("package.json has no minBackendVersion");

  const healthUrl = env.UNFRET_HEALTH_URL || HEALTH_URL;
  const { running, problem } = await checkBackend({
    fetch: fetchFn,
    url: healthUrl,
    minimum: minBackendVersion,
  });
  if (problem) {
    if (!dryRun) {
      console.log(`::error::refusing the store release of ${version}: ${problem}`);
      return 1;
    }
    console.log(`::warning::a real run would refuse: ${problem}`);
  } else {
    console.log(`backend ${running} on ${healthUrl} meets minBackendVersion ${minBackendVersion}`);
  }
  if (argv.includes("--gate-only")) return 0;

  const dir = env.UNFRET_STORE_DIR || join(root, "dist", "store");
  const files = {
    chrome: join(dir, `unfret-chrome-${version}.zip`),
    firefox: join(dir, `unfret-firefox-${version}.zip`),
    source: join(dir, `unfret-source-${version}.zip`),
  };
  const needed = { chrome: [files.chrome], firefox: [files.firefox, files.source] };
  for (const store of stores) {
    for (const file of needed[store]) {
      if (!existsSync(file) || !statSync(file).isFile()) {
        throw new Error(`${file} is missing: run \`make store-package\` first`);
      }
    }
  }

  // Chrome: a service account (CWS_SERVICE_ACCOUNT_KEY) first; the OAuth refresh token when only that is set.
  const oauth = ["CWS_CLIENT_ID", "CWS_CLIENT_SECRET", "CWS_REFRESH_TOKEN"];
  const chromeOauth = !env.CWS_SERVICE_ACCOUNT_KEY && oauth.some((name) => env[name]);
  const secrets = {
    chrome: [...(chromeOauth ? oauth : ["CWS_SERVICE_ACCOUNT_KEY"]), "CWS_PUBLISHER_ID"],
    firefox: ["AMO_JWT_ISSUER", "AMO_JWT_SECRET"],
  };
  const http = httpClient({ fetch: fetchFn, dryRun });
  const results = [];
  let failed = false;
  for (const store of stores) {
    const absent = missing(env, secrets[store]);
    if (absent.length > 0 && !dryRun) {
      console.log(
        `::notice::${store}: skipped, the secret(s) ${absent.join(", ")} are not set (store/SUBMIT.md)`,
      );
      results.push(`${store}: skipped (no secrets)`);
      continue;
    }
    if (absent.length > 0)
      console.log(`${store}: ${absent.join(", ")} not set: a real run would skip this store`);
    const value = (name) => env[name] || `<${name}>`;
    try {
      if (store === "chrome") {
        const serviceAccount = chromeOauth
          ? undefined
          : env.CWS_SERVICE_ACCOUNT_KEY
            ? readServiceAccount(env.CWS_SERVICE_ACCOUNT_KEY)
            : { client_email: "<service account e-mail>", private_key: "" };
        console.log(
          `chrome: authenticating with ${chromeOauth ? "the OAuth refresh token" : "the service account"}`,
        );
        results.push(
          await publishChrome({
            http,
            version,
            zipPath: files.chrome,
            itemId: env.CWS_ITEM_ID || CWS_ITEM_ID,
            dryRun,
            credentials: {
              serviceAccount,
              clientId: value("CWS_CLIENT_ID"),
              clientSecret: value("CWS_CLIENT_SECRET"),
              refreshToken: value("CWS_REFRESH_TOKEN"),
              publisherId: value("CWS_PUBLISHER_ID"),
            },
          }),
        );
      } else {
        results.push(
          await publishFirefox({
            http,
            dryRun,
            version,
            zipPath: files.firefox,
            sourcePath: files.source,
            android: env.AMO_ANDROID === "1",
            approvalNotes: env.AMO_APPROVAL_NOTES ?? "",
            credentials: { issuer: value("AMO_JWT_ISSUER"), secret: value("AMO_JWT_SECRET") },
          }),
        );
      }
    } catch (error) {
      // The other store still gets its turn; the run fails at the end.
      failed = true;
      console.log(`::error::${store}: ${error instanceof Error ? error.message : String(error)}`);
      results.push(`${store}: FAILED`);
    }
  }
  for (const result of results) console.log(`${dryRun ? "[dry run] " : "::notice::"}${result}`);
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
