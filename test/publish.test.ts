// @vitest-environment node
// Publishing Unfret Dev from CI: its build-numbered version and the hand-over into the backend's release directory.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { devVersion, versionFor } from "../scripts/channels.mjs";
import { publishDev, releaseDir } from "../scripts/publish-dev.mjs";

const temp: string[] = [];
afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function dir(files: Record<string, string> = {}): string {
  const path = mkdtempSync(join(tmpdir(), "unfret-publish-"));
  temp.push(path);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(path, name), content);
  return path;
}

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

describe("Unfret Dev version", () => {
  it("is package.json's without a build number, and gets it as a fourth part", () => {
    expect(devVersion("0.8.3", undefined)).toBe("0.8.3");
    expect(devVersion("0.8.3", "")).toBe("0.8.3");
    expect(devVersion("0.8.3", "42")).toBe("0.8.3.42");
    expect(devVersion("0.8.3", "007")).toBe("0.8.3.7");
  });

  it("refuses what Chromium wouldn't take", () => {
    expect(() => devVersion("0.8.3", "65536")).toThrow(/0 to 65535/u);
    expect(() => devVersion("0.8.3", "4a")).toThrow(/0 to 65535/u);
    expect(() => devVersion("0.8.3.1", "2")).toThrow(/build number/u);
  });

  it("applies to Unfret Dev only", () => {
    expect(versionFor("chrome", "0.8.3")).toBe("0.8.3");
    expect(versionFor("chrome-selfhosted", "0.8.3")).toBe("0.8.3");
  });
});

describe("publishing into the backend", () => {
  it("finds src/<package>/static/extension whatever the package is called", () => {
    const backend = dir();
    mkdirSync(join(backend, "src", "unfret", "static", "extension"), { recursive: true });
    mkdirSync(join(backend, "src", "other"), { recursive: true });
    expect(releaseDir(backend)).toBe(join(backend, "src", "unfret", "static", "extension"));
  });

  it("replaces the dev files and their checksums, and leaves production's alone", () => {
    const prodSums = `${sha("prod")}  unfret-0.8.3.crx\n${sha("xml")}  updates.xml\n`;
    const backend = dir({
      "unfret-0.8.3.crx": "prod",
      "updates.xml": "xml",
      "unfret-dev-0.8.3.crx": "old dev",
      "updates-dev.xml": "old dev xml",
      SHA256SUMS: `${prodSums}${sha("old dev")}  unfret-dev-0.8.3.crx\n${sha("old dev xml")}  updates-dev.xml\n`,
    });
    const release = dir({
      "unfret-dev-0.8.3.42.crx": "new dev",
      "updates-dev.xml": "new dev xml",
      SHA256SUMS: "ignored",
    });

    expect(publishDev(release, backend)).toBe("unfret-dev-0.8.3.42.crx");

    expect(readdirSync(backend).sort()).toEqual([
      "SHA256SUMS",
      "unfret-0.8.3.crx",
      "unfret-dev-0.8.3.42.crx",
      "updates-dev.xml",
      "updates.xml",
    ]);
    expect(readFileSync(join(backend, "updates-dev.xml"), "utf8")).toBe("new dev xml");
    expect(readFileSync(join(backend, "SHA256SUMS"), "utf8")).toBe(
      `${prodSums}${sha("new dev")}  unfret-dev-0.8.3.42.crx\n${sha("new dev xml")}  updates-dev.xml\n`,
    );
  });
});
