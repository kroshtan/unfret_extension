// Check the store packages of a fresh production build (`npm run build` first) and put them, with their checksums,
// in dist/store/:
//   dist/store/unfret-chrome-<version>.zip    the Chrome Web Store upload
//   dist/store/unfret-firefox-<version>.zip   the addons.mozilla.org (AMO) upload
//   dist/store/unfret-source-<version>.zip    the source AMO asks for with a bundled, minified add-on: `git archive`
//                                             of the release commit, which `npm ci && npm run build` (store/AMO.md)
//                                             turns into the very same Firefox zip
//   dist/store/SHA256SUMS
// It refuses a package that isn't exactly dist/<browser> at package.json's version, that carries a `key` or
// `update_url` (the stores assign their own ID and updates), or that talks to anything but the production API, and
// a source zip from a working tree with uncommitted changes.
// The "Release to the extension stores" workflow runs this; locally: `make store-package`.
import { execFileSync } from "node:child_process";
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
  if (!readFileSync(zipPath).equals(zipBuffer(dir))) problems.push(`the zip differs from ${dir}`);
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const problems = [];
  const names = [];
  for (const browser of ["chrome", "firefox"]) {
    const zipName = `unfret-${browser}-${pkg.version}.zip`;
    const found = storeProblems(join(root, "dist", browser), join(root, "dist", zipName), pkg.version);
    problems.push(...found.map((problem) => `${browser}: ${problem}`));
    names.push(zipName);
  }
  if (git("status", "--porcelain", "--untracked-files=no").trim()) {
    problems.push("source: the working tree has uncommitted changes");
  }
  if (problems.length > 0) {
    console.error(`not a store package:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  const out = join(root, "dist", "store");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const name of names) copyFileSync(join(root, "dist", name), join(out, name));
  const sourceName = `unfret-source-${pkg.version}.zip`;
  git("archive", "--format=zip", "-o", join(out, sourceName), "HEAD");
  names.push(sourceName);
  writeFileSync(join(out, "SHA256SUMS"), sha256sums(out, names));
  console.log(`dist/store: ${names.join(", ")}, SHA256SUMS`);
}
