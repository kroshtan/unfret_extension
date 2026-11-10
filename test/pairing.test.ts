import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError, UnfretApi } from "../src/api/client.js";
import { waitForPairing } from "../src/shared/pairing.js";
import { type MockApi, PAIRED_SESSION, startMockApi } from "./mock-server.js";

let mock: MockApi;

beforeEach(async () => {
  mock = await startMockApi();
});

afterEach(async () => {
  await mock.close();
});

const noSleep = (): Promise<void> => Promise.resolve();
const FAR = "2099-01-01T00:05:00Z";

describe("phone pairing", () => {
  it("starts a pairing on the API's own origin", async () => {
    const pairing = await new UnfretApi(mock.url).startPairing();
    expect(pairing.confirm_code).toBe("K7-4Q");
    expect(pairing.connect_url).toBe(`${mock.url}/connect?pair=pair-ok`);
  });

  it("refuses a connect URL on another origin (it would go into the QR code)", async () => {
    mock.pairing.connectBase = "https://evil.example";
    await expect(new UnfretApi(mock.url).startPairing()).rejects.toMatchObject({ code: "BAD_PAIRING" });
  });

  it("waits while pending, then signs in exactly once", async () => {
    const api = new UnfretApi(mock.url);
    const outcome = await waitForPairing(api, "pair-ok", { expiresAt: FAR, sleep: noSleep });

    expect(outcome).toEqual({
      kind: "signed-in",
      session: {
        token: PAIRED_SESSION.token,
        address: PAIRED_SESSION.address,
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    });
    expect(mock.requests.filter((r) => r.path === "/v1/auth/pair/pair-ok")).toHaveLength(3); // 202, 202, 200
    await expect(api.pollPairing("pair-ok")).rejects.toMatchObject({ status: 404 }); // delivered once
  });

  it("reports expiry from the server (410)", async () => {
    const outcome = await waitForPairing(new UnfretApi(mock.url), "pair-expired", {
      expiresAt: FAR,
      sleep: noSleep,
    });
    expect(outcome).toEqual({ kind: "expired" });
  });

  it("stops at the pairing's own expiry while still pending", async () => {
    mock.pairing.pendingPolls = 1_000;
    let now = Date.parse("2099-01-01T00:00:00Z");
    const outcome = await waitForPairing(new UnfretApi(mock.url), "pair-ok", {
      expiresAt: "2099-01-01T00:00:03Z",
      now: () => now,
      sleep: () => {
        now += 1500;
        return Promise.resolve();
      },
    });
    expect(outcome).toEqual({ kind: "expired" });
  });

  it("fails clearly on an unknown pairing (404)", async () => {
    const outcome = await waitForPairing(new UnfretApi(mock.url), "pair-gone", {
      expiresAt: FAR,
      sleep: noSleep,
    });
    expect(outcome).toEqual({ kind: "failed", message: "This sign-in request is no longer valid." });
  });

  it("retries through server hiccups (5xx)", async () => {
    const outcome = await waitForPairing(new UnfretApi(mock.url), "pair-flaky", {
      expiresAt: FAR,
      sleep: noSleep,
    });
    expect(outcome.kind).toBe("signed-in");
  });

  it("retries through network errors until the pairing expires", async () => {
    let calls = 0;
    const offline = new UnfretApi("http://127.0.0.1:9", undefined, () => {
      calls += 1;
      return Promise.reject(new TypeError("fetch failed"));
    });
    let now = Date.parse("2099-01-01T00:00:00Z");
    const outcome = await waitForPairing(offline, "pair-ok", {
      expiresAt: "2099-01-01T00:00:06Z",
      now: () => now,
      sleep: () => {
        now += 1500;
        return Promise.resolve();
      },
    });
    expect(outcome).toEqual({ kind: "expired" });
    expect(calls).toBeGreaterThan(1);
  });

  it("can be cancelled", async () => {
    mock.pairing.pendingPolls = 1_000;
    const abort = new AbortController();
    const outcome = await waitForPairing(new UnfretApi(mock.url), "pair-ok", {
      expiresAt: FAR,
      signal: abort.signal,
      sleep: () => {
        abort.abort();
        return Promise.resolve();
      },
    });
    expect(outcome).toEqual({ kind: "cancelled" });
  });

  it("rejects a malformed session from the server", async () => {
    const api = new UnfretApi(mock.url, undefined, () =>
      Promise.resolve(
        new Response(JSON.stringify({ token: "x", address: "nope", expires_at: FAR }), { status: 200 }),
      ),
    );
    const outcome = await waitForPairing(api, "pair-ok", { expiresAt: FAR, sleep: noSleep });
    expect(outcome).toEqual({ kind: "failed", message: "The sign-in was not valid." });
  });

  it("surfaces start errors as ApiError", async () => {
    const api = new UnfretApi(mock.url, undefined, () =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "Too many.", error_code: "TOO_MANY_REQUESTS" }), {
          status: 429,
        }),
      ),
    );
    await expect(api.startPairing()).rejects.toBeInstanceOf(ApiError);
  });
});
