/**
 * Peer-to-peer ads: the same cases as the backend's `tests/unit/test_p2p.py` for the ad text and the dates, and
 * that no seller's (or visitor's) name is ever part of the facts. Field-by-field parity is in `parity.test.ts`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { extractFacts } from "../src/extract/generic.js";
import { adSignals } from "../src/extract/p2p.js";
import { parseSince } from "../src/extract/parse.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const index = JSON.parse(readFileSync(join(FIXTURES, "index.json"), "utf8")) as Record<string, string>;
const ADS = Object.keys(index).filter((name) => name.startsWith("p2p-"));
const NAMES = [
  "Kevin",
  "Marleen",
  "pdx_photo_guy",
  "lisa_closet",
  "Thomas van Dijk",
  "Jane",
  "jane.doe@example.org",
];

function facts(name: string): ReturnType<typeof extractFacts> {
  const html = readFileSync(join(FIXTURES, `${name}.html`), "utf8");
  return extractFacts(new DOMParser().parseFromString(html, "text/html"), html, index[name] ?? "");
}

describe("ad text signals", () => {
  it.each([
    ["Stuur me een appje op 06-12345678", ["whatsapp", "phone"], []],
    ["Mail me: seller@example.com", ["email"], []],
    ["Betaal nooit vooruit. Geen aanbetaling nodig.", [], []],
    ["Payment by Zelle or gift cards only", [], ["gift_card", "payment_app"]],
    ["Aanbetaling van 50% via Tikkie", [], ["payment_link", "deposit"]],
    ["Send BTC or USDT to my wallet", [], ["crypto"]],
    ["IBAN NL91ABNA0417164300 voor de overboeking", [], ["bank_transfer"]],
    ["Gazelle fiets, contant bij ophalen", [], []],
  ])("%s", (text, contacts, payments) => {
    expect(adSignals(text)).toEqual([contacts, payments]);
  });
});

describe("member since", () => {
  it.each([
    ["12 maart 2019", "2019-03-12"],
    ["Mar 2015", "2015-03-01"],
    ["2015", "2015-01-01"],
    ["x", null],
  ])("%s", (text, expected) => {
    expect(parseSince(text)).toBe(expected);
  });
});

describe("private sellers", () => {
  it.each(ADS)("%s keeps no seller or visitor name", (name) => {
    const dumped = JSON.stringify(facts(name));
    for (const needle of NAMES) expect(dumped).not.toContain(needle);
  });

  it("reads the ad's own text, not the platform's safety tips", () => {
    const listing = facts("p2p-marktplaats-iphone").listing;
    expect(listing?.description).toMatch(/^Te koop mijn iPhone 15 Pro/u);
    expect(listing?.description).not.toContain("Betaal nooit vooruit");
    expect(listing?.payment_requests).toEqual(["bank_transfer", "deposit"]);
  });

  it("finds Facebook's areas by their headings", () => {
    const result = facts("p2p-facebook-ps5");
    expect(result.listing?.condition).toBe("Used - like new");
    expect(result.listing?.location).toBe("Utrecht, Netherlands");
    expect(result.seller_profile?.member_since).toBe("2011-01-01");
  });
});
