# Chrome Web Store: privacy practices tab

Copy these into the developer dashboard (Privacy practices). They match https://unfret.net/privacy and the
manifest built by `scripts/manifest.mjs` (Chrome store build: `dist/chrome`).

## Single purpose

Unfret has one purpose: when the user clicks "Check this page", it checks the product page in the current tab for
signs of scams, dropshipped generic goods, fake discounts and manipulative sales tricks, and shows the result in plain
words.

## Permission justifications

**activeTab**: The extension reads a page only after the user clicks its toolbar button and then "Check this page".
activeTab gives access to that one tab for that one click, so the extension needs no standing access to any website.

**scripting**: Used together with activeTab to run the page reader (`extract.js`) in the tab the user chose to check.
It collects the product facts (title, brand, seller, price, ratings, review texts, shop policies) and the visible text,
with account menus, addresses, forms and typed input removed. Nothing is injected anywhere else.

**storage**: Stores the user's sign-in session or API key, their consent, their settings and the result of the last
check per tab (session storage, cleared when the browser closes), with that result's shared link and delete code if the
user shared it. No browsing history is stored.

**declarativeContent**: Lets the browser itself show a small marker on the toolbar icon on supported marketplace
product pages (Amazon, bol.com), so the user knows a check is possible there. The extension never sees those pages:
the browser applies the rule, and no page access is granted.

**Host permission (content script on https://unfret.net/connect\*)**: Unfret's own sign-in page. After the
user signs in with their wallet there, the page hands the session to the extension through this content script. It
runs on no other site.

**Optional host permissions (https://dev.unfret.net/\_, http://localhost/\_, http://127.0.0.1/\*)**:
Requested only if a developer chooses the test server or a local server in the extension's settings. Never requested
for normal use.

**Remote code**: No. All code is in the package; the extension only exchanges JSON with the Unfret API.

## Data usage

What the extension collects (tick these):

- **Website content**: the product facts and cleaned visible text of a page, only when the user clicks "Check this
  page", sent to the Unfret API to produce the result.
- **Web history**: the address of the page the user chose to check, sent with that check (not stored by the server,
  never linked to the user). If the user shares a result (after a preview of the public page, and only on their
  click), that address and the result go to the Unfret API without any sign-in, and become a public page with no
  account attached, for 90 days.
- **Authentication information**: the user's session token or API key, kept in the browser and sent to the Unfret
  API to pay for checks.

Not collected: personally identifiable information, health information, financial and payment information (payments
happen in the user's wallet or on the payment provider's page, not in the extension), personal communications,
location, user activity (clicks, keystrokes, mouse movement).

Certifications (all true):

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Privacy policy URL: https://unfret.net/privacy
