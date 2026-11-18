/**
 * The brand from a marketplace byline, in every language Amazon uses, and the guard against a sentence or a store
 * link taken as a brand. The same cases as the backend's tests/unit/test_brand_byline.py; all names are made up.
 */

import { describe, expect, it } from "vitest";

import { cleanBrand, plausibleBrand, unwrapByline } from "../src/extract/brand.js";
import { extractFacts } from "../src/extract/generic.js";

describe("cleanBrand", () => {
  it.each([
    ["Visit the Lumora Store", "Lumora"],
    ["Brand: Lumora", "Lumora"],
    ["Merk: Lumora", "Lumora"],
    ["Bezoek de Lumora-winkel", "Lumora"],
    ["Bezoek de Lumora winkel", "Lumora"],
    ["De Air Max Store openen", "Air Max"],
    ["De Lumora-Store openen", "Lumora"],
    ["Besuche den Lumora-Store", "Lumora"],
    ["Besuchen Sie den Lumora-Store", "Lumora"],
    ["Marke: Lumora", "Lumora"],
    ["Visiter la boutique Lumora", "Lumora"],
    ["Visitez la boutique Lumora", "Lumora"],
    ["Marque : Lumora", "Lumora"],
    ["Visita lo Store di Lumora", "Lumora"],
    ["Marca: Lumora", "Lumora"],
    ["Visita la tienda de Lumora", "Lumora"],
    ["Odwiedź sklep Lumora", "Lumora"],
    ["Marka: Lumora", "Lumora"],
    ["Besök Lumora-butiken", "Lumora"],
    ["Märke: Lumora", "Lumora"],
    ["Visite a loja da Lumora", "Lumora"],
    ["Lumora Mağazasını ziyaret edin", "Lumora"],
    ["Pokéball-Store", "Pokéball"],
    ["Lumora-winkel", "Lumora"],
    ["  Visit   the  Air  Max  Store ", "Air Max"],
    ["Lumora", "Lumora"],
  ])("%s is %s", (byline, brand) => {
    expect(cleanBrand(byline)).toBe(brand);
  });

  it.each([
    "Air Max Store openen",
    "Klik hier om de Lumora winkel te bezoeken",
    "Visit Lumora",
    "Tienda oficial Lumora",
    "The best nasal dilator for better sleep",
    "",
  ])("%s is no brand", (name) => {
    expect(plausibleBrand(name)).toBe(false);
    expect(cleanBrand(name)).toBe("");
  });

  it.each(["The Body Shop", "Funky Flair Boutique LLC", "Levi Strauss & Co.", "3M", "Air Max"])(
    "%s stays",
    (name) => {
      expect(cleanBrand(name)).toBe(name);
    },
  );

  it("leaves other names alone", () => {
    expect(unwrapByline("Etta James (Artist)")).toBe("Etta James (Artist)");
  });
});

describe("the Amazon extractor", () => {
  const page = (byline: string, extra = ""): Document =>
    new DOMParser().parseFromString(
      `<html><head><link rel="canonical" href="https://www.amazon.nl/dp/B0FAKE0001"></head><body>
<span id="productTitle">Airmax neusspreider voor beter slapen</span>
<a id="bylineInfo" href="/stores/page/1">${byline}</a>${extra}
<div offer-display-feature-name="desktop-merchant-info" class="offer-display-feature-label">Verkocht door</div>
<div offer-display-feature-name="desktop-merchant-info" class="offer-display-feature-text">
<span class="offer-display-feature-text-message">Airmax nasal dilator</span></div></body></html>`,
      "text/html",
    );
  const url = "https://www.amazon.nl/dp/B0FAKE0001";

  it("reads the brand from the Dutch store byline and the seller from its own field", () => {
    const facts = extractFacts(page("De Air Max Store openen"), "", url);
    expect([facts.brand, facts.seller]).toEqual(["Air Max", "Airmax nasal dilator"]);
  });

  it("prefers the overview table's brand row to the byline", () => {
    const overview = `<div id="productOverview_feature_div"><table>
<tr class="po-brand"><td><span>Merk</span></td><td><span>Airmax</span></td></tr></table></div>`;
    expect(extractFacts(page("De Air Max Store openen", overview), "", url).brand).toBe("Airmax");
  });

  it("leaves the brand empty for a byline that is a sentence", () => {
    expect(extractFacts(page("Klik hier om de Airmax winkel te bezoeken"), "", url).brand).toBe("");
  });
});
