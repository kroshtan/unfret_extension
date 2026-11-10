/**
 * "Share this result": a finished check made public as a link on Unfret's site, anonymously.
 *
 * The server first answers exactly what would be public (a preview, nothing stored); only the user's "Share" stores
 * it, for 90 days, with a delete code shown that once. Both requests go without the sign-in (no Authorization
 * header), so the shared page names no account and nothing kept with it says who checked.
 */

import {
  type AnalysisResult,
  type AnalyzeBody,
  ApiError,
  type ShareRequest,
  type VeridexApi,
} from "../api/client.js";
import type { ShareState } from "./messages.js";
import { OFFLINE } from "./text.js";

/** The request that shares this check, or null when the result can't be shared (no share token). */
export function shareRequest(body: AnalyzeBody | undefined, result: AnalysisResult): ShareRequest | null {
  if (!body || !result.share_token) return null;
  const { score, explanation, assessment, verdict } = result;
  // The token covers the url and the result exactly as they were: they go back unchanged.
  return {
    share_token: result.share_token,
    url: body.url,
    result: { score, explanation, ...(assessment ? { assessment } : {}), ...(verdict ? { verdict } : {}) },
  };
}

const SHARE_ERROR: Record<string, string> = {
  CHECKOUT_NOT_SHAREABLE: "A check that included a checkout page can't be shared.",
  SHARE_TOKEN_EXPIRED: "This check is too old to share; check the page again first.",
  BAD_SHARE_TOKEN: "This result can't be shared; check the page again first.",
  NOT_SHAREABLE: "This result can't be shared.",
};

/** A refused or failed share, in plain words. */
export function shareError(error: unknown): string {
  if (!(error instanceof ApiError)) return OFFLINE;
  if (error.status === 429) return "Too many shares from here for now; please try again later.";
  return SHARE_ERROR[error.code] ?? "Sharing isn't available right now. Please try again later.";
}

/** Ask for the preview: what the public page would show. */
export async function previewShare(api: VeridexApi, request: ShareRequest): Promise<ShareState> {
  try {
    return { status: "preview", preview: await api.sharePreview(request) };
  } catch (error) {
    return { status: "error", message: shareError(error) };
  }
}

/** Share it (after the user saw the preview): the public link on `apiBase`, and its delete code. */
export async function createShare(
  api: VeridexApi,
  apiBase: string,
  request: ShareRequest,
  preview: Extract<ShareState, { status: "preview" }>["preview"],
): Promise<ShareState> {
  try {
    const created = await api.createShare(request);
    return {
      status: "shared",
      link: `${apiBase}${created.link}`,
      deleteCode: created.delete_code,
      expiresAt: created.expires_at,
    };
  } catch (error) {
    // The preview stays up, so "Share" can be tried again.
    return { status: "error", message: shareError(error), preview };
  }
}
