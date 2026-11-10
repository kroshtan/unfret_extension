/**
 * The Veridex API, as the extension uses it (contract v1: SIWS sessions, credits in lamports, streamed analysis).
 * Errors carry the backend's `{detail, error_code, metadata}` shape.
 */

import type { PageFacts } from "../shared/facts.js";
import { readEvents } from "./sse.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
    readonly metadata?: unknown,
  ) {
    super(detail);
    this.name = "ApiError";
  }

  get needsSignIn(): boolean {
    return this.status === 401;
  }

  get needsCredits(): boolean {
    return this.status === 402 || this.code === "INSUFFICIENT_CREDITS";
  }

  /** The server has sign-in / credits switched off (503 SERVICE_UNAVAILABLE). */
  get serviceOff(): boolean {
    return this.status === 503;
  }
}

export interface Pricing {
  analysis_lamports: number;
  /** null while buying credits is switched off on the server. */
  hot_wallet: string | null;
  suggested_packs?: { checks: number; lamports: number }[];
  network?: string;
}

export interface Credits {
  address: string;
  balance_lamports: number;
  checks_remaining: number;
  /** Whether an invite can still be redeemed onto this account (it never had credit); absent on older servers. */
  invite_eligible?: boolean;
}

/** A phone sign-in pairing (contract: "phone sign-in by pairing"). */
export interface Pairing {
  pair_id: string;
  confirm_code: string;
  connect_url: string;
  expires_at: string;
}

export interface PairedSession {
  token: string;
  address: string;
  expires_at: string;
}

export type PairPoll = { status: "pending" } | { status: "ready"; session: PairedSession };

export interface Flag {
  type: string;
  evidence: string;
  weight: number;
  /** Human label from the server (never show `type`). */
  label?: string;
  /** "context" flags describe the page (e.g. "Marketplace listing") and are shown neutrally. */
  kind?: "signal" | "context";
  severity?: "high" | "medium" | "low";
}

export interface VerdictReason {
  type: string;
  title: string;
  detail: string;
  severity: "high" | "medium" | "low";
  /** Up to three thumbnails of matching photos (photo-reuse evidence), served by the API itself. */
  thumbnails?: string[];
}

export interface VerdictPositive {
  type: string;
  title: string;
  detail: string;
}

export type Band = "reliable" | "concerns" | "careful" | "junk_or_scam";

/** The shopper-facing verdict, as the server wrote it (shown as it comes, whatever its language). */
export interface Verdict {
  band: Band;
  label: string;
  headline: string;
  reasons: VerdictReason[];
  positives: VerdictPositive[];
  language?: string;
}

export interface AnalysisResult {
  score: number;
  explanation: string;
  assessment?: { risk_score: number; confidence: number; flags: Flag[]; model_version: string };
  balance_lamports?: number;
  balance_usd_micros?: number;
  /** False when no check was used (a page that couldn't be analysed, or a recent result from the cache). */
  charged?: boolean;
  verdict?: Verdict;
  /** Lets this account report the result as wrong (POST /v1/reports) within 7 days. */
  report_token?: string;
  /** Lets anyone holding the result share it as a public link (POST /v1/shares) within 7 days; names no account. */
  share_token?: string;
}

export type ReportReason = "real_brand" | "scam" | "junk" | "other";
export type ReportOutcome = "queued" | "already_reported" | "already_known";

export interface ReportResponse {
  status: ReportOutcome;
  reports_used: number;
  reports_per_month: number;
}

/** What an invite added (POST /v1/invites/redeem). */
export interface InviteRedeemed {
  checks_added: number;
  usd_micros_added: number;
  balance_usd_micros: number;
  checks_remaining: number;
}

/** A result to share: the check's share token, the url as it was analysed and the result as it came back. */
export interface ShareRequest {
  share_token: string;
  url: string;
  result: Pick<AnalysisResult, "score" | "explanation" | "assessment" | "verdict">;
}

export type SharedFlag = Pick<Flag, "label" | "evidence" | "kind">;

/** The shared page's bands (the showcase's names: "warning" is the extension's `junk_or_scam`). */
export type ShareBand = "reliable" | "concerns" | "careful" | "warning";

/** Exactly what a share makes public (POST /v1/shares/preview): no score, no quotes from the page. */
export interface SharePreview {
  title: string;
  host: string;
  product_url: string;
  checked_on: string;
  checked_on_text: string;
  band: ShareBand;
  label: string;
  symbol: string;
  headline: string;
  result: {
    verdict?: {
      band?: ShareBand;
      label?: string;
      symbol?: string;
      headline?: string;
      reasons?: {
        title: string;
        detail: string;
        severity: VerdictReason["severity"];
        thumbnails?: string[];
      }[];
      positives?: { title: string; detail: string }[];
    };
    /** Flags with their labels only (evidence is always empty on a shared page). */
    assessment?: { flags?: SharedFlag[]; confidence?: number; model_version?: string };
  };
  /** What to tell the sharer before they confirm. */
  notice: string;
}

/** A new share (POST /v1/shares): the delete code is shown this once. */
export interface CreatedShare {
  id: string;
  /** The share's page on the API's own site, `/r/<id>`. */
  link: string;
  delete_code: string;
  expires_at: string;
}

export interface Finding {
  skill: string;
  type?: string;
  evidence: string;
}

export interface AnalyzeBody {
  url: string;
  page_facts?: PageFacts;
  page_content?: string;
  checkout_content?: string;
  flags?: string[];
}

export type StreamEvent =
  | { kind: "page_type"; pageType: string }
  | { kind: "step"; skill: string }
  | { kind: "finding"; finding: Finding }
  | { kind: "result"; result: AnalysisResult };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function errorFrom(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // not JSON
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const detail = typeof b.detail === "string" ? b.detail : `HTTP ${response.status}`;
  const code = typeof b.error_code === "string" ? b.error_code : `HTTP_${response.status}`;
  return new ApiError(response.status, code, detail, b.metadata);
}

function asFindings(data: Record<string, unknown>): Finding[] {
  // Contract v1 sends `step` events ({skill, findings}); the current backend sends one `finding` per observation.
  if (Array.isArray(data.findings)) {
    const skill = typeof data.skill === "string" ? data.skill : "";
    return (data.findings as Record<string, unknown>[]).map((f) => ({
      skill: typeof f.skill === "string" ? f.skill : skill,
      ...(typeof f.type === "string" ? { type: f.type } : {}),
      evidence: typeof f.evidence === "string" ? f.evidence : "",
    }));
  }
  if (typeof data.evidence === "string") {
    return [
      {
        skill: typeof data.skill === "string" ? data.skill : "",
        ...(typeof data.type === "string" ? { type: data.type } : {}),
        evidence: data.evidence,
      },
    ];
  }
  return [];
}

export class VeridexApi {
  constructor(
    private readonly base: string,
    private readonly token?: string,
    private readonly fetcher: FetchLike = (input, init) => fetch(input, init),
  ) {}

  private headers(json: boolean): Record<string, string> {
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      // The extension is in English. Whatever the server writes about a page is shown as it comes.
      "Accept-Language": "en",
    };
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetcher(`${this.base}${path}`, { headers: this.headers(false) });
    if (!response.ok) throw await errorFrom(response);
    return (await response.json()) as T;
  }

  pricing(): Promise<Pricing> {
    return this.get<Pricing>("/v1/pricing");
  }

  credits(): Promise<Credits> {
    return this.get<Credits>("/v1/credits");
  }

  /**
   * Report a result as wrong, with the user's consent to share this one check's page data: the analysed request
   * and the explanation go back exactly as they were, with the result's report token.
   */
  async report(body: AnalyzeBody, result: AnalysisResult, reason: ReportReason): Promise<ReportResponse> {
    const response = await this.fetcher(`${this.base}/v1/reports`, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({
        report_token: result.report_token,
        reason,
        consent: true,
        request: body,
        explanation: result.explanation,
        ...(result.verdict ? { verdict: result.verdict } : {}),
      }),
    });
    if (!response.ok) throw await errorFrom(response);
    return (await response.json()) as ReportResponse;
  }

  /**
   * Redeem an invite someone gave the user for this account (the wallet's session or the API key): only a new account
   * that never had checks can. Refusals come back as ApiError with the server's reason (INVALID_INVITE,
   * UNKNOWN_INVITE, INVITE_USED, INVITE_NOT_FOR_THIS_ACCOUNT).
   */
  async redeemInvite(code: string): Promise<InviteRedeemed> {
    const response = await this.fetcher(`${this.base}/v1/invites/redeem`, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({ code }),
    });
    if (!response.ok) throw await errorFrom(response);
    return (await response.json()) as InviteRedeemed;
  }

  /**
   * A share is anonymous: it goes without Authorization, whatever this client was made with, so nothing ties the
   * public page to an account (the server refuses a share request that carries one).
   */
  private async postShare<T>(path: string, request: ShareRequest): Promise<T> {
    const response = await this.fetcher(`${this.base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": "en" },
      body: JSON.stringify(request),
      cache: "no-store",
    });
    if (!response.ok) throw await errorFrom(response);
    return (await response.json()) as T;
  }

  /** Exactly what sharing this result would make public; stores nothing. */
  sharePreview(request: ShareRequest): Promise<SharePreview> {
    return this.postShare<SharePreview>("/v1/shares/preview", request);
  }

  /** Make the result public as `/r/<id>` for 90 days; the link must be a page on this API's own site. */
  async createShare(request: ShareRequest): Promise<CreatedShare> {
    const created = await this.postShare<CreatedShare>("/v1/shares", request);
    if (
      typeof created.link !== "string" ||
      !/^\/r\/[A-Za-z0-9_-]+$/u.test(created.link) ||
      typeof created.delete_code !== "string" ||
      !created.delete_code
    ) {
      throw new ApiError(502, "BAD_SHARE", "The server sent an unexpected shared link.");
    }
    return created;
  }

  /** Start a phone sign-in; the connect URL must be on this API's origin (it goes into a QR code). */
  async startPairing(): Promise<Pairing> {
    const response = await this.fetcher(`${this.base}/v1/auth/pair`, {
      method: "POST",
      headers: this.headers(true),
    });
    if (!response.ok) throw await errorFrom(response);
    const pairing = (await response.json()) as Pairing;
    if (
      typeof pairing.connect_url !== "string" ||
      !pairing.connect_url.startsWith(`${this.base}/connect?pair=`)
    ) {
      throw new ApiError(502, "BAD_PAIRING", "The server sent an unexpected sign-in link.");
    }
    return pairing;
  }

  /** One poll: pending (202), or the session (200, delivered once). 410 expired and 404 unknown throw ApiError. */
  async pollPairing(pairId: string): Promise<PairPoll> {
    const response = await this.fetcher(`${this.base}/v1/auth/pair/${encodeURIComponent(pairId)}`, {
      headers: this.headers(false),
      cache: "no-store",
    });
    if (response.status === 202) return { status: "pending" };
    if (!response.ok) throw await errorFrom(response);
    return { status: "ready", session: (await response.json()) as PairedSession };
  }

  /** Run a streamed analysis; yields progress, ends with the result, throws ApiError on failure. */
  async *analyze(body: AnalyzeBody, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const response = await this.fetcher(`${this.base}/v1/analyze/stream`, {
      method: "POST",
      headers: { ...this.headers(true), Accept: "text/event-stream" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw await errorFrom(response);
    if (!response.body) throw new ApiError(response.status, "EMPTY_RESPONSE", "The server sent no data.");
    for await (const { event, data } of readEvents(response.body)) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event === "page_type" && typeof parsed.page_type === "string") {
        yield { kind: "page_type", pageType: parsed.page_type };
      } else if (event === "finding" || event === "step") {
        if (event === "step" && typeof parsed.skill === "string") {
          if (typeof parsed.page_type === "string") yield { kind: "page_type", pageType: parsed.page_type };
          yield { kind: "step", skill: parsed.skill };
        }
        for (const finding of asFindings(parsed)) yield { kind: "finding", finding };
      } else if (event === "result") {
        yield { kind: "result", result: parsed as unknown as AnalysisResult };
        return;
      } else if (event === "error") {
        throw new ApiError(
          typeof parsed.status === "number" ? parsed.status : 500,
          typeof parsed.error_code === "string" ? parsed.error_code : "INTERNAL_ERROR",
          typeof parsed.detail === "string" ? parsed.detail : "Analysis failed.",
          parsed.metadata,
        );
      }
    }
    throw new ApiError(502, "STREAM_ENDED", "The analysis ended without a result.");
  }
}
