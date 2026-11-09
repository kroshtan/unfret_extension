// Check that a published CRX is genuine and built from this source, without the signing key:
//   npm run build && node scripts/verify-release.mjs path/to/unfret-<version>.crx
//   npm run build && node scripts/verify-release.mjs --dev path/to/unfret-dev-<version>.crx   (Unfret Dev)
// It verifies the CRX signature, that its ID is the channel's (release/extension-id.txt or dev-extension-id.txt),
// and that the ZIP inside is byte-identical to the ZIP of your own build (dist/chrome-selfhosted or dist/chrome-dev).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { channelFromArgs } from "./channels.mjs";
import { verifyCrx } from "./crx.mjs";
import { zipBuffer } from "./zip.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const channel = channelFromArgs();
const file = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
if (!file) {
  console.error("usage: node scripts/verify-release.mjs [--dev] <file.crx>");
  process.exit(2);
}
const { id, zip } = verifyCrx(readFileSync(file));
const expectedId = readFileSync(channel.idFile, "utf8").trim();
const signatureOk = `signature valid, ID ${id}`;
if (id !== expectedId) {
  console.error(`${signatureOk}, but release/ says ${expectedId}`);
  process.exit(1);
}
if (!zip.equals(zipBuffer(join(root, "dist", channel.build)))) {
  console.error(`${signatureOk}, but its contents differ from your dist/${channel.build} build`);
  process.exit(1);
}
console.log(`${signatureOk}, contents identical to your build of this source`);
