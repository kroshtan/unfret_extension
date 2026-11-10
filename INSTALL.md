# Installing Unfret

Unfret is distributed **from its own server** (and, once listed, the Chrome Web Store):

- Signed package: `https://unfret.kroshtan.com/extension/unfret-<version>.crx`
- Update manifest: `https://unfret.kroshtan.com/extension/updates.xml`
- Extension ID: `kpllgmbgfmnlpnmkibmhflkafhilckfe` (fixed by the signing key)

The install page, <https://unfret.kroshtan.com/extension>, has the same instructions, filled in for the current release.

Chromium browsers only install extensions from outside the Chrome Web Store through a **browser policy** or **developer
mode**. What that means per platform:

| Browser and OS                                             | How                              | Automatic updates                |
| ---------------------------------------------------------- | -------------------------------- | -------------------------------- |
| Brave, Chromium, Chrome on **Linux**                       | Policy (one command, below)      | Yes, from unfret.kroshtan.com    |
| **ungoogled-chromium** (any OS)                            | A flag, then open the `.crx`     | Yes, via the update manifest     |
| Windows, macOS, **managed** device (Active Directory, MDM) | Policy, set by the administrator | Yes                              |
| Windows, macOS, personal device                            | Developer mode ("Load unpacked") | No; install new versions by hand |

## Linux: Brave, Chromium, Chrome

Chromium-based browsers read policies from JSON files in a `managed` directory. This installs Unfret and keeps it
updated from unfret.kroshtan.com:

```bash
# Brave
sudo mkdir -p /etc/brave/policies/managed && sudo rm -f /etc/brave/policies/managed/veridex.json && echo '{"ExtensionInstallForcelist":["kpllgmbgfmnlpnmkibmhflkafhilckfe;https://unfret.kroshtan.com/extension/updates.xml"]}' | sudo tee /etc/brave/policies/managed/unfret.json > /dev/null

# Chromium: same JSON in /etc/chromium/policies/managed/unfret.json
# Google Chrome: same JSON in /etc/opt/chrome/policies/managed/unfret.json
```

Restart the browser, then check `brave://policy` (or `chrome://policy`) and `brave://extensions`.

A force-installed extension can't be removed from the browser's extensions page. To uninstall, delete the policy file
(`sudo rm /etc/brave/policies/managed/unfret.json`, or `veridex.json` for releases before 0.7.0) and restart the browser.

## ungoogled-chromium

1. Open `chrome://flags/#extension-mime-request-handling` and set it to **Always prompt for install**. Restart.
2. Paste the `.crx` address (from the install page) into the address bar and confirm the install prompt.

Updates come from the update manifest the extension carries. If your build has extension updates disabled, install new
versions the same way.

## Windows and macOS

On a personal Windows or macOS device, Chromium browsers refuse force-installed extensions from outside the Chrome Web
Store unless the device is managed (joined to Active Directory, or enrolled in device management). The options:

- **Developer mode:** download `unfret-chrome-<version>.zip` from the install page, unzip it, open
  `brave://extensions` (or `chrome://extensions`), enable **Developer mode**, click **Load unpacked** and pick the
  folder. The browser shows a developer-mode notice, and there are no automatic updates.
- **Managed devices:** an administrator adds the same `ExtensionInstallForcelist` entry (ID;update URL) through Group
  Policy (`HKLM\SOFTWARE\Policies\BraveSoftware\Brave` for Brave) or a configuration profile (`com.brave.Browser`).
- **Chrome Web Store:** not listed (yet). <!-- STORE_LINK -->

## Verifying a download

Releases are reproducible. Anyone can check that a published CRX is genuine and built from this source, without the
signing key:

```bash
make install && make verify-release CRX=path/to/unfret-<version>.crx
```

That checks the signature, that the ID is `kpllgmbgfmnlpnmkibmhflkafhilckfe` (`release/extension-id.txt`) and that the
contents are byte-identical to your own build. `SHA256SUMS` on the install page lists the checksums of every release
file.

## For maintainers: making a release

**Unfret Dev is published by CI.** Every merge to `main` builds Unfret Dev as version `<package.json>.<run number>`
(e.g. `0.8.3.42`), signs it with the dev key (repo secret `DEV_CRX_KEY`) and opens a pull request on the backend
(kroshtan/unfret_backend, branch `extension-dev`) that replaces `unfret-dev-*.crx`, `updates-dev.xml` and their
`SHA256SUMS` lines. It merges itself when the backend's CI passes, and the backend's pipeline deploys it to
dev.unfret.kroshtan.com; installed copies update within a few hours. To check a published Unfret Dev package, rebuild
it with the same run number: `UNFRET_DEV_BUILD=42 make verify-release DEV=1 CRX=unfret-dev-0.8.3.42.crx`.

**Production goes to the Chrome Web Store, by hand.**

1. Bump `version` in `package.json` and merge it; wait for CI (both `check` and `publish-dev`) to pass on `main`.
2. Actions → **Release to Chrome Web Store** → Run workflow (input `main`). It checks the commit, builds and checks the
   store package (`make store-package` does the same locally), tags `v<version>` and attaches
   `unfret-chrome-<version>.zip` and `SHA256SUMS` to that Forgejo release.
3. Upload that zip in the Chrome Web Store developer dashboard ([store/SUBMIT.md](store/SUBMIT.md)).

**The self-hosted production channel** (until it is retired): `make release` signs both channels locally. It needs
both signing keys: production's at `$UNFRET_CRX_KEY` (default `~/kroshtan_secrets/unfret-extension-crx.pem`) and
Unfret Dev's at `$UNFRET_DEV_CRX_KEY` (default `~/kroshtan_secrets/unfret-dev-crx.pem`). Each is created once with
`make crx-key` (`DEV=1` for the dev one); back them up: losing one changes that extension's ID, and existing installs
stop receiving updates. Copy `unfret-<version>.crx`, `updates.xml`, the store zip and their `SHA256SUMS` lines from
`dist/release/` into the backend's `src/<package>/static/extension/` and ship it; leave the dev files to CI (a local
`updates-dev.xml` at `<version>` would sit below CI's `<version>.<run>` builds, so Unfret Dev would ignore it).
