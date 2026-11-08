.PHONY: help install lint typecheck test smoke build build-dev parity icons crx-key release verify-release clean
.DEFAULT_GOAL := help

BACKEND ?= $(HOME)/repos/veridex_backend

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

icons:  ## Regenerate the placeholder icons
	node scripts/icons.mjs

crx-key:  ## Create the CRX signing key once (VERIDEX_CRX_KEY, default ~/kroshtan_secrets/veridex-extension-crx.pem)
	node scripts/crx-key.mjs

release: build  ## Signed self-hosted release in dist/release: CRX, updates.xml, store zip, SHA256SUMS
	node scripts/release.mjs

verify-release: build  ## Check a published CRX against your own build: make verify-release CRX=path/to/file.crx
	node scripts/verify-release.mjs $(CRX)

clean:  ## Remove build output
	rm -rf dist coverage
