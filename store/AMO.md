# Submitting Unfret to addons.mozilla.org (AMO)

Everything Claude could prepare is here. The steps only you can do are marked **you**.

## The files

From the Forgejo release `v<version>` (Actions → **Release to the extension stores** attaches them and, with the AMO
secrets set, submits them; for 0.9.1 they were attached by hand, built the same way):

- `unfret-firefox-<version>.zip`: the add-on.
- `unfret-source-<version>.zip`: its source (`git archive` of the release commit). AMO asks for it because the add-on
  is bundled and minified with esbuild.
- `SHA256SUMS`.

Checked before upload: `npx web-ext lint --source-dir dist/firefox` (CI runs it on every push), and a clean build from
the source zip in `node:22-bookworm` (Node 22.23.5, npm 10.9.9) gives a byte-identical Firefox zip. The sign-in relay
was tested in Firefox 158 on https://unfret.net/connect: it runs without an extra permission grant.

## Releasing a new version (automated)

After the first submission below, "Release to the extension stores" with `stores` `both` or `firefox` (store/SUBMIT.md,
"Releasing a new version") does steps 2 and 3 through AMO's API v5, authenticated with a JWT from `AMO_JWT_ISSUER` and
`AMO_JWT_SECRET` (made once as in store/SUBMIT.md, "addons.mozilla.org: an API key"):

1. `GET /api/v5/addons/addon/unfret/versions/<version>/`: a version AMO already has is never uploaded again (see
   "A run that failed halfway" below).
2. `POST /api/v5/addons/upload/` with `unfret-firefox-<version>.zip` and `channel=listed`, then
   `GET /api/v5/addons/upload/<uuid>/` until AMO's validator has processed it; a failed validation stops here with
   its errors.
3. `POST /api/v5/addons/addon/unfret/versions/` (multipart: the upload and `unfret-source-<version>.zip` as `source`;
   AMO takes nothing else in a multipart request).
4. If the `AMO_APPROVAL_NOTES` secret is set: `PATCH` that version with `approval_notes` (the notes to the reviewer),
   in a request of its own.
5. Only if the package's manifest has no `gecko_android`: `PATCH` that version with `compatibility: ["firefox"]`,
   again on its own. The release build declares Firefox for Android, so this request isn't sent (below).

If step 4 or 5 is refused, the other is still sent, and the step fails with both results in the log.

**A run that failed halfway.** When AMO has created the version but a later request failed, run the workflow again
(`ref` the release tag, `stores` `firefox`). It finds the version, uploads nothing, and only adds what that version
is missing: the notes when they differ from `AMO_APPROVAL_NOTES`, the desktop-only compatibility for a package
without Android. A disabled version is left alone.

**Firefox for Android.** The manifest (`scripts/manifest.mjs`, Firefox build) declares `gecko_android` (142+), so
AMO lists every version for Firefox desktop and Firefox for Android, and the API refuses to take Android away ("Can
not override compatibility information set in the manifest for this application"; that refusal stopped the 0.11.0
run). To ship a version for desktop only, decide it at build time: remove `gecko_android` from the Firefox manifest
in `scripts/manifest.mjs` and release. The workflow then sets `compatibility: ["firefox"]` (step 5), in case AMO
carries Android over from an earlier version. There is no switch for it in the workflow.

The listing (texts, images, categories, privacy policy) isn't touched. Review then runs as for a manual upload.

## The first submission (by hand)

1. **You**: a developer account at https://addons.mozilla.org/developers/ (free). Use the same public contact
   address as for the Chrome Web Store.
2. **You**: Submit a New Add-on → **On this site** (listed) → upload `unfret-firefox-<version>.zip`.
   Compatibility: **Firefox** and **Firefox for Android** (the manifest declares both; see "Firefox for Android"
   above).
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

The `AMO_APPROVAL_NOTES` secret holds this block with the key filled in; without the secret, paste it in the
Developer Hub (the version → **Notes to Reviewer**). The testing steps match the Chrome reviewer's in
[reviewer-notes.md](reviewer-notes.md); the build and data paragraphs are AMO's own.

```
Build: the add-on is bundled and minified with esbuild. To reproduce it from the uploaded source:
  Node 22 (tested: 22.23.5) with npm 10 (tested: 10.9.9), on Linux:
    npm ci
    npm run build
  Output: dist/unfret-firefox-<version>.zip, byte-identical to the uploaded add-on (dist/firefox is the unzipped
  add-on). The build script is scripts/build.mjs; the manifest comes from scripts/manifest.mjs.

Testing: no account or wallet is needed; use the test API key below.
1. Install the add-on and pin it to the toolbar. A welcome page on unfret.net opens once; it can be closed.
2. Click the Unfret toolbar button and read the first-run screen, then click "I agree".
3. In the popup, click "Sign in with an API key or wallet", then "API key"; paste this key and click "Use this key":
   ufk_<REPLACE WITH THE TEST KEY>
   The key holds about 20 checks.
4. Open a product page, for example any product on https://www.amazon.com or https://www.bol.com, click the Unfret
   button, then "Check this page". The result appears in 10-30 seconds: a verdict in plain words with its reasons.
5. Optional: under a result, "This is wrong" lets you report a wrong result (it asks for consent first).
Nothing is read or sent until "Check this page" is clicked.

Data: on "Check this page" the page address, product facts and cleaned visible text of that one page go to the Unfret
API (https://unfret.net), which is the add-on's only network destination. Two content scripts run only on Unfret's
own pages: https://unfret.net/connect* (the wallet sign-in page) to receive the session, and
https://unfret.net/checkout* to receive a new API key the checkout page shows; they read nothing else from the page.
Privacy policy: https://unfret.net/privacy
```

The test key: the one made for the Chrome review (`~/kroshtan_secrets/unfret-cws-reviewer-key.json`) works, or make
a new one as in [reviewer-notes.md](reviewer-notes.md).
