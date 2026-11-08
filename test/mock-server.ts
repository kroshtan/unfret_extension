/**
 * A small mock of the Veridex API (contract v1) for tests and the smoke run: pricing, credits, and a streamed
 * analysis that records the request it got. Behaviour per bearer token: "expired" → 401, "broke" → 402,
 * "off" → 503, "midway" → stream error event, anything else → a normal result.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockApi {
  url: string;
  requests: { path: string; auth: string; body: unknown }[];
  close(): Promise<void>;
}

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
  const server: Server = createServer((req, res) => {
    void (async () => {
      const auth = req.headers.authorization ?? "";
      const token = auth.replace(/^Bearer /u, "");
      const path = req.url ?? "";
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Allow-Methods": "GET, POST",
        });
        res.end();
        return;
      }
      const body = req.method === "POST" ? await readBody(req) : null;
      requests.push({ path, auth, body });
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
          trial_checks: 5,
        });
        return;
      }
      if (path === "/v1/credits") {
        json(res, 200, {
          address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
          balance_lamports: 7_500_000,
          checks_remaining: 5,
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
