/** 0.5.0: Shopify compare-at bound to the variant, the consent screen, the timer wait and the dev server. */

import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEV_PERMISSIONS, manifest } from "../scripts/manifest.mjs";
import { shopifyCompareAt } from "../src/extract/generic.js";
import { TIMER_WAIT_MS } from "../src/extract/index.js";
import { t } from "../src/shared/i18n.js";
import {
  CONSENT_VERSION,
  consentGiven,
  DEFAULT_API_BASE,
  DEV_API_BASE,
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

  it.each(["en", "nl"] as const)(
    "%s: the three panels say what is sent, to whom and for how long",
    (lang) => {
      const sent = t("consent_sent_body", [], lang);
      expect(sent).toContain("unfret.kroshtan.com");
      expect(sent).toContain("90");
      for (const key of [
        "consent_what_body",
        "consent_pay_body",
        "consent_agree",
        "consent_privacy",
      ] as const) {
        expect(t(key, [], lang)).not.toBe(key);
      }
      expect(PRIVACY_URL).toBe("https://unfret.kroshtan.com/privacy");
    },
  );

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

  it("the dev server is an optional permission, reachable from the extension pages", () => {
    const m = manifest("chrome", { version: "0.5.0", description: "x" }) as {
      optional_host_permissions: string[];
      content_security_policy: { extension_pages: string };
    };
    expect(DEV_PERMISSIONS[0]).toBe(`${DEV_API_BASE}/*`);
    expect(m.optional_host_permissions).toContain("https://dev.unfret.kroshtan.com/*");
    expect(m.content_security_policy.extension_pages).toContain(DEV_API_BASE);
    expect(DEFAULT_API_BASE).toBe("https://unfret.kroshtan.com");
    expect(isDevBase(DEV_API_BASE)).toBe(true);
  });
});
