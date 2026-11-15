// One-time helper for the owner, only for the fallback to a service account: get the Chrome Web Store API refresh
// token the release workflow can use instead (store/SUBMIT.md, "Chrome Web Store fallback"):
//   node scripts/cws-refresh-token.mjs [client.json] [--save]
// client.json is either ~/kroshtan_secrets/cws-oauth.json ({"client_id", "client_secret", ...}, the default) or the
// JSON Google Cloud lets you download for a "Desktop app" OAuth client ({"installed": {...}}). The script prints a
// consent URL; open it signed in as the Google account that owns the Chrome Web Store item and allow access. Google
// then redirects to a one-off server on 127.0.0.1 here, the script exchanges the code (with PKCE) and prints the
// refresh token. If the browser runs on another machine, the redirect page fails to load: copy its full address from
// the address bar and paste it here instead. --save also writes the token into ~/kroshtan_secrets/cws-oauth.json.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SCOPE = "https://www.googleapis.com/auth/chromewebstore";
export const SECRETS_FILE = join(homedir(), "kroshtan_secrets", "cws-oauth.json");

/** `{ clientId, clientSecret }` from our own JSON or Google's downloaded client file. */
export function readClient(json) {
  const data = json.installed ?? json;
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

async function run(argv) {
  const save = argv.includes("--save");
  const file = argv.find((arg) => !arg.startsWith("--")) ?? SECRETS_FILE;
  if (!existsSync(file)) throw new Error(`${file} not found (store/SUBMIT.md says what goes in it)`);
  const { clientId, clientSecret } = readClient(JSON.parse(readFileSync(file, "utf8")));
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
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const redirectUri = `http://127.0.0.1:${port}/`;

  console.log(
    "Open this address, signed in as the account that owns the Chrome Web Store item, and allow access:\n",
  );
  console.log(`  ${consentUrl({ clientId, redirectUri, state, challenge })}\n`);
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

  console.log(`\nRefresh token (the Forgejo secret CWS_REFRESH_TOKEN):\n\n  ${data.refresh_token}\n`);
  if (save) {
    const current = existsSync(SECRETS_FILE) ? JSON.parse(readFileSync(SECRETS_FILE, "utf8")) : {};
    const next = {
      ...current,
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: data.refresh_token,
    };
    writeFileSync(SECRETS_FILE, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    console.log(`saved to ${SECRETS_FILE}`);
  }
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
