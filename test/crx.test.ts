// @vitest-environment node
// CRX3 packing and verification (scripts/crx.mjs). Cross-checked once against Chromium's own --pack-extension:
// with the same key and ZIP, packCrx reproduces Chromium's CRX byte for byte.
import { createHash, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { extensionId, packCrx, publicKeyDer, verifyCrx } from "../scripts/crx.mjs";

function rsaPem(bits = 2048): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: bits });
  return privateKey.export({ type: "pkcs8", format: "pem" });
}

const zip = Buffer.from("PK\x05\x06" + "\x00".repeat(18), "latin1"); // an empty ZIP archive
const pem = rsaPem();

describe("CRX3", () => {
  it("packs a CRX that verifies, with the ID derived from the key", () => {
    const crx = packCrx(zip, pem);
    expect(crx.subarray(0, 4).toString()).toBe("Cr24");
    expect(crx.readUInt32LE(4)).toBe(3);
    const { id, zip: inner, publicKey } = verifyCrx(crx);
    expect(id).toBe(extensionId(publicKeyDer(pem)));
    expect(id).toMatch(/^[a-p]{32}$/);
    expect(inner.equals(zip)).toBe(true);
    expect(publicKey.equals(publicKeyDer(pem))).toBe(true);
  });

  it("is deterministic for the same key and ZIP", () => {
    expect(packCrx(zip, pem).equals(packCrx(zip, pem))).toBe(true);
  });

  it("derives IDs the way Chromium does (SHA-256 of the key, first 16 bytes, hex mapped to a-p)", () => {
    const der = publicKeyDer(pem);
    const hex = createHash("sha256").update(der).digest("hex").slice(0, 32);
    expect(extensionId(der)).toBe(hex.replace(/./g, (c) => "abcdefghijklmnop".charAt(parseInt(c, 16))));
  });

  it("rejects tampered contents, headers and foreign keys", () => {
    const crx = packCrx(Buffer.concat([zip, Buffer.from("payload")]), pem);
    const tamperedZip = Buffer.from(crx);
    tamperedZip.writeUInt8((tamperedZip.at(-1) ?? 0) ^ 1, tamperedZip.length - 1);
    expect(() => verifyCrx(tamperedZip)).toThrow("bad signature");

    const badMagic = Buffer.from(crx);
    badMagic.write("Cr23", 0);
    expect(() => verifyCrx(badMagic)).toThrow("not a CRX file");

    const v2 = Buffer.from(crx);
    v2.writeUInt32LE(2, 4);
    expect(() => verifyCrx(v2)).toThrow("unsupported CRX version");

    // Another key's valid header in front of a different ZIP: the signature no longer covers the contents.
    const other = packCrx(zip, rsaPem());
    expect(() =>
      verifyCrx(Buffer.concat([other.subarray(0, other.length - zip.length), Buffer.from("x")])),
    ).toThrow("bad signature");
  });

  it("refuses non-RSA keys", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    expect(() => packCrx(zip, privateKey.export({ type: "pkcs8", format: "pem" }))).toThrow("RSA");
  });
});
