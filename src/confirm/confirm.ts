/**
 * The extension's own question, in a small window it opens itself, before it switches to a pass or wallet that
 * unfret.net handed over while it uses another one (`shared/handoff.ts`). A web page can't draw on it, frame it or
 * answer it: only a click here switches.
 */

import { answerOffer, type Offer, pendingOffer } from "../shared/handoff.js";
import { accountLabel, isKeySession, type Session } from "../shared/settings.js";

function el(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} missing`);
  return found;
}

/** How the window names an account: "pass ABCDE-FGHIJ", "your free pass ABCDE-FGHIJ", "wallet 9xQe…VFin". */
export function accountName(session: Session, freePass = false): string {
  if (!isKeySession(session)) return `wallet ${accountLabel(session)}`;
  return `${freePass ? "your free pass" : "pass"} ${accountLabel(session)}`;
}

function finish(text: string): void {
  el("ask").hidden = true;
  el("done-text").textContent = text;
  el("done").hidden = false;
  button("close").focus();
}

function button(id: string): HTMLButtonElement {
  const found = el(id);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`#${id} is not a button`);
  return found;
}

/** Show `offer` (none: it was answered or ran out). */
export function render(offer: Offer | undefined): void {
  if (!offer) {
    finish("Nothing to confirm: this question was answered or has run out. Unfret didn't change anything.");
    return;
  }
  const isKey = offer.kind === "key";
  el("ask-heading").textContent = isKey ? "Use this pass in Unfret?" : "Sign Unfret in with this wallet?";
  el("ask-current").textContent = accountName(offer.current, offer.freePass);
  el("ask-offered-label").textContent = isKey ? "unfret.net offers" : "unfret.net signed in";
  el("ask-offered").textContent = accountName(offer.session);
  el("ask-free").hidden = !(isKey && offer.freePass);
  button("use").textContent = isKey ? "Use the new pass" : "Use this wallet";
  button("keep").textContent = "Keep the current one";
  el("done").hidden = true;
  el("ask").hidden = false;
  el("ask").dataset.offer = offer.id;
  el("ask-heading").focus();
}

async function answer(accept: boolean): Promise<void> {
  const id = el("ask").dataset.offer ?? "";
  button("use").disabled = button("keep").disabled = true;
  const outcome = await answerOffer(id, accept);
  button("use").disabled = button("keep").disabled = false;
  if (outcome === "gone") {
    render(await pendingOffer());
    return;
  }
  finish(
    outcome === "signed-in"
      ? "Done: Unfret uses it now. You can close this window."
      : "Unfret keeps what it has. You can close this window.",
  );
  setTimeout(() => {
    window.close();
  }, 1500);
}

async function init(): Promise<void> {
  render(await pendingOffer());
  button("use").addEventListener("click", () => void answer(true));
  button("keep").addEventListener("click", () => void answer(false));
  button("close").addEventListener("click", () => {
    window.close();
  });
  // A newer question replaces this one in the same window.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "session" || !("handoffOffer" in changes)) return;
    const next = changes.handoffOffer.newValue as Offer | undefined;
    if (next && next.id !== el("ask").dataset.offer) render(next);
  });
}

if (typeof document !== "undefined" && document.getElementById("ask")) void init();
