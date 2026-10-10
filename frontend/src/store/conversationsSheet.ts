// The per-home CONVERSATIONS SHEET's open flag (D84 §7, Phase 27 S9b). A ROOT sheet — mounted once in
// `DefaultRoot` beside the dialogs (not a composer overlay, so not the `composerOverlay` slot), opened by
// the chat header's conversations button (`ChatHeaderActions`). Dep-free `createStore` (D23), module
// state, NOT persisted: a sheet must never be open on a cold boot.

import { createStore } from "./createStore";

const { emit, useStore } = createStore();
let open = false;

/** Open the sheet (the header button). Idempotent. */
export function openConversationsSheet(): void {
  if (open) return;
  open = true;
  emit();
}

/** Close the sheet (a row tap, "New conversation", Escape, the catcher, leaving the chat tab). */
export function closeConversationsSheet(): void {
  if (!open) return;
  open = false;
  emit();
}

/** Whether the sheet is open — the header button's `aria-expanded` and the sheet's `open`. */
export function useConversationsSheetOpen(): boolean {
  return useStore(() => open);
}
