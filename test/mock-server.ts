/**
 * A small mock of the Unfret API (contract v1) for tests and the smoke run: pricing, credits, and a streamed
 * analysis that records the request it got. Behaviour per bearer token: "expired" → 401, "broke" → 402,
 * "off" → 503, "midway" → stream error event, anything else → a normal result.
 *
 * Invites (`POST /v1/invites/redeem`): INVITE_OK adds 3 checks; INVITE_USED_CODE, INVITE_UNKNOWN_CODE and
 * INVITE_NOT_NEW_CODE are refused with the server's codes and words; once INVITE_OK is redeemed by a token,
 * `/v1/credits` reports `invite_eligible: false` for it (before that the field is absent, like an older server). Shares (`/v1/shares/preview`, `/v1/shares`) refuse
 * a request with Authorization, like the server; share token "expired.mac" → 422, "busy.mac" → 429 on create.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { SharePreview } from "../src/api/client.js";

export interface MockApi {
  url: string;
  requests: { path: string; auth: string; body: unknown; language?: string }[];
  /**
   * Phone pairing behaviour. `POST /v1/auth/pair` returns `id`; polls of "pair-ok" answer 202 `pendingPolls` times,
   * then the session once, then 404. "pair-expired" → 410, "pair-gone" → 404, "pair-flaky" → 503 once, then the
   * session. `connectBase` overrides the connect URL's origin (to test the origin check).
   */
  pairing: { id: string; pendingPolls: number; connectBase?: string; delivered: boolean; flaked: boolean };
  close(): Promise<void>;
}

export const PAIRED_SESSION = {
  token: "paired-session-token-0123456789",
  address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  expires_at: "2099-01-01T00:00:00Z",
};

/** The verdict the mock analysis returns. */
export const VERDICT = {
  band: "junk_or_scam",
  label: "Many warning signs",
  headline: "Thousands of reviews on a six-week-old listing and an inflated discount.",
  reasons: [
    {
      type: "review_velocity",
      title: "Suspicious number of reviews",
      detail: "4,800 ratings for a product that's only been listed for 6 weeks.",
      severity: "high",
    },
  ],
  positives: [],
  language: "en",
};

export const INVITE_OK = `ufi_${"a".repeat(32)}`;
export const INVITE_USED_CODE = `ufi_${"b".repeat(32)}`;
export const INVITE_UNKNOWN_CODE = `ufi_${"c".repeat(32)}`;
export const INVITE_NOT_NEW_CODE = `ufi_${"d".repeat(32)}`;

const INVITE_REFUSALS: Record<string, { status: number; error_code: string; detail: string }> = {
  [INVITE_USED_CODE]: {
    status: 409,
    error_code: "INVITE_USED",
    detail: "This invite has already been used.",
  },
  [INVITE_UNKNOWN_CODE]: { status: 404, error_code: "UNKNOWN_INVITE", detail: "Unknown invite code." },
  [INVITE_NOT_NEW_CODE]: {
    status: 403,
    error_code: "INVITE_NOT_FOR_THIS_ACCOUNT",
    detail: "Invites are for new accounts: this one has had checks before, or used an invite.",
  },
};

export const SHARE_ID = "k3v7q2m9x4b8n6c1d5f0h2j4la";
export const SHARE_DELETE_CODE = "delcode7q2m9x4b8n6c1d5f0h2";

/** What the public page would show: the showcase's wording, no score, no quotes from the page. */
export const SHARE_PREVIEW: SharePreview = {
  title: "NOVAXEL Smart Watch",
  host: "amazon.com",
  product_url: "https://www.amazon.com/dp/B0WATCH123",
  checked_on: "2026-11-10",
  checked_on_text: "10 November 2026",
  band: "warning",
  label: "Many warning signs",
  symbol: "✕",
  headline: "Several things on this page are typical of junk or dropshipped goods.",
  result: {
    verdict: {
      band: "warning",
      label: "Many warning signs",
      symbol: "✕",
      headline: "Several things on this page are typical of junk or dropshipped goods.",
      reasons: [{ title: "Suspicious number of reviews", detail: "", severity: "high", thumbnails: [] }],
      positives: [],
    },
    assessment: {
      flags: [{ label: "Steep discount", evidence: "", kind: "signal" }],
      confidence: 0.64,
      model_version: "v1-test",
    },
  },
  notice: "Anyone with the link sees this verdict and the product link. It never says who checked.",
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as unknown) : null;
}

export async function startMockApi(): Promise<MockApi> {
  const requests: MockApi["requests"] = [];
  const pairing: MockApi["pairing"] = { id: "pair-ok", pendingPolls: 2, delivered: false, flaked: false };
  const invited = new Set<string>(); // tokens that redeemed an invite
  let base = "";
  const server: Server = createServer((req, res) => {
    void (async () => {
      const auth = req.headers.authorization ?? "";
      const token = auth.replace(/^Bearer /u, "");
      const path = req.url ?? "";
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Unfret-Claim",
          "Access-Control-Allow-Methods": "GET, POST",
        });
        res.end();
        return;
      }
      const body = req.method === "POST" ? await readBody(req) : null;
      const language = req.headers["accept-language"];
      requests.push({ path, auth, body, ...(typeof language === "string" ? { language } : {}) });
      if (token === "expired") {
        json(res, 401, { detail: "Sign in again.", error_code: "UNAUTHORIZED" });
        return;
      }
      if (token === "off") {
        json(res, 503, { detail: "Sign-in is off.", error_code: "SERVICE_UNAVAILABLE" });
        return;
      }
      if (path === "/v1/pricing") {
        json(res, 200, {
          analysis_lamports: 1_500_000,
          x402: { quick_lamports: 100_000, deep_lamports: 1_500_000 },
          bonuses: [],
          suggested_packs: [{ checks: 10, lamports: 15_000_000 }],
          hot_wallet: "HotWa11etHotWa11etHotWa11etHotWa11etHotWa11",
          network: "solana-devnet",
        });
        return;
      }
      if (path === "/v1/auth/pair" && req.method === "POST") {
        json(res, 201, {
          pair_id: pairing.id,
          confirm_code: "K7-4Q",
          connect_url: `${pairing.connectBase ?? base}/connect?pair=${pairing.id}`,
          expires_at: "2099-01-01T00:05:00Z",
        });
        return;
      }
      if (path.startsWith("/v1/auth/pair/")) {
        const id = decodeURIComponent(path.slice("/v1/auth/pair/".length));
        if (id === "pair-expired") {
          json(res, 410, { detail: "This pairing expired; start again.", error_code: "PAIRING_EXPIRED" });
        } else if (id === "pair-flaky" && !pairing.flaked) {
          pairing.flaked = true;
          json(res, 503, { detail: "Busy.", error_code: "SERVICE_UNAVAILABLE" });
        } else if ((id === "pair-ok" || id === "pair-flaky") && !pairing.delivered) {
          if (id === "pair-ok" && pairing.pendingPolls > 0) {
            pairing.pendingPolls -= 1;
            json(res, 202, { status: "pending" });
          } else {
            pairing.delivered = true;
            json(res, 200, PAIRED_SESSION);
          }
        } else {
          json(res, 404, { detail: "Unknown pairing.", error_code: "PAIRING_UNKNOWN" });
        }
        return;
      }
      if (path === "/v1/reports" && req.method === "POST") {
        if (token === "limited") {
          json(res, 429, {
            detail: "You've used this month's reports.",
            error_code: "REPORT_LIMIT",
            metadata: { used: 5, limit: 5 },
          });
        } else {
          json(res, 201, { status: "queued", reports_used: 1, reports_per_month: 5 });
        }
        return;
      }
      if (path === "/v1/invites/redeem" && req.method === "POST") {
        if (!token) {
          json(res, 401, { detail: "Sign in first.", error_code: "UNAUTHORIZED" });
          return;
        }
        const code = (body as { code?: string } | null)?.code ?? "";
        const refusal = INVITE_REFUSALS[code];
        if (refusal) json(res, refusal.status, { detail: refusal.detail, error_code: refusal.error_code });
        else if (code === INVITE_OK) {
          invited.add(token);
          json(res, 200, {
            checks_added: 3,
            usd_micros_added: 600_000,
            balance_usd_micros: 600_000,
            checks_remaining: 3,
          });
        } else
          json(res, 400, {
            detail: "That isn't an invite code (it starts with ufi_).",
            error_code: "INVALID_INVITE",
          });
        return;
      }
      if ((path === "/v1/shares/preview" || path === "/v1/shares") && req.method === "POST") {
        if (auth) {
          json(res, 400, {
            detail: "A share is anonymous: send it without an Authorization header.",
            error_code: "AUTHORIZATION_NOT_ALLOWED",
          });
          return;
        }
        const shareToken = (body as { share_token?: string } | null)?.share_token;
        if (shareToken === "expired.mac") {
          json(res, 422, { detail: "Too old.", error_code: "SHARE_TOKEN_EXPIRED" });
        } else if (shareToken !== "share-token.mac") {
          json(res, 400, { detail: "Forged.", error_code: "BAD_SHARE_TOKEN" });
        } else if (path === "/v1/shares/preview") {
          json(res, 200, SHARE_PREVIEW);
        } else if ((body as { url?: string } | null)?.url?.includes("busy")) {
          json(res, 429, {
            detail: "Too many shared results from here today.",
            error_code: "TOO_MANY_REQUESTS",
          });
        } else {
          json(res, 201, {
            id: SHARE_ID,
            link: `/r/${SHARE_ID}`,
            delete_code: SHARE_DELETE_CODE,
            expires_at: "2027-02-08T12:00:00Z",
          });
        }
        return;
      }
      if (path === "/v1/credits") {
        json(res, 200, {
          address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
          balance_lamports: 7_500_000,
          checks_remaining: 5,
          ...(invited.has(token) ? { invite_eligible: false } : {}),
        });
        return;
      }
      if (path === "/v1/analyze/stream") {
        if (token === "broke") {
          json(res, 402, {
            detail: "Not enough credits.",
            error_code: "INSUFFICIENT_CREDITS",
            metadata: { balance_lamports: 0, analysis_lamports: 1_500_000 },
          });
          return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" });
        res.write('event: page_type\ndata: {"page_type": "aggregate_listing"}\n\n');
        res.write(
          'event: step\ndata: {"skill": "listing", "findings": [{"type": "discount", "evidence": "85% off."}]}\n\n',
        );
        res.write(
          ': keep-alive\n\nevent: finding\r\ndata: {"skill": "reviews", "type": "velocity", "evidence": "4,800 reviews in 6 weeks."}\r\n\r\n',
        );
        if (token === "midway") {
          res.end(
            'event: error\ndata: {"detail": "Analysis took too long.", "error_code": "GATEWAY_TIMEOUT"}\n\n',
          );
          return;
        }
        res.end(
          "event: result\ndata: " +
            JSON.stringify({
              score: 18,
              explanation: "Generic product, inflated discount, implausibly fast reviews.",
              assessment: {
                risk_score: 0.82,
                confidence: 0.64,
                model_version: "v1-test",
                flags: [{ type: "listing.discount_pct", evidence: "85% off.", weight: 1.2 }],
              },
              balance_lamports: 6_000_000,
              charged: true,
              verdict: VERDICT,
              report_token: "report-token.mac",
              share_token: "share-token.mac",
            }) +
            "\n\n",
        );
        return;
      }
      json(res, 404, { detail: "Not found.", error_code: "NOT_FOUND" });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  return {
    url: base,
    requests,
    pairing,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
