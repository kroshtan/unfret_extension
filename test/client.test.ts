// @vitest-environment node
import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiError, type StreamEvent, UnfretApi } from "../src/api/client.js";
import { PowAborted, solve } from "../src/shared/pow.js";
import { type MockApi, startMockApi } from "./mock-server.js";

let api: MockApi;

beforeAll(async () => {
  api = await startMockApi();
});

afterAll(async () => {
  await api.close();
});

async function collect(client: UnfretApi): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of client.analyze({
    url: "https://www.amazon.com/dp/B0TEST1234",
    page_content: "x",
  })) {
    events.push(event);
  }
  return events;
}

describe("UnfretApi against a mock server", () => {
  it("reads whether free deep checks are paused, with no Authorization", async () => {
    api.mode = "ok";
    expect((await new UnfretApi(api.url).pricing()).free?.paused).toBe(false);
    api.mode = "paused";
    expect((await new UnfretApi(api.url).pricing()).free).toMatchObject({
      paused: true,
      pause: { message_key: "free_checks_run_on_donations" },
    });
    api.mode = "ok";
    expect(api.requests.every((r) => r.auth === "")).toBe(true);
  });

  it("gets a challenge, and a deep check with its solution goes through", async () => {
    const client = new UnfretApi(api.url);
    const challenge = await client.challenge();
    expect(challenge).toMatchObject({ bits: 4, paused: false });
    const solution = await solve(challenge.challenge, challenge.bits);
    const events: StreamEvent[] = [];
    for await (const event of client.analyze({
      url: "https://www.amazon.com/dp/B0TEST1234",
      proof_of_work: { challenge: challenge.challenge, solution },
    }))
      events.push(event);
    const last = events.at(-1);
    expect(last?.kind === "result" && last.result.free_check).toBe(true);
    expect(last?.kind === "result" && last.result.label_token).toBe("label-deep.mac");
  });

  it("maps 428 without a proof of work, and the pause, the network limit and 503", async () => {
    const missing = (await collect(new UnfretApi(api.url)).catch((e: unknown) => e)) as ApiError;
    expect([missing.status, missing.code, missing.needsProof]).toEqual([428, "PROOF_OF_WORK_REQUIRED", true]);
    api.mode = "paused";
    const paused = (await collect(new UnfretApi(api.url)).catch((e: unknown) => e)) as ApiError;
    expect(paused.freePaused).toBe(true);
    expect(paused.metadata).toMatchObject({ donate_url: "https://unfret.net/donate" });
    api.mode = "busy";
    const busy = (await collect(new UnfretApi(api.url)).catch((e: unknown) => e)) as ApiError;
    expect([busy.code, busy.retryAfterS]).toEqual(["TOO_MANY_REQUESTS", 1200]);
    api.mode = "off";
    const off = (await collect(new UnfretApi(api.url)).catch((e: unknown) => e)) as ApiError;
    expect(off.serviceOff).toBe(true);
    api.mode = "ok";
  });

  it("streams progress, then the result (step and finding events, CRLF, comments)", async () => {
    const client = new UnfretApi(api.url);
    const challenge = await client.challenge();
    const events: StreamEvent[] = [];
    for await (const event of client.analyze({
      url: "https://www.amazon.com/dp/B0TEST1234",
      page_content: "x",
      proof_of_work: { challenge: challenge.challenge, solution: await solve(challenge.challenge, 4) },
    }))
      events.push(event);

    expect(events.map((e) => e.kind)).toEqual(["page_type", "step", "finding", "finding", "result"]);
    expect(events[1]).toEqual({ kind: "step", skill: "listing" }); // ticks the checklist even without findings
    expect(events[2]).toEqual({
      kind: "finding",
      finding: { skill: "listing", type: "discount", evidence: "85% off." },
    });
    expect(events[3]).toMatchObject({ finding: { skill: "reviews", evidence: "4,800 reviews in 6 weeks." } });
    const last = events.at(-1);
    expect(last?.kind === "result" && last.result.assessment?.model_version).toBe("v1-test");
    expect(api.requests.at(-1)?.body).toMatchObject({ url: "https://www.amazon.com/dp/B0TEST1234" });
  });

  it("asks for English, whatever the browser's language (the extension is in English)", async () => {
    await new UnfretApi(api.url).pricing();
    expect(api.requests.at(-1)?.language).toBe("en");
    await collect(new UnfretApi(api.url)).catch(() => undefined);
    expect(api.requests.at(-1)?.language).toBe("en");
  });

  it("turns an error event mid-stream into an ApiError", async () => {
    api.mode = "midway";
    const client = new UnfretApi(api.url);
    const challenge = await client.challenge();
    const seen: StreamEvent[] = [];
    const error = (await (async () => {
      for await (const event of client.analyze({
        url: "https://www.amazon.com/dp/B0TEST1234",
        proof_of_work: { challenge: challenge.challenge, solution: await solve(challenge.challenge, 4) },
      }))
        seen.push(event);
    })().catch((e: unknown) => e)) as ApiError;
    expect(seen.map((e) => e.kind)).not.toContain("result");
    api.mode = "ok";
    expect(error.code).toBe("GATEWAY_TIMEOUT");
    expect(error.message).toBe("Analysis took too long.");
  });

  it("reports a non-JSON error body by status", async () => {
    const fetcher = () => Promise.resolve(new Response("<html>bad gateway</html>", { status: 502 }));
    const error = (await new UnfretApi("https://x.test", fetcher)
      .pricing()
      .catch((e: unknown) => e)) as ApiError;
    expect([error.status, error.code, error.message]).toEqual([502, "HTTP_502", "HTTP 502"]);
  });

  it("fails clearly when the stream ends without a result", async () => {
    const fetcher = () =>
      Promise.resolve(
        new Response('event: finding\ndata: {"skill": "a", "evidence": "b"}\n\n', {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    const client = new UnfretApi("https://x.test", fetcher);
    const error = (await collect(client).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("STREAM_ENDED");
  });
});

describe("the proof of work", () => {
  it("finds the same first counter as the server's check (SHA-256, leading zero bits)", async () => {
    for (const [challenge, bits] of [
      ["mock-1.4", 4],
      ["x".repeat(61), 12], // a counter that crosses into a second block
      ["1795611869.c6195c1e44c9eeb2.20.5ed127a3bb7cd7d463a8a5fd74c745ba", 16],
    ] as const) {
      const solution = await solve(challenge, bits);
      let first = 0;
      while (
        zeroBits(
          createHash("sha256")
            .update(`${challenge}:${String(first)}`)
            .digest(),
        ) < bits
      )
        first++;
      expect(solution).toBe(String(first));
    }
  });

  it("stops when asked", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(solve("never", 40, { signal: abort.signal })).rejects.toBeInstanceOf(PowAborted);
  });
});

function zeroBits(digest: Buffer): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte) return bits + Math.clz32(byte) - 24;
    bits += 8;
  }
  return bits;
}
