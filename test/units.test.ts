import { describe, expect, it } from "vitest";

import { SseParser } from "../src/api/sse.js";
import { badgeFor, light } from "../src/background/badge.js";
import { acceptSessionMessage } from "../src/content/relay.js";
import { parseCount, parseDate, parseNumber, parsePrice, parseRating } from "../src/extract/parse.js";
import { pyJsonLength } from "../src/extract/pyjson.js";
import { checksText, flagName, scoreLabel } from "../src/popup/view.js";
import { DEFAULT_API_BASE, isDevBase, normaliseApiBase, parseSession } from "../src/shared/settings.js";
import { isAnalysable, isMarketplaceProduct } from "../src/shared/sites.js";

describe("parsing (the backend's test cases)", () => {
  it.each([
    ["Date First Available: August 14, 2026", "2026-08-14"],
    ["Im Angebot von Amazon.de seit: 3. März 2025", "2025-03-03"],
    ["Disponible depuis le : 14 août 2024", "2024-08-14"],
    ["Reviewed in the United Kingdom on 2 Jan. 2026", "2026-01-02"],
    ["published 2023-07-01T10:00:00Z", "2023-07-01"],
    ["no date here", null],
    ["February 30, 2024", null],
  ])("parseDate(%j)", (text, expected) => {
    expect(parseDate(text)).toBe(expected);
  });

  it.each([
    ["9.99", 9.99],
    ["1.299,00", 1299],
    ["4,5", 4.5],
    ["2,285", 2285],
    ["2.285", 2285],
    ["1 299,50", 1299.5],
    ["1 299,50", 1299.5],
  ])("parseNumber(%j)", (text, expected) => {
    expect(parseNumber(text)).toBe(expected);
  });

  it("parses prices, ratings and counts", () => {
    expect(parsePrice("$9.99")).toEqual([9.99, "USD"]);
    expect(parsePrice("12,99 €")).toEqual([12.99, "EUR"]);
    expect(parsePrice("EUR 1.299,00")).toEqual([1299, "EUR"]);
    expect(parseRating("4,5 von 5 Sternen")).toBe(4.5);
    expect(parseRating("12 out of 5")).toBeNull();
    expect(parseCount("1.204 Sternebewertungen")).toBe(1204);
    expect(parseCount("no ratings")).toBeNull();
  });

  it("measures JSON like Python's json.dumps", () => {
    // json.dumps({"a": [1, "é"], "b": None}) == '{"a": [1, "\\u00e9"], "b": null}' (31 chars)
    expect(pyJsonLength({ a: [1, "é"], b: null })).toBe(31);
  });
});

describe("server-sent events", () => {
  it("handles split chunks, CRLF, comments and multi-line data", () => {
    const parser = new SseParser();
    expect(parser.feed("event: step\r")).toEqual([]);
    expect(parser.feed("\ndata: one\r\ndata: two\r\n")).toEqual([]);
    expect(parser.feed("\r\n: ping\n\ndata: plain\n\n")).toEqual([
      { event: "step", data: "one\ntwo" },
      { event: "message", data: "plain" },
    ]);
    expect(parser.feed("event: result\ndata: {}")).toEqual([]);
    expect(parser.end()).toEqual([{ event: "result", data: "{}" }]);
  });
});

describe("session relay origin check", () => {
  const page = {};
  const session = {
    type: "veridex-session",
    token: "t".repeat(40),
    address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    expires_at: "2999-01-01T00:00:00Z",
  };
  const origin = "https://veridex.kroshtan.com";

  it("accepts the page's own message on the configured origin", () => {
    expect(
      acceptSessionMessage({ origin, source: page, data: session }, page, origin, DEFAULT_API_BASE),
    ).toEqual({
      token: session.token,
      address: session.address,
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
  });

  it.each([
    ["another window", { origin, source: {}, data: session }, origin, DEFAULT_API_BASE],
    [
      "another origin",
      { origin: "https://evil.example", source: page, data: session },
      origin,
      DEFAULT_API_BASE,
    ],
    [
      "a page that isn't the API site",
      { origin: "https://evil.example", source: page, data: session },
      "https://evil.example",
      DEFAULT_API_BASE,
    ],
    [
      "a different message type",
      { origin, source: page, data: { ...session, type: "other" } },
      origin,
      DEFAULT_API_BASE,
    ],
    [
      "an expired session",
      { origin, source: page, data: { ...session, expires_at: "2000-01-01T00:00:00Z" } },
      origin,
      DEFAULT_API_BASE,
    ],
    [
      "a malformed address",
      { origin, source: page, data: { ...session, address: "not-base58!" } },
      origin,
      DEFAULT_API_BASE,
    ],
    [
      "a dev page while production is configured",
      { origin: "http://localhost:8080", source: page, data: session },
      "http://localhost:8080",
      DEFAULT_API_BASE,
    ],
  ])("rejects %s", (_, event, pageOrigin, apiBase) => {
    expect(acceptSessionMessage(event, page, pageOrigin, apiBase)).toBeNull();
  });

  it("accepts the dev origin when it is the configured API", () => {
    const dev = "http://localhost:8080";
    expect(acceptSessionMessage({ origin: dev, source: page, data: session }, page, dev, dev)).not.toBeNull();
  });
});

describe("settings", () => {
  it("only allows https or a local dev origin", () => {
    expect(normaliseApiBase("https://veridex.kroshtan.com/v1/")).toBe(DEFAULT_API_BASE);
    expect(normaliseApiBase("http://localhost:8080/")).toBe("http://localhost:8080");
    expect(normaliseApiBase("http://evil.example")).toBe(DEFAULT_API_BASE);
    expect(normaliseApiBase("not a url")).toBe(DEFAULT_API_BASE);
    expect(isDevBase("http://127.0.0.1:9000")).toBe(true);
  });

  it("validates sessions", () => {
    const now = new Date("2026-11-08T12:00:00Z");
    const ok = {
      token: "x".repeat(20),
      address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
      expires_at: "2026-12-08T12:00:00Z",
    };
    expect(parseSession(ok, now)).not.toBeNull();
    expect(parseSession({ ...ok, token: "short" }, now)).toBeNull();
    expect(parseSession({ ...ok, expires_at: "garbage" }, now)).toBeNull();
    expect(parseSession(null, now)).toBeNull();
  });
});

describe("sites", () => {
  it("recognises marketplace product pages", () => {
    expect(isMarketplaceProduct("https://www.amazon.de/dp/B0TEST1234")).toBe(true);
    expect(isMarketplaceProduct("https://www.amazon.co.uk/Some-Title/dp/B0TEST1234/ref=x")).toBe(true);
    expect(isMarketplaceProduct("https://www.amazon.com/s?k=earbuds")).toBe(false);
    expect(isMarketplaceProduct("https://www.bol.com/nl/nl/p/koffiezetapparaat/9300000/")).toBe(true);
    expect(isMarketplaceProduct("https://notamazon.com/dp/B0TEST1234")).toBe(false);
  });

  it("knows which pages can be analysed", () => {
    expect(isAnalysable("https://shop.example/p/1", DEFAULT_API_BASE)).toBe(true);
    expect(isAnalysable("chrome://extensions", DEFAULT_API_BASE)).toBe(false);
    expect(isAnalysable("https://chromewebstore.google.com/detail/x", DEFAULT_API_BASE)).toBe(false);
    expect(isAnalysable("https://veridex.kroshtan.com/checkout", DEFAULT_API_BASE)).toBe(false);
    expect(isAnalysable(undefined, DEFAULT_API_BASE)).toBe(false);
  });
});

describe("presentation", () => {
  it("names flags and scores", () => {
    expect(flagName("listing.discount_pct")).toBe("Discount");
    expect(flagName("reviews.some_new_signal")).toBe("Some new signal");
    expect(scoreLabel(-1)).toBe("Not assessed");
    expect(scoreLabel(82)).toBe("Score 82 out of 100: few risk signals");
    expect(checksText(1)).toBe("1 check left");
  });

  it("colours the badge like a traffic light", () => {
    expect([light(85), light(55), light(10), light(-1)]).toEqual(["green", "amber", "red", "none"]);
    expect(badgeFor({ status: "done", findings: [], result: { score: 18, explanation: "" } })).toEqual({
      text: "18",
      color: "#c62828",
    });
    expect(badgeFor({ status: "idle" })).toBeNull();
  });
});
