/**
 * A small mock of the Unfret API (contract v1, "Free checks for shoppers") for tests and the smoke run: pricing, a
 * free deep check's challenge (4 bits) and a streamed analysis that records the request it got. Its behaviour is set
 * through `mode`: "ok" → a normal result, "paused" → free deep checks paused (the challenge says so, and a deep check
 * gets 429 FREE_CHECKS_PAUSED), "off" → 503 on a deep check, "busy" → 429 TOO_MANY_REQUESTS on a deep check,
 * "midway" → a stream error event, "spent" → the first deep check's challenge is refused with 400 BAD_CHALLENGE.
 * A deep check without a valid proof of work gets 428 PROOF_OF_WORK_REQUIRED, as on the server. Any Authorization
 * header is refused (a test that sees it fails): shoppers' checks name no one.
 *
 * Shares (`/v1/shares/preview`, `/v1/shares`): share token "expired.mac" → 422, a url with "busy" → 429 on create.
 */

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { SharePreview } from "../src/api/client.js";

export type MockMode = "ok" | "paused" | "off" | "busy" | "midway" | "spent";

export interface MockApi {
  url: string;
  mode: MockMode;
  requests: { path: string; auth: string; body: unknown; language?: string }[];
  close(): Promise<void>;
}

/** The verdict the mock analysis returns. */
export const VERDICT = {
  band: "junk_or_scam",
  label: "Serious concerns",
  headline: "Thousands of reviews on a six-week-old listing and an inflated discount.",
  reasons: [
    {
      type: "review_velocity",
      title: "Suspicious number of reviews",
      detail: "4,800 ratings for a product that's only been listed for 6 weeks.",
      severity: "high",
      source: "The reviews on the page",
      level: 1,
    },
  ],
  positives: [],
  language: "en",
  risk: {
    level: 4,
    key: "wont_arrive",
    label: "May not arrive, or may not be safe",
    because: [
      { type: "new_domain", level: 4, title: "Brand-new web shop" },
      { type: "review_velocity", level: 1, title: "Suspicious number of reviews" },
    ],
    combined: null,
    modifier: null,
    explanation: "Level 4 because: Brand-new web shop + Suspicious number of reviews.",
    source: "band",
  },
  // The result card (backend: the result card).
  next_step: { type: "junk_or_scam", text: "Better to buy this from a shop you know." },
  checklist: [
    { key: "who", label: "Who's behind the shop", status: "checked", note: "" },
    { key: "reviews", label: "Reviews", status: "concern", note: "Suspicious number of reviews" },
  ],
  checks_run: 12,
};

export const PAUSE = {
  reason: "spend_ceiling",
  retry_after_s: 86_400,
  quick_checks: true,
  message_key: "free_checks_run_on_donations",
  donate_url: "https://unfret.net/donate",
};

const BITS = 4;

function zeroBits(digest: Buffer): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte) return bits + Math.clz32(byte) - 24;
    bits += 8;
  }
  return bits;
}

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
  label: "Serious concerns",
  symbol: "✕",
  headline: "Several things on this page are typical of junk or dropshipped goods.",
  result: {
    verdict: {
      band: "warning",
      label: "Serious concerns",
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
  const issued = new Set<string>();
  let challenges = 0;
  const state = { mode: "ok" as MockMode };
  const server: Server = createServer((req, res) => {
    void (async () => {
      const auth = req.headers.authorization ?? "";
      const path = req.url ?? "";
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET, POST",
        });
        res.end();
        return;
      }
      const body = req.method === "POST" ? await readBody(req) : null;
      const language = req.headers["accept-language"];
      requests.push({ path, auth, body, ...(typeof language === "string" ? { language } : {}) });
      if (auth) {
        json(res, 400, { detail: "No Authorization here.", error_code: "AUTHORIZATION_NOT_ALLOWED" });
        return;
      }
      const paused = state.mode === "paused";
      if (path === "/v1/pricing") {
        json(res, 200, {
          free: {
            quick_checks: true,
            deep_checks: true,
            paused,
            ...(paused ? { pause: PAUSE } : {}),
            donate_url: "https://unfret.net/donate",
            checks_per_pass: 0,
          },
        });
        return;
      }
      if (path === "/v1/analyze/challenge") {
        challenges += 1;
        const challenge = `mock-${String(challenges)}.${BITS}`;
        issued.add(challenge);
        json(res, 200, {
          challenge,
          bits: BITS,
          expires_at: 4_102_444_800,
          paused,
          ...(paused ? { pause: PAUSE } : {}),
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
      if (path === "/v1/analyze/stream") {
        const sent = (body ?? {}) as {
          tier?: unknown;
          proof_of_work?: { challenge?: string; solution?: string };
        };
        const quick = sent.tier === "quick";
        if (!quick) {
          if (paused) {
            json(res, 429, {
              detail: "Free deep checks are paused until next month. Quick checks still work.",
              error_code: "FREE_CHECKS_PAUSED",
              metadata: PAUSE,
            });
            return;
          }
          if (state.mode === "off") {
            json(res, 503, { detail: "Not now.", error_code: "SERVICE_UNAVAILABLE" });
            return;
          }
          if (state.mode === "busy") {
            json(res, 429, {
              detail: "Too many.",
              error_code: "TOO_MANY_REQUESTS",
              metadata: { retry_after_s: 1200 },
            });
            return;
          }
          const proof = sent.proof_of_work;
          if (!proof?.challenge || proof.solution === undefined) {
            json(res, 428, { detail: "Proof of work required.", error_code: "PROOF_OF_WORK_REQUIRED" });
            return;
          }
          const digest = createHash("sha256").update(`${proof.challenge}:${proof.solution}`).digest();
          const spent = state.mode === "spent";
          if (spent) state.mode = "ok";
          if (spent || !issued.delete(proof.challenge) || zeroBits(digest) < BITS) {
            json(res, 400, { detail: "Bad challenge.", error_code: "BAD_CHALLENGE" });
            return;
          }
        }
        if (quick) {
          res.writeHead(200, { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" });
          res.end(
            "event: result\ndata: " +
              JSON.stringify({
                score: 40,
                explanation: "An inflated discount.",
                verdict: {
                  ...VERDICT,
                  band: "careful",
                  label: "Think twice",
                  risk: {
                    ...VERDICT.risk,
                    level: 1,
                    key: "manipulation",
                    label: "Pressure and tricks",
                    because: [VERDICT.risk.because[1]],
                    explanation: "Level 1 because: Suspicious number of reviews.",
                  },
                  deep_check: paused
                    ? {
                        suggested: true,
                        reason: "paused",
                        text: "A deep check also looks the shop up elsewhere.",
                        cost: "Free deep checks are paused until next month.",
                        action: "donate",
                        action_label: "Support Unfret",
                      }
                    : {
                        suggested: true,
                        reason: "signals",
                        text: "A deep check also looks the shop up elsewhere.",
                        cost: "Deep checks are free.",
                        action: "run_deep",
                        action_label: "Run a deep check",
                      },
                },
                charged: false,
                tier: "quick",
                label_token: "label-quick.mac",
              }) +
              "\n\n",
          );
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
        if (state.mode === "midway") {
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
              charged: false,
              free_check: true,
              charge_note: "Deep checks are free.",
              tier: "deep",
              verdict: VERDICT,
              label_token: "label-deep.mac",
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
  return {
    url: `http://127.0.0.1:${port}`,
    get mode() {
      return state.mode;
    },
    set mode(mode: MockMode) {
      state.mode = mode;
    },
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
