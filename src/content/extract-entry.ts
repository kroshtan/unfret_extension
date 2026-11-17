/**
 * Injected on demand (`scripting.executeScript`) into the tab the user asked to analyse. It only defines a
 * function; the background calls it in a second injection and receives the facts and text. Nothing runs, and
 * nothing is read, until the user clicks "Analyse".
 */

import { extractPage } from "../extract/index.js";
import { checkedUrl } from "../shared/urls.js";

declare global {
  interface Window {
    __unfretExtract?: () => ReturnType<typeof extractPage>;
  }
}

// The page's address without its fragment and what is about the visitor (tracking, sessions, e-mail addresses): what
// the check sends, and what relative links on the page are resolved against.
window.__unfretExtract = () => extractPage(document, checkedUrl(location.href), { live: true });
