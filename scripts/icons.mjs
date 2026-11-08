// Generate placeholder toolbar icons (icons/icon-{16,32,48,128}.png): a white check mark on a blue rounded
// square. Real branding is still to come; this keeps the build self-contained (no image tooling needed).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BLUE = [11, 87, 208];
const WHITE = [255, 255, 255];

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), y * (size * 4 + 1) + 1 + x * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function sample(u, v) {
  // Unit square coordinates; returns [inside background, on check mark].
  const r = 0.2;
  const qx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
  const qy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
  const inside = Math.hypot(qx, qy) <= r;
  const check =
    Math.min(segmentDistance(u, v, 0.27, 0.52, 0.43, 0.68), segmentDistance(u, v, 0.43, 0.68, 0.75, 0.33)) <=
    0.075;
  return [inside, inside && check];
}

function icon(size) {
  const ss = 4;
  return png(size, (x, y) => {
    let bg = 0;
    let fg = 0;
    for (let i = 0; i < ss; i++) {
      for (let j = 0; j < ss; j++) {
        const [inside, check] = sample((x + (i + 0.5) / ss) / size, (y + (j + 0.5) / ss) / size);
        if (inside) bg++;
        if (check) fg++;
      }
    }
    const n = ss * ss;
    const alpha = bg / n;
    const mix = bg ? fg / bg : 0;
    const rgb = BLUE.map((c, k) => Math.round(c + (WHITE[k] - c) * mix));
    return [...rgb, Math.round(alpha * 255)];
  });
}

mkdirSync(join(root, "icons"), { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(join(root, `icons/icon-${size}.png`), icon(size));
console.log("icons written");
