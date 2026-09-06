import { useState } from "react";

import { FocalImg } from "./FocalImg";
import { CropModal } from "./media/CropModal";
import { AGENTS_NS } from "../hooks/useAgentArt";
import { useImageJob, type ImageJob } from "../hooks/useImageJob";
import { useMediaLibrary, type SectionView } from "../hooks/useMediaLibrary";
import { useMediaUpload } from "../hooks/useMediaUpload";
import { orderedUsable, revUrl } from "../lib/media";
import { artFocal, entryId, rowId, shown } from "../lib/mediaLibrary";
import { MEDIA_NS, UPLOAD_ACCEPT } from "../theme-engine/mediaRegistry";

// SETTING AN AGENT'S ART FROM ITS EDITOR (D70 / ROLEPLAY_PLAN §8.2, ruling 14) — and the whole point
// of this file is how little of it is new.
//
// The binding is agent DATA (`AgentDef.avatar`/`.background` name an entry in the `agents` media
// namespace); the LIBRARY behind it is an ordinary D65 one the media manager already owns end to end.
// So: `useMediaLibrary` resolves the sections and owns the ONE write queue, `useImageJob` runs the
// admit→guard→crop→export machine, and `useMediaUpload` is the delivery tail that mints a name, PUTs
// the bytes and registers the entry. Nothing here re-implements any of that — what it adds is the
// last hop the gallery has no use for: the stored filename becomes this agent's binding (`onStored`).
//
// FRAMING and RE-CROP are deliberately NOT here (§8.2): these are ordinary library entries, so the
// media gallery in Conf frames and re-crops them exactly as it does every other picture. A second
// focal UI on this surface would be the same capability twice.

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
 *  must be a sibling of whatever else is on screen rather than a child of it. */
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

/** One binding row: what is bound now, the library to choose from, and the two ways to change it. */
export function AgentArtRow(props: {
  studio: AgentArtStudio;
  /** The `agents` role this row binds into — `avatars` or `backgrounds`. */
  role: string;
  /** The entry name currently bound; `""` = none. */
  value: string;
  onChange: (entry: string) => void;
}) {
  const { studio, role, value } = props;
  const [picking, setPicking] = useState(false);
  const view = studio.sections.find((v) => v.section.role === role);
  // Everything the render could actually paint: the owner's switched-off entries and the files whose
  // bytes the server cannot read are exactly what a binding must not point at, and the two shipped
  // predicates are how every other consumer says so (`useAgentArt#bound` reads bindings the same way).
  const rows = orderedUsable(shown(view?.rows ?? []));
  // Read through the shipped `entryId`/`rowId` parser, exactly as `useAgentArt` reads the same
  // binding: a binding is the "W9" identity a pin is, and a bare `row.file === value` would answer
  // for `""` with whatever row carries no file (a bundled one).
  const want = value === "" ? null : entryId({ name: value });
  const bound = want === null ? undefined : rows.find((r) => rowId(r) === want);

  const upload = useMediaUpload({
    job: studio.job,
    section: view?.section,
    scope: {},
    // The WHOLE role's rows (not the filtered ones): a filename collides folder-wide.
    rows: view?.rows ?? [],
    append: studio.append,
    // THE LAST HOP: the picture is in the library under this name, so bind it.
    onStored: (filename) => {
      props.onChange(filename);
      setPicking(false);
    },
  });

  const pick = (entry: string) => {
    props.onChange(entry);
    setPicking(false);
  };

  return (
    <div className="agart">
      <div className="agart-now">
        <span className="agart-thumb">
          {bound ? (
            <FocalImg
              src={revUrl(bound.url, bound.revision)}
              art={artFocal(bound)}
              alt=""
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="agart-none" aria-hidden>
              —
            </span>
          )}
        </span>
        <span className="agart-name">{value || "none"}</span>
      </div>
      <div className="agart-acts">
        <button type="button" onClick={() => setPicking((p) => !p)} disabled={rows.length === 0}>
          {rows.length === 0 ? "library empty" : picking ? "close" : "choose"}
        </button>
        {/* HIDDEN input + a styled button — the gallery's own Add-row shell (GalleryModal): an
            explicit `accept` list and NO `capture`, so the chooser still offers the camera without
            making it the only option. `input.value` is reset inside `onInputChange`. */}
        <input
          ref={upload.inputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          hidden
          onChange={upload.onInputChange}
        />
        <button type="button" onClick={upload.pick} disabled={!upload.ready || upload.busy}>
          {upload.busy ? "working…" : "upload"}
        </button>
        {value !== "" && (
          <button type="button" onClick={() => props.onChange("")}>
            clear
          </button>
        )}
      </div>
      {/* The job's own failure row, scoped to this section by the hook — the same sentences the
          gallery shows, because it is the same delivery. */}
      {upload.failure !== null && (
        <div className="agart-fail">
          {upload.failure.message}
          {upload.failure.retry && (
            <button type="button" onClick={upload.failure.retry}>
              try again
            </button>
          )}
          <button type="button" onClick={upload.dismiss}>
            dismiss
          </button>
        </div>
      )}
      {picking && (
        <ul className="agart-pick">
          {rows.map((r) => (
            <li key={rowId(r)}>
              <button
                type="button"
                className={"agart-tile" + (rowId(r) === want ? " on" : "")}
                aria-label={r.name}
                aria-pressed={rowId(r) === want}
                onClick={() => pick(r.file)}
              >
                <FocalImg
                  src={revUrl(r.url, r.revision)}
                  art={artFocal(r)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
