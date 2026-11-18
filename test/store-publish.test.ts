// @vitest-environment node
// Submitting to the Chrome Web Store and addons.mozilla.org: the order guard, the request shapes, the JWT, the
// dry run and the one-time refresh-token helper. No request leaves the test: fetch is a fake.
import { createHash, createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  codeExchangeRequest,
  codeFrom,
  consentUrl,
  pkce,
  readClient,
} from "../scripts/cws-refresh-token.mjs";
import { manifest } from "../scripts/manifest.mjs";
import {
  amoCompatibility,
  amoJwt,
  checkBackend,
  compareVersions,
  changelogHeadlines,
  CWS_ITEM_ID,
  cwsExistingState,
  cwsServiceAccountAssertion,
  cwsServiceAccountTokenRequest,
  cwsTokenRequest,
  cwsUrls,
  edgeHeaders,
  edgeNotes,
  edgeOperationId,
  edgeUrls,
  gateProblem,
  httpClient,
  main,
  packageManifest,
  publishChrome,
  publishEdge,
  publishFirefox,
  readServiceAccount,
} from "../scripts/store-publish.mjs";
import { zipBuffer, zipEntry } from "../scripts/zip.mjs";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * A fake fetch answering from `routes` ("METHOD url-substring" → JSON, [status, JSON] or [status, JSON, headers]);
 * records every call.
 */
function fakeFetch(routes: [string, unknown][]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...routes];
  const fn = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init.method ?? "GET";
    calls.push({ method, url, headers: (init.headers ?? {}) as Record<string, string>, body: init.body });
    const index = queue.findIndex(([key]) => {
      const [m, part] = key.split(" ", 2);
      return m === method && part !== undefined && url.includes(part);
    });
    if (index < 0) return Promise.resolve(new Response("unexpected", { status: 599 }));
    const [, answer] = queue.splice(index, 1)[0] ?? [];
    const [status, data, headers = {}] = Array.isArray(answer)
      ? (answer as [number, unknown, Record<string, string>?])
      : [200, answer];
    return Promise.resolve(
      new Response(status === 202 && data === null ? null : JSON.stringify(data), { status, headers }),
    );
  };
  return { fetch: fn, calls };
}

const temp: string[] = [];
afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function file(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "unfret-stores-"));
  temp.push(dir);
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}
/** A Firefox package: the release build's manifest (with Firefox for Android), or one without `gecko_android`. */
function firefoxZip(
  version: string,
  { android = true, dir }: { android?: boolean; dir?: string } = {},
): string {
  const built = manifest("firefox", { version, description: "Unfret" });
  const settings = built.browser_specific_settings as Record<string, unknown>;
  const content = android ? built : { ...built, browser_specific_settings: { gecko: settings.gecko } };
  const src = mkdtempSync(join(tmpdir(), "unfret-firefox-"));
  temp.push(src);
  writeFileSync(join(src, "manifest.json"), JSON.stringify(content));
  mkdirSync(join(src, "popup"));
  writeFileSync(join(src, "popup", "popup.html"), "<!doctype html>");
  const target = dir ?? mkdtempSync(join(tmpdir(), "unfret-stores-"));
  if (!dir) temp.push(target);
  const path = join(target, `unfret-firefox-${version}.zip`);
  writeFileSync(path, zipBuffer(src));
  return path;
}
const quiet = (): void => undefined;
const noWait = (): Promise<void> => Promise.resolve();

describe("the order guard", () => {
  it("compares versions numerically, a pre-release before its release", () => {
    expect(compareVersions("0.10.6", "0.10.6")).toBe(0);
    expect(compareVersions("0.10.10", "0.10.6")).toBe(1);
    expect(compareVersions("0.11.0", "0.10.6")).toBe(1);
    expect(compareVersions("0.10.5", "0.10.6")).toBe(-1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
    expect(compareVersions("0.10.6-rc.1", "0.10.6")).toBe(-1);
    expect(compareVersions("v0.10.6", "0.10.6")).toBe(0);
    expect(() => compareVersions("dev", "0.10.6")).toThrow(/not a version/u);
  });

  it("refuses an older, missing or unreadable backend version", () => {
    expect(gateProblem("0.10.6", "0.10.6")).toBeNull();
    expect(gateProblem("0.11.0", "0.10.6")).toBeNull();
    expect(gateProblem("0.10.5", "0.10.6")).toMatch(/runs backend 0\.10\.5.*0\.10\.6 or newer/u);
    expect(gateProblem(undefined, "0.10.6")).toMatch(/no version/u);
    expect(gateProblem("main", "0.10.6")).toMatch(/not a version/u);
  });

  it("reads the version from the health endpoint and treats an HTTP error as a refusal", async () => {
    const ok = fakeFetch([["GET /v1/health", { status: "healthy", version: "0.10.6" }]]);
    expect(await checkBackend({ fetch: ok.fetch, minimum: "0.10.6" })).toEqual({
      running: "0.10.6",
      problem: null,
    });
    expect(ok.calls[0]?.url).toBe("https://unfret.net/v1/health");
    const down = fakeFetch([["GET /v1/health", [502, {}]]]);
    expect((await checkBackend({ fetch: down.fetch, minimum: "0.10.6" })).problem).toMatch(/HTTP 502/u);
  });

  it("is set in package.json to a release version", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as {
      minBackendVersion: string;
    };
    expect(pkg.minBackendVersion).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(compareVersions(pkg.minBackendVersion, "0.10.5")).toBe(1);
  });
});

describe("Chrome Web Store", () => {
  const credentials = {
    clientId: "cid",
    clientSecret: "csecret",
    refreshToken: "rtoken",
    publisherId: "pub",
  };

  it("exchanges the refresh token as a form post to Google's token endpoint", () => {
    const request = cwsTokenRequest(credentials);
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://oauth2.googleapis.com/token");
    expect(request.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(request.body)).toEqual({
      client_id: "cid",
      client_secret: "csecret",
      refresh_token: "rtoken",
      grant_type: "refresh_token",
    });
  });

  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const serviceAccount = {
    client_email: "unfret-release@unfret-cws.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    private_key_id: "kid1",
  };

  it("signs a service account's RS256 assertion for the Chrome Web Store scope", () => {
    const jwt = cwsServiceAccountAssertion(serviceAccount, { now: 1_700_000_000_000 });
    const [header = "", payload = "", signature = ""] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
      kid: "kid1",
    });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/chromewebstore",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    expect(
      createVerify("RSA-SHA256").update(`${header}.${payload}`).verify(publicKey, signature, "base64url"),
    ).toBe(true);
    expect(() => cwsServiceAccountAssertion(serviceAccount, { lifetime: 3601 })).toThrow(/an hour/u);
    const request = cwsServiceAccountTokenRequest(jwt);
    expect(request.url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(request.body)).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    });
  });

  it("reads the key file without quoting it in errors", () => {
    expect(readServiceAccount(JSON.stringify(serviceAccount)).client_email).toBe(serviceAccount.client_email);
    expect(() => readServiceAccount("{-----BEGIN PRIVATE KEY----- secret")).toThrow(
      /^the service account key is not valid JSON$/u,
    );
    expect(() => readServiceAccount({ client_email: "x" })).toThrow(/private_key/u);
  });

  it("gets its token with the service account when one is given", async () => {
    const zipPath = file("unfret-chrome-0.10.1.zip", "PK");
    const { fetch, calls } = fakeFetch([
      ["POST /token", { access_token: "satoken" }],
      ["GET :fetchStatus", {}],
      ["POST :upload", { uploadState: "SUCCEEDED", crxVersion: "0.10.1" }],
      ["POST :publish", { state: "PENDING_REVIEW" }],
    ]);
    const http = httpClient({ fetch, log: quiet });
    await publishChrome({
      http,
      credentials: { publisherId: "pub", serviceAccount },
      zipPath,
      version: "0.10.1",
    });
    const form = Object.fromEntries(calls[0]?.body as URLSearchParams);
    expect(form.grant_type).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(form.assertion?.split(".")).toHaveLength(3);
    expect(calls[3]?.headers.Authorization).toBe("Bearer satoken");
  });

  it("uses the v2 publisher/item URLs", () => {
    expect(cwsUrls("pub")).toEqual({
      upload: `https://chromewebstore.googleapis.com/upload/v2/publishers/pub/items/${CWS_ITEM_ID}:upload`,
      publish: `https://chromewebstore.googleapis.com/v2/publishers/pub/items/${CWS_ITEM_ID}:publish`,
      status: `https://chromewebstore.googleapis.com/v2/publishers/pub/items/${CWS_ITEM_ID}:fetchStatus`,
    });
  });

  it("knows a version that is already pending or published", () => {
    const status = {
      submittedItemRevisionStatus: {
        state: "PENDING_REVIEW",
        distributionChannels: [{ crxVersion: "0.10.1" }],
      },
      publishedItemRevisionStatus: { state: "PUBLISHED", distributionChannels: [{ crxVersion: "0.10.0" }] },
    };
    expect(cwsExistingState(status, "0.10.1")).toBe("PENDING_REVIEW");
    expect(cwsExistingState(status, "0.10.0")).toBe("PUBLISHED");
    expect(cwsExistingState(status, "0.10.2")).toBeNull();
    const rejected = {
      submittedItemRevisionStatus: { state: "REJECTED", distributionChannels: [{ crxVersion: "0.10.2" }] },
    };
    expect(cwsExistingState(rejected, "0.10.2")).toBeNull();
  });

  it("gets a token, uploads the zip with it and submits for review", async () => {
    const zipPath = file("unfret-chrome-0.10.1.zip", "PK zip");
    const { fetch, calls } = fakeFetch([
      ["POST oauth2.googleapis.com/token", { access_token: "atoken", expires_in: 3599 }],
      ["GET :fetchStatus", {}],
      ["POST :upload", { uploadState: "IN_PROGRESS" }],
      ["GET :fetchStatus", { lastAsyncUploadState: "SUCCEEDED" }],
      ["POST :publish", { state: "PENDING_REVIEW" }],
    ]);
    const http = httpClient({ fetch, log: quiet });
    const result = await publishChrome({ http, credentials, zipPath, version: "0.10.1", wait: noWait });
    expect(result).toMatch(/submitted \(PENDING_REVIEW\)/u);
    expect(calls.map((c) => `${c.method} ${c.url.split("/").pop() ?? ""}`)).toEqual([
      "POST token",
      `GET ${CWS_ITEM_ID}:fetchStatus`,
      `POST ${CWS_ITEM_ID}:upload`,
      `GET ${CWS_ITEM_ID}:fetchStatus`,
      `POST ${CWS_ITEM_ID}:publish`,
    ]);
    for (const call of calls.slice(1)) expect(call.headers.Authorization).toBe("Bearer atoken");
    const upload = calls[2];
    expect(upload?.headers["Content-Type"]).toBe("application/zip");
    expect(Buffer.from(await (upload?.body as Blob).arrayBuffer()).toString()).toBe("PK zip");
    expect(JSON.parse(String(calls[4]?.body))).toEqual({ publishType: "DEFAULT_PUBLISH" });
  });

  it("skips a version the store already has, and fails loudly on an API error", async () => {
    const zipPath = file("unfret-chrome-0.10.1.zip", "PK");
    const done = fakeFetch([
      ["POST /token", { access_token: "a" }],
      [
        "GET :fetchStatus",
        {
          publishedItemRevisionStatus: {
            state: "PUBLISHED",
            distributionChannels: [{ crxVersion: "0.10.1" }],
          },
        },
      ],
    ]);
    const http = httpClient({ fetch: done.fetch, log: quiet });
    expect(await publishChrome({ http, credentials, zipPath, version: "0.10.1" })).toMatch(
      /already PUBLISHED/u,
    );
    expect(done.calls).toHaveLength(2);

    const refused = fakeFetch([["POST /token", [400, { error: "invalid_grant" }]]]);
    await expect(
      publishChrome({
        http: httpClient({ fetch: refused.fetch, log: quiet }),
        credentials,
        zipPath,
        version: "0.10.1",
      }),
    ).rejects.toThrow(/HTTP 400.*invalid_grant/u);

    const failed = fakeFetch([
      ["POST /token", { access_token: "a" }],
      ["GET :fetchStatus", {}],
      ["POST :upload", { uploadState: "FAILED" }],
    ]);
    await expect(
      publishChrome({
        http: httpClient({ fetch: failed.fetch, log: quiet }),
        credentials,
        zipPath,
        version: "0.10.1",
      }),
    ).rejects.toThrow(/upload ended as FAILED/u);
  });
});

describe("addons.mozilla.org", () => {
  it("signs an HS256 JWT with iss, jti, iat and an exp within five minutes", () => {
    const token = amoJwt({ issuer: "user:1:2", secret: "s3cret", now: 1_700_000_000_000, jti: "nonce" });
    const [header = "", payload = "", signature = ""] = token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
      iss: "user:1:2",
      jti: "nonce",
      iat: 1_700_000_000,
      exp: 1_700_000_060,
    });
    expect(signature).toBe(createHmac("sha256", "s3cret").update(`${header}.${payload}`).digest("base64url"));
    expect(amoJwt({ issuer: "i", secret: "s" })).not.toBe(amoJwt({ issuer: "i", secret: "s" }));
    expect(() => amoJwt({ issuer: "i", secret: "s", lifetime: 301 })).toThrow(/five minutes/u);
  });

  it("reads the package's manifest: the release build keeps Firefox for Android", () => {
    const released = packageManifest(firefoxZip("0.11.0"));
    expect(released.browser_specific_settings).toHaveProperty("gecko_android");
    expect(amoCompatibility(released)).toBeNull();
    expect(amoCompatibility(packageManifest(firefoxZip("0.11.0", { android: false })))).toEqual(["firefox"]);
    expect(() => packageManifest(file("unfret-firefox-0.11.0.zip", "xpi"))).toThrow(/not a zip/u);
    const zip = readFileSync(firefoxZip("0.11.0"));
    expect(zipEntry(zip, "popup/popup.html")?.toString()).toBe("<!doctype html>");
    expect(zipEntry(zip, "missing.json")).toBeNull();
  });

  it("uploads as listed, creates the version with its source, then sends the notes alone (no compatibility with Android)", async () => {
    const zipPath = firefoxZip("0.10.1");
    const sourcePath = file("unfret-source-0.10.1.zip", "src");
    const { fetch, calls } = fakeFetch([
      ["GET /addon/unfret/versions/0.10.1/", [404, { detail: "Not found." }]],
      ["POST /upload/", { uuid: "u1", processed: false }],
      ["GET /upload/u1/", { uuid: "u1", processed: true, valid: true }],
      ["POST /addon/unfret/versions/", { id: 42, edit_url: "https://addons.mozilla.org/x" }],
      ["PATCH /addon/unfret/versions/42/", { id: 42 }],
    ]);
    const http = httpClient({ fetch, log: quiet });
    const result = await publishFirefox({
      http,
      credentials: { issuer: "user:1:2", secret: "s3cret" },
      zipPath,
      sourcePath,
      version: "0.10.1",
      approvalNotes: "test key ufk_x",
      wait: noWait,
    });
    expect(result).toMatch(/submitted as a listed version with its source.*; reviewer notes set$/u);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "GET", "POST", "PATCH"]);
    for (const call of calls) expect(call.headers.Authorization).toMatch(/^JWT [\w-]+\.[\w-]+\.[\w-]+$/u);
    const upload = calls[1]?.body as FormData;
    expect(upload.get("channel")).toBe("listed");
    expect((upload.get("upload") as File).name).toBe("unfret-firefox-0.10.1.zip");
    const version = calls[3]?.body as FormData;
    expect(version.get("upload")).toBe("u1");
    expect(await (version.get("source") as File).text()).toBe("src");
    expect(calls[4]?.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(calls[4]?.body))).toEqual({ approval_notes: "test key ufk_x" });
    expect(calls.some((c) => typeof c.body === "string" && c.body.includes("compatibility"))).toBe(false);
  });

  it("sends the notes and a desktop-only compatibility separately, so a refused one doesn't lose the other", async () => {
    const zipPath = firefoxZip("0.10.1", { android: false });
    const sourcePath = file("unfret-source-0.10.1.zip", "src");
    const { fetch, calls } = fakeFetch([
      ["GET /addon/unfret/versions/0.10.1/", [404, {}]],
      ["POST /upload/", { uuid: "u1", processed: true, valid: true }],
      ["POST /addon/unfret/versions/", { id: 42 }],
      ["PATCH /addon/unfret/versions/42/", { id: 42 }],
      [
        "PATCH /addon/unfret/versions/42/",
        [
          400,
          {
            compatibility: [
              "Can not override compatibility information set in the manifest for this application (Firefox for Android)",
            ],
          },
        ],
      ],
    ]);
    await expect(
      publishFirefox({
        http: httpClient({ fetch, log: quiet }),
        credentials: { issuer: "i", secret: "s" },
        zipPath,
        sourcePath,
        version: "0.10.1",
        approvalNotes: "notes",
      }),
    ).rejects.toThrow(
      /submitted as a listed version.*; reviewer notes set; but these failed.*\n {2}compatibility firefox: .*HTTP 400/su,
    );
    expect(calls.slice(3).map((c) => JSON.parse(String(c.body)) as unknown)).toEqual([
      { approval_notes: "notes" },
      { compatibility: ["firefox"] },
    ]);

    // And the other way round: notes refused, compatibility still set.
    const notesRefused = fakeFetch([
      ["GET /addon/unfret/versions/0.10.1/", [404, {}]],
      ["POST /upload/", { uuid: "u1", processed: true, valid: true }],
      ["POST /addon/unfret/versions/", { id: 42 }],
      ["PATCH /addon/unfret/versions/42/", [400, { approval_notes: ["too long"] }]],
      ["PATCH /addon/unfret/versions/42/", { id: 42 }],
    ]);
    await expect(
      publishFirefox({
        http: httpClient({ fetch: notesRefused.fetch, log: quiet }),
        credentials: { issuer: "i", secret: "s" },
        zipPath,
        sourcePath,
        version: "0.10.1",
        approvalNotes: "notes",
      }),
    ).rejects.toThrow(/compatibility firefox set; but these failed.*reviewer notes: .*too long/su);
    expect(notesRefused.calls).toHaveLength(5);
  });

  it("finishes a version AMO already has: adds the missing notes, uploads nothing", async () => {
    const zipPath = firefoxZip("0.11.0");
    const sourcePath = file("unfret-source-0.11.0.zip", "src");
    const credentials = { issuer: "i", secret: "s" };
    // Run 84: the version was created, the PATCH after it refused.
    const created = {
      id: 6717859,
      version: "0.11.0",
      approval_notes: "",
      compatibility: { firefox: { min: "140.0", max: "*" }, android: { min: "142.0", max: "*" } },
      file: { status: "unreviewed" },
    };
    const resume = fakeFetch([
      ["GET /addon/unfret/versions/0.11.0/", created],
      ["PATCH /addon/unfret/versions/6717859/", { id: 6717859 }],
    ]);
    expect(
      await publishFirefox({
        http: httpClient({ fetch: resume.fetch, log: quiet }),
        credentials,
        zipPath,
        sourcePath,
        version: "0.11.0",
        approvalNotes: "notes\nwith the key",
      }),
    ).toBe(
      "addons.mozilla.org: 0.11.0 already exists (version 6717859); nothing uploaded; reviewer notes set",
    );
    expect(resume.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET https://addons.mozilla.org/api/v5/addons/addon/unfret/versions/0.11.0/",
      "PATCH https://addons.mozilla.org/api/v5/addons/addon/unfret/versions/6717859/",
    ]);
    expect(JSON.parse(String(resume.calls[1]?.body))).toEqual({ approval_notes: "notes\nwith the key" });

    // Run again once the notes are there: nothing to do.
    const again = fakeFetch([
      ["GET /addon/unfret/versions/0.11.0/", { ...created, approval_notes: "notes\r\nwith the key\n" }],
    ]);
    expect(
      await publishFirefox({
        http: httpClient({ fetch: again.fetch, log: quiet }),
        credentials,
        zipPath,
        sourcePath,
        version: "0.11.0",
        approvalNotes: "notes\nwith the key",
      }),
    ).toMatch(/nothing uploaded; reviewer notes already set$/u);
    expect(again.calls).toHaveLength(1);

    // A desktop-only package on a version that has Android gets its compatibility; a disabled version is left alone.
    const desktop = fakeFetch([
      ["GET /addon/unfret/versions/0.11.0/", created],
      ["PATCH /addon/unfret/versions/6717859/", { id: 6717859 }],
    ]);
    expect(
      await publishFirefox({
        http: httpClient({ fetch: desktop.fetch, log: quiet }),
        credentials,
        zipPath: firefoxZip("0.11.0", { android: false }),
        sourcePath,
        version: "0.11.0",
      }),
    ).toMatch(/no reviewer notes \(AMO_APPROVAL_NOTES is not set\); compatibility firefox set$/u);
    expect(JSON.parse(String(desktop.calls[1]?.body))).toEqual({ compatibility: ["firefox"] });

    const disabled = fakeFetch([
      ["GET /addon/unfret/versions/0.11.0/", { ...created, file: { status: "disabled" } }],
    ]);
    expect(
      await publishFirefox({
        http: httpClient({ fetch: disabled.fetch, log: quiet }),
        credentials,
        zipPath,
        sourcePath,
        version: "0.11.0",
        approvalNotes: "notes",
      }),
    ).toMatch(/already exists \(disabled\); nothing uploaded or changed/u);
    expect(disabled.calls).toHaveLength(1);
  });

  it("stops on a failed validation and doesn't upload a version that exists", async () => {
    const zipPath = firefoxZip("0.10.1");
    const sourcePath = file("unfret-source-0.10.1.zip", "src");
    const credentials = { issuer: "i", secret: "s" };
    const invalid = fakeFetch([
      ["GET /versions/0.10.1/", [404, {}]],
      [
        "POST /upload/",
        {
          uuid: "u1",
          processed: true,
          valid: false,
          validation: { messages: [{ type: "error", message: "bad manifest" }] },
        },
      ],
    ]);
    await expect(
      publishFirefox({
        http: httpClient({ fetch: invalid.fetch, log: quiet }),
        credentials,
        zipPath,
        sourcePath,
        version: "0.10.1",
      }),
    ).rejects.toThrow(/failed validation:\n {2}bad manifest/u);

    const exists = fakeFetch([["GET /versions/0.10.1/", { id: 7, version: "0.10.1" }]]);
    expect(
      await publishFirefox({
        http: httpClient({ fetch: exists.fetch, log: quiet }),
        credentials,
        zipPath,
        sourcePath,
        version: "0.10.1",
      }),
    ).toMatch(/already exists \(version 7\); nothing uploaded/u);
    expect(exists.calls).toHaveLength(1);
  });
});

describe("Microsoft Edge Add-ons", () => {
  const credentials = {
    productId: "d34f98f5-f9b7-42b1-bebb-98707202b21d",
    clientId: "cid",
    apiKey: "the-key",
  };
  const product =
    "https://api.addons.microsoftedge.microsoft.com/v1/products/d34f98f5-f9b7-42b1-bebb-98707202b21d";
  const accepted = (location: string): [number, null, Record<string, string>] => [
    202,
    null,
    { Location: location },
  ];

  it("uses the API v1.1 endpoints and headers", () => {
    const urls = edgeUrls(credentials.productId);
    expect(urls.upload).toBe(`${product}/submissions/draft/package`);
    expect(urls.uploadStatus("op1")).toBe(`${product}/submissions/draft/package/operations/op1`);
    expect(urls.publish).toBe(`${product}/submissions`);
    expect(urls.publishStatus("op2")).toBe(`${product}/submissions/operations/op2`);
    expect(edgeHeaders(credentials)).toEqual({ Authorization: "ApiKey the-key", "X-ClientID": "cid" });
  });

  it("reads the operation ID from the Location header, bare or as a URL", () => {
    expect(edgeOperationId("4d2a5f3e-0001")).toBe("4d2a5f3e-0001");
    expect(edgeOperationId(`${product}/submissions/operations/4d2a5f3e-0002/`)).toBe("4d2a5f3e-0002");
    expect(edgeOperationId("/v1/products/p/submissions/draft/package/operations/op?x=1")).toBe("op");
    expect(edgeOperationId("")).toBeNull();
    expect(edgeOperationId(undefined)).toBeNull();
  });

  it("writes notes for certification from the changelog, then the testers' instructions", () => {
    const changelog = [
      "# Changelog",
      "",
      "## 0.13.0 (unreleased)",
      "",
      "- **The result card**, as on the website.",
      "  More text.",
      "- **One gift code a month.** Details.",
      "- A line without a headline.",
      "",
      "## 0.12.0",
      "",
      "- **Older.**",
    ].join("\n");
    expect(changelogHeadlines(changelog, "0.13.0")).toEqual(["The result card", "One gift code a month"]);
    expect(changelogHeadlines(changelog, "0.12.0")).toEqual(["Older"]);
    expect(changelogHeadlines(changelog, "0.1.0")).toEqual([]);
    const notes = edgeNotes({ version: "0.13.0", changelog, instructions: "Test key: ufk_x\n" });
    expect(notes).toBe(
      [
        "Unfret 0.13.0.",
        "What changed:",
        "- The result card",
        "- One gift code a month",
        "Full changelog: https://git.kroshtan.com/kroshtan/unfret_extension/src/tag/v0.13.0/CHANGELOG.md",
        "",
        "Test key: ufk_x",
      ].join("\n"),
    );
    // Too long: headlines go from the end, the instructions stay whole.
    const long = changelog.replace("a month.**", "a month, for each pass and each wallet.**");
    const full = edgeNotes({ version: "0.13.0", changelog: long, instructions: "x".repeat(150) });
    const short = edgeNotes({
      version: "0.13.0",
      changelog: long,
      instructions: "x".repeat(150),
      max: full.length - 1,
    });
    expect(short.length).toBeLessThan(full.length);
    expect(short).toContain("- The result card\n- and more (see the changelog)");
    expect(short).not.toContain("gift code");
    expect(short.endsWith("x".repeat(150))).toBe(true);
    const shortest = edgeNotes({ version: "0.13.0", changelog, instructions: "x".repeat(400) });
    expect(edgeNotes({ version: "0.13.0", changelog, instructions: "x".repeat(400), max: 100 })).toBe(
      shortest.replace(/What changed:\n.*\n.*\n/u, "What changed: see the changelog.\n"),
    );
    expect(edgeNotes({ version: "0.1.0" })).toBe(
      "Unfret 0.1.0.\nFull changelog: https://git.kroshtan.com/kroshtan/unfret_extension/src/tag/v0.1.0/CHANGELOG.md",
    );
  });

  it("uploads the Chrome zip, waits for it, submits with the notes and waits for that", async () => {
    const zipPath = file("unfret-chrome-0.13.0.zip", "PK zip");
    const { fetch, calls } = fakeFetch([
      ["POST /submissions/draft/package", accepted("up-1")],
      ["GET /package/operations/up-1", { id: "up-1", status: "InProgress" }],
      [
        "GET /package/operations/up-1",
        { id: "up-1", status: "Succeeded", message: "Successfully updated package" },
      ],
      ["POST /submissions", accepted(`${product}/submissions/operations/pub-1`)],
      ["GET /submissions/operations/pub-1", { status: "InProgress" }],
      [
        "GET /submissions/operations/pub-1",
        { status: "Succeeded", message: "Successfully created submission with ID 7" },
      ],
    ]);
    const http = httpClient({ fetch, log: quiet });
    const result = await publishEdge({
      http,
      credentials,
      zipPath,
      version: "0.13.0",
      notes: "Unfret 0.13.0.",
      wait: noWait,
    });
    expect(result).toMatch(
      /0\.13\.0 uploaded and submitted for certification \(Successfully created submission/u,
    );
    expect(calls.map((c) => `${c.method} ${c.url.replace(product, "")}`)).toEqual([
      "POST /submissions/draft/package",
      "GET /submissions/draft/package/operations/up-1",
      "GET /submissions/draft/package/operations/up-1",
      "POST /submissions",
      "GET /submissions/operations/pub-1",
      "GET /submissions/operations/pub-1",
    ]);
    for (const call of calls) {
      expect(call.headers.Authorization).toBe("ApiKey the-key");
      expect(call.headers["X-ClientID"]).toBe("cid");
    }
    expect(calls[0]?.headers["Content-Type"]).toBe("application/zip");
    expect(Buffer.from(await (calls[0]?.body as Blob).arrayBuffer()).toString()).toBe("PK zip");
    expect(calls[3]?.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(calls[3]?.body))).toEqual({ notes: "Unfret 0.13.0." });
  });

  it("fails with the store's message, and treats nothing new as already there", async () => {
    const zipPath = file("unfret-chrome-0.13.0.zip", "PK");
    const run = (routes: [string, unknown][]): Promise<string> =>
      publishEdge({
        http: httpClient({ fetch: fakeFetch(routes).fetch, log: quiet }),
        credentials,
        zipPath,
        version: "0.13.0",
        notes: "n",
        wait: noWait,
      });

    await expect(
      run([
        ["POST /draft/package", accepted("u")],
        [
          "GET /operations/u",
          {
            status: "Failed",
            errorCode: "InvalidPackage",
            message: "Package isn't valid.",
            errors: ["manifest.json: version must be higher", { message: "second" }],
          },
        ],
      ]),
    ).rejects.toThrow(
      /upload ended as Failed \(InvalidPackage\): Package isn't valid\.\n {2}manifest\.json.*\n {2}second/u,
    );

    await expect(
      run([
        ["POST /draft/package", accepted("u")],
        ["GET /operations/u", { status: "Succeeded" }],
        ["POST /submissions", accepted("p")],
        [
          "GET /operations/p",
          { status: "Failed", errorCode: "InProgressSubmission", message: "in progress" },
        ],
      ]),
    ).rejects.toThrow(
      /submission ended as Failed \(InProgressSubmission\): in progress\n.*wait for it to finish/u,
    );

    expect(
      await run([
        ["POST /draft/package", accepted("u")],
        ["GET /operations/u", { status: "Succeeded" }],
        ["POST /submissions", accepted("p")],
        ["GET /operations/p", { status: "Failed", errorCode: "NoModulesUpdated" }],
      ]),
    ).toMatch(/already has this package \(0\.13\.0\); nothing new/u);

    await expect(run([["POST /draft/package", [401, { message: "Unauthorized" }]]])).rejects.toThrow(
      /the package upload: POST .*HTTP 401.*\n.*EDGE_API_KEY/u,
    );
    await expect(run([["POST /draft/package", [202, null]]])).rejects.toThrow(
      /without an operation in Location/u,
    );

    // An operation that never finishes stops after `tries`.
    const stuck = fakeFetch([
      ["POST /draft/package", accepted("u")],
      ["GET /operations/u", { status: "InProgress" }],
      ["GET /operations/u", { status: "InProgress" }],
    ]);
    await expect(
      publishEdge({
        http: httpClient({ fetch: stuck.fetch, log: quiet }),
        credentials,
        zipPath,
        version: "0.13.0",
        notes: "n",
        wait: noWait,
        tries: 2,
      }),
    ).rejects.toThrow(/still InProgress after 5 seconds/u);
  });

  it("without its secrets, a real run skips Edge with a notice and passes", async () => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: string): void => {
      lines.push(line);
    };
    const { minBackendVersion, version } = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf8"),
    ) as { minBackendVersion: string; version: string };
    const { fetch, calls } = fakeFetch([["GET /v1/health", { version: minBackendVersion }]]);
    const store = mkdtempSync(join(tmpdir(), "unfret-store-"));
    temp.push(store);
    writeFileSync(join(store, `unfret-chrome-${version}.zip`), "zip");
    try {
      expect(await main(["--edge"], { UNFRET_STORE_DIR: store, EDGE_PRODUCT_ID: "p" }, fetch)).toBe(0);
    } finally {
      console.log = log;
    }
    expect(calls).toHaveLength(1);
    expect(lines).toContain(
      "::notice::edge: skipped, the secret(s) EDGE_CLIENT_ID, EDGE_API_KEY are not set (store/EDGE.md)",
    );
    expect(lines).toContain("::notice::edge: skipped (no secrets)");
  });
});

describe("the dry run", () => {
  it("calls only the health endpoint and lists the store requests without secrets", async () => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: string): void => {
      lines.push(line);
    };
    const { fetch, calls } = fakeFetch([["GET /v1/health", { version: "0.10.5" }]]);
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as {
      version: string;
    };
    const store = mkdtempSync(join(tmpdir(), "unfret-store-"));
    temp.push(store);
    for (const kind of ["chrome", "source"])
      writeFileSync(join(store, `unfret-${kind}-${pkg.version}.zip`), "zip");
    firefoxZip(pkg.version, { dir: store });
    let code: number;
    try {
      code = await main(
        ["--dry-run"],
        {
          UNFRET_STORE_DIR: store,
          CWS_CLIENT_ID: "cid",
          AMO_JWT_SECRET: "must-not-appear",
          AMO_APPROVAL_NOTES: "key ufk_must-not-appear",
          EDGE_API_KEY: "must-not-appear",
          EDGE_CERTIFICATION_NOTES: "Test key: ufk_must-not-appear",
        },
        fetch,
      );
    } finally {
      console.log = log;
    }
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    const out = lines.join("\n");
    expect(out).toMatch(/a real run would refuse: production runs backend 0\.10\.5/u);
    expect(out).toContain("[dry run] POST https://oauth2.googleapis.com/token");
    expect(out).toContain(":upload");
    expect(out).toContain(":publish");
    expect(out).toContain("[dry run] POST https://addons.mozilla.org/api/v5/addons/upload/");
    // The release build declares Firefox for Android: only the notes follow the version create.
    expect(out).toContain(
      "[dry run] PATCH https://addons.mozilla.org/api/v5/addons/addon/unfret/versions/%3Cversion%20id%3E/ " +
        '[Authorization: JWT …] {"approval_notes":"<AMO_APPROVAL_NOTES>"}',
    );
    expect(out).not.toContain("compatibility");
    // Edge: the Chrome zip to the draft, then the submission with notes shown only by their length.
    expect(out).toContain(
      "[dry run] POST https://api.addons.microsoftedge.microsoft.com/v1/products/%3CEDGE_PRODUCT_ID%3E/submissions/" +
        `draft/package [Authorization: ApiKey …] (application/zip, 3 bytes) (unfret-chrome-${pkg.version}.zip)`,
    );
    expect(out).toContain("/submissions/draft/package/operations/%3Cupload%20operation%3E");
    expect(out).toMatch(/POST \S+\/submissions \[Authorization: ApiKey …\] \{"notes": <\d+ characters/u);
    expect(out).toContain("/submissions/operations/%3Csubmission%20operation%3E");
    expect(out).toMatch(/edge: EDGE_PRODUCT_ID, EDGE_CLIENT_ID not set: a real run would skip/u);
    // The OAuth refresh token is the primary path; its secrets show as placeholders.
    expect(out).toContain("<CWS_REFRESH_TOKEN>");
    expect(out).not.toContain("must-not-appear");
  });

  it("shows the service account flow when only its key is set", async () => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: string): void => {
      lines.push(line);
    };
    const { minBackendVersion } = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as {
      minBackendVersion: string;
    };
    const { fetch } = fakeFetch([["GET /v1/health", { version: minBackendVersion }]]); // production is new enough
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as {
      version: string;
    };
    const store = mkdtempSync(join(tmpdir(), "unfret-store-"));
    temp.push(store);
    writeFileSync(join(store, `unfret-chrome-${pkg.version}.zip`), "zip");
    try {
      expect(
        await main(
          ["--dry-run", "--chrome"],
          {
            UNFRET_STORE_DIR: store,
            CWS_SERVICE_ACCOUNT_KEY: JSON.stringify({
              client_email: "sa@x.iam.gserviceaccount.com",
              private_key: "k",
            }),
          },
          fetch,
        ),
      ).toBe(0);
    } finally {
      console.log = log;
    }
    const out = lines.join("\n");
    expect(out).toMatch(/meets minBackendVersion/u);
    expect(out).toMatch(/chrome: CWS_PUBLISHER_ID not set: a real run would skip/u);
    expect(out).toContain("grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(out).toContain("iss sa@x.iam.gserviceaccount.com");
    expect(out).not.toContain("addons.mozilla.org");
  });

  it("refuses a real run when production's backend is too old, before any store call", async () => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: string): void => {
      lines.push(line);
    };
    const { fetch, calls } = fakeFetch([["GET /v1/health", { version: "0.10.5" }]]);
    try {
      expect(await main(["--chrome"], { CWS_CLIENT_ID: "x" }, fetch)).toBe(1);
    } finally {
      console.log = log;
    }
    expect(calls).toHaveLength(1);
    expect(lines.join("\n")).toMatch(/::error::refusing the store release/u);
  });
});

describe("the refresh-token helper", () => {
  it("reads the two-line client file, our JSON and Google's downloads, without quoting them in errors", () => {
    expect(readClient("1234-abc.apps.googleusercontent.com\nGOCSPX-secret\n")).toEqual({
      clientId: "1234-abc.apps.googleusercontent.com",
      clientSecret: "GOCSPX-secret",
    });
    expect(() => readClient("GOCSPX-secret-only")).toThrow(/^the client file needs the client ID on line 1/u);
    expect(() => readClient("{GOCSPX-secret")).toThrow(/^the client file is not valid JSON$/u);
    expect(readClient(JSON.stringify({ web: { client_id: "a", client_secret: "b" } }))).toEqual({
      clientId: "a",
      clientSecret: "b",
    });
    expect(readClient(JSON.stringify({ client_id: "a", client_secret: "b" }))).toEqual({
      clientId: "a",
      clientSecret: "b",
    });
    expect(readClient(JSON.stringify({ installed: { client_id: "a", client_secret: "b" } }))).toEqual({
      clientId: "a",
      clientSecret: "b",
    });
    expect(() => readClient("{}")).toThrow(/client_id/u);
  });

  it("asks for offline access to the Chrome Web Store scope with PKCE", () => {
    const { verifier, challenge } = pkce(new Uint8Array(32));
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    const url = new URL(
      consentUrl({ clientId: "a", redirectUri: "http://127.0.0.1:5000/", state: "st", challenge }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "a",
      redirect_uri: "http://127.0.0.1:5000/",
      response_type: "code",
      scope: "https://www.googleapis.com/auth/chromewebstore",
      access_type: "offline",
      prompt: "consent",
      state: "st",
      code_challenge_method: "S256",
    });
    const exchange = codeExchangeRequest({
      clientId: "a",
      clientSecret: "b",
      code: "c",
      redirectUri: "r",
      verifier,
    });
    expect(exchange.url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(exchange.body)).toEqual({
      client_id: "a",
      client_secret: "b",
      code: "c",
      code_verifier: verifier,
      redirect_uri: "r",
      grant_type: "authorization_code",
    });
  });

  it("takes the code from a pasted redirect address and checks its state", () => {
    expect(codeFrom("http://127.0.0.1:5000/?state=st&code=4/abc&scope=x", "st")).toBe("4/abc");
    expect(codeFrom("  4/abc ", "st")).toBe("4/abc");
    expect(() => codeFrom("http://127.0.0.1/?state=other&code=x", "st")).toThrow(/state/u);
    expect(() => codeFrom("http://127.0.0.1/?error=access_denied&state=st", "st")).toThrow(/access_denied/u);
  });
});
