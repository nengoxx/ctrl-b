import type { KeyboardEvent } from "react";

// The ONE modal keydown contract (extracted 2026-07-30 / A3 slice 3 review, MED). PromptModal has
// owned this since 7e-b; the automations editor sheet needs exactly the same behaviour, and a second
// copy is precisely the "similar code for the same thing we already own" failure the repo bans.
//
// Two things, and both are deliberate:
//
//  * **Escape closes**, from a handler scoped to the BACKDROP element — not `window`. Keydown bubbles
//    from focused descendants, so an Escape pressed inside the panel still reaches it, while an Escape
//    aimed at some other layer never does. (F17's rule for ConfirmDialog, applied here too.)
//  * **Tab cycles the LIVE focusable set.** Re-queried on every Tab rather than captured once, because
//    the panel's focusable children change while it is open (PromptModal's Load/Restore buttons only
//    exist when a default is set; the sheet's preset sub-fields swap with the picked preset). A
//    snapshot would let focus escape the moment the set changed.
//
// `preventDefault` on Tab is what makes the trap real: a textarea would otherwise move focus itself.

/** What counts as focusable inside a trapped panel. Deliberately narrow — the elements our modals
 *  actually contain — rather than the full generic query: every one of these is a real tab stop, so
 *  the cycle can never land on something the user cannot operate. `[disabled]` is filtered at use. */
const FOCUSABLE = "a[href], button, textarea, input, select";

/** Handle one keydown on a modal backdrop: Escape → `onClose`, Tab/Shift+Tab → cycle `panel`'s live
 *  focusable set.
 *
 *  Takes the resolved ELEMENT rather than a ref (or a getter for one), so the caller reads
 *  `panelRef.current` inside its own event handler — where reading a ref is exactly what refs are for —
 *  and nothing about this helper can be reached during render:
 *
 *      onKeyDown={(e) => modalKeyDown(e, panelRef.current, close)}
 */
export function modalKeyDown(
  e: KeyboardEvent<HTMLElement>,
  panel: HTMLElement | null,
  onClose: () => void,
): void {
  if (e.key === "Escape") {
    e.preventDefault();
    onClose();
    return;
  }
  if (e.key !== "Tab" || !panel) return;
  const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (node) => !node.hasAttribute("disabled"),
  );
  if (!items.length) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = e.shiftKey
    ? items[(i - 1 + items.length) % items.length]
    : items[(i + 1) % items.length];
  next.focus();
}
