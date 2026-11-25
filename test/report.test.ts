// @vitest-environment node
/** "Wrong result?" (one flow) and the contributor key, against the mock API. */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type AnalysisResult, ApiError, UnfretApi } from "../src/api/client.js";
import { CONTRIBUTOR_KEY_RE, newContributorKey } from "../src/shared/contributor.js";
import {
  cleanLabel,
  MISSING_CHOICES,
  missingChoices,
  reportable,
  reportError,
  shownFindings,
} from "../src/shared/report.js";
import { CATALOGUE, type MockApi, startMockApi, VERDICT } from "./mock-server.js";

let api: MockApi;

beforeAll(async () => {
  api = await startMockApi();
});

afterAll(async () => {
  await api.close();
});

const BODY = {
  url: "https://www.amazon.com/dp/B0WATCH123",
  page_content: "NOVAXEL Smart Watch",
  proof_of_work: { challenge: "mock-1.4", solution: "7" },
};
const RESULT = {
  score: 18,
  explanation: "Generic product, inflated discount.",
  verdict: VERDICT,
  label_token: "label-deep.mac",
} as unknown as AnalysisResult;

describe("the contributor key", () => {
  it("is 32 random bytes in base64url without padding (43 characters), new each time", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newContributorKey()));
    expect(keys.size).toBe(50);
    for (const key of keys) {
      expect(key).toMatch(CONTRIBUTOR_KEY_RE);
      const bytes = Buffer.from(key, "base64url");
      expect(bytes).toHaveLength(32);
      expect(bytes.toString("base64url")).toBe(key);
    }
  });
});

describe("what a report offers and sends", () => {
  it("offers the findings behind the level and the card's reasons, once each, worst first", () => {
    expect(shownFindings(RESULT)).toEqual([
      { type: "new_domain", title: "Brand-new web shop" },
      { type: "review_velocity", title: "Suspicious number of reviews" },
    ]);
    // Offline: the short list, without what was shown (it can be wrong, not missing) and without payment modifiers.
    const missing = missingChoices(RESULT).map((c) => c.type);
    expect(missing).not.toContain("new_domain");
    expect(missing).not.toContain("irreversible_payment_only");
    expect(missing).toHaveLength(MISSING_CHOICES.length - 2);
    // The server's catalogue, when it could be read, in its order.
    expect(missingChoices(RESULT, CATALOGUE).map((c) => c.type)).toEqual([
      "mailbox_address",
      "claim_contradicted",
      "drip_pricing",
      "countdown",
    ]);
    expect(missingChoices(RESULT, []).length).toBe(missing.length); // an empty catalogue: the short list
  });

  it("reads the catalogue from the server, public and cached", async () => {
    expect(await new UnfretApi(api.url).findingsCatalogue()).toEqual(CATALOGUE);
    expect(api.requests.at(-1)).toMatchObject({ path: "/v1/catalogue/findings", auth: "" });
  });

  it("keeps only a level from 0 to 4, findings shown as wrong and choices not shown as missing", () => {
    expect(cleanLabel(RESULT, { level: 0 })).toEqual({ level: 0 });
    expect(
      cleanLabel(RESULT, {
        level: 7,
        wrong: ["new_domain", "made_up", "new_domain"],
        missing: ["drip_pricing", "new_domain", "made_up"],
      }),
    ).toEqual({ wrong: ["new_domain"], missing: ["drip_pricing", "made_up"] }); // the server's catalogue decides
    expect(cleanLabel(RESULT, { missing: ["Not a type!"], comment: "only words" })).toBeNull(); // a comment alone isn't a report
    expect(cleanLabel(RESULT, { level: 2, comment: `  ${"x".repeat(600)}  ` })).toEqual({
      level: 2,
      comment: "x".repeat(500),
    });
    expect(cleanLabel(RESULT, { level: 2, comment: "   " })).toEqual({ level: 2 });
    expect(cleanLabel(RESULT, { level: 2.5, wrong: ["made_up"] })).toBeNull();
    expect(cleanLabel(RESULT, {})).toBeNull();
  });

  it("is offered only with a label token, the request and a score", () => {
    expect(reportable(RESULT, true)).toBe(true);
    expect(reportable(RESULT, false)).toBe(false);
    expect(reportable({ ...RESULT, label_token: undefined } as unknown as AnalysisResult, true)).toBe(false);
    expect(reportable({ ...RESULT, score: -1 }, true)).toBe(false);
  });

  it("sends the token, the request as analysed without the proof of work, and no key unless it is on", async () => {
    const sent = await new UnfretApi(api.url).label(BODY, RESULT, { level: 1, wrong: ["new_domain"] });
    expect(sent).toEqual({ status: "queued", updated: false, anonymous: true });
    const request = api.requests.at(-1);
    expect(request?.path).toBe("/v1/labels");
    expect(request?.auth).toBe("");
    const { proof_of_work: _spent, ...page } = BODY;
    expect(_spent.solution).toBe("7");
    expect(request?.body).toEqual({
      label_token: "label-deep.mac",
      request: page,
      level: 1,
      wrong: ["new_domain"],
      explanation: RESULT.explanation,
      verdict: VERDICT,
    });

    const key = newContributorKey();
    await new UnfretApi(api.url).contributor(key);
    await new UnfretApi(api.url).label(
      BODY,
      RESULT,
      { missing: ["drip_pricing"], comment: "Paid, never came." },
      key,
    );
    expect(api.requests.at(-1)?.body).toMatchObject({
      contributor_key: key,
      missing: ["drip_pricing"],
      comment: "Paid, never came.",
    });
    expect(await new UnfretApi(api.url).contributor(key)).toMatchObject({ labels: 1 });
  });

  it("explains refusals in plain words", async () => {
    const again = await new UnfretApi(api.url).label(BODY, RESULT, { level: 4 }).catch((e: unknown) => e);
    expect(reportError(again)).toBe("You've already reported this result.");
    const old = await new UnfretApi(api.url)
      .label(BODY, { ...RESULT, label_token: "old" }, { level: 4 })
      .catch((e: unknown) => e);
    expect(reportError(old)).toBe("This check can't be reported any more; check the page again first.");
    expect(reportError(new ApiError(429, "LABEL_LIMIT", ""))).toMatch(/Thank you!/u);
    expect(reportError(new ApiError(503, "QUEUE_FULL", ""))).toMatch(/review queue is full/u);
    expect(reportError(new TypeError("Failed to fetch"))).toBe(
      "Couldn't reach Unfret. Check your connection.",
    );
  });
});

describe("contributor profiles and the leaderboard", () => {
  it("sets an opt-in handle, shows it on the leaderboard, and forgets the profile", async () => {
    const client = new UnfretApi(api.url);
    const key = newContributorKey();
    expect(await client.contributor(key)).toMatchObject({ handle: null, public: false });
    const taken = await client.contributor(key, { handle: "taken" }).catch((e: unknown) => e);
    expect((taken as ApiError).code).toBe("HANDLE_TAKEN");
    expect(await client.contributor(key, { handle: "sharp-eye", public: true })).toMatchObject({
      handle: "sharp-eye",
      public: true,
      rank: 1,
    });
    expect((await client.leaderboard()).map((e) => e.handle)).toContain("sharp-eye");
    expect(await client.forgetContributor(key)).toBe(true);
    expect((await client.leaderboard()).map((e) => e.handle)).not.toContain("sharp-eye");
  });
});
