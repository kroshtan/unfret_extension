/**
 * Who ships and who sells, from the buybox labels in Amazon's languages, including the combined label of the
 * current offer box. The same cases as the backend's tests/unit/test_seller_labels.py; all names are made up.
 */

import { describe, expect, it } from "vitest";

import { extractFacts } from "../src/extract/generic.js";

const page = (label: string, value: string): Document =>
  new DOMParser().parseFromString(
    `<html><head><link rel="canonical" href="https://www.amazon.de/dp/B0FAKE0002"></head><body>
<span id="productTitle">Nasenspreizer aus Silikon</span>
<div class="offer-display-feature-label" offer-display-feature-name="desktop-merchant-info"><span>${label}</span></div>
<div class="offer-display-feature-text" offer-display-feature-name="desktop-merchant-info">
<span class="offer-display-feature-text-message">${value}</span></div></body></html>`,
    "text/html",
  );
const url = "https://www.amazon.de/dp/B0FAKE0002";

describe("seller labels", () => {
  it.each([
    ["Verzender / Verkoper", "Slaapwel Handel", true],
    ["Versender / Verkäufer", "Gutschlaf GmbH", true],
    ["Expéditeur / Vendeur", "Nuit Calme SARL", true],
    ["Shipper / Seller", "Restful Goods LLC", true],
    ["Mittente / Venditore", "Notte Calma Srl", true],
    ["Remitente / Vendedor", "Noche Tranquila SL", true],
    ["Nadawca / Sprzedawca", "Spokojny Sen", true],
    ["Avsändare / Säljare", "Sovgott Handel", true],
    ["Gönderici / Satıcı", "Rahat Uyku", true],
    ["Verkocht door", "Slaapwel Handel", false],
    ["Verkauf durch", "Gutschlaf GmbH", false],
    ["Vendu par", "Nuit Calme SARL", false],
    ["Venduto da", "Notte Calma Srl", false],
    ["Vendido por", "Noche Tranquila SL", false],
    ["Sprzedawca", "Spokojny Sen", false],
    ["Säljs av", "Sovgott Handel", false],
    ["Satıcı", "Rahat Uyku", false],
    ["Sold by", "Restful Goods LLC", false],
  ])("%s", (label, value, ships) => {
    const facts = extractFacts(page(label, value), "", url);
    expect(facts.seller).toBe(value);
    expect(facts.ships_from).toBe(ships ? value : "");
  });

  it("leaves the seller out when no label names one", () => {
    const facts = extractFacts(page("Rückgaben", "Rücksendung innerhalb von 30 Tagen"), "", url);
    expect([facts.seller, facts.ships_from]).toEqual(["", ""]);
  });
});
