/** Messages between the popup and the background (the analysis runs in the background so closing the popup is safe). */

import type { AnalysisResult, AnalyzeBody, Finding, ReportReason, SharePreview } from "../api/client.js";

export const ANALYSIS_PORT = "veridex-analysis";

/**
 * What the background knows about a tab's analysis. Kept in memory and mirrored to `chrome.storage.session` (memory
 * only, cleared when the browser closes) so a result survives the service worker going to sleep; never written to disk.
 * `steps` are the checks that have finished, for the progress checklist. A finished state keeps the analysed request
 * (`body`, already cleaned) so the user can report a wrong result; it goes to the server only with their consent.
 * The same request and result make a shared link when the user shares it after a preview (`share`); the link and its
 * delete code stay with the tab's result, in memory, until the tab moves on.
 */

export type ReportState =
  | { status: "sending" }
  | { status: "sent"; outcome: "queued" | "already_reported" | "already_known" }
  | { status: "error"; message: string };
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
  | { status: "analysing"; pageType?: string; findings: Finding[]; steps?: string[] }
  | {
      status: "done";
      pageType?: string;
      findings: Finding[];
      steps?: string[];
      result: AnalysisResult;
      body?: AnalyzeBody;
      report?: ReportState;
      share?: ShareState;
    }
  | {
      status: "error";
      message: string;
      needsSignIn: boolean;
      needsCredits: boolean;
      /** True when no check was used (the server refunds failed analyses). */
      refunded?: boolean;
    };

export type PopupRequest =
  | { type: "watch"; tabId: number }
  | { type: "analyze"; tabId: number }
  | { type: "report"; tabId: number; reason: ReportReason }
  | { type: "share-preview"; tabId: number }
  | { type: "share"; tabId: number }
  | { type: "share-cancel"; tabId: number };

export type BackgroundUpdate = { type: "state"; tabId: number; state: TabState };
