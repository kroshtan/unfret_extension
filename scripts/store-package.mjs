// Check the Chrome Web Store package of a fresh production build (`npm run build` first) and put it, with its
// checksum, in dist/store/:
//   dist/store/unfret-chrome-<version>.zip   the upload for the developer dashboard
//   dist/store/SHA256SUMS
// It refuses a package that isn't exactly dist/chrome at package.json's version, that carries a `key` or
// `update_url` (the store assigns its own ID and updates), or that talks to anything but the production API.
// The "Release to Chrome Web Store" workflow runs this; locally: `make store-package`.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { API_ORIGIN, DEV_API_ORIGIN } from "./manifest.mjs";
import { sha256sums } from "./release.mjs";
import { zipBuffer } from "./zip.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** Everything wrong with the store build in `dir` and its zip at `zipPath` (empty when it is fit to upload). */
export function storeProblems(dir, zipPath, version) {
  const problems = [];
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  if (manifest.version !== version)
    problems.push(`version ${manifest.version}, package.json says ${version}`);
  if (manifest.name !== "Unfret") problems.push(`name ${JSON.stringify(manifest.name)}`);
  for (const field of ["key", "update_url"])
    if (field in manifest) problems.push(`manifest has \`${field}\``);
  const relay = manifest.content_scripts?.[0]?.matches?.[0];
  if (relay !== `${API_ORIGIN}/connect*`) problems.push(`sign-in relay on ${relay}`);
  if (!manifest.content_security_policy?.extension_pages?.includes(`connect-src ${API_ORIGIN} `)) {
    problems.push("CSP doesn't name the production API");
  }
  const scripts = readdirSync(dir, { recursive: true }).filter((name) => String(name).endsWith(".js"));
  for (const name of scripts) {
    const code = readFileSync(join(dir, String(name)), "utf8");
    if (code.includes(DEV_API_ORIGIN)) problems.push(`${name} mentions the dev API`);
    if (code.includes("sourceMappingURL")) problems.push(`${name} has a source map (a --dev build?)`);
  }
  if (!readFileSync(zipPath).equals(zipBuffer(dir))) problems.push("the zip differs from dist/chrome");
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const zipName = `unfret-chrome-${pkg.version}.zip`;
  const problems = storeProblems(join(root, "dist", "chrome"), join(root, "dist", zipName), pkg.version);
  if (problems.length > 0) {
    console.error(`not a store package:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  const out = join(root, "dist", "store");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  copyFileSync(join(root, "dist", zipName), join(out, zipName));
  writeFileSync(join(out, "SHA256SUMS"), sha256sums(out, [zipName]));
  console.log(`dist/store: ${zipName}, SHA256SUMS`);
}
