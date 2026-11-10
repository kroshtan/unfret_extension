// Package the self-hosted releases from a fresh production build (run `npm run build` first; `make release` does both):
//   dist/release/unfret-<version>.crx          dist/chrome-selfhosted, signed with the production key
//   dist/release/updates.xml                   its update manifest (served at UPDATE_URL)
//   dist/release/unfret-dev-<version>.crx      dist/chrome-dev ("Unfret Dev"), signed with the dev key
//   dist/release/updates-dev.xml               its update manifest (served at DEV_UPDATE_URL)
//   dist/release/unfret-chrome-<version>.zip   the store-variant zip (the Chrome Web Store upload)
//   dist/release/SHA256SUMS                    checksums of the above
// With --dev only Unfret Dev is signed (its CRX, updates-dev.xml and SHA256SUMS): what CI publishes on every merge
// to main, with $UNFRET_DEV_BUILD set so its version is x.y.z.N (channels.mjs).
// Everything is deterministic: the same source, version and key give byte-identical files, so anyone can rebuild
// and compare (scripts/verify-release.mjs).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CHANNELS, versionFor } from "./channels.mjs";
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

/** `sha256  name` lines for the files in `dir`, as `sha256sum` writes them. */
export function sha256sums(dir, names) {
  return names
    .map(
      (name) =>
        `${createHash("sha256")
          .update(readFileSync(join(dir, name)))
          .digest("hex")}  ${name}\n`,
    )
    .join("");
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
  const version = versionFor(channel.build, pkg.version);
  if (manifest.version !== version) {
    throw new Error(`dist/${channel.build} is version ${manifest.version}, expected ${version}: rebuild`);
  }

  const crx = packCrx(zipBuffer(dir), readFileSync(channel.keyPath, "utf8"));
  const { id, publicKey } = verifyCrx(crx);
  if (id !== expectedId) throw new Error(`key gives ${id}, release/ says ${expectedId}`);
  if (publicKey.toString("base64") !== manifest.key)
    throw new Error("manifest key differs from the signing key");

  const crxName = `${channel.crxPrefix}-${version}.crx`;
  writeFileSync(join(out, crxName), crx);
  writeFileSync(join(out, channel.updates), updatesXml(id, version, `${channel.baseUrl}/${crxName}`));
  console.log(`dist/release: ${crxName} (ID ${id}), ${channel.updates}`);
  return [crxName, channel.updates];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const devOnly = process.argv.includes("--dev");
  const out = join(root, "dist", "release");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const names = devOnly
    ? releaseChannel(CHANNELS.dev, out)
    : [...releaseChannel(CHANNELS.production, out), ...releaseChannel(CHANNELS.dev, out)];
  if (!devOnly) {
    const zipName = `unfret-chrome-${pkg.version}.zip`;
    copyFileSync(join(root, "dist", zipName), join(out, zipName));
    names.push(zipName);
  }
  writeFileSync(join(out, "SHA256SUMS"), sha256sums(out, names));
  console.log("dist/release: SHA256SUMS");
}
