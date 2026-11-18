# Unfret privacy policy (browser extension)

_Last updated: 17 November 2026 (version 0.12.0: a free Unfret pass made on install, free quick checks, the extension asks in its own window before switching accounts, every request and stored item listed, the page address sent without its fragment, tracking parameters, sessions or e-mail addresses, the welcome page says whether this browser had its free checks; 0.11.0: a new key from the checkout page signs the extension in, welcome page after installing; earlier: photo lookup corrected, service providers and private sellers' ads added). Draft for the store listings; to be reviewed before publication._

Unfret is made by Kroshtan (Floris van Beers, the Netherlands).

## What the extension reads

Nothing, until you click **Check this page**. Then it reads the page in the tab you are looking at:
product facts (title, brand, seller, price, ratings, review texts and dates, shop policies, hidden text,
checkboxes, countdowns), what the shop or company publishes about itself (its phone numbers, e-mail addresses and
address from its contact, legal or imprint section, footer or structured data; registration and licence numbers;
payment methods it mentions) and the visible product text. To recognise the apps a shop runs (dropshipping,
review-import and countdown apps), it also reads the names in the page's code (class names, ids and data attribute
names, never what they hold) and which other sites the page refers to (the site, and for a link also its path,
never what follows a `?`). On a service company's own site (a plumber, a
locksmith) it also reads the testimonials the company publishes: their text, the name as the site prints it, the
rating and the date. On a provider's profile on a platform (Werkspot, Thumbtack, Angi, …) it reads the platform's
figures (member since, jobs, rating, badges, response rate) and its reviews, without the reviewers' names.

Before anything leaves your browser, the extension removes account menus, greetings, forms and input fields,
checkout, billing and delivery areas, and any address that isn't in the business's own contact section, from a copy
of the page; inside those areas not even the names in the code are read. These rules are there to keep your own name, address, e-mail address and phone number in your browser;
when in doubt, the extension strips. Testimonials inside a form, and "member since" in your own account menu, are
not read. The page itself is not changed.

On a private seller's ad (Marktplaats, 2dehands, Vinted, Craigslist, Facebook Marketplace, or a private seller on
eBay) it also reads the ad's own text, the item details (price, condition, category, delivery, location) and what the
platform shows about the seller's account: since when, ratings, badges, other ads, reply time. **The seller's name is
never read.**

On three of Unfret's own pages a small part of the extension runs by itself, to receive what those pages hand it:
on `unfret.net/connect` (signing in with a wallet) the wallet sign-in, on `unfret.net/checkout` (getting checks) a
new Unfret pass the page has just shown you (after a gift code, a card payment, a recovery with your backup code, or
"Send it to the extension" on My checks), so you don't have to copy it into the extension, and on
`unfret.net/welcome` whether this browser already had its free checks (a yes or no) and an affiliate's code (both
below). It reads nothing else from those pages, takes the message only from that page itself, and answers the page
only with whether it signed in (on the welcome page: how many free checks the new pass got, or why none). Without a pass or wallet yet, it takes one
only right after you click on that page, or on a page it opened for you itself (from its popup or settings, or the
welcome page after installing). If the extension is already signed in with another pass or wallet, it never switches
by itself: it asks you in a small window of its own, naming both, and changes nothing unless you choose the new one
there. While that question is open (at most ten minutes), the pass or sign-in it is about is kept in the browser's
memory only. Your pass is never sent back to the page or to anyone else, and the extension never puts a pass or
backup code in a web address it opens.

After you install it, the extension opens a welcome page on `unfret.net` and asks `unfret.net` once for a new
**Unfret pass** (an anonymous API key: no account, no e-mail) with a few free checks; the welcome page then says how
many it got. That request carries nothing about you or your browsing: it fetches a small computing puzzle and sends
back its answer (a proof of work, a few seconds of computing in your browser, that keeps out bots) and whether it asks
for free checks. If that fails (offline), or after you signed out, the popup's **Get your free checks** opens the
welcome page again, which makes the pass the same way. To give free checks only once, the extension notes in the
browser's `storage.sync` that this browser had them; your browser may sync that note between your devices, as it
does settings, and a reinstall then gets a pass without free checks. Without sync, removing the extension removes
that note too, so the welcome page tells the extension, before it asks for free checks, whether the website's own
note says this browser had them (the note the link checker on `unfret.net` keeps in your browser): a yes or no, from
the page to the extension in your browser, nothing else and nowhere else. With either note, the pass comes without
free checks, and the welcome page says why; a pass made with free checks sets the website's note too. The notes say
nothing else. The pass and its backup code are kept in your browser; the
backup code is shown in the extension's settings, so you can save it if you add checks to the pass.

If an affiliate's link (`unfret.net/?ref=CODE`) brought you to Unfret, the website keeps the affiliate's code in its
own storage, and the welcome page hands that code to the extension; the extension then tells `unfret.net` once, with
its pass, so the pass counts for that affiliate (you get bonus checks on your first pack, the affiliate a share of what
you pay). Only the code goes from the page to the extension, and only on the welcome page; nothing about you or your
browsing is sent with it.

If the checkout page hands the extension another pass while it uses the free pass it made, the page and then the
extension's own window ask you first; when you agree, the free pass's free checks left move to the new pass (the
extension sends the new pass's public ID, never the pass itself).

The extension has no standing access to any website. It can read a page only after you click its toolbar button on
that page (the browser's `activeTab` grant, for that one tab). On Amazon and bol.com product pages the toolbar icon
gets a small marker: the browser sets it itself from the page address (`declarativeContent`); the extension does not
see the page or its address.

## What is sent, and to whom

Only to the Unfret API (`unfret.net`, hosted in the EU), when you click "Check this page":

- the page address, without what in it is about you rather than the product: the part after `#`, a user name or
  password, tracking and referral parameters (`utm_…`, `gclid`, `fbclid`, `msclkid`, `mc_eid`, `igshid`, `ref`,
  affiliate tags and the like), sessions and tokens (`sid`, `PHPSESSID`, `token`, …) and anything that is an e-mail
  address. What picks the product or its variant (an ID, a size or colour) stays. The same address is used for the
  product facts, and is what a shared result links to;
- the product facts and text described above;
- your Unfret pass, or the session token of the Solana wallet you signed in with, to pay for the check;
- for a **quick check** (free; offered when you have no checks left, or while today's free checks are used up),
  the same page data, marked as a quick check: Unfret then reads only the page itself, by its rules.

More requests go to the same API, each only when you ask for it:

- **Share this result**: the page address and that check's result, sent **without** your session token or API key,
  so the shared result is not tied to your account. Unfret first shows you exactly what the public page will contain
  (the product's title and link, the shop, the day of the check and the verdict; no score and no quotes from the page);
  nothing is stored until you click **Share**. The page is then public at `unfret.net/r/…` for anyone with
  the link, for 90 days, and never says who checked. You get a delete code, shown once, to remove it sooner.
- **Wrong result?** (reporting a result): that one check's product facts, page text and result, with your sign-in,
  only after you chose a reason and clicked **Send report**. An AI model hosted in the EU may read the stored report
  once to suggest a label; a person decides.
- **Have an invite or gift code?**: the code you enter, with your sign-in, to add its checks to your account. The
  server notes which pack's buyer a gift code came from only as a keyed one-way hash, so the buyer can't use their own;
  it doesn't note who redeemed it.
- **Signing in**: with a pass you paste, a request for its balance, to check that Unfret knows it; with a wallet on
  your phone, a sign-in request and then one request every second and a half for its result, without any sign-in,
  until your phone has signed in or you cancel.

When you open the popup or the settings, they ask the API for your balance (with your sign-in) to show how many checks
you have; the popup asks for the price list (without any sign-in) when signed out, to say how many free checks a new
pass gets, and with a result you can report, to say what a report may earn. The pictures in a result (matching photos
on other shops) are loaded from Unfret's own server only. The extension makes no other network requests: no
analytics, no trackers, no third parties. Besides opening the popup or settings, the requests it makes without a
click are the new pass when the welcome page opens after installing and, if an affiliate's link brought you, that one
note to `unfret.net`, both above.

## What is stored

In your browser (`storage.local`): your sign-in (your Unfret pass; or a wallet's session token, address and expiry),
whether your last sign-in expired, your consent, your settings, for the pass the extension made itself its public ID
and backup code (shown in the settings, so you can save it), and, until that pass is made, a note to offer it again. In
`storage.sync`: only whether this browser had its free checks (your browser may sync it, as it does settings).

Only in memory (the browser's session storage, cleared when you close the browser, never written to disk): the
results of your checks, each with the request it was made from (for "Wrong result?") and, if you shared it, its link
and delete code, cleared when you leave the page; a phone sign-in that is still waiting; which tabs the extension
opened on `unfret.net` for you (an hour each); and a pass or sign-in the website handed over while the extension asks
you about it (above). Invite and gift codes you enter are not kept at all.

The extension is in English and asks Unfret for English results; it sends nothing about your browser's language.

On the server: your wallet address and its credit balance, or your pass's public ID, its balance, its free checks
left and one-way hashes of the pass and its backup code. To limit how many free passes one internet connection gets in
a day, the server counts them in memory only, under a salted one-way hash of the address, gone at its next restart:
it never stores your IP address. The server does not keep the addresses or contents of
the pages you check, and does not link what you checked to your wallet or pass. For product pages with a public product
number (an Amazon ASIN, a bol.com ID or a barcode) it keeps an anonymous price observation for 90 days: a one-way
hash of the shop's domain and that number, the day, the price and the claimed "was" price, with no address, wallet,
IP address or time of day. That is how Unfret tells whether a "was" price was ever really charged. A result you
share is kept for 90 days (or until you delete it) as the preview showed it, without anything about who shared it;
the server keeps only a fingerprint of its delete code. A gift code (invite) is kept only as a fingerprint with the
day it was issued and the day it was used, and a keyed one-way hash of the account that bought its pack; never who
redeemed it. For a private seller's ad it keeps, for 90 days, only
a fingerprint of the ad's text (from which the text can't be read back), the platform, a one-way hash of the ad's
address and the day, and any phone number or e-mail address written in the ad as a keyed one-way hash, to notice the
same ad or number behind many ads; never the seller's name, account, location or the text itself. The main
product photo (on a service company's page, its first photo that isn't a logo) is fingerprinted on Unfret's own
server, to spot the same photo on another shop: the photo goes to no one else, and no outside image search is
used. The full server-side statement: <https://unfret.net/privacy>.

## Your consent

The first time you open the extension it explains what it does, what is sent and when, and how paying works, and
checks nothing until you click **I agree**. Your agreement (and which version of that screen you agreed to) is
stored in your browser. You can reread it any time under **About & privacy** in the popup.

## Signing in

Most people never sign in: the extension uses the free Unfret pass it made on install, or a pass you got on
`unfret.net` (with a gift code or a purchase), which the website hands to it. An Unfret pass is an anonymous key; it
isn't tied to a name, an e-mail address or a wallet. You can also paste a pass you have, or sign in with a Solana
wallet, in this browser or on your phone: that means signing a plain-text message with your wallet. It costs nothing
and gives Unfret no right to spend from your wallet. Buying checks is a separate payment you approve on the
payment provider's page or in your wallet.

## Your choices

Sign out in the popup or the settings to remove your sign-in from your browser (save the backup code of the free
pass first if you want to keep its checks). Uninstalling the extension removes what it stored in this browser; the
free-checks note in `storage.sync` may stay with your browser's synced data. Questions:
[hello@unfret.net](mailto:hello@unfret.net).
