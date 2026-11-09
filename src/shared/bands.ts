/** The verdict bands and their symbols, shared by the popup and the toolbar badge so both say the same thing. */

import type { AnalysisResult, Band } from "../api/client.js";

/** The band for a result: the server's verdict, or the same thresholds from the score for an older server. */
export function bandOf(result: Pick<AnalysisResult, "score" | "verdict">): Band | null {
  if (result.score < 0) return null;
  if (result.verdict) return result.verdict.band;
  if (result.score >= 80) return "reliable";
  if (result.score >= 50) return "concerns";
  if (result.score >= 25) return "careful";
  return "junk_or_scam";
}

/** A symbol per band, so the verdict never relies on colour alone: the popup, the badge and the web page agree. */
export const BAND_SYMBOL: Record<Band, string> = {
  reliable: "✓",
  concerns: "!",
  careful: "⚠",
  junk_or_scam: "✕",
};
