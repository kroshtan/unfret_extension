/** Messages between the popup and the background (the analysis runs in the background so closing the popup is safe). */

import type { AnalysisResult, AnalyzeBody, Finding, Pause, SharePreview } from "../api/client.js";

export const ANALYSIS_PORT = "unfret-analysis";

/**
 * What the background knows about a tab's analysis. Kept in memory and mirrored to `chrome.storage.session` (memory
 * only, cleared when the browser closes) so a result survives the service worker going to sleep; never written to disk.
 * `steps` are the checks that have finished, for the progress checklist. A finished state keeps the analysed request
 * (`body`, already cleaned, without its proof of work) so the user can report a wrong result.
 * The same request and result make a shared link when the user shares it after a preview (`share`); the link and its
 * delete code stay with the tab's result, in memory, until the tab moves on.
 */

export type ShareState =
  | { status: "loading" }
  | { status: "preview"; preview: SharePreview }
  | { status: "sharing"; preview: SharePreview }
  | { status: "shared"; link: string; deleteCode: string; expiresAt: string }
  /** With `preview` when sharing failed after it (it stays up to try again); without, when the preview failed. */
  | { status: "error"; message: string; preview?: SharePreview };
export type TabState =
  | { status: "idle" }
  | { status: "extracting" }
  /** A free deep check's proof of work, a few seconds of hashing in the background. */
  | { status: "preparing" }
  | { status: "analysing"; pageType?: string; findings: Finding[]; steps?: string[] }
  | {
      status: "done";
      pageType?: string;
      findings: Finding[];
      steps?: string[];
      result: AnalysisResult;
      body?: AnalyzeBody;
      share?: ShareState;
      /** Why a quick check ran instead of the deep one asked for (free deep checks paused or unavailable). */
      note?: string;
      /** Free deep checks are paused (the spend ceiling): the popup says so, with "Support Unfret". */
      pause?: Pause;
    }
  | {
      status: "error";
      message: string;
    };

export type PopupRequest =
  | { type: "watch"; tabId: number }
  | { type: "analyze"; tabId: number; tier?: "quick" }
  | { type: "share-preview"; tabId: number }
  | { type: "share"; tabId: number }
  | { type: "share-cancel"; tabId: number };

export type BackgroundUpdate = { type: "state"; tabId: number; state: TabState };
