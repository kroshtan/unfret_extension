/**
 * The risk level (or, from an older server, the verdict band) and its symbol, shared by the popup and the toolbar
 * badge so both say the same thing.
 */

import type { AnalysisResult, Band, Risk } from "../api/client.js";

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

/** The result's overall risk level, when the server sent a valid one (and the page could be assessed). */
export function riskOf(result: Pick<AnalysisResult, "score" | "verdict">): Risk | null {
  const risk = result.verdict?.risk;
  if (result.score < 0 || !risk) return null;
  return Number.isInteger(risk.level) && risk.level >= 0 && risk.level <= 4 ? risk : null;
}

/**
 * How a level looks, as the band it is closest to (the popup's colours and the badge's traffic light): 0 green, 1 and
 * 2 amber, 3 and 4 red. A symbol per level, so it never relies on colour alone.
 */
export const LEVEL_TONE: readonly Band[] = ["reliable", "concerns", "concerns", "careful", "junk_or_scam"];
export const LEVEL_SYMBOL: readonly string[] = ["✓", "!", "!", "⚠", "✕"];

/** The tone and symbol of a result: its risk level when it has one, else its band. */
export function toneOf(
  result: Pick<AnalysisResult, "score" | "verdict">,
): { tone: Band; symbol: string } | null {
  const risk = riskOf(result);
  if (risk) return { tone: LEVEL_TONE[risk.level] ?? "concerns", symbol: LEVEL_SYMBOL[risk.level] ?? "!" };
  const band = bandOf(result);
  return band ? { tone: band, symbol: BAND_SYMBOL[band] } : null;
}
