# Changelog

Releases of the Unfret browser extension. (Earlier releases are described in their commit messages and in the
backend's changelog, which lists each one published at `/extension`.)

## 0.13.0 (2026-11-20)

- **The store summary, from the listing.** `package.json`'s `description`, which the build puts in the manifest and
  the Chrome Web Store and Edge show as the summary, is now the summary in `store/listing.en.md`: "Is this shop legit?
  Catch fake sellers on marketplaces, fake shops, fake discounts and dropshipping before you buy." (115 characters),
  instead of "Spot junk, dropshipping and scams on product pages before you buy." `store/EDGE.md` shows the new text,
  and `store/SUBMIT.md` says the Chrome summary comes from the package. The listing's description no longer names
  another product ("Looking for a Fakespot alternative?…"), which a store may reject as keyword spam.
- **The result card, as on the website** (backend #261). When part of the check didn't finish (the AI read of the
  page), a line under the headline says so: "Part of this check didn't finish (the AI read of the page), so this answer
  may be milder than it should be. It still counted as a check. Checking again after an hour may help." "What we
  checked" adds up: "What we checked: 16 checks in 5 areas", each area with its own count ("Who's behind the shop · 4
  checks"); a clean area is read out as "nothing to note". What the check cost is a sentence, the server's
  `charge_note` ("This check used one of your free checks; 4 are left.", "Quick checks are free.", "You checked this
  page recently, so no new check was used."); a check that used one is now said too, at the end. With an older server,
  the same words without the count.
- **The free quick check, always on offer.** Under "Check this page" (a deep check, which uses a check, a free deep
  check first) the popup now has a plain "Quick check (free)" button, with "Reads this page only, by Unfret's rules."
  under it, before every check and not only once the checks run out. Without a pass it works too: the quick check goes
  without a sign-in, as the server allows (backend 0.13.0), while "Check this page" waits for a pass. Out of checks,
  or with only free deep checks left while they're paused for the day, the main button is the quick check as before,
  and the second one isn't shown. Under a quick result the "A deep check also looks at…" suggestion still offers the
  deep check; without a pass its "Get checks" leads to the free checks (or buying checks, in a browser that had them).
  When a check finishes, the focus goes to that suggestion's button or to "Check this page". Too many quick checks in
  a minute (429) now say so instead of "The check failed". The hint under the buttons says "A deep check uses one
  check." instead of "One check per page.", and signed out "…or sign in for a deep check." The consent screen, the
  privacy statement and the store's privacy texts name the new button.
- **No more intro codes** (backend: intro codes purged). The gift code field takes only gift codes (`ufi_…`): a former
  intro code such as FRIENDS gets "That doesn't look like a gift code: they start with ufi_. Check it and try again.",
  as on the website, without asking the server. The messages for `INVITE_NOT_FOR_THIS_ACCOUNT`, `INVITE_ENDED` and
  `INTRO_DAILY_CAP`, which the server no longer sends, are gone. A code from your own pack (403 `INVITE_OWN_PACK`)
  now says "This gift code came with your own pack: give it to a friend." instead of "That gift code didn't work";
  the monthly limit, unknown and used codes are worded as before.
- **Store images for this release** (not part of the extension package): the promo tiles say "Check before you
  pay.", the website's tagline, instead of "Shop without the worry.", and the marquee's line names fake sellers on
  marketplaces first. The screenshots' results were checked again on dev.unfret.net (dates as the server now writes
  them, "November 18, 2026"; "Prices, delivery and returns" as the area's name) and the screenshots rendered from
  them, with the popup as it now is (the "Quick check (free)" button, what the check cost); they differ from the ones
  submitted with 0.12.0.

## 0.12.0 (2026-11-18)

- **The seller on Amazon's current offer box, in every language** (backend: the same fix): a combined label
  ("Verzender / Verkoper", "Shipper / Seller", "Expéditeur / Vendeur") fills both the seller and where it ships
  from, and the seller and shipper labels of de, fr, it, es, pl, se and tr are known. Four new made-up parity
  fixtures (nl, en, se, fr) and `test/seller-labels.test.ts`.
- **The brand from Amazon's byline, in every language** (backend: the brand from a marketplace byline): the
  byline's phrase is taken off ("Visit the X Store", "De X Store openen", "Besuche den X-Store", "Visiter la boutique
  X", "Marca: X", in en, nl, de, fr, it, es, pt, pl, se, tr and ja), as is a store word hyphened on ("X-winkel");
  the product's structured brand comes first (JSON-LD, the overview and detail tables' brand row, the byline link's
  brand filter); and a name that reads like a sentence or a store link is sent as no brand. `src/extract/brand.ts`
  is a line-for-line port of the backend's `facts/brand.py`; four new made-up parity fixtures (nl, fr, se) check
  both give the same brand and seller.
- **The result card**, as on the website and the Android app (backend: the result card): the same product sold
  elsewhere first, with both photos ("Looks like the same product, sold elsewhere for $X", from Unfret's image
  index, photos only through the API's own thumbnail proxy); each finding with its source ("Source: Domain registry
  (RDAP)"); "What you can do", one suggested next step; "What we checked", area by area, ticked, marked or not
  checked and why; a clean result says "Nothing worrying in 14 checks." Results without these fields (an older
  server, a cached result) look as before. "This is wrong" is now "Wrong result?", and a "Your shop? Object to this
  result" link opens the site's `/objection`. The share preview shows the card too.
- **One gift code a month.** A pass or wallet that already redeemed a gift code this calendar month is refused with
  429 `INVITE_MONTHLY_LIMIT` (backend B5); the popup and settings now say "You've already used a gift code this
  month; this one still works from December, or give it to someone else." (the month from `metadata.next_month`;
  "next month" without it) instead of "That invite didn't work". The help text under the code field says a gift code
  adds 5 checks to the pass or wallet in use, one a month, and not one from your own pack.
- **The page address a check sends is cleaned first** (security audit L8): without its fragment (`#…`), a user name
  or password, `;jsessionid=` in the path, and query parameters that are about the visitor rather than the product:
  tracking and referral parameters (`utm_*`, `hsa_*`, `gclid`, `fbclid`, `msclkid`, `mc_eid`, `igshid`, `ref`, `ref_`,
  affiliate tags, Amazon's search and placement trail, …), sessions and tokens (`sid`, `PHPSESSID`, `token`, …),
  `email`, and any parameter whose value is an e-mail address or an Unfret pass. What picks the product or its variant
  (`id`, `variant`, `th`, `size`, …) stays, as it was written. Relative links on the page (policy pages, photos) are
  resolved against the cleaned address too. The lists are the backend's (`result_cache.is_tracking_param`, from
  backend 0.13.0), copied by `make parity` into `test/fixtures/url-params.expected.json`, so the server keys an
  address the same whichever client sent it.
- **A reinstall without browser sync gets no second round of free checks.** Removing the extension wipes its
  `storage.sync` note when the browser doesn't sync, so the extension no longer makes its pass before the welcome page
  opens: it opens `/welcome?setup=1`, which tells it (a yes or no, through the welcome page's content script) whether
  the website's own note in this browser (the link checker's) says it had its free checks, and only then makes the
  pass, with free checks if neither note says so. The page then shows "You have 5 free checks", or says why the pass
  came without them, and a pass made with free checks sets the website's note too. The popup's "Get your free checks"
  opens the same page; it makes a pass by itself only when this profile's own note already rules the free checks out
  (an install that couldn't reach the server). A smoke test removes the extension and installs it again in the same
  profile.
- **Store texts for 0.12.0**: the listing's "How you pay" (5 free deep checks on install, then free quick checks;
  packs of 25 ($6, $5 with crypto) or 100 ($20) bought on unfret.net by card or crypto; gift codes of 5 checks, one
  per 25 checks bought, for any pass but the buyer's own, one a month), the accuracy page, "no
  affiliate links to shops", and the reviewer notes (the free checks on install; the test key only as a fallback, in
  the settings). The privacy statement and the store's privacy texts say what the address loses and what the welcome
  page tells the extension.

- **The privacy statement (`PRIVACY.md`) and the store's privacy texts match 0.12.0**: the free pass made on install
  (its proof-of-work request), the Unfret pass and its backup code in the settings, the free-checks note in
  `storage.sync`, every request the extension makes and when (the balance when the popup opens, reports, phone
  sign-in, the affiliate note), what stays in memory only, the hand-off rules with the extension's own confirmation
  window, and gift codes as the server now keeps them. The button is "Check this page", and questions go to
  hello@unfret.net.

- **A pass or wallet sign-in from unfret.net is taken only when you meant it.** Without an account yet, the extension
  takes a pass from the checkout page, or a wallet sign-in from the connect page, only right after a click on that
  page, or in a tab the extension opened itself (from the popup, the settings or after installing; for an hour, so a
  card payment's return still signs in by itself). Otherwise the page gets `needs-click` and shows a button. Signed
  in with another pass or wallet, the extension no longer switches when the page says the user agreed: it asks in a
  small window of its own, naming both accounts (and, for its free pass, that the free checks left come along), and
  only "Use the new pass" there switches; the page hears `confirm`, then `signed-in` or `kept`. A wallet sign-in
  from `/connect` follows the same rules (a renewed sign-in of the same wallet is taken as before); the connect page
  hears the new statuses as `{type: "unfret-session-status", status}`. The pages only take these from exactly
  `/checkout` and `/connect`, not from longer paths that start the same. The website's pages show the button and
  the "confirm in the Unfret window" step from the next backend release on; older pages still work, showing "no extension"
  where a click or the window is needed.
- **No pass or backup code in an address the extension opens.** The popup and settings open Unfret pages through
  the background, and every address the extension opens or links to (a shared result's link too) loses query
  parameters and fragments that carry a pass (`ufk_…`) or backup code (`ufr_…`).
- **Signed out, the popup offers your free checks.** Its main button is "Get your free checks" ("Get your 5 free
  checks" once the price list says how many): it makes the free pass as installing does, with free checks once per
  browser profile; when this browser had them, it says so and the button is "Buy checks". If the server has none to
  give today, the popup says so. "Sign in with an Unfret pass or wallet" stays the second choice, and "Have a code?"
  is a small "Have a gift code from a friend?" link (intro codes are retired; gift codes work for any pass but the
  buyer's own). The popup no longer says "Get your first checks with a code or by card".

- **The four verdicts in the website's words**: Looks fine, **Worth a look**, **Think twice** and **Serious
  concerns** (they were Looks fine, A few things to check, Some warning signs and Many warning signs). The popup
  shows the server's words as before; these are the words it shows when an older server sends no verdict, and the
  store listing's. The badge's symbols and colours are unchanged.
- **A verdict below "Looks fine" always names a reason.** The server always sends one; a result without any (from
  an older server) shows "Several small signals" instead of a verdict on its own.
- **"Unfret pass" and "backup code"**, as on the website: the popup and the settings page say "Unfret pass" where
  they said "API key" ("Sign in with an Unfret pass or wallet", "Paste your pass", "Use this pass"), and a pass's
  "backup code" where they said "recovery code". A pass is named by its ID as the site shows it: "Using Unfret pass
  ABCDE-FGHIJ". Only the words change: the key, how it is stored and what is sent stay the same.
- **"Gift code"**, as on the website: the popup and the settings page say "Have a gift code?" and "Gift code" where
  they said "Have an invite or intro code?" (placeholder "ufi_…"), and the messages after a code say "gift code"
  where they said "invite". Only the words change: the field still takes a retired intro code, which the server
  answers as ended.
- **The popup and the settings page look like unfret.net**: its green, its calm verdict colours (each verdict with
  its own: "Think twice" is no longer the same red as "Serious concerns"), its typeface (Figtree, bundled with the
  extension under the SIL Open Font License: no fonts or anything else are loaded from elsewhere), drawn signs instead
  of typed ones (Android showed ⚠ as a colour emoji) and the site's light and dark themes.
- **What matters now comes first.** A running check, its result or what went wrong is at the top, then the button,
  then the account; signed out, getting started comes first. After a result, checking the page again is a plain
  button under it rather than the biggest thing on screen. Before the first check is agreed to, the consent screen
  is the whole popup. Reasons are small cards with their tone on the edge, as on the site; "No check was used" sits
  under the headline. Signed out or out of checks, the account and the main button say so once, instead of a red card
  repeating them. The settings page's server field (for development) is folded away.
- **On a phone** (Firefox for Android shows the popup as a page): the popup takes the phone's width instead of a fixed
  360 px, every button, link and choice is at least 44×44 px, fields use 16 px text (no zooming in on focus), and
  nothing scrolls sideways at 360 px. A smoke test renders the popup and the settings page at 360×740.
- **Keyboard and screen readers**: buttons that were links are buttons; the verdict is a heading; a result, a running
  check or a problem is announced once instead of the whole result being read again on every change; opening the
  consent screen, the report form, a share preview or the sign-in choices moves the focus there, and agreeing to the
  consent moves it to the next step; "About & privacy" says whether it is open; a refused pass or code marks its
  field. Colours meet WCAG AA (the main button's white text is on a darker green than the site's, 6:1), fields have a
  visible 3:1 edge, and the one animation (the checklist's waiting dot) is off with reduced motion.
- **The Unfret test shop can be checked** (`/test-shop` on the site the extension uses: unfret.net, or dev.unfret.net
  for Unfret Dev), its product page and its checkout: it is a made-up store with every trick Unfret catches, for
  demos and trying Unfret out. Unfret's other pages (checkout, sign-in, welcome, …) still can't be checked.
- **Fixed: "Buy checks" appeared seconds after the popup opened** in a fresh browser. It waited for the price list
  (`/v1/pricing`), which the popup asked for only after reading its settings and the tab, and which on a cold
  connection costs a DNS lookup, a TLS handshake and the server's live SOL price; it was also the wrong question (it
  says whether crypto purchases are on, while cards work without them). The popup no longer asks for it: "Buy checks"
  and "Get more checks" show at once, and the checkout page says if buying is off. The same wait could leave "Buy
  checks" out of the "no checks left" message for good.
- **Fixed: out of checks on a page that can't be checked**, the hint said "This page can't be checked." under a "Get
  more checks" button. Out of checks, the button gets more checks on any page, so the hint now says "You have no
  checks left."; once there are checks again, it says the page can't be checked. While a check runs, the hint says
  the popup can be closed.
- **Free checks on install.** Unfret makes itself an Unfret pass when it's installed (no code, no account, no
  purchase) with 5 free deep checks, and the welcome page says "You have 5 free checks" and leads straight to
  checking a page; the popup says the same. A reinstall in the same browser profile gets a pass without free checks
  (a flag in `storage.sync`). Offline at install, the popup tries again when it opens. The pass's backup code is in
  the settings page, to save if you add checks to it.
- **An affiliate's link counts for the pass made on install.** When an affiliate's link (`unfret.net/?ref=CODE`)
  brought the user, the welcome page hands the code to the extension (a content script on `/welcome` only, like the
  checkout's), and the extension tells the server once with its own pass (`POST /v1/affiliates/attribute`), so the
  first pack bought on it gets the affiliate bonus. Nothing else is read from the page or sent with it.
- **Quick checks are free.** With no checks left, the button reads "Quick check (free)" (instead of "Get more checks"): the rules-only check of the
  page itself. While today's free deep checks are used up for everyone, the popup says "Free deep checks are back
  tomorrow" and a check becomes a quick one, saying why. Buying checks stays the "Buy checks" button.
- When the website hands the extension a bought pass while it uses its own free pass, the page says so, and on a
  switch the free checks left move to the new pass (`POST /v1/keys/move-free-checks`).
- Version 0.12.0. Needs backend 0.13.0 or later (`minBackendVersion`: the welcome page that makes the free pass, the
  extension hand-off answers, free passes, affiliate codes); production runs 0.12.0, so the backend release goes
  first, and the store workflow's order guard refuses a submission until it has.

## 0.11.0 (2026-11-16)

In short, since 0.10.0 (and for Firefox, whose store still has 0.9.1, also everything in 0.10.0):

- **Marketplace ads and service providers.** When you check a private seller's ad (Marktplaats, 2dehands, eBay,
  Vinted, Craigslist, Facebook Marketplace), Unfret now reads the ad and what the platform shows about the seller's
  account, never the seller's name. On a service provider's site or platform profile (a plumber, a locksmith; Werkspot,
  Thumbtack, Angi and others) it reads the business details the provider publishes: addresses, phone numbers, licence
  and KvK numbers, testimonials. Only when you click "Check this page", as always. What the server does with them
  depends on it having those checks switched on.
- **Business addresses kept, yours stripped.** A business's own address (its contact or imprint section) is now sent;
  your own details (account menu, delivery and billing addresses, forms) are still removed in the browser, and an
  account or checkout page sends no text at all.
- **A key from the website signs Unfret in by itself.** When the checkout page shows you a new key (an intro code,
  a card payment, a key recovery, "Make a new key"), it hands the key to the extension, which signs in with it: no
  copying and pasting. Signed in with another key or a wallet, the page asks first and nothing changes unless you
  agree. A new content script on `unfret.net/checkout*` (Unfret Dev: `dev.unfret.net/checkout*`) does this; it reads
  nothing else from the page and answers only with a status. Same host as the sign-in relay, so no new install
  warning. The privacy statement and the store's privacy notes say so.
- **A welcome page after installing** (`unfret.net/welcome`, once, never after an update): use a code, buy checks, or
  sign in with a key you have.
- **One next step in the popup.** Signed out: "Get started" (the welcome page), with the sign-in choices behind "Sign
  in with an API key or wallet"; after an expired sign-in the choices show at once. Out of checks: "Get more checks"
  in place of "Check this page"; signed in, "Get started" stays out of the way. Signed in with an API key, "Buy checks" and "Get more checks" (popup and settings)
  open that key's own top-up with its ID filled in (`/checkout?mode=topup&key_id=…`, never the key itself); they used
  to open the page that makes a new key.
- **"Have a code?"** When you aren't signed in, the popup and the settings page link to the website's one-step code
  page (Unfret Dev: dev.unfret.net): it makes you an API key with the code's checks and signs Unfret in with it. The
  in-extension "Have an invite or intro code?" stays for a new key or wallet.
- **The consent screen says so** (one new line about ads and service providers) and is asked once more
  (`CONSENT_VERSION` 2). Your sign-in stays; nothing is checked until you agree again.
- **Firefox** gets intro codes and "API key" as the first sign-in option for the first time (both from 0.10.0).
- **Privacy statement corrected:** product photos are fingerprinted on Unfret's own server, not sent to Google Cloud
  Vision.
- Needs backend 0.11.2 or later (`minBackendVersion`: the welcome page and the key hand-off; the page data needs
  0.10.6); production runs 0.11.1, so the backend release goes first. Details of each change below.

- **Parity fixture for a Houzz page without the provider** (`service-houzz-frame`): both sides read no profile and
  no reviews from it, which the backend now answers with "not analysed" (no check used) instead of "a few things to
  check" about nothing. The walmart expectations already match backend main (no countdown: `timers` is `[]`), so a
  regeneration changes nothing else
- **bol.com seller names without their rating label**: the seller block reads "Verkoop door Light Gallery NL
  beoordeeld met een 8,5", and the seller came out as "Verkoop door Light Gallery NL beoordeeld met een". The label
  before the name and the rating after it are dropped, and the page text is only a fallback when the offer's JSON-LD
  names no seller. A "Bedrijfsgegevens" or "Company details" link counts as the shop's imprint page. Both in parity
  with the backend; new parity fixture `bolcom-partner-rating`
- **Service platform profiles read as the platforms write them**, in parity with the backend: "4.5 ★ uit 160
  beoordelingen" is a 4.5 from 160 reviews (it was read as a 1 from 60), and "★ (350 reviews)", "4.9 ★★★★★ (143)",
  "312 verified reviews", "Years in Business: 15", "Responds within about 2 hours", "Reageert meestal binnen 2 uur",
  "356 klussen via Werkspot" and "KvK-nummer gecontroleerd" are read; "No reviews yet" / "Nog geen beoordelingen"
  is zero reviews. **HomeGuide** is a known platform (`homeguide`), and Houzz's "Best of Houzz" and "Verified
  License" are badges. A town called Evergreen in a page script is no longer a countdown. New parity fixtures for
  Werkspot (new and established), HomeAdvisor, Houzz, HomeGuide and a Dutch locksmith call-centre page

- **Marktplaats and 2dehands ads read from the ad's own JSON** (`window.__CONFIG__` in the page), in parity with the
  backend: bidding, pickup or shipping, the platform's payment protection, the date placed, the town, the category,
  the price and the whole photo gallery, and the account (private or business, how long on the platform). The same
  JSON names the seller and links their profile: only the listed fields are copied out of it, so no name, id or
  profile link is ever kept or sent (the header's JSON, which describes the visitor, isn't read). New parity fixture
  `p2p-marktplaats-config`; the parity test and `make parity` count "on the platform for 4 months" from a fixed day

- **Addresses written out in a footer or contact block** (a house number, street and ZIP, or a street, number and
  Dutch postcode) are read into `addresses` too, in parity with the backend, so a service company with several branch
  addresses in its footer is no longer told it shows none; a licence number with a dot (`#MP.00188386`) is read as
  one. Still only from the business's own areas, never from forms or the visitor's account. New parity fixture
  `service-footer-addresses`
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
- **Peer-to-peer ads are read** (`src/extract/p2p.ts`, a port of the backend's `facts/p2p.py`, in parity): on
  Marktplaats, 2dehands, eBay, Vinted, Craigslist and Facebook Marketplace the extension fills `listing` (price
  handling, condition, category, listing date, location, delivery, the platform's payment protection, the contact
  methods and payment requests the ad text mentions, and the ad's own text as `listing.description`) and
  `seller_profile` (seller type, member since, rating and count, badges, other ads, reply time). Never the seller's
  name. Facebook Marketplace needs a login, so the extension is the only way to check it; its areas are found by
  their headings. Parity fixtures for each platform; the backend's results for ads need its expansion classes on.
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
