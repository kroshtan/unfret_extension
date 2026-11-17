/**
 * The address a check sends (audit L8): without its fragment and without what is about the visitor (tracking and
 * referral parameters, sessions, tokens, e-mail addresses), with what picks the product. The lists are the backend's:
 * `make parity` writes them to test/fixtures/url-params.expected.json, so the server keys an address the same whichever
 * client sent it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkedUrl,
  isDroppedParam,
  PRIVATE_PARAMS,
  TRACKING_PARAMS,
  TRACKING_PREFIXES,
} from "../src/shared/urls.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const backend = JSON.parse(readFileSync(join(FIXTURES, "url-params.expected.json"), "utf8")) as {
  tracking: string[];
  prefixes: string[];
  private: string[];
  dropped: [string, string, boolean][];
};

describe("parity with the backend's dropped parameters", () => {
  it("the same lists", () => {
    expect([...TRACKING_PARAMS].sort()).toEqual(backend.tracking);
    expect([...TRACKING_PREFIXES]).toEqual(backend.prefixes);
    expect([...PRIVATE_PARAMS].sort()).toEqual(backend.private);
  });

  it.each(backend.dropped)("%s=%s: dropped %s", (name, value, dropped) => {
    expect(isDroppedParam(name, value)).toBe(dropped);
  });
});

describe("the address a check sends", () => {
  it.each([
    // the fragment, always
    ["https://shop.example/p/lamp#reviews", "https://shop.example/p/lamp"],
    ["https://shop.example/p/lamp?id=5#access_token=abc", "https://shop.example/p/lamp?id=5"],
    // tracking and referral parameters
    [
      "https://shop.example/products/lamp?variant=4419&utm_source=fb&utm_medium=cpc&fbclid=IwAR0&gclid=x",
      "https://shop.example/products/lamp?variant=4419",
    ],
    [
      "https://www.amazon.com/dp/B0WATCH123/ref=sr_1_1?th=1&psc=1&keywords=watch&qid=17&sr=8-1&tag=aff-20&ref_=x",
      "https://www.amazon.com/dp/B0WATCH123/ref=sr_1_1?th=1",
    ],
    ["https://shop.example/p?mc_eid=1&mc_cid=2&igshid=3&msclkid=4&ref=friend", "https://shop.example/p"],
    // sessions, tokens and e-mail addresses
    [
      "https://shop.example/account/reset?token=s3cr3t&email=me%40mail.example&id=7",
      "https://shop.example/account/reset?id=7",
    ],
    ["https://shop.example/p.php?id=5&PHPSESSID=abc&sid=def", "https://shop.example/p.php?id=5"],
    ["https://shop.example/p;jsessionid=ABC123?id=5", "https://shop.example/p?id=5"],
    ["https://shop.example/p?u=me@mail.example&id=5", "https://shop.example/p?id=5"],
    ["https://shop.example/p?next=ufk_abcdefghij_xyz&id=5", "https://shop.example/p?id=5"],
    // user name and password
    ["https://me:pw@shop.example/p?id=5", "https://shop.example/p?id=5"],
    // what picks the product stays, as it was written
    [
      "https://shop.example/item?id=5&size=M&color=blue%20sky",
      "https://shop.example/item?id=5&size=M&color=blue%20sky",
    ],
    ["https://shop.example/s?q=lamp+shade&page=2", "https://shop.example/s?q=lamp+shade&page=2"],
    ["https://shop.example/p?flag&id=5&utm_x=1", "https://shop.example/p?flag&id=5"],
    [
      "https://shop.example/p?smid=A1B2&tags=x&sidebar=1",
      "https://shop.example/p?smid=A1B2&tags=x&sidebar=1",
    ],
    ["https://shop.example/p?id=%E2%82%AC5", "https://shop.example/p?id=%E2%82%AC5"],
  ])("%s → %s", (url, expected) => {
    expect(checkedUrl(url)).toBe(expected);
  });

  it("leaves what isn't a web address alone, but for its fragment", () => {
    expect(checkedUrl("")).toBe("");
    expect(checkedUrl("not a url#x")).toBe("not a url");
    expect(checkedUrl("file:///tmp/page.html#x")).toBe("file:///tmp/page.html");
  });

  it("gives the same address again (idempotent)", () => {
    const once = checkedUrl("https://shop.example/p?id=5&utm_source=x&email=a%40b.example#top");
    expect(checkedUrl(once)).toBe(once);
  });

  it("is used where the page is read and where the check is sent", () => {
    expect(readFileSync("src/content/extract-entry.ts", "utf8")).toContain(
      "extractPage(document, checkedUrl(location.href), { live: true })",
    );
    const background = readFileSync("src/background/index.ts", "utf8");
    expect(background).toContain("const url = checkedUrl(facts.url);");
    expect(background).toContain("page_facts: { ...facts, url },");
  });
});
