/**
 * Content script on the Unfret welcome page only (`<API base>/welcome*`, or a local dev origin).
 *
 * When an affiliate's link brought the user, the page posts the affiliate's code to itself; this relays it to the
 * background, which tells the server once with the extension's own pass, and tells the page how that went (so it can
 * forget the code). It reads nothing else from the page and sends the page nothing but that status.
 */

import { loadSettings } from "../shared/settings.js";
import { acceptRefMessage, isRefStatus, REF_MESSAGE, REF_RECEIVED_MESSAGE } from "./relay.js";

let sent = false; // the page offers the code a few times while it waits for an answer: one is enough

window.addEventListener("message", (event: MessageEvent) => {
  void (async () => {
    const { apiBase } = await loadSettings();
    const code = acceptRefMessage(event, window, location.origin, apiBase);
    if (!code || sent) return;
    sent = true;
    const reply = await chrome.runtime
      .sendMessage<{ type: string; code: string }, { status?: unknown } | undefined>({
        type: REF_MESSAGE,
        code,
      })
      .catch(() => undefined); // the extension was updated or removed under this page: no answer
    if (!reply) return;
    const status = isRefStatus(reply.status) ? reply.status : "error";
    window.postMessage({ type: REF_RECEIVED_MESSAGE, status }, location.origin);
  })();
});
