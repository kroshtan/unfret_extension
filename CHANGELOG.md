# Changelog

Releases of the Unfret browser extension. (Earlier releases are described in their commit messages and in the
backend's changelog, which lists each one published at `/extension`.)

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
- Privacy statement and store privacy practices: shared results (public, 90 days, no account attached, delete code)
  and invites (not linked to the buyer).
