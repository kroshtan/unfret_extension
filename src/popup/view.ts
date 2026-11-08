/** Presentation for the popup: the result view and the progress checklist (pure DOM, tested in jsdom). */

import type { AnalysisResult, Band, Flag } from "../api/client.js";
import { type Language, type MessageKey, t } from "../shared/i18n.js";

/** The band for a result: the server's verdict, or the same thresholds from the score for an older server. */
export function bandOf(result: AnalysisResult): Band | null {
  if (result.score < 0) return null;
  if (result.verdict) return result.verdict.band;
  if (result.score >= 80) return "reliable";
  if (result.score >= 50) return "concerns";
  if (result.score >= 25) return "careful";
  return "junk_or_scam";
}

/** A symbol per band, so the verdict never relies on colour alone. */
export const BAND_SYMBOL: Record<Band, string> = {
  reliable: "✓",
  concerns: "!",
  careful: "⚠",
  junk_or_scam: "✕",
};

export function checksText(checks: number, language?: Language): string {
  return checks === 1 ? t("checks_left_one", [], language) : t("checks_left", [checks], language);
}

// ── Progress ──────────────────────────────────────────────────────────────────
// A fixed, friendly checklist instead of skill names: each item ticks off when one of its checks finishes.

export const CHECKLIST: readonly { key: MessageKey; skills: readonly string[] }[] = [
  { key: "step_reviews", skills: ["reviews"] },
  { key: "step_seller", skills: ["listing", "content"] },
  { key: "step_price", skills: ["dark_patterns"] },
  { key: "step_code", skills: ["html_source_signals", "injection"] },
  { key: "step_company", skills: ["eu_registry", "domain_age"] },
];

export function checklistDone(steps: readonly string[], finished: boolean): boolean[] {
  return CHECKLIST.map((item) => finished || item.skills.some((s) => steps.includes(s)));
}

/** Build the checklist once; later updates only flip states (so screen readers don't re-read the whole list). */
export function buildChecklist(list: HTMLElement, language?: Language): void {
  if (list.children.length === CHECKLIST.length) return;
  list.replaceChildren(
    ...CHECKLIST.map((item) => {
      const li = document.createElement("li");
      li.dataset.key = item.key;
      const mark = element("span", "tick");
      mark.setAttribute("aria-hidden", "true");
      li.append(mark, element("span", undefined, t(item.key, [], language)));
      return li;
    }),
  );
}

export function updateChecklist(list: HTMLElement, done: readonly boolean[], language?: Language): void {
  CHECKLIST.forEach((item, i) => {
    const li = list.children[i] as HTMLElement | undefined;
    const isDone = done[i] === true;
    if (!li || li.classList.contains("done") === isDone) return;
    li.classList.toggle("done", isDone);
    const mark = li.querySelector(".tick");
    if (mark) mark.textContent = isDone ? "✓" : "";
    if (isDone) li.setAttribute("aria-label", t("step_done", [t(item.key, [], language)], language));
    else li.removeAttribute("aria-label");
  });
}

// ── Result ────────────────────────────────────────────────────────────────────

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function flagLine(flag: Flag, language?: Language): HTMLLIElement {
  const li = element("li", flag.kind === "context" ? "context" : `signal ${flag.severity ?? "low"}`);
  li.append(element("span", "type", flag.label ?? t("details_signals", [], language)));
  if (flag.evidence) li.append(document.createTextNode(`: ${flag.evidence}`));
  return li;
}

function list(
  className: string,
  items: readonly { title: string; detail: string; cls?: string }[],
): HTMLElement {
  const ul = element("ul", className);
  for (const item of items) {
    const li = element("li", item.cls);
    li.append(element("strong", undefined, item.title), element("span", "detail", item.detail));
    ul.append(li);
  }
  return ul;
}

/** Fill `root` with the result: verdict label and headline, reasons, positives, the charge note and details. */
export function renderResult(root: HTMLElement, result: AnalysisResult, language?: Language): void {
  const band = bandOf(result);
  const verdict = result.verdict;
  const head = element("div", `verdict ${band ?? "none"}`);
  const symbol = element("span", "symbol", band ? BAND_SYMBOL[band] : "–");
  symbol.setAttribute("aria-hidden", "true");
  const fallbackLabel = band ? t(`band_${band}`, [], language) : t("not_assessed", [], language);
  head.append(symbol, element("p", "label", verdict?.label ?? fallbackLabel));
  const nodes: Node[] = [head, element("p", "headline", verdict?.headline ?? result.explanation)];

  const reasons: Node[] = verdict?.reasons.length
    ? [
        element("h2", undefined, t("concerns_heading", [], language)),
        list(
          "reasons",
          verdict.reasons.map((r) => ({ title: r.title, detail: r.detail, cls: r.severity })),
        ),
      ]
    : [];
  const positives: Node[] = verdict?.positives.length
    ? [element("h2", undefined, t("good_heading", [], language)), list("positives", verdict.positives)]
    : [];
  // Reliable: what looks good first; otherwise what we noticed first.
  nodes.push(...(band === "reliable" ? [...positives, ...reasons] : [...reasons, ...positives]));

  if (result.score < 0 || result.charged === false) {
    nodes.push(
      element("p", "muted small", t(result.score < 0 ? "no_check_used" : "cache_hit", [], language)),
    );
  }

  const assessment = result.assessment;
  if (assessment) {
    const details = element("details", "details");
    details.append(element("summary", undefined, t("details_show", [], language)));
    const signals = assessment.flags.filter((f) => f.kind !== "context");
    const context = assessment.flags.filter((f) => f.kind === "context");
    for (const [key, flags] of [
      ["details_signals", signals],
      ["details_context", context],
    ] as const) {
      if (flags.length === 0) continue;
      const ul = element("ul", "flags");
      ul.replaceChildren(...flags.map((f) => flagLine(f, language)));
      details.append(element("h3", undefined, t(key, [], language)), ul);
    }
    const confidence = Math.round(assessment.confidence * 100);
    details.append(
      element("p", "muted small", t("details_meta", [assessment.model_version || "–", confidence], language)),
    );
    nodes.push(details);
  }
  root.replaceChildren(...nodes);
}
