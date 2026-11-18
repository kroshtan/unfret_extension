# Chrome Web Store: privacy practices tab

Copy these into the developer dashboard (Privacy practices). They match https://unfret.net/privacy and the
manifest built by `scripts/manifest.mjs` (Chrome store build: `dist/chrome`).

## Single purpose

Unfret has one purpose: when the user clicks "Check this page" (or the free "Quick check"), it checks the product
page in the current tab for signs of scams, dropshipped generic goods, fake discounts and manipulative sales tricks,
and shows the result in plain words.

## Permission justifications

**activeTab**: The extension reads a page only after the user clicks its toolbar button and then "Check this page"
or "Quick check (free)". activeTab gives access to that one tab for that one click, so the extension needs no
standing access to any website.

**scripting**: Used together with activeTab to run the page reader (`extract.js`) in the tab the user chose to check.
It collects the product facts (title, brand, seller, price, ratings, review texts, shop policies), the contact details
the shop publishes about itself, the names in the page's code that identify its apps (class names, ids and data
attribute names, without their values) and the other sites it refers to, and the visible text, with account menus, forms and typed input, checkout and
delivery areas and the user's own addresses removed. Nothing is injected anywhere else.

**storage**: Stores the user's sign-in (an Unfret pass, or a wallet's session), their consent, their settings, and the
public ID and backup code of the free pass the extension made on install (the backup code is shown in the settings);
in `storage.sync`, only whether this browser profile already had its free checks. In session storage (memory,
cleared when the browser closes): the result of the last check per tab, with that result's shared link and delete code
if the user shared it, a phone sign-in still waiting, which tabs the extension opened on unfret.net, and a pass the
website handed over while the extension asks the user about it. No browsing history is stored.

**declarativeContent**: Lets the browser itself show a small marker on the toolbar icon on supported marketplace
product pages (Amazon, bol.com), so the user knows a check is possible there. The extension never sees those pages:
the browser applies the rule, and no page access is granted.

**Host permission (content scripts on `https://unfret.net/connect*`, `https://unfret.net/checkout*` and
`https://unfret.net/welcome*`)**: three of Unfret's own pages. After the user signs in with their wallet on the
sign-in page, that page hands the session to the extension; when the checkout page shows the user a new Unfret pass
(from a gift code, a card payment, a recovery), it hands that pass to the extension, so the user doesn't have to copy
and paste it; the welcome page hands over whether this browser already had its free checks (a yes or no, from the
website's own note, so a reinstall gets no second round) and an affiliate's code if an affiliate's link brought the
user. Each content
script reads nothing from the page but the one message the page posts for it, accepts it only from that page's own
window on Unfret's origin, and answers the page with a status only. Without an account yet, the extension takes a
pass or sign-in only right after the user clicked on that page, or in a tab the extension opened itself; signed in
with another account, it changes nothing unless the user chooses the new one in the extension's own confirmation
window. The pass only goes from the page to the extension, never back, and nothing goes to anyone else. They run on
no other site.

**Optional host permissions (http://localhost/\_, http://127.0.0.1/\_)**: Requested only if a developer chooses a
local server in the extension's settings. Never requested for normal use.

**Remote code**: No. All code is in the package; the extension only exchanges JSON with the Unfret API.

## Data usage

What the extension collects (tick these):

- **Website content**: the product facts and cleaned visible text of a page, only when the user clicks "Check this
  page", sent to the Unfret API to produce the result.
- **Web history**: the address of the page the user chose to check, sent with that check without its fragment,
  tracking and referral parameters, sessions, tokens or e-mail addresses (not stored by the server, never linked to
  the user). If the user shares a result (after a preview of the public page, and only on their
  click), that address and the result go to the Unfret API without any sign-in, and become a public page with no
  account attached, for 90 days.
- **Authentication information**: the user's Unfret pass (an anonymous API key, made on install or got on
  unfret.net) or wallet session token, kept in the browser and sent to the Unfret API to pay for checks; the free
  pass's backup code, kept in the browser only.

Not collected: personally identifiable information, health information, financial and payment information (payments
happen in the user's wallet or on the payment provider's page, not in the extension), personal communications,
location, user activity (clicks, keystrokes, mouse movement).

Certifications (all true):

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Privacy policy URL: https://unfret.net/privacy
