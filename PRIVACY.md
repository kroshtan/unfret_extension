# Unfret privacy policy (browser extension)

_Last updated: 17 November 2026 (version 0.12.0: a free Unfret pass made on install, free quick checks; 0.11.0: a new key from the checkout page signs the extension in, welcome page after installing; earlier: photo lookup corrected, service providers and private sellers' ads added). Draft for the store listings; to be reviewed before publication._

Unfret is made by Kroshtan (Floris van Beers, the Netherlands).

## What the extension reads

Nothing, until you click **Analyse this page**. Then it reads the page in the tab you are looking at:
product facts (title, brand, seller, price, ratings, review texts and dates, shop policies, hidden text,
checkboxes, countdowns), what the shop or company publishes about itself (its phone numbers, e-mail addresses and
address from its contact, legal or imprint section, footer or structured data; registration and licence numbers;
payment methods it mentions) and the visible product text. On a service company's own site (a plumber, a
locksmith) it also reads the testimonials the company publishes: their text, the name as the site prints it, the
rating and the date. On a provider's profile on a platform (Werkspot, Thumbtack, Angi, …) it reads the platform's
figures (member since, jobs, rating, badges, response rate) and its reviews, without the reviewers' names.

Before anything leaves your browser, the extension removes account menus, greetings, forms and input fields,
checkout, billing and delivery areas, and any address that isn't in the business's own contact section, from a copy
of the page. These rules are there to keep your own name, address, e-mail address and phone number in your browser;
when in doubt, the extension strips. Testimonials inside a form, and "member since" in your own account menu, are
not read. The page itself is not changed.

On a private seller's ad (Marktplaats, 2dehands, Vinted, Craigslist, Facebook Marketplace, or a private seller on
eBay) it also reads the ad's own text, the item details (price, condition, category, delivery, location) and what the
platform shows about the seller's account: since when, ratings, badges, other ads, reply time. **The seller's name is
never read.**

On two of Unfret's own pages, `unfret.net/connect` (signing in with a wallet) and `unfret.net/checkout` (getting
checks), a small part of the extension runs by itself, to receive what those pages hand it: the wallet sign-in, or a
new Unfret API key the checkout page has just shown you (after an intro code, a card payment or a key recovery), so
you don't have to copy it into the extension. It reads nothing else from those pages, takes the message only from
that page itself, and answers the page only with whether it signed in. If the extension is already signed in with
another key or wallet, it asks you on the page first and changes nothing unless you agree. Your key is never sent
back to the page or to anyone else.

After you install it, the extension asks `unfret.net` once for a new **Unfret pass** (an anonymous API key: no
account, no e-mail) with a few free checks, and opens a welcome page on `unfret.net` that says how many it got. That
request carries nothing about you or your browsing: only the answer to a small computing puzzle (a proof of work that
keeps out bots). To give free checks only once, the extension notes in the browser's `storage.sync` that this browser
had them; your browser may sync that note between your devices, as it does settings, and a reinstall then gets a
pass without free checks. The note says nothing else. The pass and its backup code are kept in your browser; the
backup code is shown in the extension's settings, so you can save it if you add checks to the pass.

If an affiliate's link (`unfret.net/?ref=CODE`) brought you to Unfret, the website keeps the affiliate's code in its
own storage, and the welcome page hands that code to the extension; the extension then tells `unfret.net` once, with
its pass, so the pass counts for that affiliate (you get bonus checks on your first pack, the affiliate a share of what
you pay). Only the code goes from the page to the extension, and only on the welcome page; nothing about you or your
browsing is sent with it.

If the checkout page hands the extension another pass while it uses the free pass it made, the page asks you first;
when you agree, the free pass's free checks left move to the new pass (the extension sends the new pass's public ID,
never the pass itself).

The extension has no standing access to any website. It can read a page only after you click its toolbar button on
that page (the browser's `activeTab` grant, for that one tab). On Amazon and bol.com product pages the toolbar icon
gets a small marker: the browser sets it itself from the page address (`declarativeContent`); the extension does not
see the page or its address.

## What is sent, and to whom

Only to the Unfret API (`unfret.net`, hosted in the EU), when you click "Check this page":

- the page address and the product facts and text described above;
- your session token, which identifies the Solana wallet you signed in with, or your Unfret pass;
- for a **quick check** (free; offered when you have no checks left, or while today's free checks are used up),
  the same page data, marked as a quick check: Unfret then reads only the page itself, by its rules.

Two more requests go to the same API, and only when you ask for them:

- **Share this result**: the page address and that check's result, sent **without** your session token or API key,
  so the shared result is not tied to your account. Unfret first shows you exactly what the public page will contain
  (the product's title and link, the shop, the day of the check and the verdict; no score and no quotes from the page);
  nothing is stored until you click **Share**. The page is then public at `unfret.net/r/…` for anyone with
  the link, for 90 days, and never says who checked. You get a delete code, shown once, to remove it sooner.
- **Have an invite?**: the invite code you enter, with your sign-in, to add its checks to your account. Invite codes
  are not linked to whoever bought the pack they came with.

The extension makes no other network requests: no analytics, no trackers, no third parties. (The request for a new
pass on install, above, is the one it makes without a click.)

## What is stored

In your browser: your session (token, wallet address, expiry; or your Unfret pass), whether your last sign-in
expired, your settings, and for the pass the extension made itself, its public ID and backup code. In
`storage.sync`: only whether this browser had its free checks. Analysis results are kept only in memory (the browser's session storage, so a result survives the
extension's background process going to sleep); they are cleared when you leave the page or close the browser and
are never written to disk. A shared result's link and delete code are kept the same way, with that result. Invite
codes you enter are not kept at all.

The extension is in English and asks Unfret for English results; it sends nothing about your browser's language.

On the server: your wallet address and its credit balance, or your pass's public ID, its balance, its free checks
left and one-way hashes of the pass and its backup code. To limit how many free passes one internet connection gets in
a day, the server counts them in memory only, under a salted one-way hash of the address, gone at its next restart:
it never stores your IP address. The server does not keep the addresses or contents of
the pages you analyse, and does not link what you analysed to your wallet. For product pages with a public product
number (an Amazon ASIN, a bol.com ID or a barcode) it keeps an anonymous price observation for 90 days: a one-way
hash of the shop's domain and that number, the day, the price and the claimed "was" price, with no address, wallet,
IP address or time of day. That is how Unfret tells whether a "was" price was ever really charged. A result you
share is kept for 90 days (or until you delete it) as the preview showed it, without anything about who shared it;
the server keeps only a fingerprint of its delete code. An invite is kept only as a fingerprint with the day it was
issued and the day it was used, with no buyer and no redeemer. For a private seller's ad it keeps, for 90 days, only
a fingerprint of the ad's text (from which the text can't be read back), the platform, a one-way hash of the ad's
address and the day, and any phone number or e-mail address written in the ad as a keyed one-way hash, to notice the
same ad or number behind many ads; never the seller's name, account, location or the text itself. The main
product photo (on a service company's page, its first photo that isn't a logo) is fingerprinted on Unfret's own
server, to spot the same photo on another shop: the photo goes to no one else, and no outside image search is
used. The full server-side statement: <https://unfret.net/privacy>.

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
