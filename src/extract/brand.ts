/**
 * The brand name as a page writes it, made usable: marketplace bylines unwrapped, sentences and store links
 * dropped. A line-for-line port of the backend's `facts/brand.py`; the parity tests keep the two in step.
 *
 * Amazon's byline is a link to the brand's store, and its text wraps the brand in a phrase in the page's language
 * ("Visit the Airmax Store", "De Airmax Store openen", "Besuche den Airmax-Store", "Marque : Airmax"). `cleanBrand`
 * takes the brand out of the known phrases, and gives up (no brand) on a name that still reads like a sentence or a
 * link to a store: a quiet result instead of a wrong claim.
 */

import { cut, squash, stripChars } from "./dom.js";

// The byline phrases of Amazon's storefronts, group 1 the brand. Matched against the whole squashed text.
const BYLINE_RES: readonly RegExp[] = [
  /^visit the\s+(.+?)\s+(?:store|shop|storefront)$/iu, // en
  /^(?:besuche|besuchen sie)\s+den\s+(.+?)(?:-|\s+)(?:store|shop|markenshop)$/iu, // de
  /^bezoek\s+de\s+(.+?)(?:-|\s+)(?:winkel|store|shop)$/iu, // nl, older
  /^de\s+(.+?)(?:-|\s+)(?:store|winkel|shop)\s+openen$/iu, // nl
  /^ga\s+naar\s+de\s+(.+?)(?:-|\s+)(?:store|winkel|shop)$/iu, // nl, Belgium
  /^visite[rz]?\s+la\s+boutique(?:\s+de)?\s+(.+)$/iu, // fr
  /^visita\s+lo\s+store\s+di\s+(.+)$/iu, // it
  /^visita\s+la\s+tienda\s+de\s+(.+)$/iu, // es
  /^visite\s+a\s+loja(?:\s+d[aeo])?\s+(.+)$/iu, // pt
  /^odwiedź\s+sklep(?:\s+marki)?\s+(.+)$/iu, // pl
  /^besök\s+(.+?)(?:-|\s+)(?:butiken|butik|store)$/iu, // se
  /^(.+?)\s+mağazasını\s+ziyaret\s+edin$/iu, // tr
  /^(.+?)\s*のストアを表示$/iu, // ja
  /^(?:brand|marke|marque|merk|marca|marka|märke|varumärke|marchio|ブランド)\s*[:：]\s*(.+)$/iu,
];
// A store word joined to the brand by a hyphen: "Pokémon-Store", "Philips-winkel".
const HYPHEN_STORE_RE = /^(.+?)\s*[-‐–]\s*(?:store|shop|winkel|butiken|butik|boutique|markenshop)$/iu;
// Words that make a name a link to a store rather than a brand: "visit" and "open" in the marketplaces' languages
// (accents folded), and store words, which a brand ends with at most ("The Body Shop").
const VISIT_WORDS = new Set([
  "visit",
  "visiter",
  "visitez",
  "visita",
  "visite",
  "visitar",
  "besuche",
  "besuchen",
  "bezoek",
  "bezoeken",
  "openen",
  "offnen",
  "ouvrir",
  "abrir",
  "aprire",
  "odwiedz",
  "besok",
  "oppna",
  "ziyaret",
]);
const STORE_WORDS = new Set([
  "store",
  "shop",
  "winkel",
  "boutique",
  "tienda",
  "negozio",
  "sklep",
  "butik",
  "butiken",
  "loja",
  "storefront",
]);
// A brand is a name, not a sentence.
export const MAX_WORDS = 5;
const WORD_RE = /[\p{L}\p{N}]+/gu;
const TRIM = " -–—|:·,";
// Company forms after a store word keep it a name ("Funky Flair Boutique LLC").
const COMPANY_FORMS = new Set([
  "inc",
  "llc",
  "ltd",
  "limited",
  "gmbh",
  "bv",
  "nv",
  "sa",
  "sl",
  "srl",
  "corp",
  "co",
  "ab",
]);

function fold(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The brand inside a marketplace byline ("Visit the Airmax Store" is Airmax), or the text as it is. */
export function unwrapByline(value: string): string {
  let name = squash(value);
  for (const pattern of BYLINE_RES) {
    const m = pattern.exec(name);
    if (m) {
      name = stripChars(m[1] ?? "", TRIM);
      break;
    }
  }
  const hyphened = HYPHEN_STORE_RE.exec(name);
  if (hyphened) name = hyphened[1] ?? "";
  return stripChars(name, TRIM);
}

/** Whether a name can be a brand: at most `MAX_WORDS` words, no "visit" or "open", no store word but the last. */
export function plausibleBrand(name: string): boolean {
  const words = fold(name).match(WORD_RE) ?? [];
  if (words.length === 0 || words.length > MAX_WORDS) return false;
  if (words.some((w) => VISIT_WORDS.has(w))) return false;
  while (words.length > 1 && COMPANY_FORMS.has(words.at(-1) ?? "")) words.pop();
  return !words.slice(0, -1).some((w) => STORE_WORDS.has(w));
}

/** The brand a page names, ready to look up and to compare: unwrapped, or "" when it isn't a brand. */
export function cleanBrand(value: string): string {
  const name = unwrapByline(value);
  return plausibleBrand(name) ? cut(name, 300) : "";
}
