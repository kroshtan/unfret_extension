/** Messages between the popup and the background (the analysis runs in the background so closing the popup is safe). */

import type { AnalysisResult, Finding } from "../api/client.js";

export const ANALYSIS_PORT = "veridex-analysis";

/** What the background knows about a tab's analysis (kept in memory only, never stored). */
export type TabState =
  | { status: "idle" }
  | { status: "extracting" }
  | { status: "analysing"; pageType?: string; findings: Finding[] }
  | { status: "done"; pageType?: string; findings: Finding[]; result: AnalysisResult }
  | { status: "error"; message: string; needsSignIn: boolean; needsCredits: boolean };

export type PopupRequest = { type: "watch"; tabId: number } | { type: "analyze"; tabId: number };

export type BackgroundUpdate = { type: "state"; tabId: number; state: TabState };
