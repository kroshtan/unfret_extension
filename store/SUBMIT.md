# Submitting Unfret to the Chrome Web Store

Everything Claude could prepare is in this folder. These are the steps only you can do, in order.

## Before you upload

- [ ] **Production on the current backend, on mainnet.** The store build talks to https://unfret.kroshtan.com, so
      production must run the release with no trial, the pack prices, card payments and the admin grant endpoint,
      started by you with the Deploy production workflow.
- [ ] **Card payments live on production** (Polar ID check done, production token and webhook set). Until then,
      take "which you can also top up by card" and "a little more by card" out of both listing texts.
- [ ] **Review the privacy statement** at https://unfret.kroshtan.com/privacy (the store links to it, and its wording on
      Scaleway still needs your check).
- [x] **Approve the icon and images** (approved 2026-11-09): `icons/icon-128.png`, `store/assets/promo-small-440x280.png`,
      `store/assets/promo-marquee-1400x560.png`, `store/screenshots/*.png`. Re-render with `make icons` and
      `make screenshots` after changing `brand/*.svg` or the popup.
- [ ] **Build the package**: `make release` writes `dist/release/unfret-chrome-<version>.zip` (the store zip: no
      `key`, no `update_url`; the store gives the extension its own ID, different from the self-hosted one).

## In the developer dashboard (https://chrome.google.com/webstore/devconsole)

1. **Account**: complete the trader declaration (DSA): you sell checks, so you're a trader. It shows your business
   name, address (use the KvK business address), e-mail and phone publicly in the EU.
2. **New item** → upload `dist/release/unfret-chrome-<version>.zip`.
3. **Store listing**: copy from `store/listing.en.md` (name, summary, description, category Shopping, language
   English). Add the Dutch translation from `store/listing.nl.md` under "Localized listings". Upload the icon,
   screenshots and promo images listed at the end of `listing.en.md`. Homepage and support URLs are there too.
4. **Privacy practices**: copy from `store/privacy-practices.md` (single purpose, one justification per permission,
   remote code "No", the data usage ticks and certifications, privacy policy URL).
5. **Distribution**: public, all regions (or start with the EU and US).
6. **Test instructions**: create the reviewer's test key as in `store/reviewer-notes.md` and paste its block with the
   key filled in.
7. **Submit for review.** Choose "Defer publishing" if you want to press Publish yourself after approval. Reviews
   usually take a few days; first submissions with a payment flow can take longer.

## After approval

- The store version gets its own extension ID. The self-hosted channel (https://unfret.kroshtan.com/extension) keeps
  ID `kpllgmbgfmnlpnmkibmhflkafhilckfe`; both talk to the same API, and accounts work in both.
- When the store version is live, retire the self-hosted production channel (the dev channel stays, by policy).
