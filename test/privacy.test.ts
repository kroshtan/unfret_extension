/**
 * What leaves the browser: the addresses and contacts a business publishes are kept; anything that could be the
 * visitor's own (forms, account menus, greetings, checkout, billing and delivery areas, an address outside a contact
 * area) is stripped, from the page text and from the facts.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { privateElements, cleanText } from "../src/extract/clean.js";
import { extractPage } from "../src/extract/index.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
// The visitor's details in the fixtures below and in test/fixtures/{logged-in-shop,service-site-*,marktplaats-ad}.
const PERSONAL = /Jane|jane\.doe|Kerkstraat|Elm Street|Springfield|0612345678|98765432|555-0142|3511 AB/u;

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("addresses in the page text", () => {
  it("keeps an address the business publishes in its contact section", () => {
    const doc = parse(`<body>
      <h1>Loodgieter Amsterdam</h1>
      <section class="contact"><p class="address">Damrak 1, 1012 AB Amsterdam</p></section>
      <div id="company-info"><span class="street-address">Hauptstraße 5, Berlin</span></div>
      <div itemscope itemtype="https://schema.org/PostalAddress"><span class="address-line">1 Market St</span></div>
    </body>`);

    const text = cleanText(doc.body);

    expect(text).toContain("Damrak 1, 1012 AB Amsterdam");
    expect(text).toContain("Hauptstraße 5");
    expect(text).toContain("1 Market St");
  });

  it("strips addresses that could be the visitor's", () => {
    const doc = parse(`<body>
      <h1>Glow Lamp</h1>
      <div class="delivery-address">Deliver to Jane Doe, Kerkstraat 5</div>
      <div class="ship-to address-widget">Jane Doe, 12 Elm Street</div>
      <section class="contact"><div class="checkout-step"><p class="address">Jane Doe, 12 Elm Street</p></div></section>
      <section class="contact"><form><input value="Kerkstraat 5"></form></section>
      <div id="shipping-address">Springfield, IL</div>
      <div class="billing">Jane Doe, Kerkstraat 5</div>
      <div class="account-menu">jane.doe@example.org</div>
      <p>Free delivery in 2–3 days.</p>
    </body>`);

    const text = cleanText(doc.body);

    expect(text).toContain("Glow Lamp");
    expect(text).toContain("Free delivery in 2–3 days.");
    expect(text).not.toMatch(PERSONAL);
  });

  it("sends no text at all from an account or checkout page", () => {
    const doc = parse('<body class="woocommerce-account"><h1>My orders</h1><p>Jane Doe</p></body>');

    expect(cleanText(doc.body)).toBe("");
    expect(privateElements(doc.body)).toEqual([doc.body]);
  });
});

describe("contacts and addresses in the facts", () => {
  it.each(["logged-in-shop", "service-site-nl", "service-site-us", "marktplaats-ad"])(
    "%s: nothing about the visitor leaves the browser",
    async (name) => {
      const index = JSON.parse(readFileSync(join(FIXTURES, "index.json"), "utf8")) as Record<string, string>;
      const doc = parse(readFileSync(join(FIXTURES, `${name}.html`), "utf8"));

      const { facts, text } = await extractPage(doc, index[name] ?? "", { live: false });

      expect(JSON.stringify(facts)).not.toMatch(PERSONAL);
      expect(text).not.toMatch(PERSONAL);
    },
  );

  it("keeps what the business publishes", async () => {
    const doc = parse(readFileSync(join(FIXTURES, "logged-in-shop.html"), "utf8"));

    const { facts, text } = await extractPage(doc, "https://lumen.example/products/glow-lamp", {
      live: false,
    });

    expect(facts.addresses).toEqual(["Hauptstraße 5, 10115, Berlin, DE"]);
    expect(facts.emails).toEqual([{ address: "hello@lumen.example", kind: "own_domain" }]);
    expect(facts.phones).toEqual([{ number: "+49301234567", kind: "unknown", country: "DE" }]);
    expect(text).toContain("Lumen Store GmbH, Hauptstraße 5, 10115 Berlin");
  });

  it("never keeps a private seller's name", async () => {
    const doc = parse(readFileSync(join(FIXTURES, "marktplaats-ad.html"), "utf8"));

    const { facts } = await extractPage(doc, "https://www.marktplaats.nl/v/fietsen/m2187654321-gazelle", {
      live: false,
    });

    expect(facts.platform).toBe("marktplaats");
    expect(facts.seller).toBe("");
    expect(JSON.stringify(facts)).not.toContain("Jan de Vries");
    expect(facts.internal_links).toEqual([]); // a profile link would name the seller
  });
});
