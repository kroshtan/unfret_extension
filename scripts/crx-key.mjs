// Create a CRX signing key ONCE, and record its public half and the extension ID it gives.
//   node scripts/crx-key.mjs [--dev]           create the key (refuses to overwrite an existing one)
//   node scripts/crx-key.mjs [--dev] --public  re-derive the public key and ID files in release/ from the key
//
// Production's key lives at $UNFRET_CRX_KEY (default ~/kroshtan_secrets/unfret-extension-crx.pem), Unfret Dev's at
// $UNFRET_DEV_CRX_KEY (default ~/kroshtan_secrets/unfret-dev-crx.pem); both outside the repo, mode 600, never
// printed or committed. Losing one changes that extension's ID: existing installs would stop receiving updates.
// Back them up.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { CHANNELS, channelFromArgs } from "./channels.mjs";
import { extensionId, publicKeyDer } from "./crx.mjs";

export const KEY_PATH = CHANNELS.production.keyPath;

function recordPublicHalf(channel, pem) {
  const der = publicKeyDer(pem);
  mkdirSync(dirname(channel.publicKeyFile), { recursive: true });
  writeFileSync(channel.publicKeyFile, der.toString("base64") + "\n");
  writeFileSync(channel.idFile, extensionId(der) + "\n");
  console.log(`extension ID ${extensionId(der)} (public key in release/${basename(channel.publicKeyFile)})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const channel = channelFromArgs();
  if (process.argv.includes("--public")) {
    recordPublicHalf(channel, readFileSync(channel.keyPath, "utf8"));
  } else if (existsSync(channel.keyPath)) {
    console.error(
      `refusing to overwrite the existing key at ${channel.keyPath} (use --public to re-derive the ID)`,
    );
    process.exit(1);
  } else {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" });
    mkdirSync(dirname(channel.keyPath), { recursive: true, mode: 0o700 });
    writeFileSync(channel.keyPath, pem, { mode: 0o600, flag: "wx" });
    console.log(`created ${channel.keyPath} (mode 600) — back it up; losing it changes the extension ID`);
    recordPublicHalf(channel, pem);
  }
}
