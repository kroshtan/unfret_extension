# Submitting Unfret to the Chrome Web Store

Everything Claude could prepare is in this folder. These are the steps only you can do, in order.

## Before you upload

- [ ] **Production on the current backend, on mainnet.** The store build talks to https://unfret.net, so
      production must run the release with no trial, the pack prices, card payments and the admin grant endpoint,
      started by you with the Deploy production workflow.
- [ ] **Card payments live on production** (Polar ID check done, production token and webhook set). Until then,
      take "which you can also top up by card" and "a little more by card" out of both listing texts.
- [ ] **Review the privacy statement** at https://unfret.net/privacy (the store links to it, and its wording on
      Scaleway still needs your check).
- [x] **Approve the icon and images** (approved 2026-11-09): `icons/icon-128.png`, `store/assets/promo-small-440x280.png`,
      `store/assets/promo-marquee-1400x560.png`, `store/screenshots/*.png`. Re-render with `make icons` and
      `make screenshots` after changing `brand/*.svg` or the popup.
- [ ] **Build the package**: Actions → **Release to the extension stores** → Run workflow (input `main`) checks the
      commit, builds and checks the store zip and attaches `unfret-chrome-<version>.zip` to the Forgejo release
      `v<version>` (locally, `make store-package` writes the same file to `dist/store/`). The store zip has no `key`
      and no `update_url`: the store gives the extension its own ID, different from the self-hosted one. With the
      store credentials set (below), the same run uploads it and submits it for review.

## Releasing a new version (automated)

Once the item exists (the first version went through the dashboard steps below) and the secrets are set, a release
is one workflow run:

1. Bump `version` in `package.json` (and the CHANGELOG), merge, wait for CI and Unfret Dev.
2. **Backend first.** If the release needs a newer backend, raise `minBackendVersion` in `package.json` to the backend
   release that accepts its page data, and deploy that backend to production. The workflow reads `version` from
   https://unfret.net/v1/health and refuses to submit anything to a store while production is older.
3. Actions → **Release to the extension stores** → Run workflow: `ref` `main`, `stores` `both` (or `chrome`,
   `firefox`), **Dry run** ticked. Read the log: the order guard's result and every request a real run would send
   (secrets shown as `<NAME>`). Nothing is attached, tagged or uploaded.
4. Run it again with **Dry run** unticked. It attaches the packages to the release `v<version>`, then:
   - **Chrome Web Store** (API v2): gets an access token from the OAuth refresh token (or for a service account),
     uploads
     `unfret-chrome-<version>.zip` to item `giiengbpechhnphignbicmlcbklmcpjo` and submits it for review; it is
     published when approved, with the item's current visibility. A version the store already has (pending review
     or published) is skipped, so a run can be repeated. To hold a version back after approval, use the dashboard.
   - **addons.mozilla.org**: see [AMO.md](AMO.md#releasing-a-new-version-automated).
     A store whose secrets aren't set is skipped with a notice; an API error fails that step (the other store still
     runs) with the store's own message. Locally: `make store-package && node scripts/store-publish.mjs --dry-run`.

Listing texts, images and privacy answers are not sent by the workflow: change them in the dashboard.

## The store credentials (once)

You do this; Claude can't. Everything stays in `~/kroshtan_secrets` and in the repository's Forgejo secrets
(git.kroshtan.com → kroshtan/unfret_extension → Settings → Actions → Secrets), never in the repository.

### Chrome Web Store: the OAuth client and its refresh token

The account is the Google account that owns the item, with 2-step verification on.

**The OAuth client** (done: it is in `~/kroshtan_secrets/google-webstore-oauth`, mode 600, line 1 the client ID
`….apps.googleusercontent.com`, line 2 the client secret). To make one again:

1. https://console.cloud.google.com → project picker → **New project** (e.g. "unfret-cws"), and select it.
2. **APIs & Services → Library**: search "Chrome Web Store API" → **Enable**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform): **Get started**; app name "Unfret release",
   your e-mail as support and developer contact; audience **External**. Leave the publishing status at **Testing**
   and, under **Audience → Test users**, add the owner account. No scopes need adding here.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**: type **Desktop app**, name
   "unfret-release" → **Create**. Put the client ID and secret on lines 1 and 2 of
   `~/kroshtan_secrets/google-webstore-oauth` (`chmod 600`).

**The refresh token**:

5. Run `node scripts/cws-refresh-token.mjs`. It reads `~/kroshtan_secrets/google-webstore-oauth` (`--client <file>`
   for another; a JSON file with `client_id` and `client_secret`, or Google's download, works too) and opens Google's
   consent page in the browser (`--print-url` prints the address instead, e.g. without a desktop). Sign in as the
   owner, continue past "Google hasn't verified this app" (it's your own app) and allow "See, edit, update or publish
   your Chrome Web Store extensions". The browser comes back to a one-off page on 127.0.0.1 and the script writes the
   refresh token to `~/kroshtan_secrets/google-webstore-refresh-token` (mode 600; `--out <file>` for another). It
   prints neither the secret nor the token. If the client is a **Web application** rather than a Desktop app, add
   `http://127.0.0.1:8765/` to its authorised redirect URIs and run the script with `--port 8765`. On a machine
   without a browser, open the address elsewhere and paste the address of the page that fails to load into the
   script.
6. The **publisher ID**: https://chrome.google.com/webstore/devconsole → **Publisher → Settings** (API v2 needs it
   in every request). It isn't secret; keep it with the others, e.g. in `~/kroshtan_secrets/google-webstore-publisher-id`.
7. Forgejo secrets: `CWS_CLIENT_ID` = line 1 of `google-webstore-oauth`, `CWS_CLIENT_SECRET` = line 2,
   `CWS_REFRESH_TOKEN` = the content of `google-webstore-refresh-token`, `CWS_PUBLISHER_ID` = the publisher ID.

Refresh tokens of an app whose consent screen is in **Testing** expire after 7 days: rerun step 5 and update
`CWS_REFRESH_TOKEN` before each release, or set the consent screen to **In production** (a personal app with this
one scope can be used unverified, behind the same warning screen) so the token lasts until it is revoked or unused
for six months. A failed token exchange (`invalid_grant`) in the workflow means exactly this: rerun step 5.

### Chrome Web Store alternative: a service account

The API v2 also accepts a Google Cloud service account linked to the publisher
(https://developer.chrome.com/docs/webstore/service-accounts): no refresh token to expire. The workflow uses it when
`CWS_SERVICE_ACCOUNT_KEY` is set and the three OAuth secrets aren't.

1. In the same project: **IAM & Admin → Service accounts → Create service account**, name "unfret-release", no
   roles. On it: **Keys → Add key → Create new key → JSON**; save as `~/kroshtan_secrets/cws-service-account.json`
   (`chmod 600`).
2. Developer dashboard → **Account**: add the service account's e-mail as the publisher's service account (one per
   publisher).
3. Forgejo secrets: `CWS_SERVICE_ACCOUNT_KEY` = the whole JSON file, `CWS_PUBLISHER_ID` = the publisher ID; delete
   `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` and `CWS_REFRESH_TOKEN`.

### addons.mozilla.org: an API key

1. https://addons.mozilla.org/developers/addon/api/key/ (Developer Hub → **Tools → Manage API Keys**), signed in as
   the add-on's owner → **Generate new credentials**.
2. Put them in `~/kroshtan_secrets/amo-api.json` (`chmod 600`):

   ```json
   { "jwt_issuer": "user:12345678:123", "jwt_secret": "64 hex characters" }
   ```

3. Forgejo secrets: `AMO_JWT_ISSUER` = `jwt_issuer`, `AMO_JWT_SECRET` = `jwt_secret`. Optionally
   `AMO_APPROVAL_NOTES`: the "Notes to reviewer" block from [AMO.md](AMO.md) with the test key filled in; each new
   version then carries it.

## The first submission, in the developer dashboard (https://chrome.google.com/webstore/devconsole)

The API can't create an item or fill in its listing: the first version goes through these steps once.

1. **Account**: complete the trader declaration (DSA): you sell checks, so you're a trader. It shows your business
   name, address (use the KvK business address), e-mail and phone publicly in the EU.
2. **New item** (later releases: the workflow does this, see above) → upload `unfret-chrome-<version>.zip` from the
   release.
3. **Store listing**: copy from `store/listing.en.md` (name, summary, description, category Shopping, language
   English; the extension is English-only, so there is no localized listing). Upload the icon,
   screenshots and promo images listed at the end of `listing.en.md`. Homepage and support URLs are there too.
4. **Privacy practices**: copy from `store/privacy-practices.md` (single purpose, one justification per permission,
   remote code "No", the data usage ticks and certifications, privacy policy URL).
5. **Distribution**: public, all regions (or start with the EU and US).
6. **Test instructions**: create the reviewer's test key as in `store/reviewer-notes.md` and paste its block with the
   key filled in.
7. **Submit for review.** Choose "Defer publishing" if you want to press Publish yourself after approval. Reviews
   usually take a few days; first submissions with a payment flow can take longer.

## After approval

- The store version gets its own extension ID. The self-hosted channel (https://unfret.net/extension) keeps
  ID `kpllgmbgfmnlpnmkibmhflkafhilckfe`; both talk to the same API, and accounts work in both.
- When the store version is live, retire the self-hosted production channel (the dev channel stays, by policy).
