/**
 * Content script on the Unfret connect page only (`<API base>/connect*`, or a local dev origin).
 * Relays the session the page posts after sign-in to the extension; the background checks the sender again.
 */

import { loadSettings, type Session } from "../shared/settings.js";
import { acceptSessionMessage, SESSION_MESSAGE, SESSION_RECEIVED_MESSAGE } from "./relay.js";

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
      // Answer in the page's own naming: the old site waits for SESSION_RECEIVED_MESSAGE, the renamed one for
      // "unfret-session-received".
      const renamed = (event.data as { type?: unknown }).type === "unfret-session";
      window.postMessage(
        { type: renamed ? "unfret-session-received" : SESSION_RECEIVED_MESSAGE },
        location.origin,
      );
    }
  })();
});
