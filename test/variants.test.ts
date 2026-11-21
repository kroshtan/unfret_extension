/**
 * Variant pickers on any platform (`src/extract/variants.ts`): the options, their prices and whose price is shown.
 * The parity tests hold every fixture to the backend's facts; these name what each one is about.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { extractFacts } from "../src/extract/generic.js";
import { kindOf } from "../src/extract/variants.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const index = JSON.parse(readFileSync(join(FIXTURES, "index.json"), "utf8")) as Record<string, string>;

function variantsOf(name: string) {
  const html = readFileSync(join(FIXTURES, `${name}.html`), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  return extractFacts(doc, html, index[name] ?? "").variants;
}

describe("variant options", () => {
  it("names a dimension's kind in any language", () => {
    expect(kindOf("size_name", "Größe")).toBe("size");
    expect(kindOf("", "Kleur")).toBe("colour");
    expect(kindOf("item_package_quantity", "Packungsgröße")).toBe("count");
    expect(kindOf("style_name", "Stijlnaam")).toBe("style");
    expect(kindOf("", "")).toBe("other");
  });

  it("reads Amazon's twister and the from price's option (a cable under a phone case's title)", () => {
    const v = variantsOf("amazon-de-variants-bait");
    expect(v?.source).toBe("amazon");
    expect(v?.options.map((o) => [o.label, o.price])).toEqual([
      ["Hülle", 19.99],
      ["Panzerglas 2 Stück", 8.99],
      ["Ladekabel USB-C 1 m", 6.99],
      ["Hülle + Panzerglas", 24.99],
    ]);
    expect([v?.from_price, v?.headline_basis, v?.headline]).toEqual([true, "from", 2]);
  });

  it("reads Shopify's product JSON, the option on show being the first available one", () => {
    const v = variantsOf("shopify-variants-refill");
    expect(v?.dimensions[0]).toEqual({
      name: "Style",
      kind: "style",
      values: ["Brush head refill (4 pack)", "Toothbrush", "Toothbrush + travel case"],
    });
    expect([v?.headline_basis, v?.headline, v?.options[0]?.price]).toEqual(["selected", 0, 4.99]);
  });

  it("reads WooCommerce, Walmart and schema.org variants", () => {
    expect(variantsOf("woocommerce-variants-sizes")?.options.map((o) => o.label)).toEqual([
      "S",
      "M",
      "L",
      "XL",
    ]);
    expect(variantsOf("walmart-variants-grouped")?.options.map((o) => o.price)).toEqual([329, 69, 19]);
    expect(variantsOf("generic-productgroup-colours")?.dimensions[0]?.kind).toBe("colour");
  });

  it("takes a picker label's price from its end only, never a size's number", () => {
    const v = variantsOf("generic-select-picker");
    expect(v?.options.map((o) => [o.label, o.price])).toEqual([
      ["Single 140 x 200 cm", 89],
      ["Double 200 x 200 cm", 119],
      ["King 240 x 220 cm", 139],
    ]);
  });
});
