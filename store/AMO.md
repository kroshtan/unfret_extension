# Submitting Unfret to addons.mozilla.org (AMO)

Everything Claude could prepare is here. The steps only you can do are marked **you**.

## The files

From the Forgejo release `v<version>` (Actions → **Release to the extension stores** attaches them; for 0.9.1 they
were attached by hand, built the same way):

- `unfret-firefox-<version>.zip`: the add-on.
- `unfret-source-<version>.zip`: its source (`git archive` of the release commit). AMO asks for it because the add-on
  is bundled and minified with esbuild.
- `SHA256SUMS`.

Checked before upload: `npx web-ext lint --source-dir dist/firefox` (CI runs it on every push), and a clean build from
the source zip in `node:22-bookworm` (Node 22.23.5, npm 10.9.9) gives a byte-identical Firefox zip. The sign-in relay
was tested in Firefox 158 on https://unfret.net/connect: it runs without an extra permission grant.

## Steps

1. **You**: a developer account at https://addons.mozilla.org/developers/ (free). Use the same public contact
   address as for the Chrome Web Store.
2. **You**: Submit a New Add-on → **On this site** (listed) → upload `unfret-firefox-<version>.zip`.
   Compatibility: **Firefox** (desktop). Tick **Firefox for Android** only after trying it on a phone: the manifest
   allows it (`gecko_android`, 142+), but it hasn't been tested there.
3. **You**: "Do you need to submit source code?" → **Yes** → upload `unfret-source-<version>.zip`.
4. **You**: fill in the listing and the notes below, then submit. The automatic validation runs at once; a person may
   review the bundled code later (from a day to a few weeks). Once approved, Firefox updates installed copies itself.

## Listing

**Name**: Unfret

**Add-on URL**: `unfret`

**Summary** (≤ 250 characters; 191):

```
Check a product page before you buy: fake discounts, made-up brands, dropshipped goods and pushy tricks, in plain words. Nothing is read until you click "Check this page". Checks are prepaid.
```

**Description**: the Chrome description in [listing.en.md](listing.en.md), unchanged (AMO accepts plain text with
blank lines between paragraphs and "•" bullets).

**Categories** (Firefox, up to two): **Shopping**, **Privacy & Security**.

**Tags**: shopping, scam, dropshipping, reviews, fake discounts.

**This add-on requires payment, non-free services or software**: **tick it** (checks are prepaid packs).

**Support email**: the public contact address. **Support website**: https://unfret.net

**License**: MIT License.

**Privacy policy**: AMO wants the text itself, not a link. Paste the plain text of https://unfret.net/privacy (open
the page, select all, copy), keeping the link at the top: "The current version is at https://unfret.net/privacy."

**Images**: icon `icons/icon-128.png`; screenshots `store/screenshots/*.png` (1280×800 is fine on AMO).

## Notes to reviewer (paste, with the test key filled in)

```
Build: the add-on is bundled and minified with esbuild. To reproduce it from the uploaded source:
  Node 22 (tested: 22.23.5) with npm 10 (tested: 10.9.9), on Linux:
    npm ci
    npm run build
  Output: dist/unfret-firefox-<version>.zip, byte-identical to the uploaded add-on (dist/firefox is the unzipped
  add-on). The build script is scripts/build.mjs; the manifest comes from scripts/manifest.mjs.

Testing: no account or wallet is needed. Install, click the Unfret toolbar button, read the first-run screen and click
"I agree". In the popup click "API key", paste this test key and click "Use this key" (it holds 20 checks):
  ufk_<REPLACE WITH THE TEST KEY>
Then open a product page (any amazon.com or bol.com product), click the toolbar button and "Check this page". A
plain-words verdict appears in 10-30 seconds. Nothing is read or sent before that click.

Data: on "Check this page" the page address, product facts and cleaned visible text of that one page go to the Unfret
API (https://unfret.net), which is the add-on's only network destination. The content script runs only on
https://unfret.net/connect*, Unfret's own wallet sign-in page, to receive the session. Privacy policy:
https://unfret.net/privacy
```

The test key: the one made for the Chrome review (`~/kroshtan_secrets/unfret-cws-reviewer-key.json`) works, or make
a new one as in [reviewer-notes.md](reviewer-notes.md).
