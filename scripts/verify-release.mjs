// Check that a published CRX is genuine and built from this source, without the signing key:
//   npm run build && node scripts/verify-release.mjs path/to/veridex-<version>.crx
// It verifies the CRX signature, that its ID is the one in release/extension-id.txt, and that the ZIP inside is
// byte-identical to the ZIP of your own dist/chrome-selfhosted build.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyCrx } from "./crx.mjs";
import { zipBuffer } from "./zip.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/verify-release.mjs <file.crx>");
  process.exit(2);
}
const { id, zip } = verifyCrx(readFileSync(file));
const expectedId = readFileSync(join(root, "release", "extension-id.txt"), "utf8").trim();
const signatureOk = `signature valid, ID ${id}`;
if (id !== expectedId) {
  console.error(`${signatureOk}, but release/extension-id.txt says ${expectedId}`);
  process.exit(1);
}
if (!zip.equals(zipBuffer(join(root, "dist", "chrome-selfhosted")))) {
  console.error(`${signatureOk}, but its contents differ from your dist/chrome-selfhosted build`);
  process.exit(1);
}
console.log(`${signatureOk}, contents identical to your build of this source`);
