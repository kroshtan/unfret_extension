# Veridex privacy policy (browser extension)

_Last updated: 8 November 2026. Draft for the store listings; to be reviewed before publication._

Veridex is made by Kroshtan (Floris van Beers, the Netherlands).

## What the extension reads

Nothing, until you click **Analyse this page**. Then it reads the page in the tab you are looking at:
product facts (title, brand, seller, price, ratings, review texts and dates, shop policies, hidden text,
checkboxes, countdowns) and the visible product text.

Before anything leaves your browser, the extension removes account menus, delivery addresses, greetings, forms
and input fields from a copy of the page. The page itself is not changed.

On Amazon and bol.com product pages the toolbar icon shows "?" based on the page address alone; the page is not
read.

## What is sent, and to whom

Only to the Veridex API (`veridex.kroshtan.com`, hosted in the EU), when you click Analyse:

- the page address and the product facts and text described above;
- your session token, which identifies the Solana wallet you signed in with.

The extension makes no other network requests: no analytics, no trackers, no third parties.

## What is stored

In your browser: your session (token, wallet address, expiry) and your settings. Analysis results are kept only
in memory while the browser runs and are never written to disk.

On the server: your wallet address and its credit balance. The server does not keep the addresses or contents of
the pages you analyse, and does not link what you analysed to your wallet. (See the Veridex privacy statement for
the server side.)

## Signing in

Signing in means signing a plain-text message with your Solana wallet. It costs nothing and gives Veridex no
right to spend from your wallet. Buying checks is a separate transaction you approve in your wallet.

## Your choices

Sign out in the extension's settings to remove the session from your browser. Uninstalling the extension removes
everything it stored. Questions: see the contact details at kroshtan.com.
