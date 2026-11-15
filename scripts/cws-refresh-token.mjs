// One-time helper for the owner: get the Chrome Web Store API refresh token the release workflow uses
// (store/SUBMIT.md, "The store credentials"):
//   node scripts/cws-refresh-token.mjs [--client <file>] [--out <file>] [--port <n>] [--print-url]
// --client is the OAuth client: by default ~/kroshtan_secrets/google-webstore-oauth (line 1 the client ID, line 2
// the client secret); a JSON file with client_id and client_secret, or the JSON Google Cloud downloads for a client
// ({"installed": {...}} or {"web": {...}}), works too. The script opens Google's consent page in the browser (and
// prints its address only if it can't: the address holds the client ID, which isn't secret, never the secret); sign
// in as the Google account that owns the Chrome Web Store item and allow access. Google redirects to a one-off server
// on http://127.0.0.1:<port>/ here (a "Desktop app" client accepts any port; a "Web application" client needs that
// exact address as an authorised redirect URI, so pass --port), the script exchanges the code (with PKCE) and writes
// the refresh token to --out, by default ~/kroshtan_secrets/google-webstore-refresh-token (mode 600). It never prints
// the secret or the token. If the browser runs on another machine, the redirect page fails to load: paste its full
// address here instead.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SCOPE = "https://www.googleapis.com/auth/chromewebstore";
export const CLIENT_FILE = join(homedir(), "kroshtan_secrets", "google-webstore-oauth");
export const TOKEN_FILE = join(homedir(), "kroshtan_secrets", "google-webstore-refresh-token");

/**
 * `{ clientId, clientSecret }` from a client file's text: two lines (ID, secret), our JSON or Google's download.
 * Errors never quote the text.
 */
export function readClient(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    const [clientId = "", clientSecret = ""] = trimmed.split(/\r?\n/u).map((line) => line.trim());
    if (!clientId.endsWith(".apps.googleusercontent.com") || !clientSecret) {
      throw new Error("the client file needs the client ID on line 1 and the client secret on line 2");
    }
    return { clientId, clientSecret };
  }
  let json;
  try {
    json = JSON.parse(trimmed);
  } catch {
    throw new Error("the client file is not valid JSON");
  }
  const data = json.installed ?? json.web ?? json;
  const clientId = data.client_id;
  const clientSecret = data.client_secret;
  if (!clientId || !clientSecret) throw new Error("the client file has no client_id and client_secret");
  return { clientId, clientSecret };
}

/** A PKCE verifier and its S256 challenge (RFC 7636). */
export function pkce(bytes = randomBytes(32)) {
  const verifier = Buffer.from(bytes).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** The consent page: offline access (so Google returns a refresh token) for the Chrome Web Store scope. */
export function consentUrl({ clientId, redirectUri, state, challenge }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** The authorization-code exchange Google's token endpoint expects. */
export function codeExchangeRequest({ clientId, clientSecret, code, redirectUri, verifier }) {
  return {
    method: "POST",
    url: TOKEN_URL,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  };
}

/** The code from a pasted redirect address (or a bare code); throws on a wrong state or Google's error. */
export function codeFrom(input, state) {
  const text = input.trim();
  if (!text.includes("=")) return text;
  const params = new URL(text, "http://127.0.0.1").searchParams;
  const error = params.get("error");
  if (error) throw new Error(`Google refused: ${error}`);
  if (params.get("state") !== state) throw new Error("the redirect's state doesn't match: start again");
  const code = params.get("code");
  if (!code) throw new Error("no code in that address");
  return code;
}

/** The value after `--name` in `argv`, or `fallback`. */
function option(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = argv[index + 1];
  if (!value) throw new Error(`--${name} needs a value`);
  return value;
}

/** Open `url` in the desktop's browser; false when there's no opener. */
function openBrowser(url) {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  return new Promise((resolve) => {
    try {
      const child = spawn(command, [url], { stdio: "ignore", detached: true });
      child.on("error", () => {
        resolve(false);
      });
      child.on("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

async function run(argv) {
  const file = option(argv, "client", CLIENT_FILE);
  const out = option(argv, "out", TOKEN_FILE);
  const port = Number(option(argv, "port", "0"));
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be 0 to 65535");
  if (!existsSync(file)) throw new Error(`${file} not found (store/SUBMIT.md says what goes in it)`);
  const { clientId, clientSecret } = readClient(readFileSync(file, "utf8"));
  const state = randomBytes(16).toString("hex");
  const { verifier, challenge } = pkce();

  let finish;
  const received = new Promise((resolve, reject) => {
    finish = { resolve, reject };
  });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/") {
      res.writeHead(404).end();
      return;
    }
    try {
      const code = codeFrom(url.href, state);
      res.writeHead(200, { "Content-Type": "text/plain" }).end("Done: go back to the terminal.\n");
      finish.resolve(code);
    } catch (error) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end(`${String(error)}\n`);
      finish.reject(error);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", (error) => {
      reject(new Error(`can't listen on 127.0.0.1:${port}: ${error.message}`));
    });
    server.listen(port, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  const bound = typeof address === "object" && address ? address.port : 0;
  const redirectUri = `http://127.0.0.1:${bound}/`;

  const url = consentUrl({ clientId, redirectUri, state, challenge });
  console.log(`Redirect address: ${redirectUri}`);
  received.catch(() => undefined);
  if (!argv.includes("--print-url") && (await openBrowser(url))) {
    console.log(
      "Opened Google's consent page in the browser: sign in as the account that owns the item and allow.",
    );
    console.log("(No browser? Stop and run again with --print-url.)");
  } else {
    console.log("Open this address, signed in as the account that owns the item, and allow access:\n");
    console.log(`  ${url}\n`);
  }
  console.log("Waiting for Google's redirect (or paste the redirect page's full address here):");
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    try {
      finish.resolve(codeFrom(line, state));
    } catch (error) {
      finish.reject(error);
    }
  });

  let code;
  try {
    code = await received;
  } finally {
    rl.close();
    server.close();
  }
  const request = codeExchangeRequest({ clientId, clientSecret, code, redirectUri, verifier });
  const response = await fetch(request.url, request);
  const data = await response.json();
  if (!response.ok) throw new Error(`token exchange: HTTP ${response.status}: ${JSON.stringify(data)}`);
  if (!data.refresh_token) throw new Error("Google returned no refresh token (was prompt=consent lost?)");

  writeFileSync(out, `${data.refresh_token}\n`, { mode: 0o600 });
  chmodSync(out, 0o600);
  console.log(
    `\nThe refresh token is in ${out} (mode 600): it becomes the Forgejo secret CWS_REFRESH_TOKEN.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
