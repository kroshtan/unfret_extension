# Submitting Unfret to Microsoft Edge Add-ons

Everything Claude could prepare is here. The steps only you can do are marked **you**. Edge users can already
install Unfret from the Chrome Web Store; a listing on Microsoft Edge Add-ons (https://microsoftedge.microsoft.com)
makes it findable there and installable without allowing "extensions from other stores".

## The package

The Chrome package, unchanged: `unfret-chrome-<version>.zip` from the Forgejo release `v<version>` (Actions →
**Release to the extension stores** attaches it; locally, `make store-package` writes it to `dist/store/`). Edge is
Chromium and takes the same Manifest V3 package:

- No `key` and no `update_url`: `scripts/store-package.mjs` refuses a package with either. Edge Add-ons gives the
  extension its own ID and updates it itself.
- `minimum_chrome_version` 116: Edge's version numbers follow Chromium's, so this means Edge 116 or newer.
- `declarativeContent` (the marker on marketplace product pages), `activeTab`, `scripting` and `storage` work in
  Edge as in Chrome. Pages on microsoftedge.microsoft.com (the store itself) can't be checked, like the other
  stores' pages: browsers don't let extensions read them.
- English only, with the name and description written in the manifest (no `_locales`), so Partner Center shows one
  listing language, English.

## The first submission (by hand)

The API only updates an extension that exists: the first version goes through Partner Center once.

1. **You**: try the package in Edge first: `edge://extensions` → **Developer mode** → **Load unpacked** →
   `dist/chrome` (after `make build`), then check the test shop (https://unfret.net/test-shop). Remove it again
   afterwards: the store version gets its own ID.
2. **You**: register as an Edge extension developer (free) at
   https://partner.microsoft.com/dashboard/microsoftedge/public/login with a personal Microsoft account (an
   Outlook.com/Live.com address, or sign in with GitHub, which makes one; work or school accounts aren't accepted).
   In the registration form:
   - **Account country/region**: where you or the business is (can't be changed later).
   - **Account type**: **Individual**, or **Company** for the registered business name (can't be changed later;
     a company account is verified, which can take from a few days to a few weeks, and Microsoft may phone the
     company approver you name).
   - **Publisher display name**: shown on the store, at most 50 characters; for a company account the registered
     business name.
   - **Contact info**: for Microsoft only; use the same public contact address as for the Chrome Web Store.
   - Accept the App Developer Agreement → **Finish**, and wait for the confirmation e-mail. If Partner Center asks
     for a trader declaration (EU Digital Services Act), answer as for the Chrome Web Store: Unfret sells developer checks, so
     you're a trader.
3. **You**: Partner Center → **Microsoft Edge** → **Overview** → **Create new extension** → upload
   `unfret-chrome-<version>.zip` from the release.
4. **You**: **Availability**: visibility **Public**, markets all (or start with the EU and US, as for Chrome).
5. **You**: **Properties**: category **Shopping**, website `https://unfret.net`, support contact
   `hello@unfret.net`, mature content not ticked.
6. **You**: **Privacy**: the page has the Chrome Web Store's sections; copy them from
   [privacy-practices.md](privacy-practices.md): single purpose, one justification per permission (activeTab,
   scripting, storage, declarativeContent; since 0.14.0 no content scripts), remote code **No, I am not using remote code**, the data usage ticks and the certifications,
   and the privacy policy URL `https://unfret.net/privacy`.
7. **You**: **Store listings** → English → **Edit details**, from [Listing](#listing) below, then **Save draft**.
8. **You**: **Publish** → **Notes for certification**: paste the block in [reviewer-notes.md](reviewer-notes.md)
   (no test key since 0.14.0) → **Publish**. Certification
   can take up to seven business days.
9. **You**, once it is **In the Store**: note the listing URL (the extension's **Overview** page). Adding it to this
   README and to the website's `/extension` page is a later change.

## The API credentials and the secrets (once)

After the first version exists (it may still be in certification):

1. **You**: the **product ID**: Partner Center → **Microsoft Edge** → **Overview** → Unfret → **Extension
   identity** → **Product ID** (a GUID, also in the address bar between `microsoftedge/` and `/packages`).
2. **You**: Partner Center → **Microsoft Edge** → **Publish API**. If it offers to "enable the new experience",
   click **Enable** (that is API v1.1, with API keys; the workflow uses it). Then **Create API credentials**: it
   shows the **Client ID** and a new **API key** with its **expiry date**.
3. **You**: keep them in `~/kroshtan_secrets/edge-addons-api.json` (`chmod 600`):

   ```json
   { "product_id": "GUID", "client_id": "GUID", "api_key": "the key", "api_key_expires": "the date shown" }
   ```

4. **You**: Forgejo secrets (git.kroshtan.com → kroshtan/unfret_extension → Settings → Actions → Secrets):
   `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY`. Optionally `EDGE_CERTIFICATION_NOTES`: the test
   instructions block from [reviewer-notes.md](reviewer-notes.md) with a test key filled in; each submission then
   carries it after the list of changes.
5. **You**: check it with a dry run: Actions → **Release to the extension stores** → `stores` `edge`, **Dry run**
   ticked. It shows the requests a real run would send, secrets as `<NAME>`, and sends none.

Until the three secrets are set, the workflow's Edge step only prints "edge: skipped, the secret(s) … are not set"
and passes, so Chrome and Firefox releases are unaffected (CI checks this on every pull request).

**When the key expires**, the Edge step fails with HTTP 401 and says so: create a new key on the same Publish API
page and replace `EDGE_API_KEY` (and the file).

## Releasing a new version (automated)

"Release to the extension stores" with `stores` `all` or `edge` ([SUBMIT.md](SUBMIT.md), "Releasing a new
version") uploads the Chrome zip through the Edge Add-ons API v1.1 (`https://api.addons.microsoftedge.microsoft.com`),
every request with the headers `Authorization: ApiKey <EDGE_API_KEY>` and `X-ClientID: <EDGE_CLIENT_ID>`:

1. `POST /v1/products/<EDGE_PRODUCT_ID>/submissions/draft/package` with the zip (`Content-Type: application/zip`):
   the package replaces the draft's. The answer is 202 with the operation in `Location`.
2. `GET /v1/products/<EDGE_PRODUCT_ID>/submissions/draft/package/operations/<operation>` every 5 seconds until it
   isn't `InProgress` (at most 5 minutes). `Failed` stops here with the store's message and errors (for example a
   package Edge Add-ons doesn't accept).
3. `POST /v1/products/<EDGE_PRODUCT_ID>/submissions` with `{"notes": …}`, the notes for certification: "Unfret
   <version>.", the headlines of this version's entries in CHANGELOG.md, a link to the whole changelog, then
   `EDGE_CERTIFICATION_NOTES` if set. The log shows only their length (they may hold the test key). Again 202 with
   the operation in `Location`.
4. `GET /v1/products/<EDGE_PRODUCT_ID>/submissions/operations/<operation>` until it isn't `InProgress`. `Succeeded`:
   the version is in certification, and published when it passes, with the listing's current visibility.

The listing (texts, images, privacy answers, markets) isn't touched: change it in Partner Center.

**Repeating a run.** The API has no way to ask which version the store has, so a repeat uploads the package again.
If the store already has it, the submission ends as `NoModulesUpdated` and the step passes ("nothing new to
submit"). If a submission is still in certification, it ends as `InProgressSubmission` and the step fails, saying
so: wait for that certification to finish (or cancel it in Partner Center), then run with `stores` `edge`. Other
failures (`SubmissionValidationError`, `ModuleStateUnPublishable`, `UnpublishInProgress`) are shown with the
store's message; fix them in Partner Center and run again.

## Listing

**Extension name**: Unfret (from the manifest; read-only in Partner Center).

**Short description** (from the manifest's `description`, i.e. `package.json`'s; read-only in Partner Center, 115
characters):

```
Is this shop legit? Catch fake sellers on marketplaces, fake shops, fake discounts and dropshipping before you buy.
```

**Description** (250 to 10,000 characters): the Chrome description in [listing.en.md](listing.en.md), unchanged
(plain text with blank lines between paragraphs and "•" bullets).

**Category**: Shopping.

**Search terms** (at most 7 terms of at most 30 characters, 21 words in all; not shown to users; 7 terms, 14
words):

```
fake shop checker
free shopping checker
fake discount
dropshipping
Fakespot alternative
shopping safety
product reviews
```

**Images**:

- Extension logo (1:1, 300×300 recommended): `store/assets/logo-300x300.png` (rendered by `make icons` from
  `brand/unfret.svg`, the store icon's proportions).
- Small promotional tile (440×280): `store/assets/promo-small-440x280.png`.
- Large promotional tile (1400×560): `store/assets/promo-marquee-1400x560.png`.
- Screenshots (1280×800, at most 6): the five `store/screenshots/*.png`, in the order of
  [listing.en.md](listing.en.md).

**Website**: https://unfret.net · **Support**: hello@unfret.net · **Privacy policy**: https://unfret.net/privacy

## Privacy

The Edge package is the Chrome package, so what it reads, sends and stores is exactly what
[PRIVACY.md](../PRIVACY.md) and https://unfret.net/privacy describe, and the Privacy page's answers are the Chrome
Web Store's ([privacy-practices.md](privacy-practices.md)). The extension talks to the Unfret API and nothing else:
nothing goes to Microsoft from the extension. What Microsoft learns from the store itself (installs, ratings) is
the store's, under Microsoft's own terms, as with Google and Mozilla.
