import { useState } from "react";

import { FocalImg } from "./FocalImg";
import { CropModal } from "./media/CropModal";
import { FramingSheet } from "./media/FramingSheet";
import { EditIcon } from "./media/icons";
import { confirmDelete } from "./media/ItemDetail";
import { LibraryPicker } from "./media/LibraryPicker";
import { AGENTS_NS, AVATARS_ROLE, BACKGROUNDS_ROLE } from "../hooks/useAgentArt";
import { useImageJob, type ImageJob } from "../hooks/useImageJob";
import {
  libraryItems,
  useMediaLibrary,
  type LibraryItem,
  type SectionView,
} from "../hooks/useMediaLibrary";
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
// **FRAMING HAS A SECOND DOOR HERE** (wave 3, the owner's amendment to §8.2's framing-stays-in-Conf
// scoping): the picker offers *Focus* on the picture it is already bound to, and what it opens is the
// media manager's OWN sheet, on the media manager's own queued write. One framing UI, two ways in —
// never a second picker and never a circle on the grid. RE-CROP stays a Conf-gallery job: it is a
// destructive re-encode of a library file, which is a library screen's business rather than a
// binding's.
//
// **AND SO DOES DELETE** (the wave-3 feel round): the picker's tiles wear the media manager's delete on
// a corner, on the media manager's own `write.remove` and behind the media manager's own confirm. The
// reason is the same one that moved the choosing here — an upload ARRIVES in this screen, so a library
// that could only be added to from here was a one-way door.

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
  /** The framing write, for the picker's second door onto the sheet (wave 3) — the SAME queued,
   *  rev-guarded chokepoint the Conf gallery's Focus button uses, reached from the other end. */
  setFocal: ReturnType<typeof useMediaLibrary>["write"]["setFocal"];
  /** The delete, for the picker's tile corner (the wave-3 feel round) — reached the same way: the media
   *  manager's OWN chokepoint (bytes first, then the one queued config write that cleans the entry up),
   *  never a second delete path. */
  remove: ReturnType<typeof useMediaLibrary>["write"]["remove"];
  ready: boolean;
}

export function useAgentArtStudio(): AgentArtStudio {
  const lib = useMediaLibrary(AGENTS_NS, MEDIA_NS[AGENTS_NS]);
  const job = useImageJob();
  return {
    job,
    sections: lib.sections,
    append: lib.write.append,
    setFocal: lib.write.setFocal,
    remove: lib.write.remove,
    ready: lib.ready,
  };
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
  const { view, rows, want, bound } = useArtBinding(studio, field, value);
  // THE FRAMING SHEET's subject — `MediaGallery`'s own shape, verbatim: the ITEM, captured when the
  // sheet is opened, held one level above the screen it was opened from. Capturing is what the sheet's
  // contract already asks for (it saves the revision it RENDERED), and holding the item rather than a
  // boolean is what makes the sheet's life independent of the picker's: it can only be raised by the
  // picker's own Focus, and only ever lowered by its own Save or Cancel.
  //
  // It lives here rather than on the form for the reason the picker's own state does not: this
  // component is already OUTSIDE the `.mform` grid whose field recipe would dress an overlay's
  // controls (see the header), so nothing is bought by threading it another level up.
  const [framing, setFraming] = useState<LibraryItem | null>(null);
  const upload = useMediaUpload({
    job: studio.job,
    section: view?.section,
    scope: {},
    // The WHOLE role's rows (not the filtered ones): a filename collides folder-wide.
    rows: view?.rows ?? [],
    append: studio.append,
    // THE LAST HOP: the picture is in the library under this name, so bind it — and the picker's work
    // is done, so it closes on the way out.
    //
    // **ONLY WHILE THIS FIELD'S PICKER IS STILL OPEN** (the wave-2 review's F1), which is the Add row's
    // own promise — *keep this open until it finishes* — read as the rule it always was. A job outlives
    // the modal, so a completion arriving later used to land unconditionally, and that was two defects
    // in one line: it OVERRODE a newer explicit pick or clear (both of which close this picker, so a
    // photo begun first won a choice made second), and it fired the SHARED close, so the avatar's
    // upload shut the backdrop picker the owner had just opened. One condition answers both, because
    // both are the same question — *is the owner still on the screen that asked for this picture?* — and
    // it needs no admission bookkeeping to ask it: `onStored` is read through the hook's live ref, so it
    // sees the CURRENT open field, not the one captured when the job started.
    //
    // The picture is registered either way, so nothing is lost: it is in the library, one tap away in
    // the very picker that was closed. What is NOT guarded is the tail unmounting mid-PUT (leaving the
    // agent, collapsing the row) — the file lands unbound. That is the §13-S4 residual verbatim, the
    // same exposure the pill-button row carried, and closing it means lifting the job above the agents
    // surface entirely; per the no-new-protection rule it stays recorded rather than half-built.
    onStored: (filename) => {
      if (!props.open) return;
      props.onChange(filename);
      props.onClose();
    },
  });
  if (view === undefined) return null;
  // DELETING A TILE FROM THE PICKER (the wave-3 feel round). Confirm through the media manager's ONE
  // delete confirm — same title, same verb, same "is this the one showing" branch — with the single
  // clause that is this SCREEN's rather than the file's said in the owner's own words: a binding is one
  // slot, so deleting what it points at leaves it empty rather than promoting a successor.
  //
  // The bound test is `useArtBinding`'s own, spelled the same way: the "W9" identity, never a bare
  // filename. (`item.active` is the same fact rendered — the picker builds its items with `ids: [want]`
  // — which is exactly why the shared confirm's branch lands on the right sentence.) Clearing the slot
  // rides the SAME gesture as the delete rather than waiting for the binding to dangle: the row would
  // otherwise point at a file that is gone until the owner noticed.
  //
  // The write is FIRED, not awaited, and that is not laziness: `write.remove` reports its own failures
  // (a toast for the DELETE, a partial-success sentence for the cleanup) and resolves `void` either way,
  // so there is nothing to await FOR — and an async callback in this `() => void` slot is exactly the
  // shape `no-misused-promises` rejects.
  //
  // The picker STAYS OPEN — the owner may be clearing out several — and the grid it is looking at
  // updates on its own: the cleanup write goes through the queue, whose save awaits the media refetch,
  // so the rows this component re-reads are the server's. A FramingSheet left open on the very item
  // being deleted needs no machinery either: `setFocal`'s patch looks the row up in the freshest index
  // and returns `null` when it is gone, which is the queue's own honest refusal (verified against the
  // shipped path, not assumed).
  const removeFile = (item: LibraryItem) =>
    confirmDelete(
      item,
      () => {
        void studio.remove(view.section, item);
        if (item.id === want) props.onChange("");
      },
      "The file is removed from the server and this slot goes back to no picture. This cannot be undone.",
    );
  // The bound row as the library's own item — through `libraryItems`, the one place a row becomes one,
  // so the sheet and the write see exactly what the gallery would hand them. Framing is offered only
  // where the ROLE allows it and there is a picture to frame.
  const framable =
    view.section.caps.frame && bound !== undefined && bound.unusable !== true
      ? libraryItems([bound], { ids: [], mode: "first" })[0]
      : undefined;
  return (
    <>
      {props.open && (
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
          onFrame={framable === undefined ? undefined : () => setFraming(framable)}
          // ABSENT WHERE THE SECTION CANNOT DELETE (the GNOME rule, and the grid's own contract): the
          // corner is offered per SECTION here and refused per ITEM there (`bundled`), which is the two
          // halves of `ItemDetail`'s `section.caps.remove && !item.bundled` said where each is known.
          // It is deliberately NOT gated on being bound — the pain is a library the owner can only add
          // to, and that is every tile in it, not just the one this agent happens to use.
          onRemove={
            view.section.caps.remove
              ? (item) => {
                  void removeFile(item);
                }
              : undefined
          }
          onClose={props.onClose}
        />
      )}
      {/* A SIBLING of the picker, never a child (the gallery mounts its own sheet beside the gallery
          modal for the same reason): a nested overlay's Escape would ride the picker's keydown trap
          and close the screen underneath it. Ordinarily the picker stays up behind it, so finishing
          lands the owner back where they were — but the sheet is NOT conditioned on the picker, and
          that is deliberate: a late upload completing binds and closes the picker (the wave-2 F1
          path), and yanking a framing gesture off the screen to do it would be the worse answer. It
          also means the state can never go stale: only Focus raises the sheet, and only the sheet's
          own Save or Cancel lowers it. */}
      {framing !== null && (
        <FramingSheet
          section={view.section}
          item={framing}
          onSave={(focal, expectedRev) => {
            studio.setFocal(view.section, framing, focal, expectedRev);
            setFraming(null);
          }}
          onCancel={() => setFraming(null)}
        />
      )}
    </>
  );
}
