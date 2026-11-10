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
    keyPath: process.env.UNFRET_CRX_KEY || join(secrets, "unfret-extension-crx.pem"),
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

/**
 * Unfret Dev's version: package.json's, plus a fourth part from $UNFRET_DEV_BUILD when that is set. CI sets it to
 * its run number, so every publish from main is a higher version, which Chromium then installs; the next version
 * bump in package.json (0.8.4 > 0.8.3.N) still outranks them all.
 *
 * @param {string} version package.json's version (three parts)
 * @param {string | undefined} build the build number, 0–65535
 */
export function devVersion(version, build = process.env.UNFRET_DEV_BUILD) {
  if (!build) return version;
  if (!/^\d{1,5}$/.test(build) || Number(build) > 65535) {
    throw new Error(`UNFRET_DEV_BUILD must be a number from 0 to 65535, not ${JSON.stringify(build)}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`can't add a build number to version ${version}`);
  return `${version}.${Number(build)}`;
}

/** The version a build target (`chrome`, `chrome-dev`, ...) carries. */
export function versionFor(build, version) {
  return build === CHANNELS.dev.build ? devVersion(version) : version;
}
