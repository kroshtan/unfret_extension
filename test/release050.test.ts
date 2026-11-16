/** 0.5.0: Shopify compare-at bound to the variant, the consent screen, the timer wait and the dev server. */

import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LOCAL_PERMISSIONS, manifest } from "../scripts/manifest.mjs";
import { shopifyCompareAt } from "../src/extract/generic.js";
import { TIMER_WAIT_MS } from "../src/extract/index.js";
import {
  CONSENT_VERSION,
  consentGiven,
  DEFAULT_API_BASE,
  giveConsent,
  isDevBase,
  PRIVACY_URL,
} from "../src/shared/settings.js";

describe("Shopify compare-at (same cases as the backend's shopify_compare_at)", () => {
  const variants =
    '{"variants":[{"id":40000000001,"price":2495,"compare_at_price":7995},' +
    '{"id":40000000002,"price":3495,"compare_at_price":3995}]}';

  it("binds to the variant on show", () => {
    expect(shopifyCompareAt(variants, 24.95)).toBe(79.95);
    expect(shopifyCompareAt(variants, 34.95, "https://s.test/p?variant=40000000002")).toBe(39.95);
    expect(shopifyCompareAt(variants, 19)).toBeNull();
  });

  it("reads integers as cents, never as whole units", () => {
    expect(shopifyCompareAt('{"price":2495,"compare_at_price":2000}', 24.95)).toBeNull();
    expect(shopifyCompareAt('{"price":"24.95","compare_at_price":"39.95"}', 24.95)).toBe(39.95);
  });
});

describe("consent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubStorage(): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: (key: string) => Promise.resolve(key in data ? { [key]: data[key] } : {}),
          set: (items: Record<string, unknown>) => {
            Object.assign(data, items);
            return Promise.resolve();
          },
        },
      },
    });
    return data;
  }

  it("is remembered with its version, and an older version asks again", async () => {
    const data = stubStorage();
    expect(await consentGiven()).toBe(false);
    await giveConsent();
    expect(data.consent).toEqual({ version: CONSENT_VERSION });
    expect(await consentGiven()).toBe(true);
    data.consent = { version: CONSENT_VERSION - 1 };
    expect(await consentGiven()).toBe(false);
  });

  it("the three panels say what is sent, to whom and for how long", () => {
    const popup = new DOMParser().parseFromString(readFileSync("src/popup/popup.html", "utf8"), "text/html");
    const panels = [...popup.querySelectorAll<HTMLElement>("#consent p.small")].map((p) =>
      p.textContent.trim(),
    );
    expect(panels[0]).toMatch(/^Unfret checks product pages/u);
    expect(panels[1]).toContain("unfret.net");
    expect(panels[1]).toContain("90");
    expect(panels[2]).toMatch(/never a private seller's name/u);
    expect(panels[3]).toMatch(/prepaid checks/u);
    expect(popup.querySelector("#consent-agree")?.textContent).toBe("I agree");
    expect(PRIVACY_URL).toBe("https://unfret.net/privacy");
  });

  it("the popup keeps Analyse disabled until consent", () => {
    const popup = readFileSync("src/popup/popup.ts", "utf8");
    expect(popup).toContain("busy || !consented || !session");
    const background = readFileSync("src/background/index.ts", "utf8");
    expect(background).toContain("if (!(await consentGiven()))");
  });
});

describe("timers and hosts", () => {
  it("watches countdowns for 1.2 s", () => {
    expect(TIMER_WAIT_MS).toBe(1_200);
  });

  it("production never reaches the dev deployment (that is Unfret Dev's job); a local server stays optional", () => {
    const m = manifest("chrome", { version: "0.5.0", description: "x" }) as {
      optional_host_permissions: string[];
      content_security_policy: { extension_pages: string };
    };
    expect(m.optional_host_permissions).toEqual(LOCAL_PERMISSIONS);
    expect(m.content_security_policy.extension_pages).not.toContain("dev.unfret");
    expect(DEFAULT_API_BASE).toBe("https://unfret.net");
    expect(isDevBase("http://localhost:8080")).toBe(true);
    expect(isDevBase(DEFAULT_API_BASE)).toBe(false);
  });
});
