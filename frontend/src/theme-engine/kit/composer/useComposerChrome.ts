import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { dictationAppends } from "../../../hooks/useDictation";

// Shared PRESENTATIONAL chrome for the Kit composer variants (COMPOSER_SURFACE_PLAN §3.1). The variants
// share pure-presentational concerns — NOT behaviour (behaviour is `useComposer`, the headless
// controller): the textarea auto-grow (the collapsed ceiling below) and Enter-to-send. Extracted here so a
// second variant reuses them instead of copy-pasting; this is a CHARACTERIZED extraction (behaviour
// byte-identical to the pre-A2 KitComposer), not a redesign.
//
// THE MIC-PRESS TOGGLE LEFT AT S0.5 (Phase 24, D71 §6): `micPressed`/`pressMic`/`releaseMic` were the whole
// mic-pointer story here, and the dual-mode gesture replaces them wholesale — the press look is now one
// stage of `composer/useMicGesture`'s state machine. The reason they were a JS-toggled class rather than
// CSS `:active` (Fennec leaves `:active` wedged after a tap) carried over with them; see `MicGesture.pressing`.
//
// Since D68 S5 it owns the EXPAND affordance too, and for the same reason: expanding is nothing but a
// second auto-grow CEILING, so it belongs to whoever owns the first one — all three variants get it from
// one place and no per-variant fork exists to write (ATTACHMENTS_PLAN §9-S5, the E-amend (c) finding).
//
// vapor's `components/Composer.tsx` keeps its own copy (frozen, D7 — not touched here).

/** The COLLAPSED auto-grow ceiling, in px. 112, not the long-standing 96 (owner S6 re-round №3,
 *  "extend the minimum… just a little so the mic icon would fit without having to click expand"):
 *  112 is EXACTLY the line pill's full control column — expand 28 + mic 36 + send 36 + two 6px
 *  gaps — so the resting field can now paint enough for the stack to engage (at 5 rendered lines)
 *  without entering the expand mode, and not one pixel more than that ask. Mirrored by
 *  `.kit-composer textarea { max-height }` in kit.css, which is what actually clamps the paint;
 *  the expanded ceiling below lifts that inline. */
const CEIL_PX = 112;
/** EXPANDED = this share of the app's usable viewport height. Half is Signal's ratio in spirit (72px →
 *  212px on a desktop window) and reads right on a phone: the draft takes the top half, the chat log
 *  keeps the rest. Never smaller than the collapsed ceiling (a very short window). */
const EXPANDED_SHARE = 0.5;
/** The trigger appears once the draft RENDERS at this many lines — R62 §5's convergent number: Telegram
 *  Web A `totalLines >= 3`, Telegram Android `getLineCount() > 2`, open-webui `split('\n').length > 2`.
 *  Three of four peers, one threshold. */
const EXPAND_AT_LINES = 3;
/** Line box to fall back on when the computed style carries none (no stylesheet — unit tests). The real
 *  number is kit.css's `font-size: 15px` × `line-height: 1.45` ≈ 21.75. */
const FALLBACK_LINE_PX = 22;

/** The tall ceiling, in px. `--app-h` is the VISUAL viewport height, published by App.tsx's
 *  `useAppViewport` because `100dvh` tracks the browser toolbar but NOT the on-screen keyboard — the app
 *  already owns that measurement, so the expanded ceiling READS it instead of inventing a second one.
 *  Absent (pre-JS, or a browser with no `visualViewport`) → `innerHeight`. */
function expandedCeilPx(): number {
  const appH = parseFloat(document.documentElement.style.getPropertyValue("--app-h"));
  const h = Number.isFinite(appH) && appH > 0 ? appH : window.innerHeight;
  return Math.max(CEIL_PX, Math.round(h * EXPANDED_SHARE));
}

/** Mic-button aria-label/title per dictation status — a shared presentational constant (all three
 *  variants read it). Lives here (not in a variant) so the composers stay in lockstep on the labels. */
export const MIC_LABEL: Record<string, string> = {
  idle: "start dictation",
  recording: "stop dictation",
  sending: "transcribing…",
  unavailable: "voice servers unreachable",
  insecure: "microphone needs a secure (HTTPS) connection",
};

/** The mic button's accessible NAME, which since S0.5 carries the button's MODE (R69 §8.3 [V]: both
 *  Telegram clients put the mode in the name and re-announce on change; neither uses `aria-pressed`,
 *  because the two modes are not on/off — they are two destinations). Call mode only ever reaches this
 *  while `voice.live` is up, so the idle label is the only one that changes: once a call is running the
 *  overlay owns the surface, and every DICTATION state keeps the sentence it has always had. */
export function micLabel(status: string, mode: "mic" | "call"): string {
  if (mode === "call" && status === "idle") return "start a voice call";
  return MIC_LABEL[status] ?? MIC_LABEL.idle;
}

/** THE EXPAND AFFORDANCE's state (D68 S5) — what `<ExpandToggle/>` renders off, and the only thing any
 *  variant needs to know about it. Deliberately NOT a mode: `on` moves ONE number (the auto-grow
 *  ceiling), so nothing else in the composer changes shape when it flips. */
export interface ExpandControl {
  /** The field is expanded — the auto-grow ceiling is the tall one. */
  on: boolean;
  /** Render the trigger at all: the draft renders at ≥3 lines, OR the mode is on (a control you can
   *  enter and not leave is a trap — the collapse affordance must outlive the condition that offered
   *  it, e.g. after expanding and then deleting a line). */
  show: boolean;
  toggle: () => void;
}

export interface ComposerChrome {
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** The expand affordance (D68 S5) — hand it straight to `<ExpandToggle/>`. */
  expand: ExpandControl;
  /** The field's PAINTED height in px — the `Math.min(ceiling, scrollHeight)` this hook just wrote
   *  as the textarea's height (0 for an empty draft). Exposed so a layout can make its own
   *  does-it-fit decisions (the S6 re-round's control stack in LineComposer) in the one honest
   *  currency: the RENDERED line count is a lie about space whenever the ceiling is the binding
   *  term — a 20-line draft still PAINTS 96px at rest (the re-round review's MED-2). Read-only
   *  fallout of the measurement that already runs; nothing new is observed. */
  fieldPx: number;
  /** The CEILING that measurement ran under (96 at rest, the viewport-derived tall one while
   *  expanded) — the most the field can ever paint right now. The stack's exit rule needs it: its
   *  hysteresis band may absorb a width re-wrap, but must never hold a column the current ceiling
   *  cannot cover (the collapse-while-stacked hole the re-round's tail fix closed). */
  fieldCeilPx: number;
}

export function useComposerChrome(
  taRef: RefObject<HTMLTextAreaElement | null>,
  draft: string,
  send: () => void,
  /** ANYTHING THAT CHANGES THE FIELD'S RENDERED WIDTH, as one value whose IDENTITY changes with it
   *  (the S6 fix wave MED-3, widened by the re-round): staging a rail moves the clip + toggle out of
   *  the field row, and the line pill's control stack frees or reclaims a whole button lane — either
   *  way the textarea re-wraps with no keystroke, and a stale measurement is a stale trigger, a stale
   *  height and a stale painted-px. The stacked/sheet variants pass their staged boolean; LineComposer
   *  passes a composite key carrying the stack state too. The measurement below keys on it for the
   *  same reason it keys on the viewport. */
  fieldWidthKey: unknown = false,
): ComposerChrome {
  // THE EXPAND AFFORDANCE (D68 S5 / ATTACHMENTS_PLAN §7 + §9-S5; main-seat ruling on R62 §5's evidence,
  // owner-overridable at S6). Expanded is a TALLER AUTO-GROW CEILING AND NOTHING ELSE — the field still
  // grows with content, the mode only raises where growth stops. (The peers' "expanded" opens a second
  // editor surface — Telegram a rich one, open-webui a text-only modal, Signal a taller fixed field. We
  // have no rich text and want no second editor, so the ceiling IS the feature.)
  const [expanded, setExpanded] = useState(false);
  const [lines, setLines] = useState(1);
  // The PAINTED height and its ceiling (see `ComposerChrome.fieldPx`/`fieldCeilPx`) — set beside
  // `lines` by the same measurement.
  const [fieldPx, setFieldPx] = useState(0);
  const [fieldCeilPx, setFieldCeilPx] = useState(CEIL_PX);

  // Auto-grow the textarea to fit content (ceiling: 96px, or half the viewport while expanded), including
  // the initial render so a restored draft gets the right height as soon as the composer becomes visible.
  // The SAME measurement yields the RENDERED line count the trigger keys on (R62 §5: Telegram's own is
  // ResizeObserver-backed, ours is free — this effect already forces the layout) — no second observer.
  //
  // IT RUNS ON VIEWPORT CHANGES TOO (S5 fix wave, MED-2), not only on draft/expanded: both of its inputs
  // are viewport-dependent. The tall ceiling READS `--app-h`, so the on-screen keyboard opening (or a
  // rotation) leaves an expanded field sized for the old viewport; and the RENDERED line count changes with
  // the field's WIDTH, so a rotation can wrap a 2-line draft to 3 and the trigger would not appear until the
  // next keystroke. One `measure()` covers both — every read inside it is taken fresh per invocation, which
  // is the whole point. App.tsx's `useAppViewport` only WRITES the CSS var (there is no store to subscribe
  // to), so a listener scoped to this hook is the lean shape rather than a new reactive publisher. Its
  // ordering against that writer is safe by construction: this effect re-registers on every draft/expanded
  // change, and `expanded` — the only state that reads `--app-h` — cannot be reached without one, so our
  // listener is always the later registration and sees the freshly written value.
  //
  // IT RUNS ON `railStaged` TOO (S6 fix wave, MED-3), and for the third face of the same fact: staging
  // the first file (or clearing the last) moves the clip + the toggle between the field row and the
  // rail's tail, so the textarea's WIDTH changes with no keystroke — and a draft sitting on the
  // 2-line/3-line boundary would otherwise keep a stale line count, hence a stale trigger and a stale
  // height, until the next character. Same `measure()`, one more input.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const measure = () => {
      // What this hook wrote LAST time ("" on the first pass), and — the truer number — where the
      // PAINT actually is right now: mid-transition the computed height is the ANIMATED value, and
      // that, not `prev`, is the honest FROM for the write below. A measure landing while a shrink
      // is in flight (the stack flipping re-measures through the width key; a viewport event) used
      // to commit `prev` — the DESTINATION — and clear the cap against it, snapping the animation
      // dead (the feel round's Chromium-probed collapse). Restoring the live value instead makes
      // any mid-flight re-measure a smooth RETARGET, whatever triggered it. jsdom computes no
      // height ("" → 0), so tests fall through to `prev` and see the exact old sequence.
      const prev = ta.style.height;
      const livePx = parseFloat(getComputedStyle(ta).height) || 0;
      ta.style.height = "";
      if (ta.value === "") {
        ta.style.maxHeight = "";
        setLines(1);
        setFieldPx(0);
        return;
      }
      ta.style.height = "auto";
      // Rendered lines, not `draft.split("\n")` (open-webui's shortcut, which misses every WRAPPED line —
      // and a phone composer wraps constantly). `scrollHeight` includes padding under `box-sizing:
      // border-box`, so the padding comes back off before dividing by the line box.
      const cs = getComputedStyle(ta);
      const lineH = parseFloat(cs.lineHeight) || FALLBACK_LINE_PX;
      const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      setLines(Math.max(1, Math.round((ta.scrollHeight - pad) / lineH)));
      const ceil = expanded ? expandedCeilPx() : CEIL_PX;
      const painted = Math.min(ceil, ta.scrollHeight);
      // THE GROWTH ANIMATES (owner, S6 re-round №2 — Telegram's smooth grow): kit.css carries a
      // motion-gated `transition: height` for this write, but the scrollHeight read above forced a
      // layout AT `auto`, which would become the transition's FROM and erase the animation (auto
      // resolves to the destination). So the PREVIOUS height is restored and committed with one
      // more forced layout, and the new value is written against that — the standard
      // autogrow-with-transition dance. Under reduced motion the transition is off and these two
      // writes coalesce into exactly the old behaviour.
      //
      // AND THE CAP MUST NOT CLAMP THE FROM (the feel round's reviewer MED, Chromium-probed): a
      // SHRINK — the mode collapsing, the viewport dropping — pulls the ceiling under the
      // committed from-value, and `max-height` is not transitioned: it clamps the PAINT instantly,
      // snapping exactly the owner-visible shrinks. So the inline cap carries
      // `max(ceiling, from)` for the shrink's duration — keyed on the LIVE height, so a
      // mid-flight re-measure keeps carrying rather than clearing against the destination — and
      // settles to the true ceiling once the paint is back under it (an over-wide cap above the
      // inline height is inert meanwhile). At rest nothing changes: with the paint under the
      // stylesheet's own clamp the inline cap clears, exactly as before.
      const fromPx = Math.max(parseFloat(prev) || 0, livePx);
      ta.style.maxHeight = expanded || fromPx > CEIL_PX ? Math.max(ceil, fromPx) + "px" : "";
      ta.style.height = livePx > 0 ? livePx + "px" : prev;
      void ta.offsetHeight;
      ta.style.height = painted + "px";
      setFieldPx(painted);
      setFieldCeilPx(ceil);
    };
    measure();
    // `visualViewport` is the surface that reports the KEYBOARD (`window`'s resize does not fire for it on
    // Android), and its `scroll` fires as the visual viewport offsets under a pinned keyboard — the same
    // pair `useAppViewport` listens to, for the same reason. `window`'s resize is the fallback for a browser
    // without it (where `--app-h` is never written either, so the ceiling reads `innerHeight`).
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", measure);
      vv.addEventListener("scroll", measure);
      return () => {
        vv.removeEventListener("resize", measure);
        vv.removeEventListener("scroll", measure);
      };
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [draft, taRef, expanded, fieldWidthKey]);

  // ── THE CARET, ACROSS A STREAMING PHRASE (S2.5 / R70 §5) ──────────────────────────────────────
  //
  // MEASURED, not reasoned (Chromium, the built app — `e2e/micGesture.spec.ts`'s PROBE): an external
  // `appendDraft` landing while this textarea is focused COLLAPSES the selection to the end. The field
  // is CONTROLLED (`value={draft}`), so React re-assigns `.value`, and the HTML value setter moves the
  // text entry cursor to the end whenever the value differs. One collapse per RECORDING was invisible;
  // streaming dictation makes it one per PHRASE, at the exact moment R70 §5 says the owner is most
  // likely mid-edit (locked mode, hands free, field reachable).
  //
  // THE GATE IS THE APPEND COUNTER, not an "is streaming live" flag: the question this has to answer is
  // "was THIS commit a phrase landing", and a flag cannot tell one from the owner typing a character
  // while a session is up — restoring on a keystroke would fight their typing one character behind.
  // So nothing else in the app changes behaviour, which is R70 §5's own condition (the whole-clip path
  // keeps the collapse it always had: one append, at the end of a gesture that took focus off the
  // field anyway).
  //
  // THE SNAPSHOT rides the textarea's own events rather than a render-phase ref read: by the time any
  // effect runs the DOM has already been mutated and the old caret is gone, and React gives a function
  // component no before-mutation hook. Listeners are attached imperatively so the three variants keep
  // one textarea each with no new props. Nothing here ever calls `focus()` — a locked-mode owner may
  // deliberately be elsewhere with the keyboard closed (open-webui's mistake, R70 §5).
  const selRef = useRef<{ start: number; end: number } | null>(null);
  const seenAppends = useRef(dictationAppends());
  const prevLen = useRef(draft.length);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const snap = () => {
      selRef.current = { start: ta.selectionStart, end: ta.selectionEnd };
    };
    // Every way a caret moves in a textarea, and no more: keys (typing, arrows, Home/End), a tap or a
    // drag's release, and the `select` event a range selection fires. A `selectionchange` listener
    // would be one line fewer and is not universally supported for form controls on our two targets.
    ta.addEventListener("keyup", snap);
    ta.addEventListener("pointerup", snap);
    ta.addEventListener("select", snap);
    return () => {
      ta.removeEventListener("keyup", snap);
      ta.removeEventListener("pointerup", snap);
      ta.removeEventListener("select", snap);
    };
  }, [taRef]);
  useLayoutEffect(() => {
    const ta = taRef.current;
    const was = prevLen.current;
    prevLen.current = draft.length;
    const appends = dictationAppends();
    const landed = appends !== seenAppends.current;
    seenAppends.current = appends;
    if (!ta || !landed) return;
    const want = selRef.current;
    // EXACTLY ONE selection rides forward instead of being restored: a COLLAPSED caret sitting at (or
    // past) the end of the old draft. That owner was typing at the end, and the end is where the next
    // thing they type belongs — pinning it behind the phrase that just landed would be the bug, not
    // the fix. Everything else is an edit in progress and goes back where it was, clamped: a caret
    // inside the draft, and a real SELECTION even when its far end happens to be the last character.
    // (An unfocused field has no caret to preserve and takes the other half of the rule.)
    const rideForward = !want || (want.start === want.end && want.end >= was);
    if (document.activeElement === ta && want && !rideForward) {
      ta.setSelectionRange(
        Math.min(want.start, ta.value.length),
        Math.min(want.end, ta.value.length),
      );
      return;
    }
    // …KEEP THE FIELD AT THE BOTTOM (R70 §5's other half): the phrase that just landed is the one thing
    // worth reading, and a field scrolled to an older line would hide the whole feature.
    ta.scrollTop = ta.scrollHeight;
  }, [draft, taRef]);

  // LEAVABLE + SELF-RESETTING: the draft clearing IS the exit — send, the dictation auto-send (which
  // bypasses `useComposer().send` and clears the draft itself) and `/clear` all land here, so the next
  // message starts at the baseline with no per-path plumbing. Keyed on the draft rather than on the
  // send seam for exactly that reason.
  useEffect(() => {
    if (draft === "") setExpanded(false);
  }, [draft]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return {
    onKeyDown,
    expand: {
      on: expanded,
      show: lines >= EXPAND_AT_LINES || expanded,
      toggle: () => setExpanded((v) => !v),
    },
    fieldPx,
    fieldCeilPx,
  };
}
