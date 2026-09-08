// The FOCAL POINT's math (D65 / MEDIA_MANAGER_PLAN §5, R57 §5) — one framing point per item, mapped
// into whatever window is painting it.
//
// PURE and theme-free, on the `lib/media.ts` terms every module here sits on: no React, no query, no
// registry. Everything it needs about the WINDOW arrives as an argument, which is what makes the whole
// §11 arm table an ordinary unit test.
//
// ── the rule, and why it is not the one-liner ────────────────────────────────────────────────────
//
// `object-position: 25% 50%` does NOT put the picture's 25% point in the middle of the box. Per the
// CSS spec (Backgrounds 3, quoted in R57 §5.1) a percentage aligns the point 25% across the IMAGE with
// the point 25% across the AREA — "proportional alignment", a promise that the subject is *roughly
// over there*. Every product that really crops to a focal point (ImageSharp, Umbraco, Craft, Kirby,
// Glide/Statamic, Sanity, imgix, Cloudinary — eight sources in R57 §5.2) does something else: it puts
// the point in the MIDDLE of the window and clamps so no gap shows. The two differ by
//
//     Δ = (0.5 − f) × W pixels
//
// — 98 px on a 390 px phone window at f = 0.25 (R57 §5.3). Our windows are 110–390 px wide, so the
// cheaper rule is wrong by up to a quarter of the frame on exactly the surfaces this feature exists to
// fix. We can afford the real one because both halves are ours: the wire carries the file's own
// `width`/`height`, and the destination box is measurable (`hooks/useFocalPosition.ts`).
//
// ── the guard IS the contract (Emma #1) ──────────────────────────────────────────────────────────
//
// `P(f, s) = s ≤ 1+ε ? 0.5 : clamp01((f·s − 0.5)/(s − 1))`. Under `object-fit: cover` AT LEAST ONE
// axis always has `s = 1` — the axis the box's own aspect matched — so the bare formula divides by
// zero on every single call. A `NaN` in one half of an `object-position` pair does not degrade that
// half: it makes the whole declaration invalid and the browser drops it, taking the other axis's
// correct value with it. The `ε` is there because `s` is computed from measured floats and lands at
// `1.0000000000000002` as often as at exactly `1`.
//
// ── the MODE is a property of the ITEM, never of the call site (council H3) ──────────────────────
//
// Two kinds of item live in one library. The owner's files carry a `{x, y}` point they set through the
// framing sheet, and it means CENTRED. The theme's BUNDLED entries carry hand-tuned `object-position`
// strings authored years before this module against those exact pictures in those exact windows
// (`themes/gacha/roster.ts`), and they mean what the browser has always done with them —
// PROPORTIONAL. Re-interpreting them as centred would silently re-crop the shipped theme. So the item
// says which rule it is under and `focalPosition` obeys; no window ever decides.

/** A framing point, per axis, 0..1 of the source picture. */
export interface FocalPoint {
  x: number;
  y: number;
}

/** What ONE item says about its framing — the whole input to the mapping, minus the window.
 *
 *  · `proportional` — a hand-tuned CSS `<position>` value, passed through UNTOUCHED. The bundled art's
 *    mode, and the degrade an unmeasurable surface falls back to.
 *  · `centred` — the owner's own point, mapped into each window's overflow. `width`/`height` are the
 *    SOURCE's pixels (the wire's, or a loaded image's `naturalWidth`); `null` means we cannot know how
 *    far the picture overflows, so the mapping degrades to proportional rather than guessing.
 *
 *  `zoom` rides the centred mode because it is part of the owner's framing (`MediaFocal.z`), but it is
 *  read by `circleFraming` ALONE: `focalPosition` ignores it, which is how "only circle windows honour
 *  the zoom" is a fact about the two functions rather than a rule each call site has to remember. */
export type FocalArt =
  | { mode: "proportional"; value: string }
  | {
      mode: "centred";
      point: FocalPoint;
      width: number | null;
      height: number | null;
      /** The CIRCLE windows' magnification (`>= 1`); absent = 1, i.e. the plain cover crop. */
      zoom?: number;
    };

/** The window a focal point is being mapped into — CSS pixels of the painted box. */
export interface FocalBox {
  width: number;
  height: number;
}

/** The `s ≈ 1` band. Measured boxes produce ratios like `1.0000000000000002`; see the header. */
export const FOCAL_EPSILON = 1e-6;

/** The framing ZOOM's ends and the step the slider moves in. **Pinned to the server's own
 *  `core/media.py#FOCAL_ZOOM_MIN/MAX`** — one control, two enforcers, and a ceiling either side could
 *  raise alone would either refuse a value the owner dragged to or store one nothing paints.
 *
 *  Here rather than beside the crop step's identically-numbered constants ON PURPOSE. `CropModal`'s
 *  zoom is a gesture over a DESTRUCTIVE re-encode: it decides which pixels survive, and its value is
 *  spent when the file is written. This one is metadata that outlives every render, read fresh by each
 *  circle window. Sharing the constants would tie two ranges that answer to different pressures (a
 *  re-encode's ceiling is about resampling quality; this one is about how few source pixels a 28 px
 *  circle may show), and the day one moves the other would move with it silently. */
export const FOCAL_ZOOM_MIN = 1;
export const FOCAL_ZOOM_MAX = 4;
export const FOCAL_ZOOM_STEP = 0.05;

/** A zoom from anywhere — a control, a config file, a hand edit — as a number the math can carry.
 *  Non-finite and out-of-range both answer with the nearest end, and `1` is what "no zoom" is. */
export function clampZoom(zoom: number | null | undefined): number {
  if (zoom == null || !Number.isFinite(zoom)) return FOCAL_ZOOM_MIN;
  return Math.min(FOCAL_ZOOM_MAX, Math.max(FOCAL_ZOOM_MIN, zoom));
}

/** A hand-tuned proportional value as a `FocalArt` — the bundled entries' constructor, so the mode is
 *  written down beside the string rather than inferred from its type somewhere else. */
export function proportionalFocal(value: string): FocalArt {
  return { mode: "proportional", value };
}

/** The owner's point as a `FocalArt`, with the source dimensions the centred mapping needs — and the
 *  zoom, which only the circle windows read. A zoom of 1 is dropped rather than carried: absent is what
 *  "no zoom" is everywhere else in this feature, and one spelling is what keeps `art` comparable. */
export function centredFocal(
  point: FocalPoint,
  width: number | null | undefined,
  height: number | null | undefined,
  zoom?: number | null,
): FocalArt {
  const z = clampZoom(zoom);
  return {
    mode: "centred",
    point,
    width: width ?? null,
    height: height ?? null,
    ...(z > FOCAL_ZOOM_MIN ? { zoom: z } : {}),
  };
}

/** `P(f, s)` — the position percentage (as a 0..1 fraction) that puts the picture's `f` point in the
 *  MIDDLE of a window it overflows by a factor of `s`, clamped so no gap can show.
 *
 *  `s ≤ 1 + ε` — the axis the box did not crop — has no position to choose: any value paints the same
 *  pixels, so it answers `0.5`, which is also what the guard has to do about the division. Non-finite
 *  inputs answer the same way: this is a render path, and a `NaN` here voids a whole declaration. */
export function focalAxis(f: number, s: number): number {
  if (!Number.isFinite(f) || !Number.isFinite(s)) return 0.5;
  if (s <= 1 + FOCAL_EPSILON) return 0.5;
  return clamp01((f * s - 0.5) / (s - 1));
}

/** THE mapping: one item's framing, in one window, as a CSS `<position>` value.
 *
 *  `box` is `null` for a surface that cannot measure itself — a background published on `body`, a first
 *  render before the layout effect has run. That is a real, recorded state and not a defect: it
 *  degrades to PROPORTIONAL, which is the weaker promise (the subject is roughly over there) rather
 *  than no promise at all. Same answer for a source whose pixel size we do not know. */
export function focalPosition(art: FocalArt, box: FocalBox | null): string {
  if (art.mode === "proportional") return art.value;
  const s = coverScale(art.width, art.height, box);
  if (s === null) return `${pct(art.point.x)} ${pct(art.point.y)}`;
  return `${pct(focalAxis(art.point.x, s.x))} ${pct(focalAxis(art.point.y, s.y))}`;
}

/** What a CIRCLE window paints, as the two background properties that paint it — or `undefined` when
 *  there is nothing to say and the surface's own CSS default (a plain centred `cover`) stands.
 *
 *  `size` is absent for an unzoomed item, which is the same DORMANT-BY-ABSENCE rule `FocalImg` runs on:
 *  the CSS says `background-size: cover`, the inline style overrides nothing, and the paint is
 *  byte-identical to the one that shipped. */
export interface CircleFraming {
  /** A CSS `<position>` for `background-position`. */
  position: string;
  /** A CSS `background-size` pair — present only where the item is zoomed. */
  size?: string;
}

/** THE CIRCLE WINDOW's whole reading of an item's framing — **computed with NO measurement at all**,
 *  which is the entire reason this exists beside `focalPosition` instead of inside it.
 *
 *  ── why a circle needs no box (D70 §13-S6b wave 3) ────────────────────────────────────────────────
 *
 *  `focalPosition` needs the painted box because `P(f, s)` is a function of `s`, and `s` is how far the
 *  source overflows THIS window. A circle is always aspect 1, and for a square box of side `b` the
 *  cover scale is `k = b / min(W, H)`, so
 *
 *      s.x = W·k/b = W / min(W,H)      s.y = H·k/b = H / min(W,H)
 *
 *  — `b` cancels. The overflow of a square window is a fact about the PICTURE, not about the window, so
 *  every circle in the app (18 px, 24 px, 28 px, a preview, a future one) reads the same two numbers.
 *  That is what lets the transcript honour framing at ZERO per-bubble cost: no ref, no `ResizeObserver`,
 *  no layout effect, no state — the exact same claim the 18 px face's old comment gave up on.
 *
 *  ── and how the zoom rides it ─────────────────────────────────────────────────────────────────────
 *
 *  Magnifying the cover crop by `z` means drawing the picture at `k·z`, i.e. overflowing by `s·z`. Two
 *  properties say that exactly: `background-size` states the drawn size as a percentage of the box
 *  (`s.x·z`, `s.y·z` — aspect preserved, since both carry the same `z`), and `background-position`
 *  states the alignment for that size, which is `P(f, s·z)` under the very formula the rest of the
 *  feature uses. Percentage `background-position` and `object-position` are the same alignment rule in
 *  the spec (align the picture's p% with the box's p%), so this is `focalPosition`'s promise — the
 *  subject in the MIDDLE, clamped so no gap shows — carried onto a background, and zooming makes the
 *  clamp looser rather than tighter (`s·z > s`), which is what "zoom in on the subject" has to mean.
 *
 *  A PROPORTIONAL item (the themes' hand-tuned strings) passes through untouched and takes no zoom:
 *  those values are authored against a specific picture in a specific window, and there is no `z` to
 *  read on one. A centred item whose source pixels are unknown takes the recorded degrade — the
 *  proportional reading of its own point, no zoom, because `s` is exactly the thing that cannot be
 *  computed — rather than guessing a size. */
export function circleFraming(art: FocalArt | undefined): CircleFraming | undefined {
  if (art === undefined) return undefined;
  if (art.mode === "proportional") return { position: art.value };
  const { point, width, height } = art;
  const degrade: CircleFraming = { position: `${pct(point.x)} ${pct(point.y)}` };
  if (width == null || height == null || !(Math.min(width, height) > 0)) return degrade;
  const z = clampZoom(art.zoom);
  const short = Math.min(width, height);
  const s = { x: (z * width) / short, y: (z * height) / short };
  if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return degrade;
  return {
    position: `${pct(focalAxis(point.x, s.x))} ${pct(focalAxis(point.y, s.y))}`,
    // DORMANT WHILE UNZOOMED: at `z = 1` the drawn size IS `cover`, so the size the stylesheet already
    // declares is the correct one and stating it inline would be a longer way to write it. Which is
    // also the contract this function has with its consumers: the window's own CSS says
    // `background-size: cover`, and this overrides it only when there is a zoom to apply.
    size: z > 1 + FOCAL_EPSILON ? `${pct(s.x)} ${pct(s.y)}` : undefined,
  };
}

/** Shift a resolved position's X by `dx` (a fraction of the position range), clamped at 0 — a
 *  PER-WINDOW offset, applied by the one window that wants it (gacha's magazine cover slides its hero
 *  out from under the cut-in column).
 *
 *  It works on the RESOLVED string rather than on the point, and that is the whole reason it is
 *  correct for both modes: a centred value has already been mapped through this window's overflow, so
 *  shifting it means "and then move the framing a fifth of the way left", while a proportional value
 *  keeps the shipped arithmetic to the digit. Anything unparseable comes back unchanged — this is a
 *  render path, and a value that PARSES but is not a number the arithmetic can carry (a 400-digit
 *  percentage converts to `Infinity`) would otherwise produce an invalid declaration the browser drops,
 *  taking the entry's own framing down with it. */
export function shiftFocalX(pos: string, dx: number): string {
  const m = /^\s*(-?\d+(?:\.\d+)?)%\s+(\S+)\s*$/.exec(pos);
  if (m === null) return pos;
  const x = Number(m[1]);
  if (!Number.isFinite(x) || !Number.isFinite(dx)) return pos;
  return `${pct(Math.max(0, x / 100 + dx))} ${m[2]}`;
}

/** How far the source overflows the box on each axis under `object-fit: cover` (`s ≥ 1`), or `null`
 *  when the question cannot be answered — no window, no source size, or a degenerate zero. */
function coverScale(
  width: number | null,
  height: number | null,
  box: FocalBox | null,
): { x: number; y: number } | null {
  if (box === null || width == null || height == null) return null;
  if (!(width > 0) || !(height > 0) || !(box.width > 0) || !(box.height > 0)) return null;
  const scale = Math.max(box.width / width, box.height / height);
  const s = { x: (width * scale) / box.width, y: (height * scale) / box.height };
  return Number.isFinite(s.x) && Number.isFinite(s.y) ? s : null;
}

/** A 0..1 fraction as a CSS percentage, at four decimal places of a percent and with no trailing
 *  zeros.
 *
 *  Both halves of that are deliberate. FOUR DECIMALS is a millionth of the window — far under a device
 *  pixel — and it is what keeps float noise out of the string (`0.5 − 0.2` is
 *  `0.30000000000000004`). NO TRAILING ZEROS is what makes the shipped hand-tuned values come back
 *  BYTE-IDENTICAL through the same formatter (`0.12` → `12%`, never `12.00%`), which is how the S4
 *  rewrite proves it changed no pixel of the theme that ships. */
function pct(n: number): string {
  if (!Number.isFinite(n)) return "50%";
  return `${Math.round(n * 1_000_000) / 10_000}%`;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
