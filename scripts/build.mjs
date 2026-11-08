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

import { zipDirectory } from "./zip.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dev = process.argv.includes("--dev");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const sites = JSON.parse(readFileSync(join(root, "src/shared/sites.json"), "utf8"));

const API_ORIGIN = "https://veridex.kroshtan.com";
const UPDATE_URL = `${API_ORIGIN}/extension/updates.xml`;
const PUBLIC_KEY_FILE = join(root, "release", "public-key.b64");
const DEV_PERMISSIONS = ["http://localhost/*", "http://127.0.0.1/*"];

const entries = {
  background: "src/background/index.ts",
  extract: "src/content/extract-entry.ts",
  "connect-relay": "src/content/connect-relay.ts",
  "popup/popup": "src/popup/popup.ts",
  "options/options": "src/options/options.ts",
};
const statics = ["popup/popup.html", "popup/popup.css", "options/options.html", "shared/ui.css"];
const icons = {
  16: "icons/icon-16.png",
  32: "icons/icon-32.png",
  48: "icons/icon-48.png",
  128: "icons/icon-128.png",
};

function manifest(browser) {
  const base = {
    manifest_version: 3,
    name: "Veridex",
    version: pkg.version,
    description: pkg.description,
    icons,
    action: { default_popup: "popup/popup.html", default_title: "Veridex", default_icon: icons },
    options_ui: { page: "options/options.html", open_in_tab: true },
    permissions: ["activeTab", "storage", "scripting"],
    host_permissions: [...[...sites.amazon, ...sites.bol].map((d) => `*://*.${d}/*`), `${API_ORIGIN}/*`],
    optional_host_permissions: DEV_PERMISSIONS,
    content_scripts: [
      { matches: [`${API_ORIGIN}/connect*`], js: ["connect-relay.js"], run_at: "document_start" },
    ],
    content_security_policy: {
      // Extension pages may only talk to the Veridex API (or a local dev server).
      extension_pages: `script-src 'self'; object-src 'self'; connect-src ${API_ORIGIN} http://localhost:* http://127.0.0.1:*`,
    },
  };
  if (browser === "chrome") {
    return { ...base, background: { service_worker: "background.js" }, minimum_chrome_version: "116" };
  }
  if (browser === "chrome-selfhosted") {
    const key = readFileSync(PUBLIC_KEY_FILE, "utf8").trim();
    return { ...manifest("chrome"), key, update_url: UPDATE_URL };
  }
  return {
    ...base,
    background: { scripts: ["background.js"] },
    browser_specific_settings: {
      gecko: {
        id: "veridex@kroshtan.com",
        strict_min_version: "140.0",
        data_collection_permissions: { required: ["websiteContent", "browsingActivity"] },
      },
      gecko_android: { strict_min_version: "142.0" },
    },
  };
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
