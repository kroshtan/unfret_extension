"""
Generate the parity expectations: run the backend's Python extractors over test/fixtures/*.html.

Run with the backend's virtualenv (read-only use of the backend repo):

    make parity BACKEND=../unfret_backend

Writes test/fixtures/<name>.expected.json (PageFacts as JSON) for every entry in test/fixtures/index.json.
"""

import importlib
import json
import sys
from datetime import date
from pathlib import Path

from unfret.facts import parse_page

FIXTURES = Path(__file__).resolve().parent.parent / "test" / "fixtures"
# "On the platform for 4 months" counts back from today: both sides count from this day (test/parity.test.ts).
PARITY_TODAY = date(2026, 11, 15)


def main() -> None:
    # The backend's package is whichever one under <backend>/src has a facts module (this runs in <backend>/.venv).
    backend = Path(sys.prefix).resolve().parent
    package = next(p.parent.parent.name for p in (backend / "src").glob("*/facts/__init__.py"))
    parse_page = importlib.import_module(f"{package}.facts").parse_page
    p2p = importlib.import_module(f"{package}.facts.p2p")
    if hasattr(p2p, "_today"):
        p2p._today = lambda: PARITY_TODAY
    index = json.loads((FIXTURES / "index.json").read_text())
    for name, url in index.items():
        html = (FIXTURES / f"{name}.html").read_text()
        facts, _ = parse_page(html, url)
        out = FIXTURES / f"{name}.expected.json"
        out.write_text(json.dumps(facts.model_dump(mode="json"), indent=1, ensure_ascii=False) + "\n")
        print(f"{name}: {out.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
