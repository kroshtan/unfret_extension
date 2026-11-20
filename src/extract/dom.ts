/**
 * DOM helpers that reproduce the BeautifulSoup semantics the backend's extractors rely on, so the same page yields
 * the same facts in the browser as on the server.
 */

const WS_RE = /\s+/gu;
// bs4's get_text() leaves out the contents of these (they are not page text).
const NON_TEXT = new Set(["SCRIPT", "STYLE", "TEMPLATE"]);

export function squash(text: string): string {
  return text.replace(WS_RE, " ").trim();
}

function textNodes(root: Node): string[] {
  const doc = root.ownerDocument ?? (root as Document);
  const parts: string[] = [];
  const walker = doc.createTreeWalker(root, 0x1 | 0x4, {
    // NodeFilter.SHOW_ELEMENT | SHOW_TEXT; reject (skip the subtree of) script/style/template elements.
    acceptNode(node: Node): number {
      if (node.nodeType === 1) return NON_TEXT.has((node as Element).tagName.toUpperCase()) ? 2 : 3;
      // In a browser with scripting on, <noscript> holds its markup as raw text; that is not page text.
      const parent = node.parentElement;
      if (parent?.tagName === "NOSCRIPT" && (node as Text).data.includes("<")) return 2;
      return 1;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) parts.push((node as Text).data);
  }
  return parts;
}

/** `squash(tag.get_text(" "))`: the element's text with whitespace collapsed ("" for null). */
export function text(node: Node | null | undefined): string {
  return node ? squash(textNodes(node).join(" ")) : "";
}

/** The element's strings joined with `separator` (bs4's `get_text(separator)`), without collapsing. */
export function rawText(node: Node, separator: string): string {
  return textNodes(node).join(separator);
}

/** Python's `str.strip(chars)`. */
export function stripChars(value: string, chars: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && chars.includes(value.charAt(start))) start++;
  while (end > start && chars.includes(value.charAt(end - 1))) end--;
  return value.slice(start, end);
}

/** Python's `urljoin(base, href)` for the cases pages produce: absolute hrefs stay as they are. */
export function urljoin(base: string, href: string): string {
  if (!base || /^[a-z][a-z0-9+.-]*:/iu.test(href)) return href;
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Order-preserving dedupe that drops empty items. */
export function dedupe(items: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (item && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

export function attr(el: Element | null | undefined, name: string): string {
  return el?.getAttribute(name) ?? "";
}

/** `tag.name` as bs4 reports it (lower case). */
export function tagName(el: Element): string {
  return el.tagName.toLowerCase();
}

/** Python's `str[:n]` by code points (UTF-16 slicing could split a surrogate pair). */
export function cut(value: string, n: number): string {
  if (value.length <= n) return value;
  return Array.from(value).slice(0, n).join("");
}

/** One JSON value starting at `start` (Python's `raw_decode`): the text up to its matching close. */
export function rawDecode(value: string, start: number): unknown {
  const open = value[start];
  if (open !== "{" && open !== "[") return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < value.length; i++) {
    const c = value[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(value.slice(start, i + 1)) as unknown;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}
