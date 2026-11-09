// Package the self-hosted releases from a fresh production build (run `npm run build` first; `make release` does both):
//   dist/release/unfret-<version>.crx          dist/chrome-selfhosted, signed with the production key
//   dist/release/updates.xml                   its update manifest (served at UPDATE_URL)
//   dist/release/unfret-dev-<version>.crx      dist/chrome-dev ("Unfret Dev"), signed with the dev key
//   dist/release/updates-dev.xml               its update manifest (served at DEV_UPDATE_URL)
//   dist/release/unfret-chrome-<version>.zip   the store-variant zip (the Chrome Web Store upload)
//   dist/release/SHA256SUMS                    checksums of the above
// Everything is deterministic: the same source, version and key give byte-identical files, so anyone can rebuild
// and compare (scripts/verify-release.mjs).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CHANNELS } from "./channels.mjs";
import { packCrx, verifyCrx } from "./crx.mjs";
import { zipBuffer } from "./zip.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
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

/** Sign one channel's build into `out`; returns the names of the files written. */
function releaseChannel(channel, out) {
  const dir = join(root, "dist", channel.build);
  if (!existsSync(join(dir, "manifest.json"))) {
    throw new Error(
      `dist/${channel.build} is missing: run \`npm run build\` (needs its public key in release/)`,
    );
  }
  const expectedId = readFileSync(channel.idFile, "utf8").trim();
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  if (manifest.version !== pkg.version) throw new Error(`dist/${channel.build} is stale: rebuild`);

  const crx = packCrx(zipBuffer(dir), readFileSync(channel.keyPath, "utf8"));
  const { id, publicKey } = verifyCrx(crx);
  if (id !== expectedId) throw new Error(`key gives ${id}, release/ says ${expectedId}`);
  if (publicKey.toString("base64") !== manifest.key)
    throw new Error("manifest key differs from the signing key");

  const crxName = `${channel.crxPrefix}-${pkg.version}.crx`;
  writeFileSync(join(out, crxName), crx);
  writeFileSync(join(out, channel.updates), updatesXml(id, pkg.version, `${channel.baseUrl}/${crxName}`));
  console.log(`dist/release: ${crxName} (ID ${id}), ${channel.updates}`);
  return [crxName, channel.updates];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(root, "dist", "release");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const names = [...releaseChannel(CHANNELS.production, out), ...releaseChannel(CHANNELS.dev, out)];
  const zipName = `unfret-chrome-${pkg.version}.zip`;
  copyFileSync(join(root, "dist", zipName), join(out, zipName));
  names.push(zipName);
  const sums = names
    .map(
      (name) =>
        `${createHash("sha256")
          .update(readFileSync(join(out, name)))
          .digest("hex")}  ${name}`,
    )
    .join("\n");
  writeFileSync(join(out, "SHA256SUMS"), sums + "\n");
  console.log(`dist/release: ${zipName}, SHA256SUMS`);
}
