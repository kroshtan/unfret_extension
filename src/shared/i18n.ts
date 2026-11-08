/**
 * UI strings in the browser's language (nl or en), from the `_locales` message files.
 *
 * In the extension `chrome.i18n` serves them; the same files are bundled here as a fallback so tests (and any
 * context without `chrome.i18n`) render real text, and so the language choice matches what we ask the API for.
 */

import en from "../_locales/en/messages.json";
import nl from "../_locales/nl/messages.json";

type Messages = Record<string, { message: string }>;

const BUNDLED: Record<Language, Messages> = { en, nl };

export type Language = "en" | "nl";
export type MessageKey = keyof typeof en;

/** The browser's UI language, narrowed to one Veridex supports (English otherwise). */
export function uiLanguage(): Language {
  let tag: string;
  try {
    tag = chrome.i18n.getUILanguage();
  } catch {
    tag = typeof navigator === "undefined" ? "" : navigator.language;
  }
  return tag.toLowerCase().startsWith("nl") ? "nl" : "en";
}

/** Fill `$1`, `$2`… in a bundled message. */
export function format(message: string, substitutions: readonly (string | number)[]): string {
  return message.replace(/\$(\d)/gu, (whole, n: string) => {
    const value = substitutions[Number(n) - 1];
    return value === undefined ? whole : String(value);
  });
}

/** A UI string by key, with `$1`… substitutions; `language` overrides the browser's (for tests). */
export function t(
  key: MessageKey,
  substitutions: readonly (string | number)[] = [],
  language?: Language,
): string {
  if (language === undefined) {
    try {
      const message = chrome.i18n.getMessage(key, substitutions.map(String));
      if (message) return message;
    } catch {
      // no chrome.i18n here: use the bundled files below
    }
  }
  const lang = language ?? uiLanguage();
  const entry = BUNDLED[lang][key] ?? BUNDLED.en[key];
  return format(entry?.message ?? key, substitutions);
}

/** Replace the text of every `[data-i18n]` element (and `data-i18n-label` aria-labels) under `root`. */
export function localise(root: ParentNode, language?: Language): void {
  for (const node of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n as MessageKey, [], language);
  }
  for (const node of root.querySelectorAll<HTMLElement>("[data-i18n-label]")) {
    node.setAttribute("aria-label", t(node.dataset.i18nLabel as MessageKey, [], language));
  }
}
