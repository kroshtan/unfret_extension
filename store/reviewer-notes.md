# Chrome Web Store: test instructions for the reviewer

Paste the block below into the dashboard's "Test instructions" field, with a real test key filled in.

## Creating the reviewer's test key (operator, once per review)

Production (https://unfret.kroshtan.com) must run a release that includes the admin grant endpoint (backend PR #42)
before this works.

1. Open https://unfret.kroshtan.com/checkout?for=key, choose **Create a key**, and save the key (`ufk_…`) and its
   recovery code. Don't pay.
2. Give it about 20 checks of credit (at most $10 per call):

   ```sh
   curl -fsS -X POST https://unfret.kroshtan.com/v1/admin/keys/<key id>/grant \
     -H "Authorization: Bearer $(cat ~/kroshtan_secrets/veridex-prod-admin-token)" \
     -H "Content-Type: application/json" -d '{"usd_micros": 4000000}'
   ```

   `<key id>` is the part between `ufk_` and the next `_`. The answer shows the new balance.

3. After the review, recover the key on the checkout page (this revokes the one the reviewer had) or leave it to run
   out.

## Test instructions (paste)

```
Unfret checks a product page when you click its toolbar button. No account or wallet is needed for this review:
use the test API key below.

1. Install the extension and pin it to the toolbar.
2. Click the Unfret icon and read the first-run screen, then click "I agree".
3. Click "Settings", paste this key under "Use an API key instead" and click "Use this key":
   ufk_<REPLACE WITH THE TEST KEY>
   The key holds about 20 checks.
4. Open a product page, for example any product on https://www.amazon.com or https://www.bol.com, click the Unfret
   icon, then "Check this page". The result appears in 10–30 seconds: a verdict in plain words with its reasons.
5. Optional: under a result, "This is wrong" lets you report a wrong result (it asks for consent first).

Nothing is read or sent until "Check this page" is clicked. Privacy statement: https://unfret.kroshtan.com/privacy
```
