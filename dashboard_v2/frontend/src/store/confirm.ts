// Imperative confirm dialog (Phase 2: shutdown is the lone confirm-gated action). A caller does
// `if (await requestConfirm({...})) …`; the <ConfirmDialog/> host renders the active request and
// resolves the promise on the user's choice. Dependency-free external store, like store/ui.ts.
//
// This is a UX gate; the server still runs its single-use confirm-token dance underneath
// (defense in depth — DESIGN §14). One dialog at a time is enough for a single-user panel.

import { createStore } from "./createStore";

export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface Active extends ConfirmRequest {
  resolve: (ok: boolean) => void;
}

const { emit, useStore } = createStore();
let active: Active | null = null;

export function requestConfirm(req: ConfirmRequest): Promise<boolean> {
  // If one is already open, decline it before replacing (shouldn't happen in single-user flow).
  active?.resolve(false);
  return new Promise<boolean>((resolve) => {
    active = { ...req, resolve };
    emit();
  });
}

export function resolveConfirm(ok: boolean): void {
  const a = active;
  active = null;
  emit();
  a?.resolve(ok);
}

export function useConfirm(): Active | null {
  return useStore(() => active);
}
