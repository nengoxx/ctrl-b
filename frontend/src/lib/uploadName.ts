// AUTO-UNIQUE UPLOAD NAMES (D65 / MEDIA_MANAGER_PLAN §2.5) — the filename an upload gets, minted so
// that it can never collide and can never be refused.
//
// PURE, and the `lib/media.ts` house shape: the folder's current contents and the naming policy both
// arrive as ARGUMENTS, so nothing here reads config, the registry or the query cache.
//
// ── why this exists ──────────────────────────────────────────────────────────────────────────────
//
// **Filenames carry no owner-facing meaning in a POOL role** — the LIBRARY model made priority a list
// position and identity a `files` entry, so the name is an internal handle. That is what lets the
// upload mint one rather than negotiate: no Replace dialog, no `?overwrite`, no revision machinery
// (all deleted at D65). Uploads are purely additive; delete is the only removal.
//
// Two rules have to hold, and they pull in opposite directions:
//
//  ① the server must ADMIT the name — `core/media.py#admission_reason` rejects (never sanitises) a
//    non-NFC name, a control character, `<>:"|?*`, a leading dot, a trailing dot or space, a Windows
//    device name, anything over 255 UTF-8 bytes, or an extension outside the allowlist. A refusal is
//    a 422 on a name the CLIENT chose, so the client must not choose one;
//  ② the name must be UNIQUE in the role folder, and stay unique when the suffix walk runs — which is
//    why the byte budget reserves room for the largest suffix BEFORE truncating (Emma #7). Truncating
//    to exactly 255 and then appending `-12` produces a name the server refuses, on the retry, after
//    the upload has already been paid for.
//
// The server's plain 409-on-exists is the race guard, not the uniqueness mechanism: two devices
// picking at the same instant is the only way past the walk, and the client answers it by minting the
// next suffix and retrying — never a dialog (§2.5).

import { normalizeMediaKey } from "./media";

/** The naming policy — `theme-engine/mediaRegistry.ts#UPLOAD_LIMITS`, structurally. */
export interface NameLimits {
  /** The filesystem's own budget, in UTF-8 BYTES (a 100-character name of 3-byte code points is 300).
   *  Mirrors `core/media.py#MAX_NAME_BYTES`. */
  maxNameBytes: number;
  /** How far the `-2`, `-3`, … walk runs before the timestamp fallback takes over. */
  attempts: number;
}

/** The stem an upload falls back to when the picked file's own name survives sanitising as nothing —
 *  an Android content URI can hand over a name that is entirely punctuation, or nothing at all. */
export const FALLBACK_STEM = "image";

//: Characters the ADMISSION tier refuses, plus the two path separators. Dropped rather than replaced:
//: a substitution invents a name the owner never typed, and the stem means nothing anyway.
// eslint-disable-next-line no-control-regex -- the control range IS the rule here, not an accident
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f\u007f\ufffd]/g;

//: The DOS device names Windows refuses as a whole filename however it is spelled (`CON.png` too).
//: `ntpath.isreserved` is the server's authority; this is the client mirror that keeps the mint from
//: ever producing one. Matched against the whole casefolded stem, as the server matches it.
const DOS_DEVICES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

const utf8 = new TextEncoder();
const byteLength = (s: string): number => utf8.encode(s).length;

/** A picked file's name, reduced to a stem the server will admit.
 *
 *  SANITISES where the server REFUSES, and that asymmetry is the design (§3): the server may not
 *  invent a name for a client, but the client is naming its own upload and has nothing to negotiate
 *  about. NFC first, for the same reason the server requires it — a macOS-decomposed `é` is a
 *  different byte string from a Linux-composed one, and the binding key every comparison goes through
 *  normalises to NFC. */
export function sanitizeStem(raw: string): string {
  const dot = raw.lastIndexOf(".");
  // Drop the picked extension: the stored one is derived from the EXPORT's `blob.type` (R54 §3.3 —
  // an unsupported `toBlob` type silently yields PNG, so what was asked for proves nothing).
  const stem = dot > 0 ? raw.slice(0, dot) : raw;
  const cleaned = stem
    .normalize("NFC")
    .replace(FORBIDDEN, "")
    // Leading dots would make a hidden file; trailing dots and spaces are silently stripped by
    // Windows, so the file the owner thinks they saved is not the one on disk.
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .trim();
  if (cleaned === "") return FALLBACK_STEM;
  // A reserved device name is refused WITH any extension, so the fix has to change the stem itself.
  return DOS_DEVICES.has(normalizeMediaKey(cleaned)) ? `${cleaned}-file` : cleaned;
}

/** Cut a string to `budget` UTF-8 bytes ON A CODE-POINT BOUNDARY (Emma #7).
 *
 *  Iterating code points rather than UTF-16 units is what keeps an emoji or a CJK character from
 *  being sliced in half into a lone surrogate — which encodes as U+FFFD, the one character the
 *  admission tier refuses outright as evidence that a decode already lost the real name. */
export function truncateToBytes(s: string, budget: number): string {
  if (byteLength(s) <= budget) return s;
  let out = "";
  let used = 0;
  for (const cp of s) {
    const n = byteLength(cp);
    if (used + n > budget) break;
    out += cp;
    used += n;
  }
  // A trailing dot or space can only have been exposed BY the cut, and it is refused just the same.
  return out.replace(/[. ]+$/, "");
}

/** The name a new upload takes: `<stem><ext>`, then `-2`, `-3`, … then the timestamp fallback.
 *
 *  `taken` is compared through `normalizeMediaKey` — the SAME rule the binding uses. Two files whose
 *  stems differ only by case or NFC form are one binding on a `named` role and an invisible duplicate
 *  in a pool, so minting `Lyra.png` beside `lyra.png` would be minting a collision the folder cannot
 *  show. The FILESYSTEM would accept it (this one is POSIX); the library would not.
 *
 *  `now` is injected so the fallback arm is a deterministic test rather than a clock race. */
export function mintName(
  rawStem: string,
  ext: string,
  taken: Iterable<string>,
  limits: NameLimits,
  now: number = Date.now(),
): string {
  const used = new Set<string>();
  for (const name of taken) used.add(normalizeMediaKey(name));
  // Reserve for the LONGEST thing that can be appended, always — the walk must not be able to produce
  // a name the server refuses for length after the upload was already spent on the first try.
  //
  // The timestamp half is sized for the FURTHEST the advance below can reach, not for `now`: every
  // iteration that does not return eliminates one distinct member of `used`, so the returned instant
  // is at most `now + used.size`. Computing the reserve from that makes the budget exact rather than
  // "true until the base-36 digit count rolls over".
  const stamp = `-${(now + used.size).toString(36)}`;
  const reserve = Math.max(byteLength(`-${limits.attempts}`), byteLength(stamp));
  const budget = limits.maxNameBytes - byteLength(ext) - reserve;
  const base = truncateToBytes(sanitizeStem(rawStem), Math.max(1, budget)) || FALLBACK_STEM;

  const free = (candidate: string): boolean => !used.has(normalizeMediaKey(candidate));
  if (free(base + ext)) return base + ext;
  for (let n = 2; n <= limits.attempts; n++) {
    const candidate = `${base}-${n}${ext}`;
    if (free(candidate)) return candidate;
  }
  // The `-n` walk is exhausted — a folder holding `x`, `x-2` … `x-99` is not a race, it is a library,
  // and walking further would only be slower. The timestamp takes over.
  //
  // **It is CHECKED like every other candidate, and the check has NO CAP** (Emma #6, and her confirm
  // round on the first fix). Two mistakes live here and the second is the interesting one:
  //
  //  · "unique by construction" is a claim about a CLOCK, and a clock is the wrong thing to bet a
  //    filename on — a rollback, a frozen one, a deterministic import, or two retries inside the same
  //    millisecond all produce a candidate the folder already holds;
  //  · and BOUNDING the advance re-created exactly that: after a bounded scan gave up it returned the
  //    unadvanced stamp, i.e. the one candidate the first iteration had already PROVEN occupied. The
  //    cap was the bug. A cap on a provably-terminating loop buys nothing and costs correctness.
  //
  // **It terminates, and the proof is one line:** `used` is a finite set, each iteration produces a
  // distinct candidate (the instant strictly increases), and any iteration that does not return has
  // eliminated one member of `used` — so this runs at most `used.size + 1` times, over a set that is
  // one directory listing.
  for (let at = now; ; at++) {
    const candidate = `${base}-${at.toString(36)}${ext}`;
    if (free(candidate)) return candidate;
  }
}
