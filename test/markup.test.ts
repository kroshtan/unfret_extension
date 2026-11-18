/**
 * The markup names and references to other sites (`src/extract/markup.ts`): the app traces the backend's source
 * checks read from raw HTML, which the extension never sends. The parity tests pin them against the backend for
 * every fixture; these pin what they are for and what they never carry.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { extractPage } from "../src/extract/index.js";
import { hostAndPath } from "../src/extract/markup.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("markup names and references to other sites", () => {
  it("carry the test shop's app traces, which its text doesn't", async () => {
    const doc = parse(readFileSync(join(FIXTURES, "test-shop.html"), "utf8"));

    const { facts, text } = await extractPage(doc, "https://unfret.net/test-shop", {
      live: true,
      timerWaitMs: 0,
    });

    // The dropshipping app's attribute (on the add-to-cart form), the review importer's widget, the pop-up.
    expect(facts.markup_names).toEqual(
      expect.arrayContaining(["data-dsers-variant-sync", "looxReviews", "loox-reviews-widget", "sales-pop"]),
    );
    expect(facts.external_refs).toContain("ae01.alicdn.com"); // a product photo on the supplier's CDN
    expect(text).not.toMatch(/dsers|loox|alicdn/iu);
  });

  it("are names only, never values, and nothing inside a private area", async () => {
    const doc = parse(`<body>
      <div class="review-widget" data-customer="jane.doe@example.com" id="order-123456">Jane</div>
      <form class="buy" data-dsers-variant-sync="on"><input class="jane-field" value="Jane Doe"></form>
      <div class="account-menu"><a class="hi-jane" href="https://social.example/jane.doe">Hi Jane</a>
        <img src="https://avatars.example/u/jane.png"></div>
      <img src="https://cdn.example/photos/jane-doe-face.jpg?u=jane">
      <a href="https://supplier.example/item/1.html?ref=jane#top">Supplier</a>
    </body>`);

    const { facts } = await extractPage(doc, "https://shop.example/p", { live: false });

    expect(facts.markup_names).toEqual([
      "data-customer",
      "data-dsers-variant-sync",
      "review-widget",
      "buy",
      "account-menu",
    ]);
    // An image's site alone, a link's path without its query or fragment; nothing from the account menu.
    expect(facts.external_refs).toEqual(["cdn.example", "supplier.example/item/1.html"]);
    expect(JSON.stringify([facts.markup_names, facts.external_refs])).not.toMatch(/jane/iu);
  });

  it("read an address's host and path as the backend does, without a URL parser", () => {
    expect(hostAndPath("https://User@AE01.alicdn.com:443/kf/a.jpg?x=1#y")).toEqual([
      "ae01.alicdn.com",
      "/kf/a.jpg",
    ]);
    expect(hostAndPath("  //img.kwcdn.com/a.jpg 2x")).toEqual(["img.kwcdn.com", "/a.jpg"]);
    expect(hostAndPath("/relative/path.jpg")).toBeNull();
    expect(hostAndPath("mailto:hello@shop.example")).toBeNull();
  });
});
