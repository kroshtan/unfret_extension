"""
Generate the parity expectations: run the backend's Python extractors over test/fixtures/*.html.

Run with the backend's virtualenv (read-only use of the backend repo):

    make parity BACKEND=~/repos/veridex_backend

Writes test/fixtures/<name>.expected.json (PageFacts as JSON) for every entry in test/fixtures/index.json.
"""

import json
import sys
from pathlib import Path

from veridex.facts import parse_page

FIXTURES = Path(__file__).resolve().parent.parent / "test" / "fixtures"


def main() -> None:
    index = json.loads((FIXTURES / "index.json").read_text())
    for name, url in index.items():
        html = (FIXTURES / f"{name}.html").read_text()
        facts, _ = parse_page(html, url)
        out = FIXTURES / f"{name}.expected.json"
        out.write_text(json.dumps(facts.model_dump(mode="json"), indent=1, ensure_ascii=False) + "\n")
        print(f"{name}: {out.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
