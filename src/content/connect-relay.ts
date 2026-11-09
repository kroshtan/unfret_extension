/**
 * Content script on the Veridex connect page only (`https://unfret.kroshtan.com/connect*`, or the dev origin).
 * Relays the session the page posts after sign-in to the extension; the background checks the sender again.
 */

import { loadSettings, type Session } from "../shared/settings.js";
import { acceptSessionMessage, SESSION_MESSAGE } from "./relay.js";

window.addEventListener("message", (event: MessageEvent) => {
  void (async () => {
    const { apiBase } = await loadSettings();
    const session = acceptSessionMessage(event, window, location.origin, apiBase);
    if (!session) return;
    const reply = await chrome.runtime.sendMessage<
      { type: string; session: Session },
      { ok: boolean } | undefined
    >({
      type: SESSION_MESSAGE,
      session,
    });
    if (reply?.ok) {
      window.postMessage({ type: "veridex-session-received" }, location.origin);
    }
  })();
});
