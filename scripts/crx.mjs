// CRX3 packing and verification, with no dependencies (Node's crypto only).
//
// Format (chromium/src components/crx_file/crx3.proto, crx_creator.cc, crx_verifier.cc):
//   "Cr24" | uint32le 3 | uint32le header_size | CrxFileHeader (protobuf) | ZIP archive
//   CrxFileHeader:  2 sha256_with_rsa (repeated AsymmetricKeyProof), 10000 signed_header_data (bytes)
//   AsymmetricKeyProof: 1 public_key (SubjectPublicKeyInfo, DER), 2 signature
//   SignedData (the signed_header_data bytes): 1 crx_id (first 16 bytes of SHA-256 over the public key)
// Each signature is RSASSA-PKCS1-v1_5 / SHA-256 over:
//   "CRX3 SignedData\x00" | uint32le len(signed_header_data) | signed_header_data | ZIP archive
// PKCS#1 v1.5 signatures are deterministic, so the same key and ZIP always give the same CRX bytes.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

const MAGIC = Buffer.from("Cr24");
const SIGNATURE_CONTEXT = Buffer.from("CRX3 SignedData\x00", "latin1");

function varint(value) {
  const bytes = [];
  let v = value;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

/** A length-delimited protobuf field. */
function field(number, payload) {
  return Buffer.concat([varint(number * 8 + 2), varint(payload.length), payload]);
}

function uint32le(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

/** The 16-byte CRX id for a SubjectPublicKeyInfo (DER). */
export function crxIdBytes(spkiDer) {
  return createHash("sha256").update(spkiDer).digest().subarray(0, 16);
}

/** The extension ID Chromium derives from a public key: the CRX id in hex, with 0-9a-f mapped to a-p. */
export function extensionId(spkiDer) {
  return [...crxIdBytes(spkiDer).toString("hex")]
    .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
    .join("");
}

/** The SubjectPublicKeyInfo (DER) of a PEM private key. */
export function publicKeyDer(privateKeyPem) {
  return createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "der" });
}

/** Pack a ZIP archive into a CRX3 signed with an RSA private key (PEM). */
export function packCrx(zip, privateKeyPem) {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "rsa") throw new Error("CRX signing key must be RSA");
  const spki = createPublicKey(key).export({ type: "spki", format: "der" });
  const signedHeaderData = field(1, crxIdBytes(spki));
  const signature = sign(
    "sha256",
    Buffer.concat([SIGNATURE_CONTEXT, uint32le(signedHeaderData.length), signedHeaderData, zip]),
    key,
  );
  const header = Buffer.concat([
    field(2, Buffer.concat([field(1, spki), field(2, signature)])),
    field(10000, signedHeaderData),
  ]);
  return Buffer.concat([MAGIC, uint32le(3), uint32le(header.length), header, zip]);
}

function readVarint(buf, pos) {
  let value = 0;
  let scale = 1;
  for (;;) {
    if (pos >= buf.length) throw new Error("truncated varint");
    const byte = buf[pos++];
    value += (byte & 0x7f) * scale;
    if (byte < 0x80) return [value, pos];
    scale *= 128;
  }
}

/** Parse a protobuf message whose fields are all length-delimited: [[fieldNumber, bytes], …]. */
function parseFields(buf) {
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    let tag;
    let length;
    [tag, pos] = readVarint(buf, pos);
    if ((tag & 7) !== 2) throw new Error(`unexpected wire type ${tag & 7}`);
    [length, pos] = readVarint(buf, pos);
    if (pos + length > buf.length) throw new Error("truncated field");
    fields.push([Math.floor(tag / 8), buf.subarray(pos, pos + length)]);
    pos += length;
  }
  return fields;
}

/**
 * Verify a CRX3 the way Chromium does: magic and version, every RSA proof's signature, and that one proof's key
 * hashes to the declared crx_id (the developer key). Throws on any failure.
 *
 * @returns {{ id: string, zip: Buffer, publicKey: Buffer }}
 */
export function verifyCrx(crx) {
  if (crx.length < 12 || !crx.subarray(0, 4).equals(MAGIC)) throw new Error("not a CRX file");
  if (crx.readUInt32LE(4) !== 3) throw new Error(`unsupported CRX version ${crx.readUInt32LE(4)}`);
  const headerSize = crx.readUInt32LE(8);
  if (12 + headerSize > crx.length) throw new Error("truncated header");
  const header = crx.subarray(12, 12 + headerSize);
  const zip = crx.subarray(12 + headerSize);

  const proofs = [];
  let signedHeaderData = null;
  for (const [number, bytes] of parseFields(header)) {
    if (number === 2) proofs.push(Object.fromEntries(parseFields(bytes)));
    else if (number === 10000) signedHeaderData = bytes;
    else if (number === 3) throw new Error("ECDSA proofs are not used by Unfret builds");
  }
  if (!signedHeaderData) throw new Error("missing signed header data");
  const crxId = Object.fromEntries(parseFields(signedHeaderData))[1];
  if (!crxId || crxId.length !== 16) throw new Error("missing crx_id");
  if (proofs.length === 0) throw new Error("no RSA proofs");

  const signed = Buffer.concat([SIGNATURE_CONTEXT, uint32le(signedHeaderData.length), signedHeaderData, zip]);
  let developerKey = null;
  for (const proof of proofs) {
    const spki = proof[1];
    const signature = proof[2];
    if (!spki || !signature) throw new Error("incomplete proof");
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    if (!verify("sha256", signed, key, signature)) throw new Error("bad signature");
    if (crxIdBytes(spki).equals(crxId)) developerKey = spki;
  }
  if (!developerKey) throw new Error("no proof matches the crx_id");
  return { id: extensionId(developerKey), zip, publicKey: developerKey };
}
