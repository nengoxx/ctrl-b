import { XIcon } from "../../../components/icons";
import type { AttachController } from "../../../hooks/useAttachments";
import type { StagedAttachment } from "../../../store/attachments";
import { NoVisionIcon, PaperclipIcon, SpinnerIcon } from "./icons";

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
 *  WHERE differs per layout and is ruled in each variant.
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

/** THE RAIL — one scrolling row of chips, plus the named refusals underneath. Renders nothing at all
 *  when nothing is staged, so an untouched composer is byte-identical to its pre-D68 self. */
export function AttachRail({ attach }: { attach: AttachController }) {
  const { files } = attach;
  if (files.length === 0) return null;
  const failed = files.filter((f) => f.status === "failed");
  return (
    <>
      <div className="kit-attach-rail" role="list" aria-label="attached files">
        {files.map((file) => (
          <Chip
            key={file.localId}
            file={file}
            hint={attach.imagesUnsupported}
            onRemove={() => attach.remove(file.localId)}
          />
        ))}
      </div>
      {/* The NAMED refusals (R62 §3.2's lesson: a distinct sentence per rule, never one "couldn't
          attach that"). Each line MOUNTS when its chip fails, which is what makes `role="alert"`
          announce exactly once — the node is stable across every later render of the rail. */}
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
  return (
    <div
      className="kit-attach-chip"
      role="listitem"
      data-kind={file.kind}
      data-status={file.status}
    >
      {image && file.previewUrl !== undefined ? (
        <img className="kit-attach-thumb" src={file.previewUrl} alt="" />
      ) : (
        <span className="kit-attach-face">
          <span className="kit-attach-kind">{file.kind === "pdf" ? "PDF" : "TXT"}</span>
          <span className="kit-attach-name">{file.name}</span>
        </span>
      )}
      {file.status === "uploading" && (
        <span className="kit-attach-busy" title="uploading…">
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
      <button
        type="button"
        className="kit-attach-x"
        aria-label={`remove ${file.name}`}
        title="remove"
        onClick={onRemove}
      >
        <XIcon size={11} />
      </button>
    </div>
  );
}
