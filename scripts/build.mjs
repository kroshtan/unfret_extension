// Build the extension from one source tree:
//   dist/chrome             Chromium, store variant (no update_url; Chrome Web Store if ever listed) + its zip
//   dist/chrome-selfhosted  Chromium, self-hosted variant: update_url on unfret.net and the public `key`,
//                           so the ID is the one the signed CRX has (needs release/public-key.b64, see crx-key.mjs)
//   dist/chrome-dev         "Unfret Dev": its own key and ID, grey DEV icon, update_url and API on the dev deployment
//                           (needs release/dev-public-key.b64, `node scripts/crx-key.mjs --dev`); its version is
//                           package.json's, or x.y.z.N with $UNFRET_DEV_BUILD=N (CI's run number, channels.mjs)
//   dist/firefox            Firefox (built, not published) + its zip
//   node scripts/build.mjs          production (minified)
//   node scripts/build.mjs --dev    readable, with source maps
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { CHANNELS, versionFor } from "./channels.mjs";
import { apiOrigin, manifest as manifestFor } from "./manifest.mjs";
import { zipDirectory } from "./zip.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dev = process.argv.includes("--dev");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const PUBLIC_KEY_FILE = {
  "chrome-selfhosted": CHANNELS.production.publicKeyFile,
  "chrome-dev": CHANNELS.dev.publicKeyFile,
};

const entries = {
  background: "src/background/index.ts",
  extract: "src/content/extract-entry.ts",
  "connect-relay": "src/content/connect-relay.ts",
  "key-relay": "src/content/key-relay.ts",
  "popup/popup": "src/popup/popup.ts",
  "options/options": "src/options/options.ts",
};
const statics = ["popup/popup.html", "popup/popup.css", "options/options.html", "shared/ui.css"];

function manifest(browser) {
  const keyFile = PUBLIC_KEY_FILE[browser];
  const publicKey = keyFile ? readFileSync(keyFile, "utf8").trim() : undefined;
  return manifestFor(browser, {
    version: versionFor(browser, pkg.version),
    description: pkg.description,
    publicKey,
  });
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
    define: { __UNFRET_API__: JSON.stringify(apiOrigin(browser)) },
    logLevel: "warning",
  });
  for (const file of statics) cpSync(join(root, "src", file), join(out, file));
  cpSync(join(root, browser === "chrome-dev" ? "icons-dev" : "icons"), join(out, "icons"), {
    recursive: true,
  });
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest(browser), null, 2) + "\n");
  // The self-hosted variants ship as signed CRXs (scripts/release.mjs), not zips.
  if (!dev && !(browser in PUBLIC_KEY_FILE)) {
    zipDirectory(out, join(root, "dist", `unfret-${browser}-${pkg.version}.zip`));
  }
  console.log(`built dist/${browser}${dev ? " (dev)" : ""}`);
}

await buildFor("chrome");
for (const [browser, keyFile] of Object.entries(PUBLIC_KEY_FILE)) {
  if (existsSync(keyFile)) await buildFor(browser);
  else console.log(`skipped dist/${browser}: no ${keyFile} (run \`make crx-key\`)`);
}
await buildFor("firefox");
