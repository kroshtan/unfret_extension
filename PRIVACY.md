# Unfret privacy policy (browser extension)

_Last updated: 10 November 2026 (version 0.9.0). Draft for the store listings; to be reviewed before publication._

Unfret is made by Kroshtan (Floris van Beers, the Netherlands).

## What the extension reads

Nothing, until you click **Analyse this page**. Then it reads the page in the tab you are looking at:
product facts (title, brand, seller, price, ratings, review texts and dates, shop policies, hidden text,
checkboxes, countdowns) and the visible product text.

Before anything leaves your browser, the extension removes account menus, delivery addresses, greetings, forms
and input fields from a copy of the page. The page itself is not changed.

The extension has no standing access to any website. It can read a page only after you click its toolbar button on
that page (the browser's `activeTab` grant, for that one tab). On Amazon and bol.com product pages the toolbar icon
gets a small marker: the browser sets it itself from the page address (`declarativeContent`); the extension does not
see the page or its address.

## What is sent, and to whom

Only to the Unfret API (`unfret.kroshtan.com`, hosted in the EU), when you click "Check this page":

- the page address and the product facts and text described above;
- your session token, which identifies the Solana wallet you signed in with.

Two more requests go to the same API, and only when you ask for them:

- **Share this result**: the page address and that check's result, sent **without** your session token or API key,
  so the shared result is not tied to your account. Unfret first shows you exactly what the public page will contain
  (the product's title and link, the shop, the day of the check and the verdict; no score and no quotes from the page);
  nothing is stored until you click **Share**. The page is then public at `unfret.kroshtan.com/r/…` for anyone with
  the link, for 90 days, and never says who checked. You get a delete code, shown once, to remove it sooner.
- **Have an invite?**: the invite code you enter, with your sign-in, to add its checks to your account. Invite codes
  are not linked to whoever bought the pack they came with.

The extension makes no other network requests: no analytics, no trackers, no third parties.

## What is stored

In your browser: your session (token, wallet address, expiry), whether your last sign-in expired, and your
settings. Analysis results are kept only in memory (the browser's session storage, so a result survives the
extension's background process going to sleep); they are cleared when you leave the page or close the browser and
are never written to disk. A shared result's link and delete code are kept the same way, with that result. Invite
codes you enter are not kept at all.

The extension is in English and asks Unfret for English results; it sends nothing about your browser's language.

On the server: your wallet address and its credit balance. The server does not keep the addresses or contents of
the pages you analyse, and does not link what you analysed to your wallet. For product pages with a public product
number (an Amazon ASIN, a bol.com ID or a barcode) it keeps an anonymous price observation for 90 days: a one-way
hash of the shop's domain and that number, the day, the price and the claimed "was" price, with no address, wallet,
IP address or time of day. That is how Unfret tells whether a "was" price was ever really charged. A result you
share is kept for 90 days (or until you delete it) as the preview showed it, without anything about who shared it;
the server keeps only a fingerprint of its delete code. An invite is kept only as a fingerprint with the day it was
issued and the day it was used, with no buyer and no redeemer. The product
photo itself (the image only, fetched by the server) is looked up with Google Cloud Vision to find copies on
wholesale sites. The full server-side statement: <https://unfret.kroshtan.com/privacy>.

## Your consent

The first time you open the extension it explains what it does, what is sent and when, and how paying works, and
analyses nothing until you click **I agree**. Your agreement (and which version of that screen you agreed to) is
stored in your browser. You can reread it any time under **About & privacy** in the popup.

## Signing in

Signing in means signing a plain-text message with your Solana wallet. It costs nothing and gives Unfret no
right to spend from your wallet. Buying checks is a separate transaction you approve in your wallet.

## Your choices

Sign out in the extension's settings to remove the session from your browser. Uninstalling the extension removes
everything it stored. Questions: see the contact details at kroshtan.com.
