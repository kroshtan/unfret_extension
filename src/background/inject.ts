/**
 * Read the page the user asked to analyse. Runs only from the user's click on the toolbar button, which grants
 * `activeTab` for that one tab; the extension has no standing access to any shop.
 */

import type { Extraction } from "../extract/index.js";

export async function extractFromTab(tabId: number): Promise<Extraction> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["extract.js"] });
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__unfretExtract?.(),
  });
  const result: Extraction | undefined = injection?.result;
  if (!result) throw new Error("Couldn't read this page.");
  return result;
}
