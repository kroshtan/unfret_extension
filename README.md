# Veridex browser extension

Risk signals for the product page you're looking at: Temu-grade listings on Amazon dressed up with thousands of
five-star reviews, dropship stores, fake countdowns, pre-ticked add-ons and fees that only appear at checkout.
Veridex reports evidence and a traffic-light score; it never calls a shop a scam.

Chrome (Manifest V3) and Firefox, from one source. Vanilla TypeScript, no UI framework, no remote code, no
third-party requests: the extension talks to the Veridex API and nothing else.

## How it works

```
toolbar click ─► popup ─► background ─► inject extract.js into the tab ─► PageFacts + cleaned text
                                   └─► POST /v1/analyze/stream (Bearer session) ─► live steps ─► score, flags
```

- **Nothing runs until you click "Analyse this page".** Each analysis costs one check. On supported marketplace
  product pages (Amazon, all countries; bol.com) the toolbar shows "?" until analysed; that badge comes from the
  URL alone, without reading the page.
- **Extraction happens in the browser.** `src/extract/` is a TypeScript port of the backend's PageFacts
  extractors (`veridex/facts/*.py`). It also adds what only the rendered page shows: text hidden by stylesheet CSS,
  the current state of checkboxes, and countdowns read twice a few seconds apart.
- **Only facts and cleaned product text are sent**, never the raw page: account menus, delivery addresses,
  greetings, forms and inputs are stripped from a copy of the page first.
- **Sign-in is Sign-In With Solana.** "Sign in" opens `https://veridex.kroshtan.com/connect`; after you sign a
  message in your wallet, that page posts the session to itself and the extension's content script (injected only
  there) relays it. The relay accepts it only from that window on the configured Veridex origin, and the
  background checks the sender again. Signing grants no spending rights. "Buy checks" opens `/checkout`.

The API contract is in the backend repository (credits door, contract v1).

## Layout

```
src/
  background/   service worker / event page: session relay, badge, analysis runner
  content/      extract-entry.ts (injected on demand), connect-relay.ts (connect page only), relay.ts (checks)
  extract/      PageFacts extraction: parse, dom, generic, amazon, bolcom (ports); live, clean (browser-only)
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
| `activeTab`                                         | Analyse the page you clicked on (any shop), only when you click             |
| `scripting`                                         | Inject the extractor into that tab; register the relay for a dev API origin |
| `storage`                                           | Your session (token, wallet address, expiry) and settings; nothing else     |
| Amazon (all TLDs), bol.com                          | The "?" badge on product pages, and analysis without an extra prompt there  |
| `https://veridex.kroshtan.com/*`                    | The API, and the sign-in relay on `/connect`                                |
| optional `http://localhost/*`, `http://127.0.0.1/*` | Only if you point the extension at a local dev server                       |

## Development

```bash
make install          # npm ci
make test             # unit + parity tests
make lint typecheck
make build-dev        # dist/chrome, dist/firefox (unminified, source maps)
make smoke            # build + headless Chromium run (first: npx playwright install chromium)
make parity           # regenerate expectations from the backend's Python extractors (BACKEND=~/repos/veridex_backend)
```

Load unpacked:

- **Chrome**: `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome`.
- **Firefox**: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `dist/firefox/manifest.json`.
  Firefox may ask you to allow access to Amazon/bol.com before the badge appears.

To use a local backend, open the extension's settings and set the API base to e.g. `http://localhost:8080`
(the browser asks for access to that address).

`make build` writes `dist/veridex-chrome-<version>.zip` and `dist/veridex-firefox-<version>.zip` for the stores;
the version comes from `package.json`.

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
