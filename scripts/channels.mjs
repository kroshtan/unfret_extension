// The two self-hosted channels. Each is a separate extension with its own signing key (so its own ID), update
// manifest and API: "Unfret" for production, "Unfret Dev" for testing against the dev deployment.
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const secrets = join(homedir(), "kroshtan_secrets");

export const CHANNELS = {
  production: {
    build: "chrome-selfhosted",
    keyPath: process.env.VERIDEX_CRX_KEY || join(secrets, "veridex-extension-crx.pem"),
    publicKeyFile: join(root, "release", "public-key.b64"),
    idFile: join(root, "release", "extension-id.txt"),
    crxPrefix: "unfret",
    updates: "updates.xml",
    baseUrl: "https://unfret.kroshtan.com/extension",
  },
  dev: {
    build: "chrome-dev",
    keyPath: process.env.UNFRET_DEV_CRX_KEY || join(secrets, "unfret-dev-crx.pem"),
    publicKeyFile: join(root, "release", "dev-public-key.b64"),
    idFile: join(root, "release", "dev-extension-id.txt"),
    crxPrefix: "unfret-dev",
    updates: "updates-dev.xml",
    baseUrl: "https://dev.unfret.kroshtan.com/extension",
  },
};

/** The channel named by a `--dev` flag in argv (production otherwise). */
export function channelFromArgs(argv = process.argv) {
  return argv.includes("--dev") ? CHANNELS.dev : CHANNELS.production;
}
