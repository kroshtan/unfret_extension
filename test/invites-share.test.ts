// @vitest-environment node
/** 0.9.0: "Have an invite?" and "Share this result", against the mock API. */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type AnalysisResult, ApiError, UnfretApi } from "../src/api/client.js";
import { INVITE_RE, monthlyLimitMessage, normaliseInvite, redeemInvite } from "../src/shared/invites.js";
import { createShare, previewShare, shareError, shareRequest } from "../src/shared/share.js";
import {
  INVITE_MONTHLY_CODE,
  INVITE_NOT_NEW_CODE,
  INVITE_OK,
  INVITE_UNKNOWN_CODE,
  INVITE_USED_CODE,
  type MockApi,
  SHARE_DELETE_CODE,
  SHARE_ID,
  SHARE_PREVIEW,
  startMockApi,
} from "./mock-server.js";

let api: MockApi;

beforeAll(async () => {
  api = await startMockApi();
});

afterAll(async () => {
  await api.close();
});

const BODY = { url: "https://www.amazon.com/dp/B0WATCH123", page_content: "NOVAXEL Smart Watch" };
const RESULT: AnalysisResult = {
  score: 18,
  explanation: "Generic product, inflated discount.",
  assessment: { risk_score: 0.82, confidence: 0.64, model_version: "v1-test", flags: [] },
  verdict: { band: "junk_or_scam", label: "Serious concerns", headline: "x", reasons: [], positives: [] },
  balance_lamports: 6_000_000,
  charged: true,
  report_token: "report-token.mac",
  share_token: "share-token.mac",
};
const KEY = `ufk_abcdefghij_${"a".repeat(52)}`;

describe("invites", () => {
  it("recognises a code as typed (case, spaces) and nothing else", () => {
    expect(normaliseInvite(`  ${INVITE_OK.toUpperCase()} `)).toBe(INVITE_OK);
    expect(normaliseInvite("ufi_short")).toBeNull();
    expect(normaliseInvite(KEY)).toBeNull();
    expect(INVITE_RE.test(INVITE_OK)).toBe(true);
  });

  it("recognises intro codes such as FRIENDS, in any case", () => {
    expect(normaliseInvite(" friends ")).toBe("FRIENDS");
    expect(normaliseInvite("DEV")).toBe("DEV");
    expect(normaliseInvite("ab")).toBeNull(); // too short
    expect(normaliseInvite("free checks")).toBeNull();
  });

  it("redeems an intro code, and words the daily cap as the server does", async () => {
    expect(await redeemInvite(api.url, KEY, "friends")).toEqual({ ok: true, checksAdded: 5, checks: 5 });
    expect(api.requests.at(-1)).toMatchObject({ path: "/v1/invites/redeem", body: { code: "FRIENDS" } });
    const capped = await redeemInvite(api.url, KEY, "CAPPED");
    expect(capped).toEqual({
      ok: false,
      message: "Today's free checks from codes are gone: they're back tomorrow (UTC).",
      signedOut: false,
    });
  });

  it("refuses something that isn't a code without asking the server", async () => {
    const before = api.requests.length;
    expect(await redeemInvite(api.url, KEY, "not a code")).toEqual({
      ok: false,
      message: "That doesn't look like a gift code: they start with ufi_. Check it and try again.",
      signedOut: false,
    });
    expect(api.requests).toHaveLength(before);
  });

  it("redeems a code for the signed-in account, with its own sign-in", async () => {
    const outcome = await redeemInvite(api.url, KEY, ` ${INVITE_OK.toUpperCase()}`);
    expect(outcome).toEqual({ ok: true, checksAdded: 3, checks: 3 });
    const sent = api.requests.at(-1);
    expect(sent).toMatchObject({
      path: "/v1/invites/redeem",
      auth: `Bearer ${KEY}`,
      body: { code: INVITE_OK },
    });
  });

  it.each([
    [INVITE_USED_CODE, "This gift code has already been used."],
    [INVITE_UNKNOWN_CODE, "Unknown gift code."],
    [
      INVITE_NOT_NEW_CODE,
      "Intro codes are for new accounts: this one has had checks before, or used a code.",
    ],
  ])("shows the server's reason for a refused code (%s)", async (code, message) => {
    expect(await redeemInvite(api.url, KEY, code)).toEqual({ ok: false, message, signedOut: false });
  });

  it("one gift code a month: says when this one works again, or to give it away (429 INVITE_MONTHLY_LIMIT)", async () => {
    expect(await redeemInvite(api.url, KEY, INVITE_MONTHLY_CODE)).toEqual({
      ok: false,
      message:
        "You've already used a gift code this month; this one still works from December, or give it to someone else.",
      signedOut: false,
    });
    expect(await redeemInvite(api.url, KEY, "MONTHLYBARE")).toEqual({
      ok: false,
      message:
        "You've already used a gift code this month; this one still works next month, or give it to someone else.",
      signedOut: false,
    });
    expect(monthlyLimitMessage({ next_month: "2027-01-01" })).toContain("from January");
    for (const odd of [undefined, null, {}, { next_month: "soon" }, { next_month: "2027-13-01" }]) {
      expect(monthlyLimitMessage(odd)).toContain("still works next month");
    }
  });

  it("says so when the sign-in expired, and when the server can't be reached", async () => {
    const expired = await redeemInvite(api.url, "expired", INVITE_OK);
    expect(expired).toMatchObject({ ok: false, signedOut: true });
    expect(!expired.ok && expired.message).toMatch(/sign-in expired/u);
    const off = await redeemInvite(api.url, "off", INVITE_OK);
    expect(off).toMatchObject({
      ok: false,
      message: "Gift codes aren't available right now. Please try again later.",
    });
    const offline = await redeemInvite("http://127.0.0.1:9", KEY, INVITE_OK);
    expect(offline).toMatchObject({ ok: false, message: "Couldn't reach Unfret. Check your connection." });
  });
});

describe("sharing a result", () => {
  it("is offered only for a result with a share token and the analysed request", () => {
    expect(shareRequest(BODY, RESULT)).toEqual({
      share_token: "share-token.mac",
      url: BODY.url,
      // Exactly the fields the token covers, as they came back: no balance, charge or report token.
      result: {
        score: 18,
        explanation: RESULT.explanation,
        assessment: RESULT.assessment,
        verdict: RESULT.verdict,
      },
    });
    const { share_token: token, ...unshareable } = RESULT;
    expect(token).toBe("share-token.mac");
    expect(shareRequest(BODY, unshareable)).toBeNull();
    expect(shareRequest(undefined, RESULT)).toBeNull();
  });

  it("previews, then shares, both without the sign-in", async () => {
    const request = shareRequest(BODY, RESULT);
    if (!request) throw new Error("not shareable");
    // Even a client made with a session token sends none for a share.
    const client = new UnfretApi(api.url, KEY);
    const preview = await previewShare(client, request);
    expect(preview).toEqual({ status: "preview", preview: SHARE_PREVIEW });
    expect(api.requests.at(-1)).toMatchObject({ path: "/v1/shares/preview", auth: "", body: request });

    if (preview.status !== "preview") throw new Error("no preview");
    const shared = await createShare(client, api.url, request, preview.preview);
    expect(shared).toEqual({
      status: "shared",
      link: `${api.url}/r/${SHARE_ID}`,
      deleteCode: SHARE_DELETE_CODE,
      expiresAt: "2027-02-08T12:00:00Z",
    });
    expect(api.requests.at(-1)).toMatchObject({ path: "/v1/shares", auth: "", body: request });
  });

  it("explains refusals in plain words; a failed share keeps the preview to try again", async () => {
    const client = new UnfretApi(api.url);
    const request = shareRequest(BODY, RESULT);
    if (!request) throw new Error("not shareable");
    expect(await previewShare(client, { ...request, share_token: "expired.mac" })).toEqual({
      status: "error",
      message: "This check is too old to share; check the page again first.",
    });
    expect(await previewShare(client, { ...request, share_token: "forged" })).toEqual({
      status: "error",
      message: "This result can't be shared; check the page again first.",
    });
    const busy = { ...request, url: "https://busy.example/p" };
    expect(await createShare(client, api.url, busy, SHARE_PREVIEW)).toEqual({
      status: "error",
      message: "Too many shares from here for now; please try again later.",
      preview: SHARE_PREVIEW,
    });
    expect(shareError(new ApiError(422, "CHECKOUT_NOT_SHAREABLE", "x"))).toBe(
      "A check that included a checkout page can't be shared.",
    );
    expect(shareError(new ApiError(503, "SERVICE_UNAVAILABLE", "x"))).toBe(
      "Sharing isn't available right now. Please try again later.",
    );
    expect(shareError(new TypeError("Failed to fetch"))).toBe(
      "Couldn't reach Unfret. Check your connection.",
    );
  });

  it("refuses a shared link that isn't a page on the API's own site", async () => {
    const fake = (link: string): UnfretApi =>
      new UnfretApi("https://unfret.net", undefined, () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ id: "x", link, delete_code: "c", expires_at: "2027-01-01T00:00:00Z" }),
            {
              status: 201,
            },
          ),
        ),
      );
    const request = shareRequest(BODY, RESULT);
    if (!request) throw new Error("not shareable");
    for (const link of ["https://evil.example/r/x", "//evil.example/r/x", "/r/../v1/credits"]) {
      await expect(fake(link).createShare(request)).rejects.toMatchObject({ code: "BAD_SHARE" });
    }
    await expect(fake("/r/abc").createShare(request)).resolves.toMatchObject({ link: "/r/abc" });
  });
});
