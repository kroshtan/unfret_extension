/**
 * The Unfret API, as the extension uses it (contract v1, "Free checks for shoppers"): quick and deep checks with no
 * pass and no identity (a deep check carries a proof of work instead), streamed analysis, shared results. Nothing this
 * client sends names the user: it never sends Authorization. Errors carry the backend's `{detail, error_code,
 * metadata}` shape.
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

  /** The deep check needs a (new) proof of work: none was sent (428), or the challenge was spent or expired (400). */
  get needsProof(): boolean {
    return this.code === "PROOF_OF_WORK_REQUIRED" || this.code === "BAD_CHALLENGE";
  }

  /** Today's free deep checks are paused (the spend ceiling): quick checks still work. */
  get freePaused(): boolean {
    return this.code === "FREE_CHECKS_PAUSED";
  }

  /** The server can't offer free deep checks right now (503). */
  get serviceOff(): boolean {
    return this.status === 503;
  }

  /** Seconds to wait, when the server says (`metadata.retry_after_s`). */
  get retryAfterS(): number | undefined {
    const m = this.metadata as { retry_after_s?: unknown } | null | undefined;
    return typeof m?.retry_after_s === "number" ? m.retry_after_s : undefined;
  }
}

/**
 * Why free deep checks are paused (the spend ceiling, paced per day): `FREE_CHECKS_PAUSED`'s metadata, the challenge's
 * `pause` and `/v1/pricing`'s `free.pause`. The extension shows its own words for `message_key`.
 */
export interface Pause {
  reason?: string;
  retry_after_s?: number;
  quick_checks?: boolean;
  message_key?: string;
  donate_url?: string;
}

/** A free deep check's proof-of-work challenge (GET /v1/analyze/challenge). */
export interface Challenge {
  challenge: string;
  bits: number;
  expires_at: number;
  /** Free deep checks are paused: don't solve it; show the pause and offer a quick check. */
  paused: boolean;
  pause?: Pause;
}

export interface Pricing {
  /** Free checks for shoppers; absent on older servers. */
  free?: {
    quick_checks?: boolean;
    deep_checks?: boolean;
    paused?: boolean;
    pause?: Pause;
    donate_url?: string;
  };
}

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
  /** Where the evidence comes from, in words ("Domain registry (RDAP)"); absent from older results. */
  source?: string | null;
  /** The risk level this reason is evidence for (1–4, higher is worse); null for a modifier or the small signs. */
  level?: number | null;
}

export interface VerdictPositive {
  type: string;
  title: string;
  detail: string;
  source?: string | null;
}

/** One line of the result card's "What we checked" (server ≥ the result card). */
export interface CheckItem {
  key: string;
  label: string;
  status: "checked" | "concern" | "not_checked";
  /** Why it wasn't checked, or the finding it's about; may be empty. */
  note?: string;
  /** How many of `checks_run` looked at this area (they add up to it); absent from an older server. */
  checks?: number | null;
}

/** The same product photo on another shop (Unfret's image index): shown first, with both photos. */
export interface SameProduct {
  title: string;
  detail: string;
  /** The other shop's domain, "Amazon", or "an Amazon catalogue listing (brand: …)". */
  where: string;
  domain?: string | null;
  others?: number;
  price?: number | null;
  currency?: string | null;
  price_text?: string | null;
  price_seen_on?: string | null;
  /** Thumbnails through the API's own image proxy. */
  image: string;
  own_image?: string | null;
}

/**
 * On a quick result (server ≥ the deep-check suggestion): whether a deep check of the same page is worth it, what it
 * would add here and what it costs this caller, in the server's words.
 */
export interface DeepCheck {
  suggested: boolean;
  reason: string;
  /** Looks fine: shown quietly. */
  quiet?: boolean;
  adds?: { key: string; area: string; label: string }[];
  /** "A deep check also looks at …"; empty when not suggested. */
  text?: string;
  /** "Deep checks are free.", or while they're paused, when they're back. */
  cost?: string | null;
  /** "donate" while free deep checks are paused (label "Support Unfret"); absent: no button. */
  action?: "run_deep" | "donate" | "get_checks" | null;
  action_label?: string | null;
}

/** The result card's fields of a verdict; all optional (cached and older results have none). */
export interface ResultCard {
  checklist?: CheckItem[];
  checks_run?: number | null;
  next_step?: { type: string; text: string } | null;
  same_product?: SameProduct | null;
  deep_check?: DeepCheck | null;
  /** Part of the check didn't finish (the assessment is degraded): one line to show under the headline. */
  incomplete?: { steps: string[]; text: string } | null;
}

export type Band = "reliable" | "concerns" | "careful" | "junk_or_scam";

/** One finding behind the risk level. */
export interface RiskReason {
  type: string;
  /** The level it is evidence for (1–4), or null for a protection modifier. */
  level: number | null;
  title: string;
}

/**
 * The one overall risk level (contract: "one overall risk level"; higher is always worse): 0 no concerns found,
 * 1 pressure and tricks, 2 may cost more than it's worth, 3 may not work as described, 4 may not arrive or may not be
 * safe. `because` lists every finding behind it, worst first.
 */
export interface Risk {
  level: number;
  key: string;
  /** The level in words: "May not arrive, or may not be safe". */
  label: string;
  because: RiskReason[];
  /** Lower-level problems together moved the level up: which ones, in words. */
  combined?: string | null;
  /** Protection raised or lowered it. */
  modifier?: { direction: "raised" | "lowered"; type: string; text: string } | null;
  /** One line: "Level 4 because: …". */
  explanation: string;
  source?: string;
  confidence?: number | null;
}

/** The shopper-facing verdict, as the server wrote it (shown as it comes, whatever its language). */
export interface Verdict extends ResultCard {
  /** Deprecated: the client renders `risk`. Kept for an older server's result. */
  band: Band;
  /** The overall risk level; absent from an older server's result. */
  risk?: Risk | null;
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
  /** Always false for a shopper's free check. */
  charged?: boolean;
  /** "quick": rule-based checks of the page itself only, free; "deep" (or absent): the full check. */
  tier?: "deep" | "quick";
  /** True for a free deep check (and a quick check). */
  free_check?: boolean;
  /** What the check cost, as a sentence ("Deep checks are free."). */
  charge_note?: string;
  verdict?: Verdict;
  /** Lets whoever has the result report it as wrong (POST /v1/labels); names no one. */
  label_token?: string;
  /** Lets anyone holding the result share it as a public link (POST /v1/shares) within 7 days; names no account. */
  share_token?: string;
}

/** A "Wrong result?" report (POST /v1/labels): the level the shopper thinks is right, findings wrong or missing. */
export interface Label {
  level?: number;
  wrong?: string[];
  missing?: string[];
}

export type LabelOutcome = "queued" | "already_reported" | "already_known";

export interface LabelResponse {
  status: LabelOutcome;
  /** This contributor had reported the page before: this replaces it. */
  updated?: boolean;
  anonymous?: boolean;
}

/** A contributor profile (POST /v1/contributors). */
export interface Contributor {
  handle: string | null;
  public: boolean;
  points?: number;
  labels: number;
  settled: number;
  agreed: number;
  trusted: boolean;
  rank?: number | null;
}

export interface LeaderboardEntry {
  rank: number;
  handle: string;
  agreed: number;
  settled: number;
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
    verdict?: ResultCard & {
      band?: ShareBand;
      label?: string;
      symbol?: string;
      headline?: string;
      reasons?: {
        title: string;
        detail: string;
        severity: VerdictReason["severity"];
        thumbnails?: string[];
        source?: string | null;
      }[];
      positives?: { title: string; detail: string; source?: string | null }[];
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
  /** "quick": the free, rules-only check (the server's default is the full, deep one). */
  tier?: "quick";
  page_facts?: PageFacts;
  page_content?: string;
  checkout_content?: string;
  flags?: string[];
  /** A free deep check's solved challenge (never part of what a report or a share sends back). */
  proof_of_work?: { challenge: string; solution: string };
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

export class UnfretApi {
  constructor(
    private readonly base: string,
    private readonly fetcher: FetchLike = (input, init) => fetch(input, init),
  ) {}

  /** Never an Authorization header: shoppers' checks name no one. */
  private headers(json: boolean): Record<string, string> {
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      // The extension is in English. Whatever the server writes about a page is shown as it comes.
      "Accept-Language": "en",
    };
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetcher(`${this.base}${path}`, {
      headers: this.headers(false),
      cache: "no-store",
    });
    if (!response.ok) throw await errorFrom(response);
    return (await response.json()) as T;
  }

  pricing(): Promise<Pricing> {
    return this.get<Pricing>("/v1/pricing");
  }

  /** A new proof-of-work challenge, one per deep check. */
  challenge(): Promise<Challenge> {
    return this.get<Challenge>("/v1/analyze/challenge");
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetcher(`${this.base}${path}`, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) throw await errorFrom(response);
    return (await response.json()) as T;
  }

  /**
   * "Wrong result?": the report, with the result's label token, the analysed request exactly as it was sent (without
   * the proof of work, which the token doesn't cover), the explanation and verdict as they came back, and the
   * contributor key only when the user turned it on. Never anything else that names the user.
   */
  label(
    body: AnalyzeBody,
    result: AnalysisResult,
    label: Label,
    contributorKey?: string,
  ): Promise<LabelResponse> {
    const request: AnalyzeBody = { ...body };
    delete request.proof_of_work;
    return this.post<LabelResponse>("/v1/labels", {
      label_token: result.label_token,
      request,
      ...(label.level !== undefined ? { level: label.level } : {}),
      ...(label.wrong?.length ? { wrong: label.wrong } : {}),
      ...(label.missing?.length ? { missing: label.missing } : {}),
      explanation: result.explanation,
      ...(result.verdict ? { verdict: result.verdict } : {}),
      ...(contributorKey ? { contributor_key: contributorKey } : {}),
    });
  }

  /** Make, read or change the contributor profile of `key` (fields left out stay as they are). */
  contributor(key: string, change: { handle?: string; public?: boolean } = {}): Promise<Contributor> {
    return this.post<Contributor>("/v1/contributors", { contributor_key: key, ...change });
  }

  /** Delete the contributor profile of `key` (labels sent stay, unlinked). */
  async forgetContributor(key: string): Promise<boolean> {
    const answer = await this.post<{ deleted?: unknown }>("/v1/contributors/forget", {
      contributor_key: key,
    });
    return answer.deleted === true;
  }

  async leaderboard(limit = 10): Promise<LeaderboardEntry[]> {
    const board = await this.get<{ entries?: LeaderboardEntry[] }>(
      `/v1/contributors/leaderboard?limit=${String(limit)}`,
    );
    return Array.isArray(board.entries) ? board.entries : [];
  }

  /** A share is anonymous: nothing ties the public page to anyone (the server refuses one with Authorization). */
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
