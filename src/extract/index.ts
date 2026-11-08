/**
 * Extract what the analysis needs from a page: the structured facts and the cleaned product text.
 *
 * `live` adds what only the rendered page shows (see `live.ts`); without it the result matches the backend's
 * extraction from the same HTML, which the parity tests check.
 */

import type { PageFacts } from "../shared/facts.js";
import { cleanText } from "./clean.js";
import { extractFacts } from "./generic.js";
import { liveCheckedStates, liveHiddenText, observeTimers } from "./live.js";

export interface Extraction {
  facts: PageFacts;
  text: string;
}

export interface ExtractOptions {
  live?: boolean;
  /** How long to watch countdowns before reading them again (live only). */
  timerWaitMs?: number;
}

export async function extractPage(
  doc: Document,
  url: string,
  options: ExtractOptions = {},
): Promise<Extraction> {
  const html = doc.documentElement.outerHTML;
  const facts = extractFacts(doc, html, url);
  if (options.live) {
    facts.hidden_text = [...facts.hidden_text, ...liveHiddenText(doc, facts.hidden_text)].slice(0, 100);
    const states = liveCheckedStates(doc);
    facts.checkboxes = facts.checkboxes.map((box, i) => ({ ...box, checked: states[i] ?? box.checked }));
    await observeTimers(doc, facts, options.timerWaitMs ?? 2500);
  }
  return { facts, text: cleanText(doc.querySelector("body") ?? doc.documentElement) };
}
