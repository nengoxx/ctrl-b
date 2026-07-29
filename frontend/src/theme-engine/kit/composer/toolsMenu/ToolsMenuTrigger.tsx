import { toggleComposerOverlay, useComposerOverlayOpen } from "../../../../store/composerOverlay";
import { useComposerScope } from "../../../../store/composerScope";
import { TOOLS_SHEET_ID } from "./ToolsMenuSheet";

// The tools/skills menu TRIGGER (A6) — the `controlsStart` half of the addon, at the controls LEADING edge
// (before the plan pill; ROADMAP A6 "beside the plan pill"). Plain composer chrome: it reuses `.kit-cbtn`,
// the same class the mic wears, so every composer SKIN (glass/sleek/bezel) already styles it and every
// LAYOUT already sizes/snaps it — no new chrome vocabulary.
//
// It carries the only always-visible feedback the one-shot has: an ARMED dot when the menu has pointed the
// next message at an agent and/or some skills. Without it the arming is invisible the moment the panel
// closes, and a message would silently ride a scope the owner forgot about.

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
  const scope = useComposerScope();
  const armed = scope.agent !== null || scope.skills.length > 0;
  // The label spells the arming out — the dot alone can't say WHAT is armed, and this control has no
  // visible text of its own.
  const armedParts = [
    ...(scope.agent ? [`agent ${scope.agent}`] : []),
    ...(scope.skills.length ? [`skills ${scope.skills.join(", ")}`] : []),
  ];
  const label = armedParts.length
    ? `next message: ${armedParts.join(" · ")} — tap to change`
    : "choose an agent or skills for the next message";
  return (
    <button
      type="button"
      className={"kit-cbtn tools" + (open ? " open" : "") + (armed ? " armed" : "")}
      onClick={() => toggleComposerOverlay("menu")}
      // `dialog`, not `menu`: `aria-haspopup` should describe the popup's ROLE, and the panel is a
      // labelled REGION holding a radiogroup + a checkbox group — Tab-navigable, no roving focus. Claiming
      // `menu` would promise arrow-key menu semantics this deliberately isn't (see ToolsMenuSheet).
      aria-haspopup="dialog"
      aria-expanded={open}
      // Only while the panel exists — it unmounts when closed, and a dangling `aria-controls` target is
      // what the suggest popover's `open ? LISTBOX_ID : undefined` avoids for the same reason.
      aria-controls={open ? TOOLS_SHEET_ID : undefined}
      aria-label={label}
      title={label}
    >
      <SlidersIcon />
      {armed && <span className="tools-dot" aria-hidden />}
    </button>
  );
}
