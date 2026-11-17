/** 0.11.0: "Have a code?" opens the website's one-step code checkout; the consent screen asks again, keeping sign-in. */

import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CODE_CHECKOUT } from "../src/shared/invites.js";
import { CONSENT_VERSION, consentGiven, giveConsent, loadSettings } from "../src/shared/settings.js";

function page(path: string): Document {
  return new DOMParser().parseFromString(readFileSync(path, "utf8"), "text/html");
}

describe("Have a code?", () => {
  it("is the website's code checkout, on the API base in use (Unfret Dev: the dev deployment)", () => {
    expect(CODE_CHECKOUT).toBe("/checkout?mode=code");
    const popup = readFileSync("src/popup/popup.ts", "utf8");
    expect(popup).toContain("openTab(CODE_CHECKOUT)");
    expect(popup).toContain('show("have-code-row", !session)');
    const options = readFileSync("src/options/options.ts", "utf8");
    expect(options).toContain("`${apiBase}${CODE_CHECKOUT}`");
    expect(options).toContain('el("have-code-row").hidden = Boolean(session)');
  });

  it("is offered when signed out, next to the in-extension redemption", () => {
    // 0.12.0: in the popup, a small link for a friend's gift code (intro codes are retired; free checks come first).
    expect(page("src/popup/popup.html").querySelector("#have-code")?.textContent.trim()).toBe(
      "Have a gift code from a friend?",
    );
    expect(page("src/options/options.html").querySelector("#have-code")?.textContent.trim()).toBe(
      "Have a code?",
    );
    for (const path of ["src/popup/popup.html", "src/options/options.html"]) {
      const doc = page(path);
      expect(doc.querySelector("#have-code-row")?.hasAttribute("hidden")).toBe(true); // until the account is known
      expect(doc.querySelector("#invite-input")).not.toBeNull();
    }
    expect(page("src/popup/popup.html").querySelector("#key-code")?.textContent).toBe(
      "Use it on the website",
    );
  });
});

describe("consent version 2", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks someone who agreed to version 1 again, and keeps their sign-in", async () => {
    const session = {
      token: "ufk_abcdefghij_" + "a".repeat(52),
      address: "key:abcdefghij",
      expiresAt: "9999-12-31T00:00:00.000Z",
      kind: "key",
    };
    const data: Record<string, unknown> = { consent: { version: 1 }, session, apiBase: "https://unfret.net" };
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: (keys: string | string[]) =>
            Promise.resolve(
              Object.fromEntries(
                (Array.isArray(keys) ? keys : [keys]).filter((k) => k in data).map((k) => [k, data[k]]),
              ),
            ),
          set: (items: Record<string, unknown>) => {
            Object.assign(data, items);
            return Promise.resolve();
          },
        },
      },
    });
    expect(CONSENT_VERSION).toBe(2);
    expect(await consentGiven()).toBe(false);
    await giveConsent();
    expect(await consentGiven()).toBe(true);
    expect((await loadSettings()).session).toEqual(session);
  });
});
