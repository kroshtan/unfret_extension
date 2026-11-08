/**
 * What only the rendered page shows, added on top of the server-equivalent facts:
 *
 * - text hidden by stylesheet CSS (zero font size, zero opacity, pushed off-screen, text coloured like its
 *   background): the server only sees inline styles;
 * - the current checked state of checkboxes (a script may tick an add-on after load);
 * - countdowns observed ticking (or restarting) over a short window.
 *
 * Deliberately conservative: elements merely collapsed with `display: none` by a stylesheet (menus, tabs,
 * dialogs) are ordinary interface and are not reported, matching what the scorer was trained on.
 */

import type { PageFacts } from "../shared/facts.js";
import { cut, dedupe, squash, text } from "./dom.js";
import { timerElements, timerLabel } from "./generic.js";

const MIN_HIDDEN_CHARS = 20;
const TIME_RE = /^(?:(\d{1,2})\s*[:hH]\s*)?(\d{1,2})\s*[:mM]\s*(\d{2})\s*[sS]?$/u;
const SKIP = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "HEAD",
  "META",
  "LINK",
  "SVG",
  "INPUT",
  "OPTION",
]);

function ownText(el: Element): string {
  let out = "";
  for (const node of Array.from(el.childNodes)) if (node.nodeType === 3) out += (node as Text).data;
  return squash(out);
}

function rgba(value: string): [number, number, number, number] | null {
  const m = /rgba?\(([^)]+)\)/u.exec(value);
  if (!m) return null;
  const parts = (m[1] ?? "")
    .split(/[,\s/]+/u)
    .filter(Boolean)
    .map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

function effectiveBackground(el: Element, view: Window): [number, number, number, number] | null {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const bg = rgba(view.getComputedStyle(node).backgroundColor);
    if (bg && bg[3] > 0) return bg;
    if (view.getComputedStyle(node).backgroundImage !== "none") return null; // can't tell against an image
  }
  return [255, 255, 255, 1];
}

/** Why an element's own text is invisible to a reader despite being rendered, or null. */
export function invisibility(el: Element, view: Window): string | null {
  const style = view.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return null; // ordinary collapsed UI
  if (parseFloat(style.fontSize) < 1) return "zero font size";
  if (parseFloat(style.opacity) === 0) return "zero opacity";
  if (parseFloat(style.textIndent) <= -999) return "pushed off-screen";
  if (["absolute", "fixed"].includes(style.position)) {
    if (parseFloat(style.left) <= -999 || parseFloat(style.top) <= -999) return "pushed off-screen";
  }
  const fg = rgba(style.color);
  const bg = effectiveBackground(el, view);
  if (fg && bg && fg[3] > 0) {
    const distance = Math.abs(fg[0] - bg[0]) + Math.abs(fg[1] - bg[1]) + Math.abs(fg[2] - bg[2]);
    if (distance < 12) return "text coloured like its background";
  }
  return null;
}

/** Text hidden by computed styles, not already found from inline styles. */
export function liveHiddenText(doc: Document, known: string[]): string[] {
  const view = doc.defaultView;
  if (!view) return [];
  const found: string[] = [];
  const reported: Element[] = [];
  const body = doc.querySelector("body");
  if (!body) return [];
  for (const el of Array.from(body.querySelectorAll("*"))) {
    if (SKIP.has(el.tagName.toUpperCase()) || reported.some((r) => r.contains(el))) continue;
    const own = ownText(el);
    if (own.length < MIN_HIDDEN_CHARS || !invisibility(el, view)) continue;
    const t = cut(text(el), 300);
    if (!known.includes(t)) found.push(t);
    reported.push(el);
  }
  return dedupe(found);
}

/** The live checked state of the checkboxes, in the same order the static extractor lists them. */
export function liveCheckedStates(doc: Document): boolean[] {
  return Array.from(doc.querySelectorAll("input"))
    .filter((box) => /^checkbox$/iu.test(box.getAttribute("type") ?? ""))
    .map((box) => box.checked);
}

export function seconds(value: string): number | null {
  const m = TIME_RE.exec(squash(value));
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function timeCandidates(doc: Document): Element[] {
  const tagged = timerElements(doc);
  const leaves = Array.from(doc.querySelector("body")?.querySelectorAll("*") ?? []).filter(
    (el) => el.children.length === 0 && !SKIP.has(el.tagName) && seconds(el.textContent) !== null,
  );
  return dedupeElements([...tagged, ...leaves.filter((leaf) => !tagged.some((t) => t.contains(leaf)))]);
}

function dedupeElements(items: Element[]): Element[] {
  return items.filter((el, i) => items.indexOf(el) === i);
}

function readTime(el: Element): number | null {
  const direct = seconds(el.textContent);
  if (direct !== null) return direct;
  const leaf = Array.from(el.querySelectorAll("*")).find((c) => seconds(c.textContent) !== null);
  return leaf ? seconds(leaf.textContent) : null;
}

export interface TimerObservation {
  label: string;
  first: number;
  second: number;
}

/** Describe what two readings of a countdown say about it. */
export function describeTimer(first: number, second: number): string | null {
  if (second < first) return `live: counting down (${format(first)} → ${format(second)})`;
  if (second > first) return `live: countdown restarted (${format(first)} → ${format(second)})`;
  return null;
}

function format(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Read the countdowns twice, `waitMs` apart, and annotate or add timer entries. */
export async function observeTimers(doc: Document, facts: PageFacts, waitMs: number): Promise<void> {
  const candidates = timeCandidates(doc)
    .map((el) => ({ el, first: readTime(el) }))
    .filter((c): c is { el: Element; first: number } => c.first !== null);
  if (candidates.length === 0) return;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  const timers = [...facts.timers];
  for (const { el, first } of candidates) {
    const second = readTime(el);
    const note = second === null ? null : describeTimer(first, second);
    if (!note) continue;
    const label = timerLabel(el);
    const index = timers.findIndex((t) => t === label || t.startsWith(label.split(">")[0] ?? label));
    if (index >= 0) timers[index] = `${timers[index] ?? ""} [${note}]`;
    else timers.push(`<${el.tagName.toLowerCase()}> [${note}]`);
  }
  facts.timers = dedupe(timers).slice(0, 50);
}
