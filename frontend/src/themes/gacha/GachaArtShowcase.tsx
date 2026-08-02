import { useLayoutEffect, useRef, type KeyboardEvent } from "react";

import { CLOSE_ART_LABEL, artViewLabel } from "./fleet";
import type { ResolvedArt } from "./roster";

// THE ART SHOWCASE (owner request 2026-08-02, the G2 follow-up) — tapping the dossier PORTRAIT lifts the
// unit's art out of its 104x138 crop and shows the WHOLE image on the arcade-night backdrop. A prize-slip
// portrait is a thumbnail; this is the character card the owner actually drew.
//
// It is a PURE overlay: no data, no resolver, no roster logic — it paints the SAME `ResolvedArt` the
// dossier's portrait and the machine's capsule card already resolved through `artForHost` (§5.3's one
// shared resolver). `GachaFleet` owns the open/close state and the View-Transition machinery, exactly as
// it owns the capsule morph; this component owns its own FOCUS and its own keyboard, which is the part a
// parent cannot do at the right moment (both must land inside the commit that mounts/unmounts it).
//
// ── WHY IT IS NOT RENDERED INSIDE THE DOSSIER ────────────────────────────────────────────────────────
// `.bs-sheet` carries `transform` + `will-change: transform` (the kit's slide), so it is a containing
// block for `position: fixed` descendants — an overlay rendered inside the sheet would be trapped in the
// sheet's box AND under its stacking context. It mounts as a sibling of the `<BottomSheet>` instead, at
// z-rung 46 (gacha.css) — above the sheet (40), below the confirm dialog (50).
//
// FOCUS is a two-party affair: this takes it on mount (the close button) and REPORTS its unmount through
// `onClosed`, but does not decide where focus goes — see that prop.
//
// ── THE CO-OPERATIVE DISMISSAL CONTRACT ──────────────────────────────────────────────────────────────
//   · ESCAPE is handled HERE, on a React handler, and `preventDefault()`s — so the BottomSheet's own
//     document-level Escape listener (which respects `defaultPrevented`, the Radix dismissable-layer
//     convention the ConfirmDialog already relies on) leaves the dossier alone. Escape closes the ART.
//   · TAB is trapped onto the close button. There is exactly one focusable control here, so this is the
//     ConfirmDialog's two-element cycle collapsed to one — and it is what keeps the Escape above
//     reachable: focus leaving the overlay would put the next Escape on the sheet beneath.
//   · A TAP ANYWHERE closes (the owner's wording). The close button stops propagation so its own click
//     dismisses ONCE — two calls would start two View Transitions, the second skipping the first.
//   · The dossier's tap-outside listener exempts `.gc-art-view` (GachaFleet) — without that, the tap that
//     dismisses the art would dismiss the dossier under it too.
export function GachaArtShowcase({
  hostName,
  art,
  fade,
  onClose,
  onClosed,
}: {
  hostName: string;
  art: ResolvedArt;
  /** No View Transition is carrying this open (an engine without them, or the app's reduced-motion
   *  lever) — take the CSS opacity-only entrance instead. The CSS belt nulls it under reduced motion,
   *  so the flag means "not morphing", never "animate anyway" (the GachaReel precedent). */
  fade: boolean;
  onClose: () => void;
  /** Called as this unmounts, whatever took it down. The HOST decides what that means for focus — it is
   *  the only one that can (Codex G2-close M2): a dossier on its way out keeps its content mounted for
   *  the sheet's 420 ms exit slide, so "is the portrait still in the DOM" cannot tell an art dismissal
   *  from a dossier teardown, and focusing a departing portrait parks focus on a node that is about to be
   *  detached — from which it falls to `<body>`, defeating the sheet's own claimed-focus restore. Pass a
   *  STABLE callback: this fires from a cleanup, which holds the previous render's closure. */
  onClosed?: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // The latest `onClosed`, without re-arming the mount effect below — which must run exactly once, while
  // its cleanup must call whatever the host most recently handed us. Written in an effect rather than
  // during render (the `useForegroundNotifications` precedent): a render-time ref write is the F13
  // backlog's own flagged pattern, and this needs no such licence.
  const closedRef = useRef(onClosed);
  useLayoutEffect(() => {
    closedRef.current = onClosed;
  });

  // LAYOUT effects, both halves, for the same reason GachaFleet's sheet stamps are: this mounts and
  // unmounts INSIDE a View Transition's update callback, and the new-state capture can land before
  // passive effects run.
  useLayoutEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    return () => closedRef.current?.();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      // ...so the sheet's document listener leaves the dossier open
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      e.preventDefault();
      closeRef.current?.focus();
    }
  };

  return (
    // `aria-modal` on the ConfirmDialog's terms: the keyboard cannot leave this layer (the Tab trap
    // above), and the art itself is `alt=""` because the dialog's own label already names it — the
    // image is the surface, not a second thing to announce.
    <div
      className={"gc-art-view" + (fade ? " fade" : "")}
      role="dialog"
      aria-modal="true"
      aria-label={artViewLabel(hostName)}
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      {/* NO focal crop and no `object-fit: cover` (gacha.css contains it): the whole point of this
          surface is the art the dossier's portrait had to cut into. */}
      <img src={art.url} alt="" draggable={false} />
      <button
        type="button"
        className="gc-art-close"
        ref={closeRef}
        aria-label={CLOSE_ART_LABEL}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
    </div>
  );
}
