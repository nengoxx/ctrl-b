import { useEffect } from "react";

import { XIcon } from "../../../../components/icons";
import {
  releaseComposerOverlay,
  toggleComposerOverlay,
  useComposerOverlayOpen,
} from "../../../../store/composerOverlay";
import { useComposerSkills } from "../../../../store/composerSkills";
import { runMicCancel, useMicCancelOffered } from "../../../../store/micCancel";
import { TOOLS_SHEET_ID } from "./ToolsMenuSheet";

// The tools/skills menu TRIGGER (A6) — the `controlsStart` half of the addon, at the controls LEADING edge
// (before the plan pill; ROADMAP A6 "beside the plan pill"). Plain composer chrome: it reuses `.kit-cbtn`,
// the same class the mic wears, so every composer SKIN (glass/sleek/bezel) already styles it and every
// LAYOUT already sizes/snaps it — no new chrome vocabulary.
//
// It carries the only always-visible feedback the skills one-shot has: an ARMED dot when the menu has
// ticked skills for the next message. Without it the ticks are invisible the moment the panel closes, and
// a message would silently ride skills the owner forgot about. The agent section does not light it: the
// agent is a standing switch, not a pending one, and the chat already shows who is active (the backdrop,
// the who-line, the `// agent → …` note the pick pushes).
//
// IT IS ALSO THE LOCKED RECORDING'S CANCEL (Phase 24 / S0.5 feel round OF-5, owner 2026-09-13). While a
// hold-to-record is LOCKED the hand is free and WCAG 2.5.1 wants a real tap target for "discard this" —
// and the owner's ruling is that it should be the button already sitting at the controls row's other end
// rather than a floating one that appears from nowhere. So this button MORPHS: the sliders cross-fade out,
// an ✕ cross-fades in (opacity/transform only, §14.11), the name becomes "cancel recording", the click
// discards the clip, and the menu is simply unreachable for those few seconds — as is the armed dot, which
// belongs to a state the button is no longer presenting. The offer arrives through `store/micCancel`
// because this component is composed ONCE, in DefaultRoot's slot merge, and can see no composer variant's
// gesture. If the menu happens to be OPEN when the lock lands, it is RELEASED (feel-round review F2): a
// sheet must not outlive its trigger's job — orphaned, interactive, with no trigger pointing at it.

/** The lucide `sliders-horizontal` outline — "settings for this one message", in the composer's stroke
 *  language (2.2, round caps/joins; the shared glyphs in `icons.tsx` use 2.2–2.6). Inlined rather than
 *  graduated to `icons.tsx`: that module is explicitly for glyphs MORE THAN ONE variant renders. */
function SlidersIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3" />
      <path d="M14 2v4M8 10v4M16 18v4" />
    </svg>
  );
}

export function ToolsMenuTrigger() {
  const open = useComposerOverlayOpen("menu");
  const cancelling = useMicCancelOffered();
  // A SHEET MUST NOT OUTLIVE ITS TRIGGER'S JOB (feel-round review F2): if the menu overlay is up when
  // the morph lands — a keyboard lock with the sheet open — or anything re-opens it mid-morph, release
  // it. The sheet is a pure reader of the overlay store, so this closes it; `release` is owner-checked,
  // so no other overlay is touched, and when the morph ends the menu simply reopens by its own tap.
  useEffect(() => {
    if (cancelling && open) releaseComposerOverlay("menu");
  }, [cancelling, open]);
  const skills = useComposerSkills();
  const armed = skills.length > 0;
  // The label spells the ticks out — the dot alone can't say WHAT is armed, and this control has no
  // visible text of its own.
  const menuLabel = armed
    ? `next message: skills ${skills.join(", ")} — tap to change`
    : "choose the agent, or skills for the next message";
  // The MORPH swaps the whole contract, not just the glyph: the name, the click, and every `aria-*` that
  // describes a popup this button no longer opens.
  const label = cancelling ? "cancel recording" : menuLabel;
  return (
    <button
      type="button"
      className={
        "kit-cbtn tools" +
        (cancelling ? " cancelling" : (open ? " open" : "") + (armed ? " armed" : ""))
      }
      onClick={cancelling ? runMicCancel : () => toggleComposerOverlay("menu")}
      // `dialog`, not `menu`: `aria-haspopup` should describe the popup's ROLE, and the panel is a
      // labelled REGION holding a native radio group + a checkbox group — Tab between the groups, arrows
      // within the radios. Claiming `menu` would promise WHOLE-PANEL menu-widget semantics (arrow keys
      // across every row, typeahead, focus return on Esc) this deliberately isn't (see ToolsMenuSheet).
      aria-haspopup={cancelling ? undefined : "dialog"}
      aria-expanded={cancelling ? undefined : open}
      // Only while the panel is OPEN. It now stays mounted for its close animation, but it is `inert` when
      // closed — out of the a11y tree — so pointing at it would name a target AT can't reach. Same rule,
      // same reason, as the suggest popover's `open ? LISTBOX_ID : undefined`.
      aria-controls={!cancelling && open ? TOOLS_SHEET_ID : undefined}
      aria-label={label}
      title={label}
    >
      {/* BOTH glyphs are always mounted and cross-fade in place (kit.css) — a swap would pop, and an
          element that is added mid-transition has nothing to transition FROM. */}
      <span className="tools-glyph">
        <SlidersIcon />
      </span>
      <span className="tools-x">
        {/* 18px + a 2.6 stroke (kit.css) — the owner's round-2 ask: the ✕ reads slightly bigger and
            thicker than the sliders it replaces. */}
        <XIcon size={18} />
      </span>
      {armed && !cancelling && <span className="tools-dot" aria-hidden />}
    </button>
  );
}
