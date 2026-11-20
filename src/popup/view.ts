/** Presentation for the popup: the result view and the progress checklist (pure DOM, tested in jsdom). */

import type {
  AnalysisResult,
  Band,
  Flag,
  Pricing,
  ResultCard,
  ShareBand,
  SharePreview,
} from "../api/client.js";
import { BAND_SYMBOL, bandOf } from "../shared/bands.js";
import { NO_CHECK_USED, QUICK_NOTE } from "../shared/text.js";

export { checksText } from "../shared/text.js";

// ── "Wrong result?" ───────────────────────────────────────────────────────────

/** The reward line without numbers: no price list yet, or a server that doesn't say them. */
export const REPORT_REWARD_FALLBACK = "If the result was wrong, you may get free checks.";

/**
 * The report's reward line, with the rewards the server pays (`/v1/pricing` → `reports`), worded as the site's
 * report dialog. Empty when the server says it pays none; the fallback when it doesn't say.
 */
export function reportRewardLine(reports: Pricing["reports"]): string {
  const count = (n: unknown): number | undefined =>
    typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : undefined;
  const big = count(reports?.reward_checks);
  if (big === undefined) return REPORT_REWARD_FALLBACK;
  if (big === 0) return "";
  const small = count(reports?.small_reward_checks);
  const checks = (n: number): string => `${n} free check${n === 1 ? "" : "s"}`;
  return small
    ? `If Unfret was clearly wrong, you get ${checks(big)}; if it was somewhat off, ${checks(small)}.`
    : `If Unfret was clearly wrong, you get ${checks(big)}.`;
}

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
  items: readonly {
    title: string;
    detail: string;
    cls?: string;
    thumbs?: readonly string[];
    source?: string | null | undefined;
  }[],
): HTMLElement {
  const ul = element("ul", className);
  for (const item of items) {
    const li = element("li", item.cls);
    li.append(element("strong", undefined, item.title), element("span", "detail", item.detail));
    if (item.source) li.append(element("span", "source", `Source: ${item.source}`));
    if (item.thumbs?.length) li.append(thumbnails(item.thumbs));
    ul.append(li);
  }
  return ul;
}

// ── The result card: the same product elsewhere, the next step, what was checked (as on the website) ─────────

/** The checklist's marks as words for screen readers (the marks themselves are drawn by the stylesheet). */
const CHECK_WORD = {
  checked: "nothing to note",
  concern: "something to note",
  not_checked: "not checked",
} as const;

/** "1 check", "16 checks". */
function countOf(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/**
 * The checklist's heading, as on the website: "What we checked: 16 checks in 5 areas", the areas being those with a
 * check (their counts add up to the number). An older server's result without per-area counts keeps "What we checked
 * · 16 checks".
 */
export function checklistHeading(
  checks: number | null,
  items: NonNullable<ResultCard["checklist"]>,
): { title: string; count: string } {
  if (!checks) return { title: "What we checked", count: "" };
  if (items.length > 0 && items.every((i) => typeof i.checks === "number")) {
    const areas = items.filter((i) => (i.checks ?? 0) > 0).length;
    return {
      title: `What we checked: ${countOf(checks, "check", "checks")} in ${countOf(areas, "area", "areas")}`,
      count: "",
    };
  }
  return { title: "What we checked", count: ` · ${countOf(checks, "check", "checks")}` };
}

/**
 * What the check cost, as one sentence (as on the website): the server's `charge_note`, with the checks left, or the
 * same words without the count from an older server's fields.
 */
export function chargeNoteOf(result: AnalysisResult): string | null {
  if (result.charge_note) return result.charge_note;
  if (result.tier === "quick") return "Quick checks are free.";
  if (result.score < 0) return "This page couldn't be assessed, so no check was used.";
  if (result.charged === false) return "You checked this page recently, so no new check was used.";
  if (result.free_check) return "This check used one of your free checks.";
  return result.charged ? "This check used one of your checks." : null;
}

function sameProductNode(
  same: NonNullable<ResultCard["same_product"]>,
  apiOrigin: string | undefined,
): HTMLElement | null {
  const [image] = shownThumbnails([same.image], apiOrigin);
  if (!image) return null;
  const [own] = shownThumbnails(same.own_image ? [same.own_image] : [], apiOrigin);
  const box = element("section", "same-product");
  box.setAttribute("aria-label", same.title);
  box.append(element("strong", undefined, same.title));
  const pair = element("div", "pair");
  for (const [src, caption] of [
    [own, "This page"],
    [image, same.where],
  ] as const) {
    if (!src) continue;
    const figure = element("figure");
    const img = document.createElement("img");
    img.src = src;
    img.alt = src === own ? "This page's product photo" : `The same photo on ${caption}`;
    img.width = 96;
    img.height = 96;
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      figure.remove();
    });
    figure.append(img, element("figcaption", undefined, caption));
    pair.append(figure);
  }
  box.append(pair, element("span", "detail", same.detail));
  return box;
}

function checklistNode(items: NonNullable<ResultCard["checklist"]>): HTMLElement {
  const ul = element("ul", "checked-list");
  for (const item of items) {
    const status = item.status in CHECK_WORD ? item.status : "checked";
    const li = element("li", status);
    const mark = element("span", "mark");
    mark.setAttribute("aria-hidden", "true");
    const what = element("span", "what");
    what.append(element("span", "area", item.label));
    if (item.checks) what.append(element("span", "count", ` · ${countOf(item.checks, "check", "checks")}`));
    what.append(element("span", "visually-hidden", `: ${CHECK_WORD[status]}`));
    if (item.note) what.append(element("span", "why", item.note));
    li.append(mark, what);
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
  reasons: readonly {
    type?: string;
    title: string;
    detail: string;
    severity: string;
    thumbnails?: readonly string[];
    source?: string | null;
  }[];
  positives: readonly { title: string; detail: string; source?: string | null }[];
  card?: ResultCard | undefined;
  flags: readonly Pick<Flag, "label" | "evidence" | "kind" | "severity">[];
  confidence?: number | undefined;
  modelVersion?: string | undefined;
}

/** The verdict head, headline, reasons and positives (in the band's order) and the details disclosure. */
function verdictNodes(view: VerdictView, apiOrigin: string | undefined): { nodes: Node[]; details?: Node } {
  const head = element("div", `verdict ${view.band ?? "none"}`);
  const symbol = element("span", "symbol", view.symbol);
  symbol.setAttribute("aria-hidden", "true");
  // The verdict is the result's heading for screen readers (its sub-headings are h2, so it is one level up from
  // them in meaning, without changing the h2s that the page's other headings follow).
  const label = element("p", "label", view.label);
  label.setAttribute("role", "heading");
  label.setAttribute("aria-level", "2");
  head.append(symbol, label);
  const nodes: Node[] = [head, element("p", "headline", view.headline)];
  const card = view.card ?? {};
  // Right under the headline: part of the check didn't finish, so the verdict may be milder than it should be.
  if (card.incomplete?.text) nodes.push(element("p", "incomplete", card.incomplete.text));
  const same = card.same_product ? sameProductNode(card.same_product, apiOrigin) : null;
  if (same) nodes.push(same);
  const checks = typeof card.checks_run === "number" ? card.checks_run : null;
  if (view.band === "reliable" && view.reasons.length === 0 && checks) {
    nodes.push(element("p", "clean", `Nothing worrying in ${String(checks)} checks.`));
  }

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
            // The photo of the same product is shown once, up top.
            thumbs: same && r.type === "photo_reused" ? [] : shownThumbnails(r.thumbnails, apiOrigin),
            source: "source" in r ? r.source : undefined,
          })),
        ),
      ]
    : [];
  const positives: Node[] = view.positives.length
    ? [element("h2", undefined, "What looks good"), list("positives", view.positives)]
    : [];
  // Reliable: what looks good first; otherwise what we noticed first.
  nodes.push(...(view.band === "reliable" ? [...positives, ...reasons] : [...reasons, ...positives]));
  if (card.next_step?.text) {
    const step = element("section", "next-step");
    step.append(element("h2", undefined, "What you can do"), element("p", undefined, card.next_step.text));
    nodes.push(step);
  }
  if (card.checklist?.length) {
    const { title, count } = checklistHeading(checks, card.checklist);
    const heading = element("h2", undefined, title);
    if (count) heading.append(element("span", "count", count));
    nodes.push(heading, checklistNode(card.checklist));
  }

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

/** What a quick result's suggestion of a deep check shows, or null (none suggested, a deep result, an older server). */
export interface DeepHint {
  text: string;
  cost: string;
  action: "run_deep" | "get_checks";
  label: string;
  quiet: boolean;
}

export function deepHintOf(result: AnalysisResult): DeepHint | null {
  const offer = result.verdict?.deep_check;
  if (result.tier !== "quick" || offer?.suggested !== true || !offer.text) return null;
  const action = offer.action === "run_deep" ? "run_deep" : "get_checks";
  return {
    text: offer.text,
    cost: offer.cost ?? "",
    action,
    label: offer.action_label || (action === "run_deep" ? "Run a deep check" : "Get checks"),
    quiet: offer.quiet === true,
  };
}

/** The suggestion, once, under the quick result: the server's words and one real button. */
function deepHintNode(hint: DeepHint, onAction: (action: DeepHint["action"]) => void): HTMLElement {
  const box = element("section", hint.quiet ? "deep-hint quiet" : "deep-hint");
  const text = element("p", "deep-hint-text", hint.text);
  text.id = "deep-hint-text";
  box.setAttribute("aria-labelledby", text.id);
  box.append(text);
  if (hint.cost) box.append(element("p", "cost", hint.cost));
  const button = element("button", undefined, hint.label);
  button.type = "button";
  button.id = "deep-hint-action";
  button.addEventListener("click", () => {
    onAction(hint.action);
  });
  box.append(button);
  return box;
}

/**
 * Fill `root` with the result: verdict label and headline, reasons, positives, the charge note and details.
 * `apiOrigin` is the origin of the API in use; reasons' thumbnails are shown only from there. The verdict's text is
 * the server's, shown as it comes (it may quote the page in the page's own language). A quick result's suggestion of
 * a deep check comes last, with one button; `onDeepHint` runs its action (without it, no suggestion is shown).
 */
export function renderResult(
  root: HTMLElement,
  result: AnalysisResult,
  apiOrigin?: string,
  onDeepHint?: (action: DeepHint["action"]) => void,
): void {
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
      card: verdict,
      flags: assessment?.flags ?? [],
      confidence: assessment?.confidence,
      modelVersion: assessment?.model_version,
    },
    apiOrigin,
  );
  // What the check cost, as a sentence. Right under the headline when no check was used (good news, and easy to miss
  // under the reasons; a quick check also says what it is); at the end when one was.
  const charge = chargeNoteOf(result);
  if (result.tier === "quick" || result.score < 0 || result.charged === false) {
    const text = result.tier === "quick" ? `${QUICK_NOTE} ${charge ?? ""}`.trim() : (charge ?? NO_CHECK_USED);
    nodes.splice(2, 0, element("p", "charge-note", text));
  } else if (charge) {
    nodes.push(element("p", "charge-note paid", charge));
  }
  const hint = onDeepHint ? deepHintOf(result) : null;
  if (hint && onDeepHint) nodes.push(deepHintNode(hint, onDeepHint));
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
      card: verdict,
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
