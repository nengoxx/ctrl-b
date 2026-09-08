import { FocalImg } from "./FocalImg";
import { CropModal } from "./media/CropModal";
import { EditIcon } from "./media/icons";
import { LibraryPicker } from "./media/LibraryPicker";
import { AGENTS_NS, AVATARS_ROLE, BACKGROUNDS_ROLE } from "../hooks/useAgentArt";
import { useImageJob, type ImageJob } from "../hooks/useImageJob";
import { useMediaLibrary, type SectionView } from "../hooks/useMediaLibrary";
import { useMediaUpload } from "../hooks/useMediaUpload";
import { orderedUsable, revUrl } from "../lib/media";
import { artFocal, entryId, rowId, shown, type RowId } from "../lib/mediaLibrary";
import { MEDIA_NS } from "../theme-engine/mediaRegistry";

// SETTING AN AGENT'S ART FROM ITS EDITOR (D70 / ROLEPLAY_PLAN §8.2, ruling 14) — and the whole point
// of this file is how little of it is new.
//
// The binding is agent DATA (`AgentDef.avatar`/`.background` name an entry in the `agents` media
// namespace); the LIBRARY behind it is an ordinary D65 one the media manager already owns end to end.
// So: `useMediaLibrary` resolves the sections and owns the ONE write queue, `useImageJob` runs the
// admit→guard→crop→export machine, `useMediaUpload` is the delivery tail that mints a name, PUTs the
// bytes and registers the entry, and since the owner's backdrop round (§13-S6b wave 2) the CHOOSING is
// the media manager's own library too (`media/LibraryPicker`). Nothing here re-implements any of that —
// what it adds is the last hop the gallery has no use for: the stored filename becomes this agent's
// binding (`onStored`).
//
// **THE ROW IS THE PICTURE** (the owner's round, and the field's unanimous answer — ST, open-webui,
// LibreChat, Telegram, WhatsApp, Material, HIG): a destination-shaped preview that opens the library.
// What it replaces is a 44px thumb beside a `choose` button that unfolded a hand-rolled tile strip, with
// `upload` and `clear` as sibling pills — three ways in, none of them the picture. Adding is inside the
// picker now, and so is taking the binding off.
//
// **THE FACE IS IN THE FORM; THE PICKER IS A SIBLING OF IT** — the same split the crop step has, and the
// build round proved the second reason for it. `.mform`'s field recipe is `all: unset` over every
// descendant `input`, so a dialog rendered INSIDE the grid had its hidden file input unset back to
// `display: inline` and the browser's "Choose File / No file chosen" widget appeared in the middle of the
// picker. An overlay is not part of the form it was opened from: it owns its own chrome, and it must sit
// outside the rules that dress the form's fields (the media gallery mounts its own modal a level above
// for the sibling half of this reason). So the ROW state lives on the form, the pickers mount beside it,
// and each one's upload tail outlives the modal being closed on it.
//
// FRAMING and RE-CROP are deliberately NOT here (§8.2): these are ordinary library entries, so the
// media gallery in Conf frames and re-crops them exactly as it does every other picture.

/** THE TWO ART FIELDS, once: which `AgentDef` field binds which role, and what the owner calls it. One
 *  map because three surfaces have to agree about it — the face in the form, the picker beside it, and
 *  the form's own row label — and a second spelling of "Backdrop ↔ backgrounds" is exactly the drift
 *  that makes a picker write into the wrong field. */
export const ART_FIELDS = {
  avatar: { role: AVATARS_ROLE, label: "Avatar" },
  background: { role: BACKGROUNDS_ROLE, label: "Backdrop" },
} as const;

export type ArtField = keyof typeof ART_FIELDS;

/** The shared machine + library for BOTH art rows of one form. Mounted once by the form and handed
 *  down, because the two rows are two destinations of one job: `useImageJob`'s latch is what makes
 *  "one job at a time" true, and two machines would be two latches (§4's rule ①). */
export interface AgentArtStudio {
  job: ImageJob;
  sections: SectionView[];
  append: ReturnType<typeof useMediaLibrary>["write"]["append"];
  ready: boolean;
}

export function useAgentArtStudio(): AgentArtStudio {
  const lib = useMediaLibrary(AGENTS_NS, MEDIA_NS[AGENTS_NS]);
  const job = useImageJob();
  return { job, sections: lib.sections, append: lib.write.append, ready: lib.ready };
}

/** The crop step, rendered ONCE per form beside the rows rather than inside one of them — the
 *  MediaGallery placement, and for its reason: a job outlives the row that started it, and the modal
 *  must be a sibling of whatever else is on screen rather than a child of it. That is also what keeps
 *  the crop's Escape off the PICKER's keydown trap: the two are sibling subtrees, so neither's events
 *  reach the other. */
export function AgentCropStep({ job }: { job: ImageJob }) {
  if (job.crop === null) return null;
  return (
    <CropModal
      job={job.crop}
      // The JOB's own destination (Emma #1), never the row that happens to be rendered: the shape
      // offered has to be the one the picture is going into.
      aspect={job.crop.section.aspect}
      onConfirm={job.confirm}
      onCancel={job.cancel}
    />
  );
}

/** What one field's row resolves to: the section it binds into, the rows it may offer, and which of
 *  them is bound. Shared by the face and the picker, so the two can never disagree about either. */
function useArtBinding(studio: AgentArtStudio, field: ArtField, value: string) {
  const view = studio.sections.find((v) => v.section.role === ART_FIELDS[field].role);
  // Everything the render could actually paint: the owner's switched-off entries and the files whose
  // bytes the server cannot read are exactly what a binding must not point at, and the two shipped
  // predicates are how every other consumer says so (`useAgentArt#bound` reads bindings the same way).
  const rows = orderedUsable(shown(view?.rows ?? []));
  // Read through the shipped `entryId`/`rowId` parser, exactly as `useAgentArt` reads the same
  // binding: a binding is the "W9" identity a pin is, and a bare `row.file === value` would answer
  // for `""` with whatever row carries no file (a bundled one).
  const want: RowId | null = value === "" ? null : entryId({ name: value });
  return {
    view,
    rows,
    want,
    bound: want === null ? undefined : rows.find((r) => rowId(r) === want),
  };
}

/** One binding row's FACE: the bound picture, as the button that opens the library. */
export function AgentArtRow(props: {
  studio: AgentArtStudio;
  field: ArtField;
  /** The entry name currently bound; `""` = none. */
  value: string;
  onOpen: () => void;
}) {
  const { field, value } = props;
  const { label } = ART_FIELDS[field];
  const { view, bound } = useArtBinding(props.studio, field, value);
  return (
    <div className="agart">
      <button
        type="button"
        className="agart-face"
        // The library has to have RESOLVED before there is anything to choose from: until the index
        // lands this role has no section, which is also the state in which an upload has no
        // destination. One disabled face is the honest rendering of it.
        disabled={view === undefined}
        aria-label={`${label}: ${value || "add an image"}`}
        onClick={props.onOpen}
      >
        <span
          className={"agart-shot" + (bound === undefined ? " empty" : "")}
          // The DESTINATION's own shape, off the section rather than hardcoded per role (an avatar is
          // square, a backdrop is the phone-shaped 9:16 — both are registry facts).
          style={{ ["--agart-aspect" as string]: String(view?.section.aspect ?? 1) }}
        >
          {bound !== undefined ? (
            <FocalImg
              src={revUrl(bound.url, bound.revision)}
              art={artFocal(bound)}
              alt=""
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="agart-plus" aria-hidden>
              ＋
            </span>
          )}
          {/* The EDIT affordance, only where there is something to change: an empty face already says
              what tapping it does. lucide `pencil`, hand-inlined like every glyph here. */}
          {bound !== undefined && (
            <span className="agart-pencil" aria-hidden>
              <EditIcon size={13} />
            </span>
          )}
        </span>
        {/* The gallery's own empty wording, so "there is no picture yet" reads the same in both
            places the owner meets it. */}
        <span className="agart-cap">{value || "Add an image"}</span>
      </button>
    </div>
  );
}

/** BOTH fields' pickers, mounted once beside the form (see the header): whichever one the owner opened
 *  is on screen, and both delivery tails stay alive whether or not their modal is. */
export function AgentArtPickers(props: {
  studio: AgentArtStudio;
  /** The field whose picker is open, or `null`. */
  open: ArtField | null;
  /** Every field's current binding, read from the LIVE draft — never captured when the picker opened. */
  values: Record<ArtField, string>;
  onChange: (field: ArtField, entry: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      {(Object.keys(ART_FIELDS) as ArtField[]).map((field) => (
        <ArtPicker
          key={field}
          studio={props.studio}
          field={field}
          value={props.values[field]}
          open={props.open === field}
          onChange={(entry) => props.onChange(field, entry)}
          onClose={props.onClose}
        />
      ))}
    </>
  );
}

/** One field's delivery tail + its picker. ALWAYS MOUNTED, so closing the modal (or opening the other
 *  field's) cannot strand a job that is still uploading: the tail holds the minted name and the exported
 *  blob that rule ②'s "a retry never re-uploads" is made of. */
function ArtPicker(props: {
  studio: AgentArtStudio;
  field: ArtField;
  value: string;
  open: boolean;
  onChange: (entry: string) => void;
  onClose: () => void;
}) {
  const { studio, field, value } = props;
  const { view, rows, want } = useArtBinding(studio, field, value);
  const upload = useMediaUpload({
    job: studio.job,
    section: view?.section,
    scope: {},
    // The WHOLE role's rows (not the filtered ones): a filename collides folder-wide.
    rows: view?.rows ?? [],
    append: studio.append,
    // THE LAST HOP: the picture is in the library under this name, so bind it — and the picker's work
    // is done, so it closes on the way out.
    onStored: (filename) => {
      props.onChange(filename);
      props.onClose();
    },
  });
  if (!props.open || view === undefined) return null;
  return (
    <LibraryPicker
      view={view}
      rows={rows}
      current={want}
      title={`Choose ${ART_FIELDS[field].label.toLowerCase()}`}
      ready={studio.ready}
      upload={upload}
      onPick={(entry) => {
        props.onChange(entry);
        props.onClose();
      }}
      onClear={() => {
        props.onChange("");
        props.onClose();
      }}
      onClose={props.onClose}
    />
  );
}
