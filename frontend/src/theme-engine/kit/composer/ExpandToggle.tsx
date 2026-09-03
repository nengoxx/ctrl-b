import { ExpandChevronsIcon } from "./icons";
import type { ExpandControl } from "./useComposerChrome";

// THE EXPAND AFFORDANCE'S TRIGGER (D68 S5 / ATTACHMENTS_PLAN §7 + §9-S5) — ONE shared quiet control,
// rendered by all three composer layouts, exactly like `AttachClip` beside it. Main-seat ruling on
// R62 §5's evidence; the owner eyeballs it at S6 and may overrule the shape.
//
// WHAT R62 §5 SETTLED (three of four peers converge, so these are not preferences):
//   · the TRIGGER  — the draft rendering at ≥3 lines (Telegram Web A `totalLines >= 3`, Telegram
//     Android `getLineCount() > 2`, open-webui `split('\n').length > 2`);
//   · the PLACEMENT — inside the field, TOP-RIGHT (Telegram Web A `top:.4375rem; right:.625rem`,
//     open-webui `top-2.5 right-3`). Signal's hover-revealed tab centred on the composer's top edge is
//     the outlier and is structurally unusable on touch;
//   · LEAVABLE — a mode you can exit, so the control never vanishes while it is on (`ExpandControl.show`).
// WHAT WE DID NOT TAKE: what expanded OPENS. All four peers open a second surface (rich editor ·
// text-only modal · fixed-height field); we have no rich text and want no second editor, so expanded is
// a taller auto-grow CEILING in `useComposerChrome` — the field still grows with content, the mode only
// raises where growth stops. The line composer is the primary beneficiary ("very little space" — owner),
// but the seam is the shared chrome hook, so all three layouts get it and no per-variant fork exists.
//
// THE MIC IS UNTOUCHED. Every peer hides or disables it in expanded mode (R62 §5's mic row: Telegram Web
// A disables it, Signal hides it) — because for them expanded is a separate WRITING mode that displaces
// the composer. Ours displaces nothing; it moves a ceiling. Hiding the mic here would break the owner's
// standing mic-never-blocked posture (the same ruling that keeps staged attachments from gating it) for
// no reason at all.
//
// STYLING is the clip's (§7's quiet ruling: "not a full icon like the mic or send is … nothing flashy"):
// the `.kit-cbtn` chassis with its ring and fill dropped, one text step down — kit.css carries both in
// one rule. WHERE it lands differs per layout and is ruled there, as the clip's placement is.

/** The trigger. Renders NOTHING below the threshold, so an ordinary short draft is byte-identical to its
 *  pre-S5 self — the same discipline `AttachRail` follows with nothing staged. */
export function ExpandToggle({ expand }: { expand: ExpandControl }) {
  if (!expand.show) return null;
  const label = expand.on ? "shrink the message field" : "expand the message field";
  return (
    <button
      type="button"
      className="kit-cbtn expand"
      aria-label={label}
      title={label}
      aria-expanded={expand.on}
      // The textarea's id is stable in every variant (`#cmd-input`), so the control can name what it
      // actually expands rather than leaving `aria-expanded` unattached.
      aria-controls="cmd-input"
      onClick={expand.toggle}
    >
      {/* 20 in the 28px chassis, not the original 16 (owner S6 re-round №2: "the icon is a little bit
          small") — the glyph fills the button the way Telegram's own 28px control does. */}
      <ExpandChevronsIcon size={20} dir={expand.on ? "down" : "up"} />
    </button>
  );
}
