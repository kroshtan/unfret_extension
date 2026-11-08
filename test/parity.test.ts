/**
 * Parity with the backend: the TypeScript extractors must produce the same PageFacts as the Python ones for the
 * same HTML. Expectations come from `make parity` (the backend's extractors over test/fixtures/*.html).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";

import { extractFacts } from "../src/extract/generic.js";
import schema from "../src/shared/pagefacts.schema.json";

const FIXTURES = join(import.meta.dirname, "fixtures");
const index = JSON.parse(readFileSync(join(FIXTURES, "index.json"), "utf8")) as Record<string, string>;

const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addFormat("date", /^\d{4}-\d{2}-\d{2}$/u);
const validate = ajv.compile(schema);

function load(name: string): { html: string; expected: unknown; url: string } {
  return {
    html: readFileSync(join(FIXTURES, `${name}.html`), "utf8"),
    expected: JSON.parse(readFileSync(join(FIXTURES, `${name}.expected.json`), "utf8")) as unknown,
    url: index[name] ?? "",
  };
}

describe("parity with the backend's extractors", () => {
  it.each(Object.keys(index))("%s", (name) => {
    const { html, expected, url } = load(name);
    const doc = new DOMParser().parseFromString(html, "text/html");

    const facts = extractFacts(doc, html, url);

    expect(facts).toEqual(expected);
    expect(validate(facts), JSON.stringify(validate.errors)).toBe(true);
  });
});
