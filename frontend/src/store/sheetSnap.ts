// Remembered open-detent (peek vs full) for the reusable <BottomSheet>, KEYED by sheet identity so EVERY
// theme's sheet reuses ONE store — cosmos today, frontier (T5) tomorrow — by passing a stable key string,
// not by hand-rolling a per-theme store (the BottomSheet primitive is shared; so is its memory). Mirrors the
// `store/collapse` shape: one localStorage blob (`Record<id, value>`) via the shared persist helpers.
//
// Unlike `collapse` it needs NO `createStore`/hook: the detent is consumed only at OPEN time (imperatively,
// via the host's `initialSnap` prop) and written on settle, so reading localStorage fresh each call is both
// simplest and correct — a snap change must NOT re-render the heavy host tree (e.g. CosmosFleet's orbital).
//
// The primitive stays pure (it owns the GESTURE; the host wires this MEMORY through initialSnap/onSnapChange
// — the controlled-with-callback seam vaul/Radix use, where persistence is the consumer's job).

import type { SheetDetent } from "../components/BottomSheet";
import { loadPersisted, savePersisted } from "./persist";

const KEY = "ctrlb.sheetSnap";

type SnapMap = Record<string, SheetDetent>;

/** The detent a sheet should open at — the last one the user left it at under `key` (default "peek"). A
 *  corrupt/absent entry falls back to "peek" (the sheet's own default detent). */
export function getSheetSnap(key: string): SheetDetent {
  return loadPersisted<SnapMap>(KEY, {})[key] === "full" ? "full" : "peek";
}

/** Record the detent the user settled a sheet on under `key`, persisted per-device for the next open. */
export function setSheetSnap(key: string, snap: SheetDetent): void {
  savePersisted(KEY, { ...loadPersisted<SnapMap>(KEY, {}), [key]: snap });
}
