import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

// A dependency-free, reusable draggable bottom sheet (Cosmos C3). Kit-level + presentational — it owns the
// GESTURE + the open/close/snap transitions, NOT any host logic. frontier reuses it.
//
// SNAP POINTS (C3c): if the content marks a `[data-bs-peek]` element, the sheet opens at a PEEK detent
// (revealing down to that element) and drag-up expands to FULL; with no marker it's a plain closed/full
// sheet. Closed/peek/full are translateY targets driven IMPERATIVELY on the element (a ref — never a
// per-pixel re-render, never a CSS var: vaul's lesson that a CSS-var offset recalcs every descendant).
//
// Web-research (COSMOS_HANDOFF §6b + vaul snap-points): drag on the HANDLE only (sidesteps the scroll-vs-drag
// gate); Pointer Events + setPointerCapture; `touch-action:none` on the handle. Release: a SLOW release snaps
// to the nearest point, a FAST flick steps one point in the drag direction (so a hard flick down dismisses) —
// `pickSnap` below. The snap itself is a CSS transition (iOS curve), cleared while `[data-dragging]` for a
// 1:1 drag. Non-modal a11y: role=dialog WITHOUT aria-modal; no focus trap; Escape closes; focus returns to
// the trigger; an sr-only Close button keeps keyboard/AT parity (no visible ✕ — owner dropped it).
// Perf (§14.11): transform/opacity only; the skin drops its blur while `[data-dragging]` + under data-perf.

/** The detent a sheet can rest at: the `[data-bs-peek]` reveal, or fully open. The canonical vocabulary for
 *  this primitive — the persistence layer (`store/sheetSnap`) imports it rather than re-declaring the union. */
export type SheetDetent = "peek" | "full";

const FLICK_VELOCITY = 0.5; // px/ms — a faster release steps one snap in the drag direction (vaul behavior)
const PEEK_PAD = 14; // breathing room (px) revealed below the [data-bs-peek] element at the peek fold
const SNAP_MS = 420; // keep in sync with the .bs-sheet transition duration (CSS) — exit-unmount fallback
// The exit slide OVERSHOOTS fully-closed by this much: at exactly translateY(fullH) the sheet's top sits
// flush with the viewport bottom, so the skin's UPWARD box-shadow (frontier ≈68px of bleed, cosmos ≈50px)
// keeps hovering over the tab bar through the snap curve's flat tail, then POPS at unmount (owner-reported).
// Overshooting rides the shadow out of view WITH the slide — gradual, transform-only (§14.11), and the
// deliberate opaque slide-out stays untouched. Covers the largest skin shadow with headroom.
const EXIT_SHADOW_CLEARANCE = 80;
// A2 (F5 Gate A) grip tap-vs-drag threshold: a pointer sequence that travels less than this (px) on the
// handle is a TAP (cycles the detent, SC 2.5.7), not a drag. `startY`/`lastY` already track the travel.
const TAP_SLOP = 4;
// Any pointer sequence on the handle (tap OR drag) can emit a trailing synthetic `click` — swallow a click
// landing within this window (ms) of the pointer release. The tap-cycle itself happens in `endDrag` (see
// there: under `setPointerCapture` the browser retargets the click inconsistently — Chromium mouse targets
// the CAPTURING handle, touch targets the grip — so a grip onClick can't be the pointer path); the grip's
// onClick exists ONLY for AT-synthesized activation (a bare `click` with no pointer sequence), which always
// lands outside this window. touch-action:none on the handle removes the legacy 300 ms tap delay, so a
// genuine trailing click is effectively immediate.
const CLICK_SUPPRESS_MS = 350;

/** Pick the resting translateY after a drag: a SLOW release snaps to the NEAREST point; a FAST flick steps
 *  ONE point in the drag direction (down can dismiss, up can expand). `snaps` ascending: `[0 = full, …peek…,
 *  fullH = closed]`. Returns the chosen translateY; the caller dismisses when it equals the last (closed). */
export function pickSnap(currentTy: number, velocity: number, snaps: number[]): number {
  let nearest = snaps[0];
  for (const s of snaps) if (Math.abs(s - currentTy) < Math.abs(nearest - currentTy)) nearest = s;
  if (Math.abs(velocity) <= FLICK_VELOCITY) return nearest;
  const i = snaps.indexOf(nearest);
  const j = Math.max(0, Math.min(snaps.length - 1, i + (velocity > 0 ? 1 : -1)));
  return snaps[j];
}

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** aria-labelledby target (the content's header id) so AT announces the sheet's title. */
  labelledBy?: string;
  /** Skin hook — cosmos passes its class to apply the glass/dot/rounded look. */
  className?: string;
  /** Accessible name for the visually-hidden close button + the tap-outside catcher. */
  closeLabel?: string;
  /** Render the invisible full-screen tap-to-close catcher (default true). Set false when the host surface
   *  behind the sheet must stay interactive — cosmos lets you tap another planet to SWAP. */
  catchOutside?: boolean;
  /** Reports the sheet's currently-revealed height (peek or full) on open / snap / resize — and 0 on close.
   *  Lets a host lift content above the sheet (cosmos's camera-lift). Pass a STABLE callback. */
  onHeightChange?: (height: number) => void;
  /** The detent to OPEN at when the content marks a `[data-bs-peek]` element (ignored otherwise — a sheet with
   *  no detent is always full). Lets the host restore the last-left position (ISSUES #1). Default "peek". */
  initialSnap?: SheetDetent;
  /** Fired when a drag SETTLES on a detent (not on dismiss) — the host persists it to feed `initialSnap` next
   *  open. Pass a STABLE callback. */
  onSnapChange?: (snap: SheetDetent) => void;
}

export function BottomSheet({
  open,
  onClose,
  children,
  labelledBy,
  className,
  closeLabel = "Close",
  catchOutside = true,
  onHeightChange,
  initialSnap,
  onSnapChange,
}: Props) {
  const [mounted, setMounted] = useState(open); // stays mounted through the slide-out
  const sheetRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Imperative geometry (no per-pixel re-render). `full` = content height = the closed translateY; `peek` =
  // the peek reveal height (0 → no detent, plain closed/full); `snap` = the current resting detent.
  const full = useRef(0);
  const peek = useRef(0);
  const snap = useRef<SheetDetent>("full");
  const dragging = useRef(false);
  const entering = useRef(false); // true during the enter slide — a mid-slide resize re-targets, never snaps
  const enterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startY = useRef(0);
  const lastY = useRef(0);
  const lastT = useRef(0);
  const velocity = useRef(0);
  const startTy = useRef(0);
  // A2 (F5 Gate A) — below-fold inerting + the grip's dragging-alternative.
  const inerted = useRef<HTMLElement[]>([]); // the below-the-fold nodes we've marked `inert` (to release exactly)
  const dragEndAt = useRef(0); // timestamp of the last real drag release (suppresses its trailing click)
  // The grip's reactive bits (only these two drive a render — never a per-drag-pixel one): whether a peek
  // detent exists at all (else the grip stays decorative) and the current detent (labels expand vs collapse).
  const [grip, setGrip] = useState<{ detent: SheetDetent; hasPeek: boolean }>({
    detent: "full",
    hasPeek: false,
  });

  const restTy = (name: SheetDetent) =>
    name === "full" ? 0 : Math.max(0, full.current - peek.current);
  // The detent to open at: only meaningful when a peek detent exists (no detent → always full). Restores the
  // host's remembered position (`initialSnap`), else the natural default (peek). Read fresh in each open path.
  const openSnap = (): SheetDetent => (peek.current ? (initialSnap ?? "peek") : "full");
  const setTransform = (ty: number) => {
    const el = sheetRef.current;
    if (el) el.style.transform = `translateY(${ty}px)`;
  };
  const report = () => onHeightChange?.(snap.current === "full" ? full.current : peek.current);
  const measure = () => {
    const el = sheetRef.current;
    if (!el) return;
    full.current = el.offsetHeight;
    const pe = el.querySelector<HTMLElement>("[data-bs-peek]");
    peek.current = pe ? Math.min(full.current, pe.offsetTop + pe.offsetHeight + PEEK_PAD) : 0;
  };
  // A2 (F5 Gate A) — SC 2.4.11 focus-not-obscured + reachability: while resting at the PEEK detent, the
  // content below the fold is hidden under the tab bar / off-screen, so make it `inert` (unfocusable,
  // AT-invisible, un-clickable) and release it at FULL. The below-fold region is exactly the peek marker's
  // following siblings (both host bodies put `[data-bs-peek]` as a direct child whose later siblings are the
  // stats/actions/services). Recomputed each call — a content reflow (the ResizeObserver re-measure) or a
  // sheet with no detent (no marker → no-op) is handled by re-releasing the tracked nodes first. Imperative,
  // mirroring the sheet's transform model (the children are host-provided, so React doesn't own their `inert`).
  const applyInert = (on: boolean) => {
    for (const node of inerted.current) node.inert = false; // release the previous set (content may have moved)
    inerted.current = [];
    if (!on) return;
    const pe = sheetRef.current?.querySelector<HTMLElement>("[data-bs-peek]");
    if (!pe) return; // no detent → nothing is below the fold
    for (let s = pe.nextElementSibling; s; s = s.nextElementSibling) {
      (s as HTMLElement).inert = true;
      inerted.current.push(s as HTMLElement);
    }
  };
  // Push the current detent state to the grip (bails the render when unchanged, so drags/polls stay render-free).
  const syncGrip = () => {
    const detent = snap.current;
    const hasPeek = peek.current > 0;
    setGrip((g) => (g.detent === detent && g.hasPeek === hasPeek ? g : { detent, hasPeek }));
  };
  // Settle onto a resting detent (shared by the layout effect, drag release, re-open + resize): apply the
  // inerting + refresh the grip together so they never drift from `snap.current`.
  const settle = () => {
    applyInert(snap.current === "peek");
    syncGrip();
  };
  // SC 2.5.7 dragging alternative: a TAP anywhere on the handle (via endDrag's sub-slop branch) or
  // Enter/Space on the focused grip toggles peek⇄full (Material's BottomSheetDragHandleView precedent —
  // the whole handle is the tap target; the 44×5px grip alone would be a hopeless one). Only meaningful
  // when a peek detent exists (else the grip is decorative). The move is the normal CSS snap transition
  // (transition is "" = enabled at rest).
  const cycleDetent = () => {
    const el = sheetRef.current;
    if (!el || peek.current <= 0) return;
    snap.current = snap.current === "peek" ? "full" : "peek";
    setTransform(restTy(snap.current));
    report();
    settle();
    onSnapChange?.(snap.current);
  };
  const onGripClick = () => {
    // AT-only activation path: desktop screen readers (NVDA/VoiceOver) activate a role="button" with a bare
    // synthesized `click` and no pointer sequence. Pointer taps are handled in `endDrag` (click retargeting
    // under pointer capture is engine-inconsistent — see CLICK_SUPPRESS_MS) and their trailing click, when
    // one does reach the grip, is swallowed here so a touch tap doesn't double-cycle.
    if (performance.now() - dragEndAt.current < CLICK_SUPPRESS_MS) return;
    cycleDetent();
  };
  const onGripKey = (e: ReactKeyboardEvent<HTMLSpanElement>) => {
    // The grip is a `role="button"` span, so it must drive its own Enter/Space (a span gets neither natively);
    // preventDefault stops Space from scrolling the page. Mouse/touch/AT activation goes through onGripClick.
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      cycleDetent();
    }
  };

  // Open → mount (the enter slide is in the layout effect). Re-open during the exit → ease back to default.
  // Close → ease down to the closed position, then unmount.
  useEffect(() => {
    if (open) {
      clearTimeout(exitTimer.current);
      triggerRef.current = (document.activeElement as HTMLElement | null) ?? triggerRef.current;
      if (mounted && sheetRef.current) {
        snap.current = openSnap();
        setTransform(restTy(snap.current));
        sheetRef.current.style.opacity = "1"; // re-fade in if it was mid-exit
        report();
        settle();
      } else {
        setMounted(true);
      }
      return;
    }
    if (mounted) {
      const el = sheetRef.current;
      if (el) {
        delete el.dataset.dragging;
        // clean slide-DOWN out the bottom (stays opaque — no fade-out, so the slide-out is fully visible
        // like a proper bottom sheet), overshooting so the shadow exits with it (EXIT_SHADOW_CLEARANCE).
        setTransform((full.current || el.offsetHeight) + EXIT_SHADOW_CLEARANCE);
      }
      applyInert(false); // closing → release the below-fold content (it's leaving with the sheet)
      onHeightChange?.(0);
      exitTimer.current = setTimeout(() => {
        setMounted(false);
        triggerRef.current?.focus?.();
        triggerRef.current = null;
      }, SNAP_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // On mount: measure, place fully closed (no transition), then next frame ease to the default snap (peek if
  // a detent exists, else full). The reflow between makes the transition play from the closed position.
  useLayoutEffect(() => {
    if (!mounted) return;
    const el = sheetRef.current;
    if (!el) return;
    measure();
    snap.current = openSnap();
    // Mark the enter window: while sliding up, a content reflow (e.g. the Audiowide title's font swap) must
    // RE-TARGET the slide, not snap it (see onResize). Clears once the slide has had time to settle.
    entering.current = true;
    clearTimeout(enterTimer.current);
    enterTimer.current = setTimeout(() => (entering.current = false), SNAP_MS + 60);
    delete el.dataset.dragging;
    el.style.transition = "none";
    setTransform(full.current);
    el.style.opacity = "0";
    void el.offsetHeight; // commit the closed position before re-enabling the transition
    el.style.transition = "";
    const r = requestAnimationFrame(() => {
      setTransform(restTy(snap.current));
      el.style.opacity = "1"; // quick fade in as it slides up
      report();
      settle(); // inert the below-fold at peek + prime the grip's label/focusability
    });
    return () => cancelAnimationFrame(r);
  }, [mounted]);

  // Track content/viewport resize: re-measure + re-apply the current snap (instant — not a slide on a poll
  // update) + re-report the revealed height. offsetHeight is transform-independent, so dragging is unaffected.
  useEffect(() => {
    const el = sheetRef.current;
    if (!mounted || !el || typeof ResizeObserver === "undefined") return;
    const onResize = () => {
      const prevFull = full.current;
      const prevPeek = peek.current;
      measure();
      // Skip the observer's initial (redundant) fire and any no-op: a `transition: none` re-apply here would
      // KILL the in-progress enter fade/slide. Only re-apply when the content height ACTUALLY changed.
      if (full.current === prevFull && peek.current === prevPeek) return;
      if (dragging.current) return;
      if (entering.current) {
        // mid-enter: keep the transition so the slide-up continues smoothly to the corrected target
        setTransform(restTy(snap.current));
      } else {
        // at rest: re-apply instantly (a poll-driven content change must not animate the resting sheet)
        el.style.transition = "none";
        setTransform(restTy(snap.current));
        void el.offsetHeight;
        el.style.transition = "";
      }
      report();
      settle(); // content reflow may add/remove below-fold nodes or the peek marker → re-inert + re-sync
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mounted]);

  useEffect(
    () => () => {
      clearTimeout(exitTimer.current);
      clearTimeout(enterTimer.current);
      applyInert(false); // release any still-inerted below-fold nodes on unmount (no leaked inert state)
    },
    [],
  );

  // Escape closes from ANYWHERE (document-level, while open). The sheet is NON-MODAL by design (no focus
  // trap, no focus steal — §14.13 #9), so after a pointer/keyboard open, focus usually still sits on the
  // TRIGGER button outside `.bs-root` — a local onKeyDown on the root never hears that Escape (the F3 audit
  // finding; it bit cosmos identically). The listener lives only while open, so there's no global cost at
  // rest; re-subscribing on an inline `onClose` identity is a no-op-cheap effect. `defaultPrevented` is the
  // cooperative-dismissal guard (the Radix dismissable-layer convention): a MODAL layer above the sheet
  // (ConfirmDialog/PromptModal/NavMenu) preventDefaults the Escape it consumes — and React's root handlers
  // run before this document listener — so its Escape closes only that layer, not the sheet beneath.
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  if (!mounted) return null;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = sheetRef.current;
    if (!el) return;
    dragging.current = true;
    startY.current = lastY.current = e.clientY;
    lastT.current = e.timeStamp;
    velocity.current = 0;
    startTy.current = restTy(snap.current);
    el.dataset.dragging = "true"; // CSS kills the transition (1:1 drag) + the skin drops the blur
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const dt = e.timeStamp - lastT.current;
    if (dt > 0) velocity.current = (e.clientY - lastY.current) / dt;
    lastY.current = e.clientY;
    lastT.current = e.timeStamp;
    const ty = Math.max(0, Math.min(full.current, startTy.current + (e.clientY - startY.current)));
    setTransform(ty);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    const el = sheetRef.current;
    if (!el) return;
    delete el.dataset.dragging; // restore the snap transition
    // TAP vs DRAG (SC 2.5.7): a negligible-travel release is a TAP on the handle, not a drag — cycle the
    // detent HERE (not in a grip onClick: under `setPointerCapture` the browser retargets the derived click
    // inconsistently — Chromium delivers a mouse tap's click to the CAPTURING handle but a touch tap's to
    // the grip [verified empirically 2026-07-15] — so the pointer path can't rely on it; the whole handle
    // is the tap target, per Material's BottomSheetDragHandleView). A CANCELLED gesture (pointercancel:
    // scroll takeover, palm rejection) must never activate — re-seat only.
    const moved = Math.abs(e.clientY - startY.current);
    if (moved < TAP_SLOP) {
      dragEndAt.current = performance.now(); // swallow any trailing click (touch WOULD double-cycle via the grip)
      setTransform(restTy(snap.current)); // re-seat any sub-slop jitter back onto the exact detent
      if (e.type !== "pointercancel") cycleDetent();
      return;
    }
    dragEndAt.current = performance.now(); // a real drag → suppress its trailing synthetic click on the grip
    const ty = Math.max(0, Math.min(full.current, startTy.current + (e.clientY - startY.current)));
    const snaps = peek.current ? [0, restTy("peek"), full.current] : [0, full.current];
    const target = pickSnap(ty, velocity.current, snaps);
    if (target >= full.current) {
      onClose(); // last snap = closed → dismiss (the parent's open=false eases it out)
      return;
    }
    snap.current = target === 0 ? "full" : "peek";
    setTransform(target);
    report();
    settle(); // re-inert for the new detent + refresh the grip's label/focusability
    onSnapChange?.(snap.current); // the user settled here → the host persists it for the next open
  };

  return (
    <div className={"bs-root" + (className ? " " + className : "")}>
      {/* invisible tap-outside catcher — no dim (the no-scrim decision); closes on tap. Optional: cosmos
          disables it so taps fall through to the orbital stage (tap a planet to swap; tap sky to close). */}
      {catchOutside && <button className="bs-catch" aria-label={closeLabel} onClick={onClose} />}
      <div className="bs-sheet" ref={sheetRef} role="dialog" aria-labelledby={labelledBy}>
        <div
          className="bs-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {/* SC 2.5.7 dragging alternative (A2): with a peek detent the grip is a labelled `role="button"`
              span (a span, NOT a <button> — no browser chrome to override; the skins keep styling `.bs-grip`)
              that cycles peek⇄full on tap/Enter/Space; the label states the action (Expand/Collapse), the
              Material/APG cue for a two-state toggle. With no detent it stays purely decorative (aria-hidden,
              not focusable). */}
          {grip.hasPeek ? (
            <span
              className="bs-grip"
              role="button"
              tabIndex={0}
              aria-label={grip.detent === "peek" ? "Expand sheet" : "Collapse sheet"}
              onClick={onGripClick}
              onKeyDown={onGripKey}
            />
          ) : (
            <span className="bs-grip" aria-hidden />
          )}
        </div>
        {/* sr-only close for keyboard/AT (no visible ✕) */}
        <button className="bs-close-sr" onClick={onClose}>
          {closeLabel}
        </button>
        <div className="bs-body">{children}</div>
      </div>
    </div>
  );
}
