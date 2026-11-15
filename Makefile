.PHONY: help install lint typecheck test smoke build build-dev parity icons screenshots crx-key release store-package store-publish publish-dev verify-release clean
.DEFAULT_GOAL := help

# The backend checkout, next to this one unless set (make parity BACKEND=…)
BACKEND ?= $(abspath $(CURDIR)/../unfret_backend)

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-12s\033[0m %s\n", $$1, $$2}'

install:  ## Install dependencies from the lock file
	npm ci

lint:  ## ESLint (strict, type-aware) and Prettier
	npm run lint

typecheck:  ## TypeScript, strict
	npm run typecheck

test:  ## Unit and parity tests (jsdom, mock API)
	npm test

smoke:  ## Build, then drive the Chrome build in headless Chromium (needs `npx playwright install chromium`)
	npm run smoke

build:  ## dist/chrome, dist/firefox and their store zips
	npm run build

build-dev:  ## Unminified builds with source maps
	npm run build:dev

parity:  ## Regenerate parity expectations with the backend's Python extractors (BACKEND=path)
	$(BACKEND)/.venv/bin/python scripts/gen_parity.py

icons:  ## Render the icons and store promo images from brand/*.svg (needs `npx playwright install chromium`)
	node scripts/icons.mjs

screenshots: build  ## Render the Chrome Web Store screenshots into store/screenshots (needs `npx playwright install chromium`)
	node scripts/screenshots.mjs

crx-key:  ## Create a CRX signing key once (production; DEV=1 for Unfret Dev). Keys live in ~/kroshtan_secrets
	node scripts/crx-key.mjs $(if $(DEV),--dev)

release: build  ## Signed self-hosted release in dist/release: CRX, updates.xml, store zip, SHA256SUMS
	node scripts/release.mjs

store-package: build  ## Check the Chrome and Firefox store packages, add the source zip, put them with SHA256SUMS in dist/store
	node scripts/store-package.mjs

store-publish: store-package  ## Submit dist/store to the stores (DRY=1: only show the requests; secrets: store/SUBMIT.md)
	node scripts/store-publish.mjs $(if $(DRY),--dry-run)

publish-dev:  ## Put dist/release's Unfret Dev into the backend checkout (BACKEND=path); CI does this on main
	node scripts/publish-dev.mjs $(BACKEND)

verify-release: build  ## Check a published CRX against your own build: make verify-release CRX=file.crx [DEV=1]
	node scripts/verify-release.mjs $(if $(DEV),--dev) $(CRX)

clean:  ## Remove build output
	rm -rf dist coverage
