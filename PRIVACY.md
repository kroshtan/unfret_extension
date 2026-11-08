# Veridex privacy policy (browser extension)

_Last updated: 8 November 2026. Draft for the store listings; to be reviewed before publication._

Veridex is made by Kroshtan (Floris van Beers, the Netherlands).

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

Only to the Veridex API (`veridex.kroshtan.com`, hosted in the EU), when you click Analyse:

- the page address and the product facts and text described above;
- your session token, which identifies the Solana wallet you signed in with.

The extension makes no other network requests: no analytics, no trackers, no third parties.

## What is stored

In your browser: your session (token, wallet address, expiry), whether your last sign-in expired, and your
settings. Analysis results are kept only in memory (the browser's session storage, so a result survives the
extension's background process going to sleep); they are cleared when you leave the page or close the browser and
are never written to disk.

The extension asks Veridex for results in your browser's language (Dutch or English). That language is the only
other thing it sends.

On the server: your wallet address and its credit balance. The server does not keep the addresses or contents of
the pages you analyse, and does not link what you analysed to your wallet. (See the Veridex privacy statement for
the server side.)

## Signing in

Signing in means signing a plain-text message with your Solana wallet. It costs nothing and gives Veridex no
right to spend from your wallet. Buying checks is a separate transaction you approve in your wallet.

## Your choices

Sign out in the extension's settings to remove the session from your browser. Uninstalling the extension removes
everything it stored. Questions: see the contact details at kroshtan.com.
