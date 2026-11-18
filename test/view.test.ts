import { describe, expect, it } from "vitest";

import { existsSync, readFileSync } from "node:fs";

import type { AnalysisResult, DeepCheck } from "../src/api/client.js";
import { manifest } from "../scripts/manifest.mjs";
import { bandOf } from "../src/shared/bands.js";
import {
  buildChecklist,
  CHECKLIST,
  checklistDone,
  deepHintOf,
  renderResult,
  renderSharePreview,
  shownThumbnails,
  updateChecklist,
} from "../src/popup/view.js";
import { SHARE_PREVIEW } from "./mock-server.js";

const JUNK: AnalysisResult = {
  score: 12,
  explanation: "Waarschijnlijk generieke fabrieksspullen.",
  charged: true,
  verdict: {
    band: "junk_or_scam",
    label: "Veel waarschuwingssignalen",
    headline: "Duizenden reviews voor een product van zes weken oud en een titel vol zoekwoorden.",
    reasons: [
      {
        type: "review_velocity",
        title: "Verdacht veel reviews",
        detail: "4.800 beoordelingen voor een product dat pas 6 weken te koop staat.",
        severity: "high",
      },
      {
        type: "word_soup",
        title: "Titel vol zoekwoorden",
        detail: "De titel is een opsomming van zoekwoorden.",
        severity: "medium",
      },
    ],
    positives: [
      {
        type: "sold_by_brand",
        title: "Verkocht door het merk",
        detail: "Wordt verkocht door het merk zelf.",
      },
    ],
    language: "nl",
  },
  assessment: {
    risk_score: 0.88,
    confidence: 0.79,
    model_version: "v1-20261108-C",
    flags: [
      {
        type: "content.title_word_soup",
        evidence: "",
        weight: 1.4,
        label: "Titel vol zoekwoorden",
        kind: "signal",
        severity: "high",
      },
      {
        type: "listing.is_marketplace",
        evidence: "",
        weight: 0.6,
        label: "Aanbod op een marktplaats",
        kind: "context",
        severity: "low",
      },
    ],
  },
};

const RELIABLE: AnalysisResult = {
  score: 95,
  explanation: "Nothing worrying stood out on this page.",
  charged: false,
  verdict: {
    band: "reliable",
    label: "Looks fine",
    headline: "A known brand sold by the brand itself; nothing worrying stood out.",
    reasons: [
      {
        type: "implausible_claims",
        title: "Hard-to-believe claims",
        detail: "“99% fewer bacteria”.",
        severity: "medium",
      },
    ],
    positives: [{ type: "known_brand", title: "Known brand", detail: "“Philips” is an established brand." }],
    language: "en",
  },
};

function rendered(result: AnalysisResult): HTMLElement {
  const root = document.createElement("div");
  renderResult(root, result);
  return root;
}

describe("result view", () => {
  it("shows the server's verdict as it comes (here Dutch), a symbol, and the reasons strongest first", () => {
    const root = rendered(JUNK);
    const verdict = root.querySelector(".verdict");
    expect(verdict?.className).toBe("verdict junk_or_scam");
    expect(root.querySelector(".verdict .label")?.textContent).toBe("Veel waarschuwingssignalen");
    expect(root.querySelector(".verdict .symbol")?.textContent).toBe("✕"); // not colour alone
    expect(root.querySelector(".headline")?.textContent).toContain("Duizenden reviews");
    const headings = [...root.querySelectorAll("h2")].map((h) => h.textContent);
    // The extension's own words are English; the verdict's text isn't translated.
    expect(headings).toEqual(["What we noticed", "What looks good"]); // concerns before positives
    expect([...root.querySelectorAll(".reasons li strong")].map((s) => s.textContent)).toEqual([
      "Verdacht veel reviews",
      "Titel vol zoekwoorden",
    ]);
  });

  it("puts what looks good first for a reliable result, and says when no check was used", () => {
    const root = rendered(RELIABLE);
    expect([...root.querySelectorAll("h2")].map((h) => h.textContent)).toEqual([
      "What looks good",
      "What we noticed",
    ]);
    expect(root.textContent).toContain("Checked recently: no check was used.");
  });

  it("keeps details behind a disclosure, with server labels and neutral context", () => {
    const root = rendered(JUNK);
    const details = root.querySelector("details");
    expect(details?.querySelector("summary")?.textContent).toBe("Show details");
    expect(details?.textContent).toContain("Model v1-20261108-C · confidence 79%");
    expect(details?.querySelector("li.context")?.textContent).toBe("Aanbod op een marktplaats");
    expect(details?.textContent).not.toMatch(/content\.|listing\.|=\s*\d/u); // no feature names or raw values
  });

  it("explains an unassessable page and a refund", () => {
    const root = rendered({ score: -1, explanation: "There's no product on this page", charged: false });
    expect(root.querySelector(".verdict .label")?.textContent).toBe("Not assessed");
    expect(root.textContent).toContain("No check was used.");
    expect(root.querySelector("details")).toBeNull();
  });

  it("still works with an older server that sends no verdict", () => {
    const root = rendered({ score: 30, explanation: "Several warning signs." });
    expect(bandOf({ score: 30 })).toBe("careful");
    expect(root.querySelector(".verdict .label")?.textContent).toBe("Think twice");
    expect(root.querySelector(".headline")?.textContent).toBe("Several warning signs.");
    // A verdict below "Looks fine" always names a reason, even when the result has none.
    expect([...root.querySelectorAll(".reasons strong")].map((s) => s.textContent)).toEqual([
      "Several small signals",
    ]);
  });

  it("always shows a reason for the middle verdicts, never for a reliable page without one", () => {
    for (const [score, band, label] of [
      [60, "concerns", "Worth a look"],
      [30, "careful", "Think twice"],
    ] as const) {
      const root = rendered({
        score,
        explanation: "",
        verdict: { band, label, headline: "x", reasons: [], positives: [], language: "en" },
      });
      expect(root.querySelector(".verdict .label")?.textContent).toBe(label);
      expect([...root.querySelectorAll(".reasons strong")].map((s) => s.textContent)).toEqual([
        "Several small signals",
      ]);
    }
    const fine = rendered({
      score: 90,
      explanation: "",
      verdict: {
        band: "reliable",
        label: "Looks fine",
        headline: "x",
        reasons: [],
        positives: [],
        language: "en",
      },
    });
    expect(fine.querySelector(".reasons")).toBeNull();
  });

  it("names the four verdicts in the website's words when the server sends none", () => {
    expect(
      [90, 60, 30, 10].map(
        (score) => rendered({ score, explanation: "" }).querySelector(".label")?.textContent,
      ),
    ).toEqual(["Looks fine", "Worth a look", "Think twice", "Serious concerns"]);
  });
});

describe("photo thumbnails", () => {
  const API = "https://unfret.net";
  const PHOTO: AnalysisResult = {
    score: 20,
    explanation: "",
    verdict: {
      band: "junk_or_scam",
      label: "Serious concerns",
      headline: "Serious concerns: photo used elsewhere.",
      reasons: [
        {
          type: "photo_on_other_shops",
          title: "Photo used by other shops",
          detail: "The same photo is on 4 other shops.",
          severity: "medium",
          thumbnails: [
            `${API}/v1/images/1/thumbnail.jpg`,
            "https://evil.example/v1/images/2/thumbnail.jpg",
            `${API}/v1/credits`,
            `${API}/v1/images/3/thumbnail.jpg`,
            "not a url",
          ],
        },
      ],
      positives: [],
    },
  };

  it("shows only thumbnails from the API's own image proxy, at most three", () => {
    expect(shownThumbnails(PHOTO.verdict?.reasons[0]?.thumbnails, API)).toEqual([
      `${API}/v1/images/1/thumbnail.jpg`,
      `${API}/v1/images/3/thumbnail.jpg`,
    ]);
    expect(shownThumbnails(PHOTO.verdict?.reasons[0]?.thumbnails, undefined)).toEqual([]);
    expect(shownThumbnails(undefined, API)).toEqual([]);
  });

  it("renders them under the reason, without a referrer", () => {
    const root = document.createElement("div");
    renderResult(root, PHOTO, API);
    const imgs = [...root.querySelectorAll<HTMLImageElement>(".reasons li .thumbs img")];
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([
      `${API}/v1/images/1/thumbnail.jpg`,
      `${API}/v1/images/3/thumbnail.jpg`,
    ]);
    expect(imgs.every((i) => i.referrerPolicy === "no-referrer" && i.alt.length > 0)).toBe(true);
  });

  it("renders no images without an API origin", () => {
    const root = document.createElement("div");
    renderResult(root, PHOTO);
    expect(root.querySelector(".thumbs")).toBeNull();
  });
});

describe("result card", () => {
  const API = "https://unfret.net";
  const CARD: AnalysisResult = {
    score: 35,
    explanation: "",
    charged: true,
    verdict: {
      band: "careful",
      label: "Think twice",
      headline: "A brand-new shop, and the same product elsewhere.",
      reasons: [
        {
          type: "new_domain",
          title: "Brand-new web shop",
          detail: "This web shop's address was registered only 23 days ago.",
          severity: "high",
          source: "Domain registry (RDAP)",
        },
        {
          type: "photo_reused",
          title: "Same photo on other shops",
          detail: "The main product photo is the same photo as on 1 other shop (cheap.shop).",
          severity: "medium",
          thumbnails: [`${API}/v1/images/1/thumbnail.jpg`],
          source: "Unfret's image index",
        },
      ],
      positives: [],
      same_product: {
        title: "Looks like the same product, sold elsewhere for $12.99",
        detail:
          "The main photo is the same photo as on cheap.shop. Unfret saw it there for $12.99 on 7 November 2026.",
        where: "cheap.shop",
        domain: "cheap.shop",
        price_text: "$12.99",
        image: `${API}/v1/images/1/thumbnail.jpg`,
        own_image: `${API}/v1/images/2/thumbnail.jpg`,
      },
      next_step: {
        type: "shop_reviews",
        text: "Look for reviews of the shop itself on other sites before you pay.",
      },
      checklist: [
        { key: "who", label: "Who's behind the shop", status: "concern", note: "Brand-new web shop" },
        { key: "reviews", label: "Reviews", status: "not_checked", note: "The page shows no reviews." },
        { key: "tricks", label: "Hidden tricks", status: "checked", note: "" },
      ],
      checks_run: 11,
    },
  };

  it("shows the same product first with both photos, then the findings with their sources", () => {
    const root = document.createElement("div");
    renderResult(root, CARD, API);
    const first = root.querySelector(".headline")?.nextElementSibling;
    expect(first?.className).toBe("same-product");
    expect(first?.querySelector("strong")?.textContent).toBe(
      "Looks like the same product, sold elsewhere for $12.99",
    );
    const photos = [...(first?.querySelectorAll<HTMLImageElement>("img") ?? [])];
    expect(photos.map((i) => i.getAttribute("src"))).toEqual([
      `${API}/v1/images/2/thumbnail.jpg`,
      `${API}/v1/images/1/thumbnail.jpg`,
    ]);
    expect([...(first?.querySelectorAll("figcaption") ?? [])].map((c) => c.textContent)).toEqual([
      "This page",
      "cheap.shop",
    ]);
    expect([...root.querySelectorAll(".reasons .source")].map((s) => s.textContent)).toEqual([
      "Source: Domain registry (RDAP)",
      "Source: Unfret's image index",
    ]);
    expect(root.querySelector(".reasons .thumbs")).toBeNull(); // the photo is shown once, up top
  });

  it("ends with one next step and what was checked, ticked, marked or not checked and why", () => {
    const root = document.createElement("div");
    renderResult(root, CARD, API);
    expect([...root.querySelectorAll("h2")].map((h) => h.textContent)).toEqual([
      "What we noticed",
      "What you can do",
      "What we checked · 11 checks",
    ]);
    expect(root.querySelector(".next-step p")?.textContent).toContain("reviews of the shop itself");
    const items = [...root.querySelectorAll(".checked-list li")];
    expect(items.map((li) => li.className)).toEqual(["concern", "not_checked", "checked"]);
    expect(items[1]?.textContent).toBe("Reviews: not checkedThe page shows no reviews.");
  });

  it("says how many checks found nothing on a clean result", () => {
    const root = document.createElement("div");
    const clean: AnalysisResult = {
      score: 92,
      explanation: "",
      verdict: {
        band: "reliable",
        label: "Looks fine",
        headline: "Nothing worrying.",
        reasons: [],
        positives: [],
        checks_run: 14,
      },
    };
    renderResult(root, clean, API);
    expect(root.querySelector(".clean")?.textContent).toBe("Nothing worrying in 14 checks.");
  });

  it("leaves the same product out without an API origin or from another origin", () => {
    const root = document.createElement("div");
    renderResult(root, CARD);
    expect(root.querySelector(".same-product")).toBeNull();
    const elsewhere = structuredClone(CARD);
    if (elsewhere.verdict?.same_product)
      elsewhere.verdict.same_product.image = "https://evil.example/v1/images/1/x.jpg";
    renderResult(root, elsewhere, API);
    expect(root.querySelector(".same-product")).toBeNull();
  });

  it("renders an older result (no card fields) as before", () => {
    const root = rendered(JUNK);
    expect(root.querySelector(".same-product, .next-step, .checked-list, .clean")).toBeNull();
  });
});

describe("deep-check suggestion under a quick result", () => {
  const OFFER: DeepCheck = {
    suggested: true,
    reason: "on_the_fence",
    quiet: false,
    adds: [
      { key: "shop_age", area: "who", label: "how old this shop is" },
      { key: "photo_elsewhere", area: "product", label: "whether its product photo appears on other shops" },
    ],
    text: "A deep check also looks at how old this shop is and whether its product photo appears on other shops.",
    cost: "Deep checks come in packs, from $6 for 25.",
    action: "get_checks",
    action_label: "Get checks",
  };
  const VERDICT: NonNullable<AnalysisResult["verdict"]> = {
    band: "concerns",
    label: "Worth a look",
    headline: "A big discount.",
    reasons: [{ type: "big_discount", title: "Big discount", detail: "70% off.", severity: "medium" }],
    positives: [],
    deep_check: OFFER,
  };
  const QUICK: AnalysisResult = {
    score: 45,
    explanation: "",
    charged: false,
    tier: "quick",
    verdict: VERDICT,
  };

  function withHint(result: AnalysisResult, actions: string[] = []): HTMLElement {
    const root = document.createElement("div");
    renderResult(root, result, undefined, (action) => actions.push(action));
    return root;
  }

  it("shows the server's words once, last, with one real button that runs its action", () => {
    const actions: string[] = [];
    const root = withHint(QUICK, actions);
    const hints = root.querySelectorAll(".deep-hint");
    expect(hints).toHaveLength(1);
    const hint = hints[0] as HTMLElement;
    expect(root.lastElementChild).toBe(hint);
    expect(hint.getAttribute("aria-labelledby")).toBe("deep-hint-text");
    expect(hint.querySelector("#deep-hint-text")?.textContent).toBe(OFFER.text);
    expect(hint.querySelector(".cost")?.textContent).toBe(OFFER.cost);
    const button = hint.querySelector("button");
    expect(button?.type).toBe("button");
    expect(button?.textContent).toBe("Get checks");
    button?.click();
    expect(actions).toEqual(["get_checks"]);
    expect(hint.classList.contains("quiet")).toBe(false);
  });

  it("is quiet for a result that looks fine, and runs a deep check when the caller has checks", () => {
    const actions: string[] = [];
    const offer = {
      ...OFFER,
      quiet: true,
      action: "run_deep" as const,
      action_label: null,
      cost: "Uses 1 of your 3 free deep checks.",
    };
    const root = withHint({ ...QUICK, verdict: { ...VERDICT, deep_check: offer } }, actions);
    expect(root.querySelector(".deep-hint.quiet button")?.textContent).toBe("Run a deep check");
    root.querySelector<HTMLButtonElement>(".deep-hint button")?.click();
    expect(actions).toEqual(["run_deep"]);
    expect(deepHintOf({ ...QUICK, verdict: { ...VERDICT, deep_check: offer } })?.quiet).toBe(true);
  });

  it("shows nothing without a suggestion: not suggested, a deep result, an older server, the share preview", () => {
    const none = { ...OFFER, suggested: false, reason: "serious_concerns", text: "" };
    for (const result of [
      { ...QUICK, verdict: { ...VERDICT, deep_check: none } },
      { ...QUICK, tier: "deep" as const },
      { ...QUICK, verdict: { ...VERDICT, deep_check: null } },
    ]) {
      expect(withHint(result).querySelector(".deep-hint")).toBeNull();
    }
    expect(rendered(QUICK).querySelector(".deep-hint")).toBeNull(); // no action to run: nothing to offer
  });
});

describe("progress checklist", () => {
  it("is a fixed list of plain items that tick off, updated in place", () => {
    const list = document.createElement("ul");
    buildChecklist(list);
    expect([...list.children].map((li) => li.textContent)).toEqual([
      "Reviews",
      "Seller",
      "Price",
      "Page code",
      "Company details",
    ]);
    const first = list.children[0];
    updateChecklist(list, checklistDone(["reviews", "listing"], false));
    buildChecklist(list); // no rebuild: screen readers aren't re-read the list
    expect(list.children[0]).toBe(first);
    expect([...list.children].map((li) => li.classList.contains("done"))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(list.children[0]?.getAttribute("aria-label")).toBe("Reviews: done");
    updateChecklist(list, checklistDone([], true));
    expect(list.querySelectorAll(".done")).toHaveLength(CHECKLIST.length);
  });
});

describe("share preview", () => {
  const API = "https://unfret.net";

  it("shows exactly what becomes public: product, shop, day and the verdict, without a score", () => {
    const root = document.createElement("div");
    renderSharePreview(root, SHARE_PREVIEW, API);
    expect(root.querySelector(".share-title")?.textContent).toBe("NOVAXEL Smart Watch");
    expect(root.querySelector(".share-meta")?.textContent).toBe(
      "amazon.com · https://www.amazon.com/dp/B0WATCH123",
    );
    expect(root.textContent).toContain(
      "Checked by an Unfret user on 10 November 2026; the page may have changed.",
    );
    // The shared page's "warning" band looks like the popup's "Serious concerns".
    expect(root.querySelector(".verdict")?.className).toBe("verdict junk_or_scam");
    expect(root.querySelector(".verdict .symbol")?.textContent).toBe("✕");
    expect(root.querySelector(".verdict .label")?.textContent).toBe("Serious concerns");
    expect([...root.querySelectorAll(".reasons strong")].map((s) => s.textContent)).toEqual([
      "Suspicious number of reviews",
    ]);
    expect(root.querySelector("details li")?.textContent).toBe("Steep discount"); // labels only, no evidence
    expect(root.textContent).not.toMatch(/\b18\b|score/iu);
  });
});

describe("English only", () => {
  it("ships no translations: no _locales, and the manifest's text is plain English", () => {
    expect(existsSync("src/_locales")).toBe(false);
    const m = manifest("chrome", { version: "0.9.0", description: "Spot junk." });
    expect(m).not.toHaveProperty("default_locale");
    expect(m.description).toBe("Spot junk.");
    for (const page of ["src/popup/popup.html", "src/options/options.html"]) {
      const html = readFileSync(page, "utf8");
      expect(html, page).not.toMatch(/data-i18n|__MSG_/u);
      expect(html, page).toContain('<html lang="en">');
    }
  });
});
