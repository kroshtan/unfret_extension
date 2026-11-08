// Package a self-hosted release from a fresh production build (run `npm run build` first; `make release` does both):
//   dist/release/veridex-<version>.crx       dist/chrome-selfhosted, signed with the key at $VERIDEX_CRX_KEY
//   dist/release/updates.xml                 the update manifest Chromium polls (served at UPDATE_URL)
//   dist/release/veridex-chrome-<version>.zip  the store-variant zip (for a store listing, if ever)
//   dist/release/SHA256SUMS                  checksums of the above
// Everything is deterministic: the same source, version and key give byte-identical files, so anyone can rebuild
// and compare (scripts/verify-release.mjs).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { KEY_PATH } from "./crx-key.mjs";
import { packCrx, verifyCrx } from "./crx.mjs";
import { zipBuffer } from "./zip.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const BASE_URL = "https://veridex.kroshtan.com/extension";
const MIN_CHROME = "116";

export function updatesXml(id, version, codebase) {
  return `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${id}'>
    <updatecheck codebase='${codebase}' version='${version}' prodversionmin='${MIN_CHROME}' />
  </app>
</gupdate>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const selfhosted = join(root, "dist", "chrome-selfhosted");
  if (!existsSync(join(selfhosted, "manifest.json"))) {
    throw new Error("dist/chrome-selfhosted is missing: run `npm run build` (needs release/public-key.b64)");
  }
  const expectedId = readFileSync(join(root, "release", "extension-id.txt"), "utf8").trim();
  const manifest = JSON.parse(readFileSync(join(selfhosted, "manifest.json"), "utf8"));
  if (manifest.version !== pkg.version) throw new Error("dist/chrome-selfhosted is stale: rebuild");

  const crx = packCrx(zipBuffer(selfhosted), readFileSync(KEY_PATH, "utf8"));
  const { id, publicKey } = verifyCrx(crx);
  if (id !== expectedId) throw new Error(`key gives ${id}, release/extension-id.txt says ${expectedId}`);
  if (publicKey.toString("base64") !== manifest.key)
    throw new Error("manifest key differs from the signing key");

  const out = join(root, "dist", "release");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const crxName = `veridex-${pkg.version}.crx`;
  const zipName = `veridex-chrome-${pkg.version}.zip`;
  writeFileSync(join(out, crxName), crx);
  writeFileSync(join(out, "updates.xml"), updatesXml(id, pkg.version, `${BASE_URL}/${crxName}`));
  copyFileSync(join(root, "dist", zipName), join(out, zipName));
  const sums = [crxName, "updates.xml", zipName]
    .map(
      (name) =>
        `${createHash("sha256")
          .update(readFileSync(join(out, name)))
          .digest("hex")}  ${name}`,
    )
    .join("\n");
  writeFileSync(join(out, "SHA256SUMS"), sums + "\n");
  console.log(`dist/release: ${crxName} (ID ${id}), updates.xml, ${zipName}, SHA256SUMS`);
}
