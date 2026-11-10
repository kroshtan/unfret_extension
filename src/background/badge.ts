/**
 * The toolbar badge for a tab's analysis state: once known, a symbol for the verdict in a traffic-light colour. The
 * popup speaks in words ("Looks fine", "Many warning signs"), so the badge shows the same verdict, never the score.
 */

import type { AnalysisResult } from "../api/client.js";
import { BAND_SYMBOL, bandOf } from "../shared/bands.js";
import type { TabState } from "../shared/messages.js";

export const GREEN = "#1e7d32";
export const AMBER = "#b26a00";
export const RED = "#c62828";
export const GREY = "#5f6368";
/** The neutral accent of the marketplace icon hint: "Unfret can check this", not a warning. */
export const ACCENT = "#3b5bdb";

/** The traffic light for a result: the verdict band when the server sent one, else the same score thresholds. */
export function light(result: Pick<AnalysisResult, "score" | "verdict">): "green" | "amber" | "red" | "none" {
  const band = bandOf(result);
  if (band === null) return "none";
  if (band === "reliable") return "green";
  if (band === "concerns") return "amber";
  return "red";
}

/**
 * The badge for a state. Red is only ever a low result: account, credit and network problems clear the badge
 * (the popup explains them), so a red badge never means "something went wrong on our side".
 */
export function badgeFor(state: TabState): { text: string; color: string } | null {
  switch (state.status) {
    case "extracting":
    case "analysing":
      return { text: "…", color: GREY };
    case "done": {
      const band = bandOf(state.result);
      const colour = { green: GREEN, amber: AMBER, red: RED, none: GREY }[light(state.result)];
      return { text: band === null ? "–" : BAND_SYMBOL[band], color: colour };
    }
    case "error":
      return { text: "", color: GREY };
    case "idle":
      return null;
  }
}
