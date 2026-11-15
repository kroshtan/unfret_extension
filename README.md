# Unfret browser extension

Risk signals for the product page you're looking at: Temu-grade listings on Amazon dressed up with thousands of
five-star reviews, dropship stores, fake countdowns, pre-ticked add-ons and fees that only appear at checkout.
Unfret reports evidence and a plain-words verdict; it never calls a shop a scam.

Chrome (Manifest V3) and Firefox, from one source. Vanilla TypeScript, no UI framework, no remote code, no
third-party requests: the extension talks to the Unfret API and nothing else.

**Install:** from the [Chrome Web Store](https://chromewebstore.google.com/detail/unfret/giiengbpechhnphignbicmlcbklmcpjo)
(Chrome, Brave, Edge and other Chromium browsers); Firefox is being submitted to addons.mozilla.org
([store/AMO.md](store/AMO.md)). Both are built byte for byte from this repository. The older self-hosted install is
described in [INSTALL.md](INSTALL.md), but no longer offered.

## How it works

```
toolbar click ─► popup ─► background ─► inject extract.js into the tab ─► PageFacts + cleaned text
                                   └─► POST /v1/analyze/stream (Bearer session) ─► live steps ─► score, flags
```

- **Nothing runs until you click "Analyse this page".** Each analysis costs one check. The extension has no standing
  access to any website: it reads a page only through `activeTab`, which the browser grants for that one tab when you
  click the toolbar button. On supported marketplace product pages (Amazon, all countries; bol.com) the toolbar icon
  gets a small amber marker; in Chromium the browser sets it itself from the page address (`declarativeContent`),
  without the extension seeing the page.
- **Extraction happens in the browser.** `src/extract/` is a TypeScript port of the backend's PageFacts
  extractors (`facts/*.py`). It also adds what only the rendered page shows: text hidden by stylesheet CSS,
  the current state of checkboxes, and countdowns read twice a few seconds apart.
- **Only facts and cleaned product text are sent**, never the raw page: account menus, greetings, forms and inputs,
  checkout, billing and delivery areas are stripped from a copy of the page first. Addresses are kept only where the
  business publishes its own (a contact, legal or imprint section, the footer, Organization or address structured
  data); an address anywhere else could be yours and is stripped. The same rules decide which phone numbers, e-mail
  addresses and addresses go into the facts (`src/extract/business.ts`, a port of the backend's `facts/business.py`).
  On classifieds platforms (Marktplaats, 2dehands, Vinted, Craigslist, Facebook Marketplace) the seller's name is
  never read, and only product IDs and payment methods are read as business facts there (also on eBay).
- **Sign-in is Sign-In With Solana.** "Sign in" opens `https://unfret.net/connect`; after you sign a
  message in your wallet, that page posts the session to itself and the extension's content script (injected only
  there) relays it. The relay accepts it only from that window on the configured Unfret origin, and the
  background checks the sender again. Signing grants no spending rights. "Buy checks" opens `/checkout`, which also
  shows the invite codes a pack comes with, once, after payment.
- **"Have an invite?"** (popup and settings, when signed in) redeems a code onto the account in use
  (`POST /v1/invites/redeem`, with its own sign-in); only a new wallet or a never-funded key can. The code isn't kept.
- **"Share this result"** asks the API for a preview of the public page (`POST /v1/shares/preview`), and only on
  "Share" makes it (`POST /v1/shares`), both **without** the sign-in, so the page names no account. The link and its
  delete code stay with the tab's result in session memory.
- **English only.** The extension's own text is English; the verdict's wording is the server's, shown as it comes.

The API contract is in the backend repository (credits door, contract v1).

## Layout

```
src/
  background/   service worker / event page: session relay, icon hint, badge, analysis runner
  content/      extract-entry.ts (injected on demand), connect-relay.ts (connect page only), relay.ts (checks)
  extract/      PageFacts extraction: parse, dom, generic, business, amazon, bolcom, walmart (ports); live, clean (browser-only)
  api/          API client and SSE parser
  popup/        popup UI
  options/      options page (API base URL, sign out)
  shared/       facts types + JSON schema, settings, sites, messages, CSS
scripts/        build (esbuild, per-browser manifests, zips), icons, gen_parity.py
test/           unit, parity (jsdom vs the Python extractors), mock API; smoke/ (headless Chromium)
```

## Permissions

| Permission                                          | Why                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `activeTab`                                         | Read the page you clicked on (any shop, marketplaces too), only then        |
| `scripting`                                         | Inject the extractor into that tab; register the relay for a dev API origin |
| `storage`                                           | Your session (token, wallet address, expiry) and settings; nothing else     |
| `declarativeContent` (Chromium)                     | The browser marks the icon on marketplace product pages; no page access     |
| `https://unfret.net/connect*`                       | The sign-in relay on the Unfret sign-in page (the API itself is CORS)       |
| optional `http://localhost/*`, `http://127.0.0.1/*` | Only if you point the extension at a local dev server                       |

## Development

```bash
make install          # npm ci
make test             # unit + parity tests
make lint typecheck
make build-dev        # dist/chrome, dist/firefox (unminified, source maps)
make smoke            # build + headless Chromium run (first: npx playwright install chromium)
make parity           # regenerate expectations from the backend's Python extractors (BACKEND=../unfret_backend)
```

Load unpacked:

- **Chrome**: `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome`.
- **Firefox**: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `dist/firefox/manifest.json`.
  Firefox has no `declarativeContent`, so it shows no marketplace marker; analysis works the same.

To use a local backend, open the extension's settings and set the API base to e.g. `http://localhost:8080`
(the browser asks for access to that address).

`make build` writes four builds: `dist/chrome` (the store variant, zipped as `dist/unfret-chrome-<version>.zip`),
`dist/chrome-selfhosted` (with the update URL and public key, signed into a CRX by `make release`), `dist/chrome-dev`
and `dist/firefox` (built, not published).

`dist/chrome-dev` is **Unfret Dev**: a separate extension (ID `phokojgbhkfcejnnocokabdjoljdfgpl`, grey icon with a
DEV label) that talks only to the dev deployment (dev.unfret.net, devnet) and updates from there. Install it
next to Unfret to test; the production extension never talks to dev. The version comes from `package.json`. `make release` produces the signed
self-hosted release in `dist/release/` (see [INSTALL.md](INSTALL.md#for-maintainers-making-a-release)).

## Releases (CI/CD)

- **Merge to `main` ⇒ Unfret Dev.** CI (`.forgejo/workflows/ci.yaml`, job `publish-dev`) builds Unfret Dev as
  `<version>.<run number>`, signs it and opens a self-merging pull request on the backend, whose pipeline deploys it to
  dev.unfret.net.
- **Production ⇒ by hand only.** Actions → "Release to the extension stores" (`release-store.yaml`) builds and checks the
  store packages (Chrome, Firefox and the source zip addons.mozilla.org asks for) and attaches them to the release
  `v<version>`; the uploads are manual ([store/SUBMIT.md](store/SUBMIT.md), [store/AMO.md](store/AMO.md)).

## Parity with the backend

The same HTML must give the same PageFacts in the browser as on the server, or the scorer sees different
features than it was trained on. `test/parity.test.ts` runs the TypeScript extractors over `test/fixtures/*.html`
and compares them field by field with the Python extractors' output (`*.expected.json`), and validates against the
backend's PageFacts JSON schema. When the backend's extractors change, run `make parity` and port the change.

The live-only additions (stylesheet-hidden text, live checkbox state, observed countdowns) deliberately go beyond
the server's view; they are conservative so as not to skew the scorer, and the scorer should eventually be
retrained on extension-sourced facts.

## License

MIT. See [PRIVACY.md](PRIVACY.md) for what is sent and stored.
