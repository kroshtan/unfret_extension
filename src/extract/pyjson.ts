/**
 * The length of Python's `json.dumps(value)` (separators ", " and ": ", ASCII-only output), used where the
 * backend caps JSON-LD by serialised size, so both sides keep or trim the same nodes.
 */

function stringLength(value: string): number {
  let n = 2; // quotes
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      ch === '"' ||
      ch === "\\" ||
      ch === "\n" ||
      ch === "\r" ||
      ch === "\t" ||
      ch === "\b" ||
      ch === "\f"
    ) {
      n += 2;
    } else if (code < 0x20 || (code > 0x7e && code <= 0xffff)) n += 6;
    else if (code > 0xffff) n += 12;
    else n += 1;
  }
  return n;
}

export function pyJsonLength(value: unknown): number {
  if (value === null || value === undefined) return 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") return Number.isFinite(value) ? String(value).length : 8;
  if (typeof value === "string") return stringLength(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return 2;
    return 2 + value.reduce<number>((sum, v) => sum + pyJsonLength(v), 0) + 2 * (value.length - 1);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return 2;
    const inner = entries.reduce((sum, [k, v]) => sum + stringLength(k) + 2 + pyJsonLength(v), 0);
    return 2 + inner + 2 * (entries.length - 1);
  }
  return 4; // not a JSON value (cannot come from JSON.parse); counted like null
}
