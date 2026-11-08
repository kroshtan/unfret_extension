import { describe, expect, it } from "vitest";

import en from "../src/_locales/en/messages.json";
import nl from "../src/_locales/nl/messages.json";
import type { AnalysisResult } from "../src/api/client.js";
import { format, t } from "../src/shared/i18n.js";
import {
  bandOf,
  buildChecklist,
  CHECKLIST,
  checklistDone,
  renderResult,
  updateChecklist,
} from "../src/popup/view.js";

const JUNK: AnalysisResult = {
  score: 12,
  explanation: "Waarschijnlijk generieke fabrieksspullen.",
  charged: true,
  verdict: {
    band: "junk_or_scam",
    label: "Waarschijnlijk rommel of oplichting",
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
    label: "Looks reliable",
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

function rendered(result: AnalysisResult, language: "en" | "nl"): HTMLElement {
  const root = document.createElement("div");
  renderResult(root, result, language);
  return root;
}

describe("result view", () => {
  it("shows the verdict in words with a symbol, the headline and the reasons strongest first (nl)", () => {
    const root = rendered(JUNK, "nl");
    const verdict = root.querySelector(".verdict");
    expect(verdict?.className).toBe("verdict junk_or_scam");
    expect(root.querySelector(".verdict .label")?.textContent).toBe("Waarschijnlijk rommel of oplichting");
    expect(root.querySelector(".verdict .symbol")?.textContent).toBe("✕"); // not colour alone
    expect(root.querySelector(".headline")?.textContent).toContain("Duizenden reviews");
    const headings = [...root.querySelectorAll("h2")].map((h) => h.textContent);
    expect(headings).toEqual(["Wat ons opviel", "Wat goed is"]); // concerns before positives
    expect([...root.querySelectorAll(".reasons li strong")].map((s) => s.textContent)).toEqual([
      "Verdacht veel reviews",
      "Titel vol zoekwoorden",
    ]);
  });

  it("puts what looks good first for a reliable result, and says when no check was used (en)", () => {
    const root = rendered(RELIABLE, "en");
    expect([...root.querySelectorAll("h2")].map((h) => h.textContent)).toEqual([
      "What looks good",
      "What we noticed",
    ]);
    expect(root.textContent).toContain("Checked recently: no check was used.");
  });

  it("keeps details behind a disclosure, with server labels and neutral context", () => {
    const root = rendered(JUNK, "nl");
    const details = root.querySelector("details");
    expect(details?.querySelector("summary")?.textContent).toBe("Details tonen");
    expect(details?.textContent).toContain("Model v1-20261108-C · zekerheid 79%");
    expect(details?.querySelector("li.context")?.textContent).toBe("Aanbod op een marktplaats");
    expect(details?.textContent).not.toMatch(/content\.|listing\.|=\s*\d/u); // no feature names or raw values
  });

  it("explains an unassessable page and a refund", () => {
    const root = rendered(
      { score: -1, explanation: "Er staat geen product op deze pagina", charged: false },
      "nl",
    );
    expect(root.querySelector(".verdict .label")?.textContent).toBe("Niet beoordeeld");
    expect(root.textContent).toContain("Er is geen check gebruikt.");
  });

  it("still works with an older server that sends no verdict", () => {
    const root = rendered({ score: 30, explanation: "Several warning signs." }, "en");
    expect(bandOf({ score: 30, explanation: "" })).toBe("careful");
    expect(root.querySelector(".verdict .label")?.textContent).toBe("Be careful");
    expect(root.querySelector(".headline")?.textContent).toBe("Several warning signs.");
  });
});

describe("progress checklist", () => {
  it("is a fixed list of plain items that tick off, updated in place", () => {
    const list = document.createElement("ul");
    buildChecklist(list, "nl");
    expect([...list.children].map((li) => li.textContent)).toEqual([
      "Reviews",
      "Verkoper",
      "Prijs",
      "Paginacode",
      "Bedrijfsgegevens",
    ]);
    const first = list.children[0];
    updateChecklist(list, checklistDone(["reviews", "listing"], false), "nl");
    buildChecklist(list, "nl"); // no rebuild: screen readers aren't re-read the list
    expect(list.children[0]).toBe(first);
    expect([...list.children].map((li) => li.classList.contains("done"))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(list.children[0]?.getAttribute("aria-label")).toBe("Reviews: klaar");
    updateChecklist(list, checklistDone([], true), "nl");
    expect(list.querySelectorAll(".done")).toHaveLength(CHECKLIST.length);
  });
});

describe("languages", () => {
  it("has every message in English and Dutch, with the same placeholders", () => {
    expect(Object.keys(nl).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(en)) {
      const dutch = (nl as Record<string, { message: string }>)[key]?.message ?? "";
      expect(dutch.match(/\$\d/gu) ?? [], key).toEqual(value.message.match(/\$\d/gu) ?? []);
      expect(/^[A-Za-z0-9_]+$/u.test(key), key).toBe(true); // chrome.i18n key rules
    }
  });

  it("fills substitutions", () => {
    expect(format("Model $1 · confidence $2%", ["v1", 79])).toBe("Model v1 · confidence 79%");
    expect(t("signed_in_as", ["9xQe…VFin"], "nl")).toBe("Ingelogd als 9xQe…VFin");
    expect(t("session_expired", [], "en")).toContain("your checks are still there");
  });
});
