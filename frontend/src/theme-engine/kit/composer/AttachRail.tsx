import { XIcon } from "../../../components/icons";
import type { AttachController } from "../../../hooks/useAttachments";
import type { StagedAttachment } from "../../../store/attachments";
import { ExpandToggle } from "./ExpandToggle";
import { NoVisionIcon, PaperclipIcon, SpinnerIcon } from "./icons";
import type { ExpandControl } from "./useComposerChrome";

// THE STAGED RAIL + THE CLIP (D68 / ATTACHMENTS_PLAN §7, owner-ruled on R62's evidence) — the ONE
// attachment presentation, rendered by all three composer layouts.
//
// **Grammar ②, the in-composer rail** (R62 §0-1: Signal/open-webui/Slack/Discord and every LLM chat
// app in R61). The chips live INSIDE the composer root, above the input row, and the bar grows
// upward exactly as it does for a second line of text — which is also why the rail needs no
// measurement of its own: DefaultRoot's `--composer-h` observer measures `.kit-composer`, so a rail
// that is a CHILD of it is accounted for for free. Telegram's modal caption screen (grammar ①) was
// explicitly not wanted; what Telegram contributes is the CLIP's quiet style.
//
// One row, horizontally scrolling (Signal's `overflow-x` rail, not open-webui's wrap): a wrapping
// row changes the composer's height per file and would walk the whole chat log up the screen.
//
// 56px chips — between open-webui's 40 and Signal's 120 (R62 §6). The lower number is a desktop
// hover UI; the upper is a media-first messenger. 56 is a phone TAP TARGET that still leaves the
// draft visible, and the remove ✕ gets its own ≥24px target inside it.
//
// The MIC IS NEVER GATED on staged files (owner ruling; R62 fact 4 — open-webui's Dictate has no
// `files.length` term while its call button does). Nothing in this file knows about the mic, which
// is the structural form of that ruling.

/** THE CLIP — quiet by owner ruling ("not a full icon like the mic or send is … nothing flashy"),
 *  Telegram's gray clip as the reference: a `.kit-cbtn` with its ring and fill dropped, so it reads
 *  as subordinate to the mic/send pair beside it. Every layout renders it (the A8 chrome ruling);
 *  WHERE has TWO answers since the S6 fix wave (F1): with nothing staged it is the variant's own
 *  ruled spot in the field/controls row, and with a rail up it is the rail's TAIL — one mounted
 *  instance either way, never both.
 *
 *  The hidden input travels WITH the button rather than living in the variant, so a layout can never
 *  render one without the other. */
export function AttachClip({ attach, size = 16 }: { attach: AttachController; size?: number }) {
  return (
    <>
      <input {...attach.inputProps} className="kit-attach-input" tabIndex={-1} aria-hidden />
      <button
        type="button"
        className="kit-cbtn attach"
        aria-label="attach files"
        title="attach files"
        onClick={attach.pick}
      >
        <PaperclipIcon size={size} />
      </button>
    </>
  );
}

/** THE RAIL — the scrolling row of chips with the pinned CONTROL TAIL at its right edge, plus the
 *  named refusals underneath. Renders nothing at all when nothing is staged, so an untouched composer
 *  is byte-identical to its pre-D68 self.
 *
 *  THE TAIL IS THE S6 FIX WAVE'S ANSWER TO TWO OWNER FINDINGS AT ONCE (the phone round, 2026-09-02):
 *   · F1 — with files staged, the clip was costing the TEXT FIELD horizontal space in every layout.
 *     It moves onto the rail's right edge ("right above the send button" — owner), still one tap away
 *     but out of the field row entirely.
 *   · F2 — the expand toggle must sit at the COMPOSER's top-right corner (Telegram). With a rail
 *     staged, the rail IS the composer's top row, so a toggle anchored inside the field row rendered
 *     BELOW it. In the tail it takes the corner the owner pointed at. (The NO-RAIL placements are
 *     ruled fine and do not move — each variant keeps rendering its own clip + toggle while nothing
 *     is staged, and exactly one of each is mounted at any time.)
 *
 *  The scroller/tail SPLIT is what makes this safe rather than an overlap: the chips scroll inside
 *  their own `flex:1; min-width:0` box, so a tenth chip can never slide under the controls. */
export function AttachRail({
  attach,
  expand,
}: {
  attach: AttachController;
  expand: ExpandControl;
}) {
  const { files } = attach;
  if (files.length === 0) return null;
  const failed = files.filter((f) => f.status === "failed");
  return (
    <>
      <div className="kit-attach-rail">
        <div className="kit-attach-scroll" role="list" aria-label="attached files">
          {files.map((file) => (
            <Chip
              key={file.localId}
              file={file}
              hint={attach.imagesUnsupported}
              onRemove={() => attach.remove(file.localId)}
            />
          ))}
        </div>
        {/* THE TAIL — a non-scrolling column at the right edge: the expand toggle on top (the
            composer's top-right corner, F2), the clip beneath it (F1). The toggle renders
            UNCONDITIONALLY here because it already answers its own threshold with null — the tail
            holds the clip alone under three rendered lines. */}
        <div className="kit-attach-tail">
          <ExpandToggle expand={expand} />
          {/* 18px in a 36px lane (kit.css): the clip is the FREQUENTLY used control of the two and
              keeps a full tap target here — it never shrinks into the toggle's 28px lane. */}
          <AttachClip attach={attach} size={18} />
        </div>
      </div>
      {/* The NAMED refusals (R62 §3.2's lesson: a distinct sentence per rule, never one "couldn't
          attach that"). Each line MOUNTS when its chip fails, which is what makes `role="alert"`
          announce exactly once — the node is stable across every later render of the rail. They stay
          OUTSIDE the flex row above, below it, exactly as before the tail existed. */}
      {failed.length > 0 && (
        <div className="kit-attach-errors">
          {failed.map((file) => (
            <p className="kit-attach-error" role="alert" key={file.localId}>
              {file.name} — {file.error}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

/** The glyph a chip wears when it has no picture to show — one per `AttachKind`, so the map is total
 *  and a fourth kind would be a type error rather than a silent "TXT". */
const KIND_GLYPH: Record<StagedAttachment["kind"], string> = {
  image: "IMG",
  pdf: "PDF",
  text: "TXT",
};

/** One chip: the picture (or the kind's glyph + its truncated name), its status face, and remove. */
function Chip({
  file,
  hint,
  onRemove,
}: {
  file: StagedAttachment;
  /** The configured primary cannot see images — a quiet corner mark on IMAGE chips only (R62 steal
   *  from open-webui's per-chip warning triangle). Informational: the send is never blocked, and the
   *  server's own in-band notice is what the model and the owner ultimately get. */
  hint: boolean;
  onRemove: () => void;
}) {
  const image = file.kind === "image";
  const blind = hint && image && file.status !== "failed";
  // `previewUrl ?? thumb` (S6/F3): the live object URL of the picked file when this page staged it, the
  // persisted data URL when the row was RESTORED after Android discarded the tab. Two fields on purpose
  // — the object URL keeps its ownership-transfer lifetime, the thumbnail is what survives the page.
  const picture = file.previewUrl ?? file.thumb;
  // `sending` = a send in flight has RESERVED this chip (D68 MED-1). It wears the busy face for the
  // same reason `uploading` does — something is happening to it that the owner did not just start —
  // and it loses its ✕: the id is already named on a POST, so removing the chip could not un-send it.
  const busy = file.status === "uploading" || file.status === "sending";
  const spokenFor = file.status === "sending";
  return (
    <div
      className="kit-attach-chip"
      role="listitem"
      data-kind={file.kind}
      data-status={file.status}
    >
      {image && picture !== undefined ? (
        <img className="kit-attach-thumb" src={picture} alt="" />
      ) : (
        <span className="kit-attach-face">
          {/* THREE glyphs, not two (S6/F3): an image row can reach this face now — a restored one
              whose thumbnail was over the persist budget (MED-6) — and calling a photo "TXT" would be
              a lie the owner reads as a bug. */}
          <span className="kit-attach-kind">{KIND_GLYPH[file.kind]}</span>
          <span className="kit-attach-name">{file.name}</span>
        </span>
      )}
      {busy && (
        <span className="kit-attach-busy" title={spokenFor ? "sending…" : "uploading…"}>
          <SpinnerIcon size={18} />
        </span>
      )}
      {file.status === "failed" && (
        <span className="kit-attach-bad" aria-hidden>
          !
        </span>
      )}
      {blind && (
        <span className="kit-attach-blind" title="the current model can't see images">
          <NoVisionIcon size={12} />
        </span>
      )}
      {!spokenFor && (
        <button
          type="button"
          className="kit-attach-x"
          aria-label={`remove ${file.name}`}
          title="remove"
          onClick={onRemove}
        >
          <XIcon size={11} />
        </button>
      )}
    </div>
  );
}
