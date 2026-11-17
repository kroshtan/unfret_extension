/**
 * Content script on the Unfret checkout page only (`<API base>/checkout*`, or a local dev origin).
 *
 * When the page shows a new API key it posts it to itself; this relays it to the background, which signs the
 * extension in with it (or, signed in with another account, waits until the user agrees on the page), and tells the
 * page how that went. It reads nothing else from the page and sends the page nothing but that status (and, for
 * "other-account", whether that is the extension's own free pass).
 */

import { loadSettings } from "../shared/settings.js";
import { acceptKeyMessage, isKeyHandoffStatus, KEY_MESSAGE, KEY_RECEIVED_MESSAGE } from "./relay.js";

window.addEventListener("message", (event: MessageEvent) => {
  void (async () => {
    const { apiBase } = await loadSettings();
    const offer = acceptKeyMessage(event, window, location.origin, apiBase);
    if (!offer) return;
    const reply = await chrome.runtime
      .sendMessage<
        { type: string; key: string; replace: boolean },
        { status?: unknown; freePass?: unknown } | undefined
      >({
        type: KEY_MESSAGE,
        key: offer.key,
        replace: offer.replace,
      })
      .catch(() => undefined); // the extension was updated or removed under this page: no answer
    if (!reply) return;
    const status = isKeyHandoffStatus(reply.status) ? reply.status : "invalid";
    // free_pass: what the extension has is the free pass it made itself (its free checks follow on a switch).
    const answer =
      status === "other-account" && reply.freePass === true
        ? { type: KEY_RECEIVED_MESSAGE, status, free_pass: true }
        : { type: KEY_RECEIVED_MESSAGE, status };
    window.postMessage(answer, location.origin);
  })();
});
