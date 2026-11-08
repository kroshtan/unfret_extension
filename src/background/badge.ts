/** The toolbar badge for a tab's analysis state: the score in a traffic-light colour once known. */

import type { TabState } from "../shared/messages.js";

export const GREEN = "#1e7d32";
export const AMBER = "#b26a00";
export const RED = "#c62828";
export const GREY = "#5f6368";

/** The traffic light for a 0–100 reliability score (100 = reliable); -1 means "not a product page". */
export function light(score: number): "green" | "amber" | "red" | "none" {
  if (score < 0) return "none";
  if (score >= 70) return "green";
  if (score >= 40) return "amber";
  return "red";
}

export function badgeFor(state: TabState): { text: string; color: string } | null {
  switch (state.status) {
    case "extracting":
    case "analysing":
      return { text: "…", color: GREY };
    case "done": {
      const score = state.result.score;
      const colour = { green: GREEN, amber: AMBER, red: RED, none: GREY }[light(score)];
      return { text: score < 0 ? "–" : String(score), color: colour };
    }
    case "error":
      return { text: "!", color: RED };
    case "idle":
      return null;
  }
}
