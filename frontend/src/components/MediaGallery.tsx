import { useState } from "react";

import { CropModal } from "./media/CropModal";
import { FramingSheet } from "./media/FramingSheet";
import { GalleryModal } from "./media/GalleryModal";
import { SectionCard } from "./media/SectionCard";
import { useImageJob } from "../hooks/useImageJob";
import { useMediaLibrary, type GalleryScope, type LibraryItem } from "../hooks/useMediaLibrary";
import { useMediaUpload } from "../hooks/useMediaUpload";
import type { MediaNsDef } from "../theme-engine/mediaRegistry";

// The owner-media gallery (D65 / MEDIA_MANAGER_PLAN §6) — the Conf half of the media surface, and the
// ONLY child `ConfTab` mounts for a namespace.
//
// **What it is now**: one CARD per art destination (a role folder, one key of a named role, a pin-backed
// seat), and behind each card a full-screen gallery of that destination's LIBRARY — the owner's files
// and the app's bundled art in one grid, where the ORDER is the priority (owner ruling 2026-08-26,
// "W6" — there is no second "set active" system), with In use on the tile corner and arranging,
// framing and delete on the item detail panel.
//
// It hosts the modal itself (council H4's acceptance line: `ConfTab` gains ZERO net lines for all of
// this). Everything it knows about a namespace still arrives as a `MediaNsDef` row from
// `theme-engine/mediaRegistry` and everything it knows about the FILES arrives from the server's index,
// so the next namespace is a registry row rather than a second gallery.
//
// CONFIG writes go through the ordinary `PUT /api/settings` — `media.namespaces.<ns>.roles.<role>.files`
// and `.slots.<key>` — serialized through `useMediaLibrary`'s queue. Only file BYTES use D65's typed
// media verbs, and only `DELETE` of them exists in this slice.

export function MediaGallery({ ns, def }: { ns: string; def: MediaNsDef }) {
  const lib = useMediaLibrary(ns, def);
  const [open, setOpen] = useState<{ id: string; scope: GalleryScope } | null>(null);
  // The FRAMING sheet's subject, for the reason the crop job lives here: it must be a SIBLING of the
  // gallery modal, never a child, or its Escape would ride the gallery's own keydown trap and close the
  // screen underneath it (the same rule the crop step states above).
  const [framing, setFraming] = useState<LibraryItem | null>(null);
  const opened = open === null ? undefined : lib.sections.find((v) => v.section.id === open.id);
  // The IMAGE JOB lives HERE, one level above the gallery modal, for two reasons that are really
  // one: the crop step must be a SIBLING of the gallery rather than a child (a nested dialog would
  // ride the gallery's own keydown trap, so Escape in the crop would close the gallery underneath
  // it), and a job outliving the modal it was started from must not be unmounted with it.
  //
  // ONE machine, however many consumers ("W10"): the upload is one tail on it, and editing a picture
  // already in the library is another. One latch, one phase word, one failure row — which is what
  // "exactly one section is on screen, so one job at a time" means once there are two ways to start
  // one (§4's rule ①).
  const job = useImageJob();
  const upload = useMediaUpload({
    job,
    section: opened?.section,
    scope: open?.scope ?? {},
    rows: opened?.rows ?? [],
    append: lib.write.append,
  });

  if (lib.error)
    return <div className="conf-card mgal-msg">media index unreachable: {lib.error.message}</div>;
  if (!lib.index)
    return <div className="conf-card mgal-msg">{lib.isLoading ? "loading…" : "no media"}</div>;
  // The namespace could not be prepared, so nothing is mounted and there is nothing to manage (W2). An
  // empty grid would read as "you have not dropped anything in yet", which is the one wrong thing to
  // say here: the theme is on its bundled art and only the owner can fix the folder.
  if (lib.index.disabled === true) {
    return (
      <div className="conf-card mgal-msg">
        <b>media disabled</b> — {lib.index.reason || "this namespace could not be prepared."}
      </div>
    );
  }

  return (
    <div className="conf-card mgal">
      {lib.sections.map((view) => (
        <SectionCard
          key={view.section.id}
          view={view}
          onOpen={(id, scope) => setOpen({ id, scope })}
        />
      ))}
      {opened !== undefined && open !== null && (
        <GalleryModal
          view={opened}
          scope={open.scope}
          busy={lib.busy}
          ready={lib.ready}
          write={lib.write}
          upload={upload}
          onFrame={setFraming}
          onClose={() => {
            setFraming(null);
            setOpen(null);
          }}
        />
      )}
      {framing !== null && opened !== undefined && (
        <FramingSheet
          section={opened.section}
          item={framing}
          onSave={(point, expectedRev) => {
            lib.write.setFocal(opened.section, framing, point, expectedRev);
            setFraming(null);
          }}
          onCancel={() => setFraming(null)}
        />
      )}
      {job.crop !== null && (
        <CropModal
          job={job.crop}
          // The JOB's own destination, not the open gallery's (Emma #1): the owner can close the
          // gallery while the crop step is up, and the shape offered has to be the one the picture is
          // going into.
          aspect={job.crop.section.aspect}
          onConfirm={job.confirm}
          onCancel={job.cancel}
        />
      )}
    </div>
  );
}
