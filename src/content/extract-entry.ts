/**
 * Injected on demand (`scripting.executeScript`) into the tab the user asked to analyse. It only defines a
 * function; the background calls it in a second injection and receives the facts and text. Nothing runs, and
 * nothing is read, until the user clicks "Analyse".
 */

import { extractPage } from "../extract/index.js";

declare global {
  interface Window {
    __veridexExtract?: () => ReturnType<typeof extractPage>;
  }
}

window.__veridexExtract = () => extractPage(document, location.href, { live: true });
