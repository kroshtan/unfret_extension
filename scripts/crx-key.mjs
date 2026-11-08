// Create the CRX signing key ONCE, and record its public half and the extension ID it gives.
//   node scripts/crx-key.mjs           create the key (refuses to overwrite an existing one)
//   node scripts/crx-key.mjs --public  re-derive release/public-key.b64 and release/extension-id.txt from the key
//
// The private key lives outside the repo, at $VERIDEX_CRX_KEY (default ~/kroshtan_secrets/veridex-extension-crx.pem),
// mode 600. It is never printed and never committed. Losing it changes the extension ID: existing installs would stop
// receiving updates. Back it up.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extensionId, publicKeyDer } from "./crx.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const KEY_PATH =
  process.env.VERIDEX_CRX_KEY || join(homedir(), "kroshtan_secrets", "veridex-extension-crx.pem");

function recordPublicHalf(pem) {
  const der = publicKeyDer(pem);
  mkdirSync(join(root, "release"), { recursive: true });
  writeFileSync(join(root, "release", "public-key.b64"), der.toString("base64") + "\n");
  writeFileSync(join(root, "release", "extension-id.txt"), extensionId(der) + "\n");
  console.log(`extension ID ${extensionId(der)} (public key in release/public-key.b64)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--public")) {
    recordPublicHalf(readFileSync(KEY_PATH, "utf8"));
  } else if (existsSync(KEY_PATH)) {
    console.error(`refusing to overwrite the existing key at ${KEY_PATH} (use --public to re-derive the ID)`);
    process.exit(1);
  } else {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" });
    mkdirSync(dirname(KEY_PATH), { recursive: true, mode: 0o700 });
    writeFileSync(KEY_PATH, pem, { mode: 0o600, flag: "wx" });
    console.log(`created ${KEY_PATH} (mode 600) — back it up; losing it changes the extension ID`);
    recordPublicHalf(pem);
  }
}
