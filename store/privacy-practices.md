# Chrome Web Store: privacy practices tab

Copy these into the developer dashboard (Privacy practices). They match https://unfret.net/privacy and the
manifest built by `scripts/manifest.mjs` (Chrome store build: `dist/chrome`).

## Single purpose

Unfret has one purpose: when the user clicks "Check this page" (or the "Quick check"), it checks the product page in
the current tab for shops that may not deliver, products that may not work as described, dropshipped generic goods,
fake discounts and manipulative sales tricks, and shows how risky the page looks (a level from 0 to 4) and why, in
plain words.

## Permission justifications

**activeTab**: The extension reads a page only after the user clicks its toolbar button and then "Check this page"
or "Quick check (free)". activeTab gives access to that one tab for that one click, so the extension needs no
standing access to any website.

**scripting**: Used together with activeTab to run the page reader (`extract.js`) in the tab the user chose to check.
It collects the product facts (title, brand, seller, price, ratings, review texts, shop policies), the contact details
the shop publishes about itself, the names in the page's code that identify its apps (class names, ids and data
attribute names, without their values) and the other sites it refers to, and the visible text, with account menus, forms and typed input, checkout and
delivery areas and the user's own addresses removed. Nothing is injected anywhere else.

**storage**: Stores the user's consent, their settings and, only if they turn on "Count my reports" in the settings,
a random contributor key made in the browser (sent only with their "Wrong result?" reports, never with a check). In
session storage (memory, cleared when the browser closes): the result of the last check per tab, with the request it
was made from (for "Wrong result?"), and that result's shared link and delete code if the user shared it. No account,
no sign-in and no browsing history are stored. (Older versions kept an anonymous pass; it is deleted on update.)

**declarativeContent**: Lets the browser itself show a small marker on the toolbar icon on supported marketplace
product pages (Amazon, bol.com), so the user knows a check is possible there. The extension never sees those pages:
the browser applies the rule, and no page access is granted.

**Optional host permissions (http://localhost/\_, http://127.0.0.1/\_)**: Requested only if a developer chooses a
local server in the extension's settings. Never requested for normal use.

**Remote code**: No. All code is in the package; the extension only exchanges JSON with the Unfret API.

## Data usage

What the extension collects (tick these):

- **Website content**: the product facts and cleaned visible text of a page, only when the user clicks "Check this
  page" or "Quick check", sent to the Unfret API to produce the result. If the user reports a result as wrong (on
  their click, after choosing what is wrong), that page's facts and text go back with the report; the report keeps the
  page, with personal details removed, and never who sent it.
- **Web history**: the address of the page the user chose to check, sent with that check without its fragment,
  tracking and referral parameters, sessions, tokens or e-mail addresses (not stored by the server, never linked to
  the user). If the user shares a result (after a preview of the public page, and only on their
  click), that address and the result go to the Unfret API with nothing that names the user, and become a public
  page for 90 days.

Not collected: authentication information (there is no account, sign-in or pass; checks are free and not tied to
anyone), personally identifiable information, health information, financial and payment information (donations
happen on the payment provider's page, not in the extension), personal communications, location, user activity
(clicks, keystrokes, mouse movement).

Certifications (all true):

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Privacy policy URL: https://unfret.net/privacy
