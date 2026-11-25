# Chrome Web Store: test instructions for the reviewer

Paste the block below into the dashboard's "Test instructions" field. Microsoft Edge Add-ons takes the same block as
its "Notes for certification" ([EDGE.md](EDGE.md)). Since 0.14.0 checks are free with no account, so no test key is
needed.

## Test instructions (paste)

```
Unfret checks a product page when you click its toolbar button. Checks are free; there is no account, sign-in or
key, so nothing needs to be set up for this review.

1. Install the extension and pin it to the toolbar.
2. Click the Unfret icon and read the first-run screen, then click "I agree".
3. Open a product page, for example the Unfret test shop https://unfret.net/test-shop (a made-up shop with the
   tricks Unfret catches) or a product on https://www.amazon.com, click the Unfret icon, then "Check this page".
   The extension first does a few seconds of computing (a proof of work that keeps bots from using up the free
   checks), then the result appears in 10-30 seconds: a risk level from 0 to 4 in plain words, with its reasons.
4. "Quick check (free)" under the main button gives a faster result from the page alone.
5. Optional: under a result, "Wrong result?" lets you pick the level you think is right and mark reasons as wrong
   or missing, then send a report.

Nothing is read or sent until "Check this page" or "Quick check (free)" is clicked.
Privacy statement: https://unfret.net/privacy
```
