import { useState } from "react";

import { GalleryModal } from "./media/GalleryModal";
import { SectionCard } from "./media/SectionCard";
import { useMediaLibrary, type GalleryScope } from "../hooks/useMediaLibrary";
import type { MediaNsDef } from "../theme-engine/mediaRegistry";

// The owner-media gallery (D65 / MEDIA_MANAGER_PLAN §6) — the Conf half of the media surface, and the
// ONLY child `ConfTab` mounts for a namespace.
//
// **What it is now**: one CARD per art destination (a role folder, one key of a named role, a pin-backed
// seat), and behind each card a full-screen gallery of that destination's LIBRARY — the owner's files
// and the app's bundled art in one grid, ordered by priority, with set-active / In use / delete on the
// item detail panel. Uploading lands at S3b; the Add row is present and inert until then.
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

  const opened = open === null ? undefined : lib.sections.find((v) => v.section.id === open.id);
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
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
