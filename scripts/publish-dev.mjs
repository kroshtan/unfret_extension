// Put a signed Unfret Dev release (dist/release from `node scripts/release.mjs --dev`) into a checkout of the
// backend, which serves it at https://dev.unfret.net/extension/updates-dev.xml:
//   node scripts/publish-dev.mjs <backend checkout>
// It replaces the previous unfret-dev-*.crx and updates-dev.xml in the backend's static/extension directory and
// updates their lines in its SHA256SUMS; the production files there are left alone. CI runs this on every merge to
// main (.forgejo/workflows/ci.yaml) and proposes the result to the backend as a pull request.
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CHANNELS } from "./channels.mjs";
import { sha256sums } from "./release.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEV_CRX = /^unfret-dev-\d+(\.\d+){1,3}\.crx$/;

/** The backend's release directory: `src/<package>/static/extension`, whatever the package is called. */
export function releaseDir(backend) {
  const src = join(backend, "src");
  const found = readdirSync(src)
    .map((name) => join(src, name, "static", "extension"))
    .filter((dir) => existsSync(dir));
  if (found.length !== 1)
    throw new Error(`expected one src/*/static/extension in ${backend}, found ${found.length}`);
  return found[0];
}

/** Copy the dev release from `from` into `to`; returns the CRX's name. */
export function publishDev(from, to) {
  const crx = readdirSync(from).filter((name) => DEV_CRX.test(name));
  if (crx.length !== 1) throw new Error(`expected one unfret-dev-*.crx in ${from}, found ${crx.length}`);
  const ours = [crx[0], CHANNELS.dev.updates];
  for (const name of readdirSync(to)) if (DEV_CRX.test(name)) rmSync(join(to, name));
  for (const name of ours) copyFileSync(join(from, name), join(to, name));

  const sumsFile = join(to, "SHA256SUMS");
  const kept = (existsSync(sumsFile) ? readFileSync(sumsFile, "utf8") : "")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .filter((line) => {
      const name = line.split(/\s+/)[1] ?? "";
      return !DEV_CRX.test(name) && name !== CHANNELS.dev.updates;
    })
    .map((line) => `${line}\n`);
  writeFileSync(sumsFile, kept.join("") + sha256sums(to, ours));
  return crx[0];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const backend = process.argv[2];
  if (!backend) {
    console.error("usage: node scripts/publish-dev.mjs <backend checkout>");
    process.exit(2);
  }
  const dir = releaseDir(backend);
  const crx = publishDev(join(root, "dist", "release"), dir);
  console.log(`${dir}: ${crx}, ${CHANNELS.dev.updates}, SHA256SUMS`);
}
