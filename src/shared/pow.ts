/**
 * The proof of work a free deep check needs (contract: "Free checks for shoppers"): the first counter `n` (in
 * decimal) with SHA-256(challenge + ":" + n) starting with `bits` zero bits. The same puzzle and the same answer as the
 * website's solver (the backend's `static/new-pass.js`) and the server's check.
 *
 * SHA-256 in plain TypeScript: Web Crypto's digest is asynchronous, and one await per hash makes a million hashes take
 * far too long. The challenge's whole 64-byte blocks are hashed once; each counter then costs one or two blocks, with
 * nothing allocated. It runs in the background (the service worker, or Firefox's event page), never in the popup, and
 * gives the event loop a turn every few thousand tries so the background keeps answering the popup.
 */

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);
const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const W = new Int32Array(64);

const k = (i: number): number => K[i] ?? 0;
const w = (i: number): number => W[i] ?? 0;

/** One 64-byte block of `bytes` at `off` into the state `h` (8 words), in place. */
function block(h: Int32Array, bytes: Uint8Array, off: number): void {
  for (let i = 0; i < 16; i++) {
    const j = off + 4 * i;
    W[i] =
      ((bytes[j] ?? 0) << 24) |
      ((bytes[j + 1] ?? 0) << 16) |
      ((bytes[j + 2] ?? 0) << 8) |
      (bytes[j + 3] ?? 0);
  }
  for (let i = 16; i < 64; i++) {
    const x = w(i - 15);
    const y = w(i - 2);
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    W[i] = (w(i - 16) + s0 + w(i - 7) + s1) | 0;
  }
  let a = h[0] ?? 0;
  let b = h[1] ?? 0;
  let c = h[2] ?? 0;
  let d = h[3] ?? 0;
  let e = h[4] ?? 0;
  let f = h[5] ?? 0;
  let g = h[6] ?? 0;
  let hh = h[7] ?? 0;
  for (let i = 0; i < 64; i++) {
    const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (hh + s1 + ((e & f) ^ (~e & g)) + k(i) + w(i)) | 0;
    const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    hh = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  h[0] = ((h[0] ?? 0) + a) | 0;
  h[1] = ((h[1] ?? 0) + b) | 0;
  h[2] = ((h[2] ?? 0) + c) | 0;
  h[3] = ((h[3] ?? 0) + d) | 0;
  h[4] = ((h[4] ?? 0) + e) | 0;
  h[5] = ((h[5] ?? 0) + f) | 0;
  h[6] = ((h[6] ?? 0) + g) | 0;
  h[7] = ((h[7] ?? 0) + hh) | 0;
}

/** Tries between turns for the event loop (a few milliseconds each). */
const SLICE = 20_000;

export class PowAborted extends Error {
  constructor() {
    super("The proof of work was stopped.");
    this.name = "PowAborted";
  }
}

/**
 * Solve a challenge.
 *
 * @param challenge - The server's challenge string.
 * @param bits - Leading zero bits wanted (the server's `bits`; at most 64).
 * @param options.signal - Stops the work (rejects with {@link PowAborted}).
 * @param options.onSlice - Called between slices (the background uses it to stay awake in Chrome).
 * @returns The solution: the counter in decimal (well under 32 characters).
 */
export async function solve(
  challenge: string,
  bits: number,
  options: { signal?: AbortSignal; onSlice?: () => void } = {},
): Promise<string> {
  const prefix = new TextEncoder().encode(`${challenge}:`);
  const full = prefix.length - (prefix.length % 64);
  const mid = new Int32Array(IV);
  for (let off = 0; off < full; off += 64) block(mid, prefix, off);
  const rest = prefix.length - full;
  const tail = new Uint8Array(128);
  tail.set(prefix.subarray(full));
  const h = new Int32Array(8);
  for (let n = 0; ; n++) {
    if (n && n % SLICE === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (options.signal?.aborted) throw new PowAborted();
      options.onSlice?.();
    }
    const digits = String(n);
    let len = rest;
    for (let i = 0; i < digits.length; i++) tail[len++] = digits.charCodeAt(i);
    const end = len + 9 > 64 ? 128 : 64;
    tail.fill(0, len, end);
    tail[len] = 0x80;
    const bitLen = (prefix.length + digits.length) * 8;
    tail[end - 4] = bitLen >>> 24;
    tail[end - 3] = bitLen >>> 16;
    tail[end - 2] = bitLen >>> 8;
    tail[end - 1] = bitLen;
    h.set(mid);
    block(h, tail, 0);
    if (end === 128) block(h, tail, 64);
    const h0 = h[0] ?? 0;
    const zeros = h0 === 0 ? 32 + Math.clz32(h[1] ?? 0) : Math.clz32(h0);
    if (zeros >= bits) return digits;
  }
}
