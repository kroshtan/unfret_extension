/** Presentation for the popup: the result view and the progress checklist (pure DOM, tested in jsdom). */

import type { AnalysisResult, Band, Flag, ShareBand, SharePreview } from "../api/client.js";
import { BAND_SYMBOL, bandOf } from "../shared/bands.js";
import { NO_CHECK_USED } from "../shared/text.js";

export { checksText } from "../shared/text.js";

// ── Progress ──────────────────────────────────────────────────────────────────
// A fixed, friendly checklist instead of skill names: each item ticks off when one of its checks finishes.

export const CHECKLIST: readonly { label: string; skills: readonly string[] }[] = [
  { label: "Reviews", skills: ["reviews"] },
  { label: "Seller", skills: ["listing", "content"] },
  { label: "Price", skills: ["dark_patterns"] },
  { label: "Page code", skills: ["html_source_signals", "injection"] },
  { label: "Company details", skills: ["eu_registry", "domain_age"] },
];

export function checklistDone(steps: readonly string[], finished: boolean): boolean[] {
  return CHECKLIST.map((item) => finished || item.skills.some((s) => steps.includes(s)));
}

/** Build the checklist once; later updates only flip states (so screen readers don't re-read the whole list). */
export function buildChecklist(list: HTMLElement): void {
  if (list.children.length === CHECKLIST.length) return;
  list.replaceChildren(
    ...CHECKLIST.map((item) => {
      const li = document.createElement("li");
      const mark = element("span", "tick");
      mark.setAttribute("aria-hidden", "true");
      li.append(mark, element("span", undefined, item.label));
      return li;
    }),
  );
}

export function updateChecklist(list: HTMLElement, done: readonly boolean[]): void {
  CHECKLIST.forEach((item, i) => {
    const li = list.children[i] as HTMLElement | undefined;
    const isDone = done[i] === true;
    if (!li || li.classList.contains("done") === isDone) return;
    li.classList.toggle("done", isDone);
    const mark = li.querySelector(".tick");
    if (mark) mark.textContent = isDone ? "✓" : "";
    if (isDone) li.setAttribute("aria-label", `${item.label}: done`);
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

function flagLine(flag: Pick<Flag, "label" | "evidence" | "kind" | "severity">): HTMLLIElement {
  const li = element("li", flag.kind === "context" ? "context" : `signal ${flag.severity ?? "low"}`);
  li.append(element("span", "type", flag.label ?? "Signals"));
  if (flag.evidence) li.append(document.createTextNode(`: ${flag.evidence}`));
  return li;
}

/** At most this many thumbnails per reason (the server sends up to three). */
const MAX_THUMBNAILS = 3;

/**
 * The thumbnails of a reason that may be shown: only images from the API's own origin (its thumbnail proxy), so the
 * popup never loads anything from the shops themselves and needs no extra permission.
 */
export function shownThumbnails(
  urls: readonly string[] | undefined,
  apiOrigin: string | undefined,
): string[] {
  if (!urls || !apiOrigin) return [];
  return urls
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.origin === apiOrigin && parsed.pathname.startsWith("/v1/images/");
      } catch {
        return false;
      }
    })
    .slice(0, MAX_THUMBNAILS);
}

function thumbnails(urls: readonly string[]): HTMLElement {
  const row = element("div", "thumbs");
  for (const url of urls) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "A matching photo on another shop";
    img.width = 64;
    img.height = 64;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      img.remove();
    });
    row.append(img);
  }
  return row;
}

function list(
  className: string,
  items: readonly { title: string; detail: string; cls?: string; thumbs?: readonly string[] }[],
): HTMLElement {
  const ul = element("ul", className);
  for (const item of items) {
    const li = element("li", item.cls);
    li.append(element("strong", undefined, item.title), element("span", "detail", item.detail));
    if (item.thumbs?.length) li.append(thumbnails(item.thumbs));
    ul.append(li);
  }
  return ul;
}

/** The band in words when the server sent none (an older server). */
const BAND_LABEL: Record<Band, string> = {
  reliable: "Looks fine",
  concerns: "Worth a look",
  careful: "Think twice",
  junk_or_scam: "Serious concerns",
};

/**
 * Every verdict below "Looks fine" names at least one reason. The server always sends one (its catalogue's "Several
 * small signals" when nothing else fired); a result without any (an older server's, sent without a verdict) gets the
 * same words here, so "Worth a look" or "Think twice" is never shown on its own.
 */
const OVERALL_REASON = {
  title: "Several small signals",
  detail: "No single big problem, but several smaller signals together lowered the score.",
  severity: "low",
} as const;

interface VerdictView {
  /** The CSS band (null: not assessed). */
  band: Band | null;
  symbol: string;
  label: string;
  headline: string;
  reasons: readonly { title: string; detail: string; severity: string; thumbnails?: readonly string[] }[];
  positives: readonly { title: string; detail: string }[];
  flags: readonly Pick<Flag, "label" | "evidence" | "kind" | "severity">[];
  confidence?: number | undefined;
  modelVersion?: string | undefined;
}

/** The verdict head, headline, reasons and positives (in the band's order) and the details disclosure. */
function verdictNodes(view: VerdictView, apiOrigin: string | undefined): { nodes: Node[]; details?: Node } {
  const head = element("div", `verdict ${view.band ?? "none"}`);
  const symbol = element("span", "symbol", view.symbol);
  symbol.setAttribute("aria-hidden", "true");
  head.append(symbol, element("p", "label", view.label));
  const nodes: Node[] = [head, element("p", "headline", view.headline)];

  const shownReasons: VerdictView["reasons"] =
    view.reasons.length > 0 || view.band === null || view.band === "reliable"
      ? view.reasons
      : [OVERALL_REASON];
  const reasons: Node[] = shownReasons.length
    ? [
        element("h2", undefined, "What we noticed"),
        list(
          "reasons",
          shownReasons.map((r) => ({
            title: r.title,
            detail: r.detail,
            cls: r.severity,
            thumbs: shownThumbnails(r.thumbnails, apiOrigin),
          })),
        ),
      ]
    : [];
  const positives: Node[] = view.positives.length
    ? [element("h2", undefined, "What looks good"), list("positives", view.positives)]
    : [];
  // Reliable: what looks good first; otherwise what we noticed first.
  nodes.push(...(view.band === "reliable" ? [...positives, ...reasons] : [...reasons, ...positives]));

  if (view.confidence === undefined && view.flags.length === 0) return { nodes };
  const details = element("details", "details");
  details.append(element("summary", undefined, "Show details"));
  const signals = view.flags.filter((f) => f.kind !== "context");
  const context = view.flags.filter((f) => f.kind === "context");
  for (const [title, flags] of [
    ["Signals", signals],
    ["About this page", context],
  ] as const) {
    if (flags.length === 0) continue;
    const ul = element("ul", "flags");
    ul.replaceChildren(...flags.map(flagLine));
    details.append(element("h3", undefined, title), ul);
  }
  const confidence = view.confidence === undefined ? "–" : `${Math.round(view.confidence * 100)}%`;
  details.append(element("p", "muted small", `Model ${view.modelVersion || "–"} · confidence ${confidence}`));
  return { nodes, details };
}

/**
 * Fill `root` with the result: verdict label and headline, reasons, positives, the charge note and details.
 * `apiOrigin` is the origin of the API in use; reasons' thumbnails are shown only from there. The verdict's text is
 * the server's, shown as it comes (it may quote the page in the page's own language).
 */
export function renderResult(root: HTMLElement, result: AnalysisResult, apiOrigin?: string): void {
  const band = bandOf(result);
  const verdict = result.verdict;
  const assessment = result.assessment;
  const { nodes, details } = verdictNodes(
    {
      band,
      symbol: band ? BAND_SYMBOL[band] : "–",
      label: verdict?.label ?? (band ? BAND_LABEL[band] : "Not assessed"),
      headline: verdict?.headline ?? result.explanation,
      reasons: verdict?.reasons ?? [],
      positives: verdict?.positives ?? [],
      flags: assessment?.flags ?? [],
      confidence: assessment?.confidence,
      modelVersion: assessment?.model_version,
    },
    apiOrigin,
  );
  if (result.score < 0 || result.charged === false) {
    nodes.push(
      element("p", "muted small", result.score < 0 ? NO_CHECK_USED : "Checked recently: no check was used."),
    );
  }
  // Details only with an assessment (an older server's result without one has none to show).
  if (assessment && details) nodes.push(details);
  root.replaceChildren(...nodes);
}

/** The shared page's band names, as the popup's CSS classes. */
const SHARE_BAND: Record<ShareBand, Band> = {
  reliable: "reliable",
  concerns: "concerns",
  careful: "careful",
  warning: "junk_or_scam",
};

/**
 * Fill `root` with exactly what a shared result makes public (the server's preview): the product, the shop, the day,
 * the verdict in the showcase's wording, without a score or quotes from the page.
 */
export function renderSharePreview(root: HTMLElement, preview: SharePreview, apiOrigin?: string): void {
  const verdict = preview.result.verdict;
  const assessment = preview.result.assessment;
  const { nodes, details } = verdictNodes(
    {
      band: SHARE_BAND[preview.band],
      symbol: preview.symbol,
      label: preview.label,
      headline: preview.headline,
      reasons: verdict?.reasons ?? [],
      positives: verdict?.positives ?? [],
      flags: assessment?.flags ?? [],
      confidence: assessment?.confidence,
      modelVersion: assessment?.model_version,
    },
    apiOrigin,
  );
  const meta = element("p", "muted small share-meta");
  meta.append(
    element("span", "host", preview.host),
    document.createTextNode(" · "),
    element("span", "share-product", preview.product_url),
  );
  root.replaceChildren(
    element("p", "share-title", preview.title),
    meta,
    element(
      "p",
      "muted small",
      `Checked by an Unfret user on ${preview.checked_on_text}; the page may have changed.`,
    ),
    ...nodes,
    ...(details && assessment ? [details] : []),
  );
}
