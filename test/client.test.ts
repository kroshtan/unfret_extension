// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiError, type StreamEvent, VeridexApi } from "../src/api/client.js";
import { type MockApi, startMockApi } from "./mock-server.js";

let api: MockApi;

beforeAll(async () => {
  api = await startMockApi();
});

afterAll(async () => {
  await api.close();
});

async function collect(client: VeridexApi): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of client.analyze({
    url: "https://www.amazon.com/dp/B0TEST1234",
    page_content: "x",
  })) {
    events.push(event);
  }
  return events;
}

describe("VeridexApi against a mock server", () => {
  it("reads pricing and credits", async () => {
    const client = new VeridexApi(api.url, "good");
    expect((await client.pricing()).hot_wallet).toMatch(/^HotWa11et/u);
    expect(await client.credits()).toMatchObject({ checks_remaining: 5, balance_lamports: 7_500_000 });
    expect(api.requests.at(-1)?.auth).toBe("Bearer good");
  });

  it("streams progress, then the result (step and finding events, CRLF, comments)", async () => {
    const events = await collect(new VeridexApi(api.url, "good"));

    expect(events.map((e) => e.kind)).toEqual(["page_type", "finding", "finding", "result"]);
    expect(events[1]).toEqual({
      kind: "finding",
      finding: { skill: "listing", type: "discount", evidence: "85% off." },
    });
    expect(events[2]).toMatchObject({ finding: { skill: "reviews", evidence: "4,800 reviews in 6 weeks." } });
    const last = events.at(-1);
    expect(last?.kind === "result" && last.result.assessment?.model_version).toBe("v1-test");
    expect(api.requests.at(-1)?.body).toMatchObject({ url: "https://www.amazon.com/dp/B0TEST1234" });
  });

  it("maps 401 to sign in again", async () => {
    const error = await collect(new VeridexApi(api.url, "expired")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).needsSignIn).toBe(true);
    expect((error as ApiError).message).toBe("Sign in again.");
  });

  it("maps 402 to buy checks, with the metadata", async () => {
    const error = (await collect(new VeridexApi(api.url, "broke")).catch((e: unknown) => e)) as ApiError;
    expect(error.needsCredits).toBe(true);
    expect(error.code).toBe("INSUFFICIENT_CREDITS");
    expect(error.metadata).toEqual({ balance_lamports: 0, analysis_lamports: 1_500_000 });
  });

  it("maps 503 to service off", async () => {
    const error = (await new VeridexApi(api.url, "off").credits().catch((e: unknown) => e)) as ApiError;
    expect(error.serviceOff).toBe(true);
  });

  it("turns an error event mid-stream into an ApiError", async () => {
    const error = (await collect(new VeridexApi(api.url, "midway")).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("GATEWAY_TIMEOUT");
    expect(error.message).toBe("Analysis took too long.");
  });

  it("reports a non-JSON error body by status", async () => {
    const fetcher = () => Promise.resolve(new Response("<html>bad gateway</html>", { status: 502 }));
    const error = (await new VeridexApi("https://x.test", "t", fetcher)
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
    const client = new VeridexApi("https://x.test", "t", fetcher);
    const error = (await collect(client).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("STREAM_ENDED");
  });
});
