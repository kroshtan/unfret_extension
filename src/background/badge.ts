/**
 * The toolbar badge for a tab's analysis state: once known, a symbol for the risk level in a traffic-light colour. The
 * popup speaks in words ("May cost more than it's worth"), so the badge shows the same level, never the score.
 */

import type { AnalysisResult } from "../api/client.js";
import { toneOf } from "../shared/bands.js";
import type { TabState } from "../shared/messages.js";

export const GREEN = "#1e7d32";
export const AMBER = "#b26a00";
export const RED = "#c62828";
export const GREY = "#5f6368";
/** The neutral accent of the marketplace icon hint: "Unfret can check this", not a warning. */
export const ACCENT = "#3b5bdb";

/**
 * The traffic light for a result: its risk level (0 green, 1–2 amber, 3–4 red), else the verdict band an older server
 * sent, else the same score thresholds.
 */
export function light(result: Pick<AnalysisResult, "score" | "verdict">): "green" | "amber" | "red" | "none" {
  const tone = toneOf(result)?.tone;
  if (tone === undefined) return "none";
  if (tone === "reliable") return "green";
  if (tone === "concerns") return "amber";
  return "red";
}

/**
 * The badge for a state. Red is only ever a low result: network and server problems clear the badge
 * (the popup explains them), so a red badge never means "something went wrong on our side".
 */
export function badgeFor(state: TabState): { text: string; color: string } | null {
  switch (state.status) {
    case "extracting":
    case "preparing":
    case "analysing":
      return { text: "…", color: GREY };
    case "done": {
      const colour = { green: GREEN, amber: AMBER, red: RED, none: GREY }[light(state.result)];
      return { text: toneOf(state.result)?.symbol ?? "–", color: colour };
    }
    case "error":
      return { text: "", color: GREY };
    case "idle":
      return null;
  }
}
