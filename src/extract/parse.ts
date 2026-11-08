/**
 * Locale-tolerant parsing of the numbers, prices and dates found on shop pages (en, de, fr, nl, es, it).
 * A line-for-line port of the backend's `veridex/facts/_parse.py`; parity tests keep the two in step.
 */

const MONTHS = new Map<string, number>();
[
  "january jan januar janvier janv januari enero ene gennaio gen",
  "february feb februar février fév fevrier fev februari febrero febbraio",
  "march mar märz maerz mars maart marzo",
  "april apr avril avr abril aprile",
  "may mai mei mayo maggio mag",
  "june jun juni juin junio giugno giu",
  "july jul juli juillet juil julio luglio lug",
  "august aug august août aout augustus agosto ago",
  "september sep sept septembre septiembre settembre set",
  "october oct oktober okt octobre octubre ottobre ott",
  "november nov novembre noviembre",
  "december dec dezember dez décembre déc decembre diciembre dic dicembre",
].forEach((names, index) => {
  for (const name of names.split(" ")) MONTHS.set(name, index + 1);
});

// Python's `\b` and `[^\W\d_]` are Unicode-aware; JavaScript's `\b` is ASCII-only, so word boundaries are spelled
// out as lookarounds over Unicode letters and numbers.
const NOT_WORD_BEFORE = String.raw`(?<![\p{L}\p{N}_])`;
const NOT_WORD_AFTER = String.raw`(?![\p{L}\p{N}_])`;

const ISO_RE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/u;
const DAY_MONTH_YEAR_RE = new RegExp(
  String.raw`${NOT_WORD_BEFORE}(\d{1,2})\.?\s+(\p{L}{3,10})\.?\s+(\d{4})${NOT_WORD_AFTER}`,
  "u",
);
const MONTH_DAY_YEAR_RE = new RegExp(
  String.raw`${NOT_WORD_BEFORE}(\p{L}{3,10})\.?\s+(\d{1,2}),?\s+(\d{4})${NOT_WORD_AFTER}`,
  "u",
);
// Digits with dots, commas, no-break spaces (U+00A0) and narrow no-break spaces (U+202F) as separators.
const NUMBER_RE = /\d[\d.,\u00a0\u202f]*/u;
const CURRENCY_SYMBOLS: [string, string][] = [
  ["$", "USD"],
  ["€", "EUR"],
  ["£", "GBP"],
  ["¥", "JPY"],
  ["₹", "INR"],
  ["zł", "PLN"],
  ["kr", "SEK"],
];
const CURRENCY_CODE_RE = new RegExp(
  String.raw`${NOT_WORD_BEFORE}(USD|EUR|GBP|CAD|AUD|JPY|INR|PLN|SEK|CHF|DKK|NOK|TRY|MXN|BRL)${NOT_WORD_AFTER}`,
  "u",
);

function validDate(year: number, month: number, day: number): string | null {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The first date in `text` (ISO, or with a month name in a supported language) as `YYYY-MM-DD`, or null. */
export function parseDate(text: string): string | null {
  const candidates: [number, number, number, number][] = []; // position, year, month, day
  let m = ISO_RE.exec(text);
  if (m) candidates.push([m.index, Number(m[1]), Number(m[2]), Number(m[3])]);
  m = DAY_MONTH_YEAR_RE.exec(text);
  if (m) {
    const month = MONTHS.get((m[2] ?? "").toLowerCase());
    if (month) candidates.push([m.index, Number(m[3]), month, Number(m[1])]);
  }
  m = MONTH_DAY_YEAR_RE.exec(text);
  if (m) {
    const month = MONTHS.get((m[1] ?? "").toLowerCase());
    if (month) candidates.push([m.index, Number(m[3]), month, Number(m[2])]);
  }
  candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
  for (const [, year, month, day] of candidates) {
    const iso = validDate(year, month, day);
    if (iso) return iso;
  }
  return null;
}

/**
 * The first number in `text`, with `,` or `.` as decimal or thousands separator: the last separator followed by
 * one or two digits is the decimal point ("1.299,00", "4,5", "9.99"); one followed by three groups thousands.
 */
export function parseNumber(text: string): number | null {
  const m = NUMBER_RE.exec(text);
  if (!m) return null;
  const raw = m[0].replace(/[\u00a0\u202f]/gu, "").replace(/[.,]+$/u, "");
  const last = Math.max(raw.lastIndexOf(","), raw.lastIndexOf("."));
  if (last === -1) return Number(raw);
  const decimals = raw.slice(last + 1);
  if (decimals.length === 1 || decimals.length === 2) {
    const integer = raw.slice(0, last).replace(/[.,]/gu, "");
    return Number(`${integer}.${decimals}`);
  }
  return Number(raw.replace(/[.,]/gu, ""));
}

/** A count such as "2,285 ratings" or "1.204 Sternebewertungen". */
export function parseCount(text: string): number | null {
  const m = NUMBER_RE.exec(text);
  if (!m) return null;
  const digits = m[0].replace(/\D/gu, "");
  return digits ? Number(digits) : null;
}

/** A price and its ISO currency from text such as "$9.99", "12,99 €" or "EUR 1.299,00". */
export function parsePrice(text: string): [number | null, string] {
  let currency = "";
  const code = CURRENCY_CODE_RE.exec(text);
  if (code) currency = code[1] ?? "";
  else {
    for (const [symbol, iso] of CURRENCY_SYMBOLS) {
      if (text.includes(symbol)) {
        currency = iso;
        break;
      }
    }
  }
  return [parseNumber(text), currency];
}

/** A star rating such as "4.5 out of 5 stars" (0–5), or null when absent or out of range. */
export function parseRating(text: string): number | null {
  const value = parseNumber(text);
  return value !== null && value >= 0 && value <= 5 ? value : null;
}
