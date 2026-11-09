/**
 * The toolbar badge for a tab's analysis state: once known, a symbol for the verdict in a traffic-light colour. The
 * popup speaks in words ("Looks fine", "Many warning signs"), so the badge shows the same verdict, never the score.
 */

import type { AnalysisResult } from "../api/client.js";
import type { TabState } from "../shared/messages.js";

export const GREEN = "#1e7d32";
export const AMBER = "#b26a00";
export const RED = "#c62828";
export const GREY = "#5f6368";
/** The neutral accent of the marketplace icon hint: "Veridex can check this", not a warning. */
export const ACCENT = "#3b5bdb";

/** The traffic light for a result: the verdict band when the server sent one, else the same score thresholds. */
export function light(result: Pick<AnalysisResult, "score" | "verdict">): "green" | "amber" | "red" | "none" {
  const band = bandOf(result);
  if (band === null) return "none";
  if (band === "reliable") return "green";
  if (band === "concerns") return "amber";
  return "red";
}

type Band = "reliable" | "concerns" | "careful" | "junk_or_scam";

/** The verdict band: the server's when it sent one, else from the same score thresholds; null when not assessed. */
export function bandOf(result: Pick<AnalysisResult, "score" | "verdict">): Band | null {
  if (result.score < 0) return null;
  return (
    (result.verdict?.band as Band | undefined) ??
    (result.score >= 80
      ? "reliable"
      : result.score >= 50
        ? "concerns"
        : result.score >= 25
          ? "careful"
          : "junk_or_scam")
  );
}

/** One symbol per verdict label: Looks fine, A few things to check, Some warning signs, Many warning signs. */
const SYMBOL: Record<Band, string> = { reliable: "✓", concerns: "?", careful: "!", junk_or_scam: "!!" };

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
      return { text: band === null ? "–" : SYMBOL[band], color: colour };
    }
    case "error":
      return { text: "", color: GREY };
    case "idle":
      return null;
  }
}
