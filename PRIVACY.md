# Unfret privacy policy (browser extension)

_Last updated: 25 November 2026 (version 0.14.0: free for shoppers, with no pass, no sign-in and no account; a deep check sends a proof of work instead; a pass or wallet sign-in an older version stored is deleted; no welcome page, no content scripts on Unfret's pages, no gift or affiliate codes. Earlier: the free quick check, the page address sent without what in it is about you, photo lookup, service providers and private sellers' ads). Draft for the store listings; to be reviewed before publication._

Unfret is made by Kroshtan (Floris van Beers, the Netherlands).

## What the extension reads

Nothing, until you click **Check this page** or **Quick check (free)**. Then it reads the page in the tab you are
looking at: product facts (title, brand, seller, price, ratings, review texts and dates, shop policies, hidden text,
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

The extension runs on no page by itself, Unfret's own pages included.

The extension has no standing access to any website. It can read a page only after you click its toolbar button on
that page (the browser's `activeTab` grant, for that one tab). On Amazon and bol.com product pages the toolbar icon
gets a small marker: the browser sets it itself from the page address (`declarativeContent`); the extension does not
see the page or its address.

## What is sent, and to whom

Only to the Unfret API (`unfret.net`, hosted in the EU), when you click "Check this page" or "Quick check (free)":

- the page address, without what in it is about you rather than the product: the part after `#`, a user name or
  password, tracking and referral parameters (`utm_…`, `gclid`, `fbclid`, `msclkid`, `mc_eid`, `igshid`, `ref`,
  affiliate tags and the like), sessions and tokens (`sid`, `PHPSESSID`, `token`, …) and anything that is an e-mail
  address. What picks the product or its variant (an ID, a size or colour) stays. The same address is used for the
  product facts, and is what a shared result links to;
- the product facts and text described above;
- for a **deep check** ("Check this page", free), the answer to a small computing puzzle the extension first fetches
  from `unfret.net` and solves in your browser (a proof of work: a few seconds of computing that keeps bots from
  using up the free checks). It says nothing about you;
- for a **quick check** (free, "Quick check (free)" under the main button, and the main button itself while free deep
  checks are paused), the same page data, marked as a quick check: Unfret then reads only the page itself, by its
  rules.

No check carries anything that names you: no account, no pass, no sign-in, no device ID. Checks are free and are not
tied to anyone. To keep the free checks from being abused, the server counts checks per internet connection in memory
only, under a salted one-way hash of the address, gone within the hour: it never stores your IP address.

More requests go to the same API, each only when you ask for it:

- **Share this result**: the page address and that check's result, sent with nothing that names you, so the shared
  result is not tied to you. Unfret first shows you exactly what the public page will contain
  (the product's title and link, the shop, the day of the check and the verdict; no score and no quotes from the page);
  nothing is stored until you click **Share**. The page is then public at `unfret.net/r/…` for anyone with
  the link, for 90 days, and never says who checked. You get a delete code, shown once, to remove it sooner.

When the popup opens (after you agreed to the consent screen), it asks the API for its price list, without anything
about you, to know whether free deep checks are paused this month. The pictures in a result (matching photos on other
shops) are loaded from Unfret's own server only. The extension makes no other network requests: no analytics, no
trackers, no third parties.

## What is stored

In your browser (`storage.local`): your consent and your settings. Nothing about an account: versions before 0.14.0
kept an Unfret pass (with its backup code) or a wallet sign-in, and a note in `storage.sync` that this browser had its
free checks; the extension deletes all of that when it updates, starts or opens, and never sends it again.

Only in memory (the browser's session storage, cleared when you close the browser, never written to disk): the
results of your checks, each with the request it was made from and, if you shared it, its link and delete code,
cleared when you leave the page.

The extension is in English and asks Unfret for English results; it sends nothing about your browser's language.

On the server: nothing about you. The server does not keep the addresses or contents of the pages you check, and
has nothing to link them to. For product pages with a public product
number (an Amazon ASIN, a bol.com ID or a barcode) it keeps an anonymous price observation for 90 days: a one-way
hash of the shop's domain and that number, the day, the price and the claimed "was" price, with no address, wallet,
IP address or time of day. That is how Unfret tells whether a "was" price was ever really charged. A result you
share is kept for 90 days (or until you delete it) as the preview showed it, without anything about who shared it;
the server keeps only a fingerprint of its delete code. For a private seller's ad it keeps, for 90 days, only
a fingerprint of the ad's text (from which the text can't be read back), the platform, a one-way hash of the ad's
address and the day, and any phone number or e-mail address written in the ad as a keyed one-way hash, to notice the
same ad or number behind many ads; never the seller's name, account, location or the text itself. The main
product photo (on a service company's page, its first photo that isn't a logo) is fingerprinted on Unfret's own
server, to spot the same photo on another shop: the photo goes to no one else, and no outside image search is
used. The full server-side statement: <https://unfret.net/privacy>.

## Your consent

The first time you open the extension it explains what it does, that it is free with no account, and what is sent
and when, and
checks nothing until you click **I agree**. Your agreement (and which version of that screen you agreed to) is
stored in your browser. You can reread it any time under **About & privacy** in the popup.

## Donations

Free checks run on donations. "Support Unfret" in the popup and the settings opens `unfret.net/support` or
`unfret.net/donate` in a tab; a donation is made on the payment provider's page, buys nothing and is not linked to
anything the extension does.

## Your choices

Uninstalling the extension removes what it stored in this browser. Questions:
[hello@unfret.net](mailto:hello@unfret.net).
