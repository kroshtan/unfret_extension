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
  trial_checks?: number;
  suggested_packs?: { checks: number; lamports: number }[];
  network?: string;
}

export interface Credits {
  address: string;
  balance_lamports: number;
  checks_remaining: number;
}

export interface Flag {
  type: string;
  evidence: string;
  weight: number;
}

export interface AnalysisResult {
  score: number;
  explanation: string;
  assessment?: { risk_score: number; confidence: number; flags: Flag[]; model_version: string };
  balance_lamports?: number;
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
