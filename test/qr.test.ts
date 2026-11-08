import jsQR from "jsqr";
import { describe, expect, it } from "vitest";

import { encodeQr, type QrMatrix } from "../src/shared/qr.js";

/** Rasterise like a screen would: 4 px per module, a 4-module white quiet zone. */
function pixels(matrix: QrMatrix, scale = 4): { data: Uint8ClampedArray; width: number } {
  const width = (matrix.length + 8) * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const offset = (((y + 4) * scale + dy) * width + (x + 4) * scale + dx) * 4;
          data[offset] = data[offset + 1] = data[offset + 2] = 0;
        }
      }
    });
  });
  return { data, width };
}

function decode(text: string): string | undefined {
  const { data, width } = pixels(encodeQr(text));
  return jsQR(data, width, width)?.data;
}

describe("QR encoder", () => {
  it.each([
    "a",
    "https://veridex.kroshtan.com/connect?pair=Xg4k2_PqR9vT-LmN0aBcDw",
    "http://localhost:8080/connect?pair=AAAAAAAAAAAAAAAAAAAAAA",
    "Veridex — ünïcödé ✓",
    "x".repeat(150),
    "y".repeat(213),
  ])("round-trips %#", (text) => {
    expect(decode(text)).toBe(text);
  });

  it("picks the smallest version that fits", () => {
    expect(encodeQr("a")).toHaveLength(21); // version 1
    // 64 bytes: more than version 4-M holds (62), so version 5 (37×37).
    expect(encodeQr("https://veridex.kroshtan.com/connect?pair=Xg4k2_PqR9vT-LmN0aBcDw")).toHaveLength(37);
  });

  it("refuses text beyond version 10", () => {
    expect(() => encodeQr("z".repeat(214))).toThrow(/too long/u);
  });
});
