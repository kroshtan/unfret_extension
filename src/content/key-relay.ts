/**
 * Content script on the Unfret checkout page only (`<API base>/checkout*`, or a local dev origin).
 *
 * When the page shows a new API key it posts it to itself; this relays it to the background, with whether the user
 * has just clicked on the page (the browser's user activation: a page can't fake it), and tells the page how that
 * went. Signed in with another account, the extension asks in its own window, and its answer comes back here later
 * ("signed-in" or "kept"). It reads nothing else from the page and sends the page nothing but that status (and, for
 * "other-account", whether that is the extension's own free pass).
 */

import { loadSettings } from "../shared/settings.js";
import {
  ANSWER_MESSAGE,
  acceptKeyMessage,
  isKeyHandoffStatus,
  KEY_MESSAGE,
  KEY_RECEIVED_MESSAGE,
  userActivated,
} from "./relay.js";

window.addEventListener("message", (event: MessageEvent) => {
  // Read at once: the activation belongs to this moment, not to after the settings have loaded.
  const activated = userActivated();
  void (async () => {
    const { apiBase } = await loadSettings();
    const offer = acceptKeyMessage(event, window, location.origin, apiBase);
    if (!offer) return;
    const reply = await chrome.runtime
      .sendMessage<
        { type: string; key: string; replace: boolean; activated: boolean },
        { status?: unknown; freePass?: unknown } | undefined
      >({
        type: KEY_MESSAGE,
        key: offer.key,
        replace: offer.replace,
        activated,
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

// The user's answer in the extension's own window, for the key this page handed over.
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  const m = message as { type?: unknown; kind?: unknown; status?: unknown } | null;
  if (m?.type !== ANSWER_MESSAGE || m.kind !== "key") return;
  if (m.status !== "signed-in" && m.status !== "kept") return;
  window.postMessage({ type: KEY_RECEIVED_MESSAGE, status: m.status }, location.origin);
});
