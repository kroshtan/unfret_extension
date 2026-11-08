/** Messages between the popup and the background (the analysis runs in the background so closing the popup is safe). */

import type { AnalysisResult, Finding } from "../api/client.js";

export const ANALYSIS_PORT = "veridex-analysis";

/**
 * What the background knows about a tab's analysis. Kept in memory and mirrored to `chrome.storage.session` (memory
 * only, cleared when the browser closes) so a result survives the service worker going to sleep; never written to disk.
 * `steps` are the checks that have finished, for the progress checklist.
 */
export type TabState =
  | { status: "idle" }
  | { status: "extracting" }
  | { status: "analysing"; pageType?: string; findings: Finding[]; steps?: string[] }
  | { status: "done"; pageType?: string; findings: Finding[]; steps?: string[]; result: AnalysisResult }
  | {
      status: "error";
      message: string;
      needsSignIn: boolean;
      needsCredits: boolean;
      /** True when no check was used (the server refunds failed analyses). */
      refunded?: boolean;
    };

export type PopupRequest = { type: "watch"; tabId: number } | { type: "analyze"; tabId: number };

export type BackgroundUpdate = { type: "state"; tabId: number; state: TabState };
