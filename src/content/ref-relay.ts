/**
 * Content script on the Unfret welcome page only (`<API base>/welcome*`, or a local dev origin).
 *
 * - When an affiliate's link brought the user, the page posts the affiliate's code to itself; this relays it to the
 *   background, which tells the server once with the extension's own pass, and tells the page how that went (so it
 *   can forget the code).
 * - On `/welcome?setup=1` the page posts whether this browser already had its free checks (a yes or no: the website's
 *   own note); this relays it to the background, which makes the extension's free pass with or without free checks,
 *   and tells the page how many it got (so it shows the welcome that fits).
 *
 * It reads nothing else from the page and sends the page nothing but those answers.
 */

import { loadSettings } from "../shared/settings.js";
import {
  acceptFreeAsk,
  acceptRefMessage,
  FREE_ANSWER_MESSAGE,
  FREE_ASK_MESSAGE,
  isFreeStatus,
  isRefStatus,
  REF_MESSAGE,
  REF_RECEIVED_MESSAGE,
} from "./relay.js";

// The page offers each a few times while it waits for an answer: one is enough.
let sent = false;
let asked = false;

async function relayRef(code: string): Promise<void> {
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
}

async function relayFreeAsk(had: boolean): Promise<void> {
  asked = true;
  const reply = await chrome.runtime
    .sendMessage<{ type: string; had: boolean }, { status?: unknown; free?: unknown } | undefined>({
      type: FREE_ASK_MESSAGE,
      had,
    })
    .catch(() => undefined);
  const status = isFreeStatus(reply?.status) ? reply.status : "error";
  const free = status === "free" && typeof reply?.free === "number" ? reply.free : 0;
  window.postMessage({ type: FREE_ANSWER_MESSAGE, status, free }, location.origin);
}

window.addEventListener("message", (event: MessageEvent) => {
  void (async () => {
    const { apiBase } = await loadSettings();
    const had = acceptFreeAsk(event, window, location.origin, apiBase);
    if (had !== null) {
      if (!asked) await relayFreeAsk(had);
      return;
    }
    const code = acceptRefMessage(event, window, location.origin, apiBase);
    if (code && !sent) await relayRef(code);
  })();
});
