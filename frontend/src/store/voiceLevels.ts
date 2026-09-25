// THE OWNER'S LEARNED VOICE LEVEL, per microphone (Phase 24 / D76 §C.3, Maya F8) — the one number the
// relative gate learns about the owner rather than about the room, remembered across calls so the
// next call on the same mic starts with its own-voice term already KNOWN (C.4: it applies from the
// first frame, which is what closes the bootstrap window against a steady interferer).
//
// DEVICE-LOCAL BY DEFINITION, so NOT `UIState`: that store is synced across the owner's devices through
// the appearance channel, and a level learned on the phone's mic means nothing to a laptop's. One
// localStorage blob keyed by the capture's effective device (`voiceDeviceKey`), via the shared persist
// helpers — the `store/sheetSnap` shape exactly.
//
// …AND MODE-LOCAL (S3b, owner report 2026-09-25): the key is the device × the echo-cancellation mode
// the track was GRANTED, because the same physical mic opens quieter under the phone's call processing
// (R83: ~4 dB into the handset, more at a distance). Keyed by device alone, the Call capture inherited
// the loud level learned under Media, `V − margin` sat above the owner's own voice, and every final was
// dropped as too quiet until a different device (unseeded) was picked. The GRANT rather than the route
// that asked: R78 §2.3's pin can hand an EC-off ask an EC-on track, and the level is the mode's that
// actually opened.
//
// NO `createStore`, deliberately (the `store/micRelease` reasoning): nothing RENDERS off this. The call
// machine seeds from it when a capture opens and writes back when the capture is released, both
// imperatively; a subscription would buy a re-render nobody wants.
//
// Storage that throws (private mode, blocked site data, a full quota) or holds garbage reads as
// UNSEEDED, and a failed write is dropped — `persist.ts` swallows both, and the value check below
// refuses anything that is not a finite number. The worst outcome is a call that learns from scratch.

import { loadPersisted, savePersisted } from "./persist";

const KEY = "ctrlb.voiceLevels";
/** The separator every current key carries — and so the mark that tells a live entry from a legacy one. */
const MODE = "|ec=";

type LevelMap = Record<string, number>;

/**
 * The key a capture's level is stored under: `"<device>|ec=<mode>"`. The device is the readback
 * `deviceId` when it names a real device, else the track label. Chrome reports `"default"` (and some
 * browsers `""`) for the system default route, which is not an identity — a different physical mic can
 * sit behind it tomorrow — so the label (what the browser says actually opened) is the better key
 * there. The mode is the GRANTED echo cancellation, normalized: `"all"` → `all`, `true` → `on`, and
 * anything else (`false`, unreported, an unknown string) → `off`. `null` when the device is unnamed,
 * whatever the mode — a mode alone identifies nothing.
 */
export function voiceDeviceKey(readback: {
  deviceId: string;
  label: string;
  echoCancellation?: string | boolean;
}): string | null {
  const device =
    readback.deviceId && readback.deviceId !== "default" ? readback.deviceId : readback.label;
  if (!device) return null;
  const ec = readback.echoCancellation;
  return `${device}${MODE}${ec === "all" ? "all" : ec === true ? "on" : "off"}`;
}

/** The learned level for `deviceKey`, dBFS, or `null` when this device has none (or storage is out). */
export function getVoiceLevel(deviceKey: string): number | null {
  const v = loadPersisted<LevelMap>(KEY, {})[deviceKey];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Remember `dbfs` as `deviceKey`'s learned level (a no-op when storage is unavailable). */
export function setVoiceLevel(deviceKey: string, dbfs: number): void {
  if (!Number.isFinite(dbfs)) return;
  // NO LEGACY DATA: an entry without the mode suffix predates S3b's key and can never be read again,
  // so the write that finds one drops it rather than carrying it in the blob forever.
  const kept = Object.entries(loadPersisted<LevelMap>(KEY, {})).filter(([k]) => k.includes(MODE));
  savePersisted(KEY, { ...Object.fromEntries(kept), [deviceKey]: dbfs });
}
