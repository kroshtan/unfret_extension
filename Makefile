.PHONY: help install lint typecheck test smoke build build-dev parity icons clean
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

clean:  ## Remove build output
	rm -rf dist coverage
