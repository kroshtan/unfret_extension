/**
 * The free pass (0.12.0): made on install with a proof of work, with free checks only once per browser profile (a
 * flag in storage.sync), its backup code kept for the options page.
 */

import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UnfretApi } from "../src/api/client.js";
import { FREE_FLAG, isOwnPass, makeFreePass, ownPass, solve } from "../src/shared/new-pass.js";

const KEY = `ufk_abcdefghij_${"a".repeat(52)}`;
const RECOVERY = `ufr_abcdefghij_${"r".repeat(52)}`;

function area(data: Record<string, unknown>): Record<string, unknown> {
  return {
    get: (keys: string | string[]) =>
      Promise.resolve(
        Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys]).filter((k) => k in data).map((k) => [k, data[k]]),
        ),
      ),
    set: (items: Record<string, unknown>) => {
      Object.assign(data, items);
      return Promise.resolve();
    },
    remove: (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) Reflect.deleteProperty(data, k);
      return Promise.resolve();
    },
  };
}

function leadingZeroBits(text: string): number {
  let bits = 0;
  for (const byte of createHash("sha256").update(text).digest()) {
    if (byte) return bits + Math.clz32(byte) - 24;
    bits += 8;
  }
  return bits;
}

describe("the free pass", () => {
  let local: Record<string, unknown>;
  let sync: Record<string, unknown>;
  let requests: { path: string; body: unknown }[];
  let freeChecks: number;

  const api = (): UnfretApi =>
    new UnfretApi("https://unfret.net", undefined, (input, init) => {
      const path = new URL(input).pathname;
      requests.push({ path, body: init?.body ? JSON.parse(init.body as string) : null });
      const json =
        path === "/v1/keys/challenge"
          ? { challenge: "c.1.abc.8.mac", bits: 8, expires_at: 9e9 }
          : {
              key_id: "abcdefghij",
              key: KEY,
              recovery_code: RECOVERY,
              account: "key:abcdefghij",
              balance_usd_micros: 0,
              free_checks: freeChecks,
            };
      return Promise.resolve(new Response(JSON.stringify(json), { status: path === "/v1/keys" ? 201 : 200 }));
    });

  beforeEach(() => {
    local = {};
    sync = {};
    requests = [];
    freeChecks = 5;
    vi.stubGlobal("chrome", { storage: { local: area(local), sync: area(sync) } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("solves the proof of work the server asks for", async () => {
    const solution = await solve("challenge", 10);
    expect(leadingZeroBits(`challenge:${solution}`)).toBeGreaterThanOrEqual(10);
  });

  it("on a first install: asks for free checks, signs in, keeps the backup code, remembers it in sync", async () => {
    const made = await makeFreePass("https://unfret.net", api());

    expect(made).toMatchObject({ ok: true, freeChecks: 5 });
    const created = requests.find((r) => r.path === "/v1/keys")?.body as Record<string, unknown>;
    expect(created.free).toBe(true);
    expect(leadingZeroBits(`c.1.abc.8.mac:${String(created.solution)}`)).toBeGreaterThanOrEqual(8);
    expect(local.session).toMatchObject({ token: KEY, address: "key:abcdefghij", kind: "key" });
    expect(await ownPass()).toEqual({ keyId: "abcdefghij", recoveryCode: RECOVERY });
    expect(await isOwnPass(local.session as never)).toBe(true);
    expect(sync[FREE_FLAG]).toBe(true);
  });

  it("after a reinstall in the same profile: a pass without free checks", async () => {
    sync[FREE_FLAG] = true;
    freeChecks = 0;
    const made = await makeFreePass("https://unfret.net", api());

    expect(made).toMatchObject({ ok: true, freeChecks: 0 });
    const created = requests.find((r) => r.path === "/v1/keys")?.body as Record<string, unknown>;
    expect(created).not.toHaveProperty("free");
  });

  it("when the network had its share today: an empty pass, and the profile may ask again later", async () => {
    freeChecks = 0;
    await makeFreePass("https://unfret.net", api());
    expect(sync).not.toHaveProperty(FREE_FLAG);
  });

  it("offline: nothing kept", async () => {
    const offline = new UnfretApi("https://unfret.net", undefined, () =>
      Promise.reject(new TypeError("offline")),
    );
    expect(await makeFreePass("https://unfret.net", offline)).toEqual({ ok: false, reason: "offline" });
    expect(local).toEqual({});
  });
});
