/**
 * Minimal permissions (0.3.0): no standing access to any shop. Pages are read through activeTab on the user's click,
 * the marketplace hint is a declarativeContent rule, and an update from 0.2.0 must not add any permission that
 * carries an install warning (Chromium would disable the extension pending approval).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { manifest } from "../scripts/manifest.mjs";
import { extractFromTab } from "../src/background/inject.js";
import sites from "../src/shared/sites.json";
import { isMarketplaceProduct, marketplaceUrlPatterns } from "../src/shared/sites.js";

const options = { version: "0.3.0", description: "test", publicKey: "PUBLICKEY" };

// None of these has a message rule in Chromium's chrome_permission_message_rules.cc, so none shows a warning.
const WARNING_FREE = new Set(["activeTab", "storage", "scripting", "declarativeContent"]);

describe("manifest permissions", () => {
  it.each(["chrome", "chrome-selfhosted"] as const)("%s: activeTab, no host permissions", (browser) => {
    const m = manifest(browser, options);
    expect(m.permissions).toEqual(["activeTab", "storage", "scripting", "declarativeContent"]);
    expect(m).not.toHaveProperty("host_permissions");
    expect(m.optional_host_permissions).toEqual(["http://localhost/*", "http://127.0.0.1/*"]);
    // No content scripts (0.14.0): with no account, no Unfret page hands the extension anything.
    expect(m).not.toHaveProperty("content_scripts");
  });

  it("firefox: no declarativeContent, no host permissions", () => {
    const m = manifest("firefox", options);
    expect(m.permissions).toEqual(["activeTab", "storage", "scripting"]);
    expect(m).not.toHaveProperty("host_permissions");
  });

  it("adds no warning-bearing permission over 0.2.0", () => {
    const before = new Set(["activeTab", "storage", "scripting"]);
    const after = manifest("chrome-selfhosted", options) as { permissions: string[] };
    const added = after.permissions.filter((p) => !before.has(p));
    expect(added).toEqual(["declarativeContent"]);
    expect(added.every((p) => WARNING_FREE.has(p))).toBe(true);
    // Host access only shrinks: 0.2.0 held every marketplace plus the API; 0.3.0 only the sign-in page's site.
  });

  it("the self-hosted build carries the update URL and key", () => {
    const m = manifest("chrome-selfhosted", options);
    expect(m.update_url).toBe("https://unfret.net/extension/updates.xml");
    expect(m.key).toBe("PUBLICKEY");
  });

  it("Unfret Dev is its own extension, on the dev deployment only", () => {
    const m = manifest("chrome-dev", { ...options, publicKey: "DEVKEY" }) as Record<string, unknown> & {
      action: { default_title: string };
      content_security_policy: { extension_pages: string };
      permissions: string[];
    };
    expect(m.name).toBe("Unfret Dev");
    expect(m.action.default_title).toBe("Unfret Dev");
    expect(m.key).toBe("DEVKEY");
    expect(m.update_url).toBe("https://dev.unfret.net/extension/updates-dev.xml");
    expect(m).not.toHaveProperty("content_scripts");
    expect(m.content_security_policy.extension_pages).toContain("connect-src https://dev.unfret.net ");
    expect(m.content_security_policy.extension_pages).not.toContain("https://unfret.net");
    expect(m.permissions).toEqual(manifest("chrome-selfhosted", options).permissions);
  });
});

describe("marketplace hint patterns", () => {
  it.each([
    ["https://www.amazon.com/dp/B0WATCH123", true],
    ["https://www.amazon.de/Some-Title/dp/B0TEST1234/ref=sr_1_1?keywords=x", true],
    ["https://www.amazon.co.jp/gp/product/B0TEST1234", true],
    ["https://smile.amazon.co.uk/gp/aw/d/B0TEST1234", true],
    ["https://amazon.nl/dp/B0TEST1234", true],
    ["https://www.bol.com/nl/nl/p/koffiezetapparaat/9300000012345678/", true],
    ["https://www.amazon.com/s?k=earbuds", false],
    ["https://www.amazon.com/s?k=dp/B0TEST1234", false],
    ["https://notamazon.com/dp/B0TEST1234", false],
    ["https://www.amazon.com.evil.example/dp/B0TEST1234", false],
    ["https://www.bol.com/nl/nl/l/koffie/123/", false],
    ["https://shop.example/dp/B0TEST1234", false],
  ])("%s → %s", (url, expected) => {
    expect(isMarketplaceProduct(url)).toBe(expected);
  });

  it("covers every supported domain", () => {
    for (const domain of sites.amazon) {
      expect(isMarketplaceProduct(`https://www.${domain}/dp/B0TEST1234`)).toBe(true);
    }
  });

  it("stays within RE2 syntax (no lookaround or backreferences)", () => {
    for (const pattern of marketplaceUrlPatterns()) {
      expect(pattern).not.toMatch(/\(\?[=!<]|\\[1-9]/u);
      expect(pattern.startsWith("^https?://")).toBe(true);
    }
  });
});

describe("analysis reads the page only on the user's click", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("injects the extractor into that tab, then reads its result", async () => {
    const calls: unknown[] = [];
    const facts = { url: "https://shop.example/p/1" };
    vi.stubGlobal("chrome", {
      scripting: {
        executeScript: vi.fn((injection: { files?: string[] }) => {
          calls.push(injection);
          return Promise.resolve(injection.files ? [] : [{ result: { facts, text: "hello" } }]);
        }),
      },
    });

    await expect(extractFromTab(7)).resolves.toEqual({ facts, text: "hello" });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ target: { tabId: 7 }, files: ["extract.js"] });
    expect(calls[1]).toMatchObject({ target: { tabId: 7 } });
  });

  it("reports a page it couldn't read", async () => {
    vi.stubGlobal("chrome", { scripting: { executeScript: vi.fn(() => Promise.resolve([])) } });
    await expect(extractFromTab(7)).rejects.toThrow("Couldn't read this page.");
  });
});
