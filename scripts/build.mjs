// Build the extension from one source tree:
//   dist/chrome             Chromium, store variant (no update_url; Chrome Web Store if ever listed) + its zip
//   dist/chrome-selfhosted  Chromium, self-hosted variant: update_url on veridex.kroshtan.com and the public `key`,
//                           so the ID is the one the signed CRX has (needs release/public-key.b64, see crx-key.mjs)
//   dist/firefox            Firefox (built, not published) + its zip
//   node scripts/build.mjs          production (minified)
//   node scripts/build.mjs --dev    readable, with source maps
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { manifest as manifestFor } from "./manifest.mjs";
import { zipDirectory } from "./zip.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dev = process.argv.includes("--dev");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const PUBLIC_KEY_FILE = join(root, "release", "public-key.b64");

const entries = {
  background: "src/background/index.ts",
  extract: "src/content/extract-entry.ts",
  "connect-relay": "src/content/connect-relay.ts",
  "popup/popup": "src/popup/popup.ts",
  "options/options": "src/options/options.ts",
};
const statics = ["popup/popup.html", "popup/popup.css", "options/options.html", "shared/ui.css"];

function manifest(browser) {
  const publicKey =
    browser === "chrome-selfhosted" ? readFileSync(PUBLIC_KEY_FILE, "utf8").trim() : undefined;
  return manifestFor(browser, { version: pkg.version, description: pkg.description, publicKey });
}

async function buildFor(browser) {
  const out = join(root, "dist", browser);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, join(root, v)])),
    outdir: out,
    bundle: true,
    format: "iife",
    target: browser === "firefox" ? "firefox140" : "chrome116",
    minify: !dev,
    sourcemap: dev ? "inline" : false,
    legalComments: "none",
    logLevel: "warning",
  });
  for (const file of statics) cpSync(join(root, "src", file), join(out, file));
  cpSync(join(root, "src", "_locales"), join(out, "_locales"), { recursive: true });
  cpSync(join(root, "icons"), join(out, "icons"), { recursive: true });
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest(browser), null, 2) + "\n");
  // The self-hosted variant ships as a signed CRX (scripts/release.mjs), not a zip.
  if (!dev && browser !== "chrome-selfhosted") {
    zipDirectory(out, join(root, "dist", `veridex-${browser}-${pkg.version}.zip`));
  }
  console.log(`built dist/${browser}${dev ? " (dev)" : ""}`);
}

await buildFor("chrome");
if (existsSync(PUBLIC_KEY_FILE)) await buildFor("chrome-selfhosted");
else console.log("skipped dist/chrome-selfhosted: no release/public-key.b64 (run `make crx-key`)");
await buildFor("firefox");
