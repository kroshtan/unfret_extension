/**
 * Content script on the Unfret connect page only (`<API base>/connect*`, or a local dev origin).
 * Relays the session the page posts after sign-in to the extension, with whether the user has just clicked on the
 * page (user activation); the background checks the sender again and decides (signed in, or a click or the user's yes
 * in the extension's own window first). The page hears back in its own naming.
 */

import { loadSettings, type Session } from "../shared/settings.js";
import {
  ANSWER_MESSAGE,
  acceptSessionMessage,
  isSessionHandoffStatus,
  SESSION_MESSAGE,
  SESSION_RECEIVED_MESSAGE,
  SESSION_STATUS_MESSAGE,
  userActivated,
} from "./relay.js";

/** The page's naming: the old site waits for SESSION_RECEIVED_MESSAGE, the renamed one for "unfret-session-received". */
let renamed = false;

function received(): void {
  window.postMessage(
    { type: renamed ? "unfret-session-received" : SESSION_RECEIVED_MESSAGE },
    location.origin,
  );
}

window.addEventListener("message", (event: MessageEvent) => {
  const activated = userActivated();
  void (async () => {
    const { apiBase } = await loadSettings();
    const session = acceptSessionMessage(event, window, location.origin, apiBase);
    if (!session) return;
    renamed = (event.data as { type?: unknown }).type === "unfret-session";
    const reply = await chrome.runtime
      .sendMessage<
        { type: string; session: Session; activated: boolean },
        { ok?: boolean; status?: unknown } | undefined
      >({
        type: SESSION_MESSAGE,
        session,
        activated,
      })
      .catch(() => undefined);
    if (reply?.ok) received();
    else if (isSessionHandoffStatus(reply?.status)) {
      window.postMessage({ type: SESSION_STATUS_MESSAGE, status: reply.status }, location.origin);
    }
  })();
});

// The user's answer in the extension's own window, for the wallet this page signed in with.
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  const m = message as { type?: unknown; kind?: unknown; status?: unknown } | null;
  if (m?.type !== ANSWER_MESSAGE || m.kind !== "wallet") return;
  if (m.status === "signed-in") received();
  else if (m.status === "kept")
    window.postMessage({ type: SESSION_STATUS_MESSAGE, status: "kept" }, location.origin);
});
