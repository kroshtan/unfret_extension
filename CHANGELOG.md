# Changelog

Releases of the Unfret browser extension. (Earlier releases are described in their commit messages and in the
backend's changelog, which lists each one published at `/extension`.)

## Unreleased

- **Automated store submission.** "Release to the extension stores" now also submits the packages it builds
  (`scripts/store-publish.mjs`, plain HTTPS, no new dependencies): the Chrome zip to the Chrome Web Store item for
  review through the API v2, authenticated with the owner's OAuth client and refresh token (`CWS_CLIENT_ID`,
  `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_PUBLISHER_ID`; `scripts/cws-refresh-token.mjs` gets the token once
  into `~/kroshtan_secrets`) or a service account linked to the publisher (`CWS_SERVICE_ACCOUNT_KEY`), and
  the Firefox zip as a new listed version on addons.mozilla.org through the API v5 (JWT from `AMO_JWT_ISSUER`,
  `AMO_JWT_SECRET`) with the source zip, Firefox desktop only. New inputs: `stores` (both, chrome, firefox, none) and
  `dry_run` (default on: build, check and print every store request without secrets; nothing is attached, tagged or
  uploaded). Each store is its own step, skipped with a notice without its secrets, and a version a store already has
  is left alone. **Order guard:** `minBackendVersion` in `package.json` (0.10.6, the first backend release after 0.10.5, with the
  foundation for p2p and service pages and the service providers' facts) must be at most the `version` https://unfret.net/v1/health reports, or
  nothing is submitted. `store/SUBMIT.md` and `store/AMO.md` describe the one-time credentials and the new release
  steps.
- **Testimonials and service platform profiles** (in parity with the backend, `make parity`): `testimonials` is now
  `{text, name, rating, posted}`, from the company's structured data (its `review`s) or elements marked as one
  testimonial or review (and Review microdata), never from forms or account areas and not on a product page; the name
  only as the site prints it. On Werkspot, Thumbtack, Angi and the other service platforms, `seller_profile` (with the
  new `years_in_business`) comes from the profile's structured data and the platform's wording outside the visitor's
  areas (a logged-in visitor's own "member since" is skipped), and the platform's reviews go into `reviews` without
  names. New parity fixtures: NL and US service sites (an established company and a doorway-style locksmith each) and
  Werkspot, Thumbtack and Angi profiles. The privacy policy says what is read from service pages. Needs a backend
  with the service providers' facts (an older one rejects testimonial objects)
- **Page facts for more kinds of pages** (kept in parity with the backend's extractors, `make parity`): public product
  IDs (GTIN/EAN, MPN, ASIN), payment methods mentioned, the phone numbers (typed: mobile, local, national, toll-free,
  premium), e-mail addresses (own domain or webmail) and addresses a business publishes, "since 1998" claims, business
  name and legal form, KvK and US licence numbers, certification, pricing and response-time snippets, cities served,
  same-site links and Organization/LocalBusiness data; plus empty `seller_profile` and `listing` for the platform
  readers to come. The platform is recognised on eBay, Marktplaats, 2dehands, Vinted, Craigslist, Facebook, Werkspot,
  Thumbtack, Angi, HomeAdvisor, Checkatrade, TaskRabbit, Bark, Houzz and MyHammer. On the classifieds platforms the
  seller's name is dropped (also from the offer's structured data). Needs a backend that knows the new platform values
  (an older one refuses them): release only after the backend.
- **Addresses: keep the business's, strip the visitor's.** The page text used to lose every element marked as an
  address. Now an address is kept where the business publishes its own (a contact, legal or imprint section,
  Organization or address microdata) and stripped everywhere else, including a plain `<address>` outside such a
  section; checkout, billing, delivery-address, login and user-menu areas are stripped too, and an account or checkout
  page sends no text at all. The business facts follow the same rules. Tests cover a logged-in shop page, service
  company pages and a classifieds ad (`test/privacy.test.ts`).

## 0.10.0 (2026-11-15)

- **Intro codes.** "Have an invite or intro code?" also takes the named codes Unfret hands out (FRIENDS, DEV, …):
  3 to 24 letters or digits, in any case, sent upper case. They work like invites (new accounts only, one per
  account) and add their own number of checks; the server's new refusals ("This code has ended", today's free
  checks are gone) are shown in its own words.
- **API key first.** The popup's sign-in buttons start with "API key", then the wallets, matching the website
  (card payments go to an API key).

- **Firefox (addons.mozilla.org).** The store workflow, now "Release to the extension stores", also attaches the
  Firefox zip and the source zip AMO asks for (`git archive` of the release commit; `npm ci && npm run build` rebuilds
  the Firefox zip byte for byte), with one SHA256SUMS for all three, replaced when a package is added to an older
  release. `store/AMO.md` has the submission steps, listing texts and reviewer notes. Node is pinned to 22 (`.nvmrc`,
  `engines`). Version 0.9.1's Firefox and source zips were attached to its release by hand, built the same way.

## 0.9.1 (2026-11-10)

- **Unfret moves to unfret.net.** The extension talks to https://unfret.net (Unfret Dev to https://dev.unfret.net),
  its host permission and the sign-in page's content script follow, the self-hosted channel updates from
  `unfret.net/extension`, and the store texts, privacy statement and first-run notice name the new host. The old
  names redirect to the new ones, so 0.9.0 keeps working until it updates.

## 0.9.0 (2026-11-10)

- **Share this result.** Under a finished check, "Share this result" shows exactly what the public page will contain
  (the server's preview: product title and link, shop, day, verdict; no score, no quotes from the page) and the
  server's notice, and only "Share" makes it. Both requests go without Authorization, so the page at `/r/<id>` names
  no account. The popup shows the link with "Copy link", and the delete code once with what it's for ("Copy delete
  code"); both stay with the tab's result in session memory until the tab moves on. Refusals (too old, checkout page,
  not shareable, too many) are explained in plain words.
- **Have an invite?** In the popup's account section and on the settings page, when signed in: enter an invite code to
  add its 3 checks to the account in use (a new wallet or a key that never had checks). The server's reasons for a
  refused code are shown as it words them; an expired sign-in signs out. The code is sent once and never stored.
- **Invites in the listing.** The store text says each pack comes with invites to give away (25 + 1 invite of 3
  checks, 50 + 2, 100 + 4). The codes themselves are shown once by the website's checkout page after payment:
  purchases happen there ("Buy checks" opens it), not in the extension.
- **English only.** The Dutch translation and the translation machinery are gone (`_locales`, `chrome.i18n`, the
  language switch): all text is in the code and pages, in English, and the extension always asks the API for English.
  What the server writes about a page is shown as it comes. The manifest's description is plain text, and the Dutch
  store listing is removed.
- **Copyright lines.** Page facts carry the footer's copyright lines (`copyright_lines`, up to three: "© 2026 Acme
  Outdoor LLC. All rights reserved."), as the backend's own extractor does, so the server can name a US shop's company
  when it's only in the footer. A copyright line never counts as an imprint. `make parity` runs the renamed backend
  again (`unfret.facts`).
- "Have an invite?" is hidden for an account that has had checks, where no code would be accepted (the server's new
  `invite_eligible` in `/v1/credits`; shown as before when a server doesn't send it).
- The connect page's sign-in message is also accepted under its new name, `unfret-session` (answered with
  `unfret-session-received`), so the site can switch to it once this version is in use; `veridex-session` keeps
  working until then.
- Privacy statement and store privacy practices: shared results (public, 90 days, no account attached, delete code)
  and invites (not linked to the buyer).
