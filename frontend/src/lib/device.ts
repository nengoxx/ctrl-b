// lib/device — THIS browser profile's device id (S11 (c), owner ruling 2026-10-14: "only the device that
// started a turn auto-speaks it; any other device reads it with the play button").
//
// `streamTurn` sends it as `X-Ctrlb-Device` on every own turn (chat · steer · regenerate · resume); the
// server stamps it on each assistant reply that turn writes, and `useAutoTts` speaks a reply only when
// the reply's `device` is this one. Shaped after `liveSocket.liveClientId` (resolved once per document,
// every storage access tolerated) but PERSISTENT: `localStorage` through the shared persist helpers, so
// the id outlives a reload, an app kill and a view hop — a tab id would make the owner's own turn,
// re-attached after a reload, read as another device's. Two tabs of one profile are one device.

import { loadPersisted, savePersisted } from "../store/persist";

const DEVICE_KEY = "ctrlb.device";

/** A device id as minted here: 16 random bytes as 32 lowercase hex — the server's `_request_device`
 *  accepts exactly this shape, so a stored value that is anything else is re-minted, never sent. */
export function isDeviceId(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{32}$/.test(v);
}

/** Resolved ONCE per document (`undefined` = not yet), like `liveClientId`. */
let resolved: string | null | undefined;

/** 16 bytes from `getRandomValues` — available outside a secure context too (unlike `randomUUID`), so
 *  plain-HTTP dev still gets an id. `null` when there is no `crypto` at all. */
function mint(): string | null {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") return null;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * This profile's device id, or `null` — and `null` means NO HEADER: every reply then reads as UNKNOWN on
 * this device, which is the pre-S11 behaviour exactly (v4.1, Sol 3b — never "every other device is
 * foreign"). Minted once and READ BACK: a private window, blocked site data or a full quota swallow the
 * write (`savePersisted`), and an id no reload could keep would make this device's own replies foreign
 * after the next one. The read-back also adopts a sibling tab's id if it won a simultaneous mint.
 */
export function deviceId(): string | null {
  if (resolved === undefined) resolved = resolve();
  return resolved;
}

function resolve(): string | null {
  const stored = loadPersisted<unknown>(DEVICE_KEY, null);
  if (isDeviceId(stored)) return stored;
  const minted = mint();
  if (minted === null) return null;
  savePersisted(DEVICE_KEY, minted);
  const back = loadPersisted<unknown>(DEVICE_KEY, null);
  return isDeviceId(back) ? back : null;
}
