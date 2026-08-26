import type { ReactNode } from "react";

import {
  DeleteIcon,
  DownIcon,
  EditIcon,
  FrameIcon,
  PinIcon,
  ToBottomIcon,
  ToTopIcon,
  UnpinIcon,
  UpIcon,
} from "./icons";
import { Switch } from "../Switch";
import { editable } from "../../hooks/useMediaEdit";
import type { LibraryItem, PinView } from "../../hooks/useMediaLibrary";
import { ADVISORIES, advisoriesOf, focalState, metaText, tileUrl } from "../../lib/mediaLibrary";
import { requestConfirm } from "../../store/confirm";
import type { MediaSection } from "../../theme-engine/mediaRegistry";

// The ITEM DETAIL panel (MEDIA_MANAGER_PLAN §6.4/§6.5) — everything about ONE library entry, and every
// action that acts on one. It exists because the alternative is diagnostics text on a 110px tile
// (R59 §11.6 ⑤): the grid keeps its corners and a count, and the words live here.
//
// **IMAGE-FORWARD, with a FLOATING ACTION PILL** (owner ruling 2026-08-26). The panel used to be a
// letterboxed band with a stack of full-width text buttons under it — eight of them by S5, so the
// picture the panel is ABOUT occupied a third of the screen and the actions read as a settings form.
// The field's answer for a single-photo view is the same everywhere it is solved (Google Photos, the
// AOSP gallery, iOS Photos): the picture fills the top edge to edge, the way back floats over it on a
// scrim, and the verbs sit in one row that overlaps its bottom edge. Everything that is TEXT — the
// filename, the numbers, the chips, the In-use switch — lives below, where text belongs.
//
// The pill is the kit's OVERLAY vocabulary (`--skin-fill`/`--skin-frost`/`--skin-border`/`--skin-elev`,
// the mini-player's four slots), so a theme that reskins its floating panels reskins this one, and
// `data-perf=lite` drops its frost like every other frosted surface (§14.11). Motion is transform and
// opacity only, and the house `data-motion` axis collapses it — never a `prefers-reduced-motion` query
// of our own (that is the UIState the Appearance switch owns).
//
// The actions are CAPABILITY-GATED, never label-swapped: a seat can only pin ("Use here"), a library
// section arranges/hides/deletes, the Unassigned bucket can only hide and delete. A bundled entry has
// NO delete at all — absent, not disabled, which is GNOME's rule and the honest one (a disabled control
// invites the owner to look for the way to enable it). There is no "Set as active": since the
// 2026-08-26 ruling the library's ORDER is the only priority system, so **move to top IS activation**.
//
// FRAMING ("Set framing") is capability-gated the same way (§5): it appears only where the ROLE's
// destinations actually cover — `section.caps.frame`, which the registry decides.
//
// **On a BUNDLED entry too, since "W10"** (the recorded H3 seam, built). It was excluded at S4 on
// Emma #6 — a bundled entry's hand-tuned value is PROPORTIONAL, and putting it through this reticle,
// which means CENTRED, would have moved the picture on every surface the moment the owner saved a point
// they had not touched. The item-mode design closed that: a STORED point is centred by construction and
// the shipped string answers only where there is no stored point, so the two never meet. The owner's
// round is what forced it — the Characters and Banner folders are empty on a fresh install, so every
// entry in them is bundled and the exclusion bit at 100%: the one feature for arranging shipped art
// could not be used on any of it. "Clear framing" puts the shipped look back, byte-identically.

/** One control in the floating pill: an icon with its word under it, and the word repeated as the
 *  accessible NAME so the two can never disagree. 44px minimum on both axes (the WCAG target floor the
 *  ↑/↓ pair has always been held to — this pill IS that pair, so it inherits the obligation whole). */
function PillButton({
  label,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={"mgal-pill-btn" + (danger === true ? " danger" : "")}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span aria-hidden>{label}</span>
    </button>
  );
}

export function ItemDetail({
  section,
  item,
  pinned,
  busy,
  ready,
  canReorder,
  canPromote,
  first,
  last,
  onBack,
  onPin,
  onUnpin,
  onMove,
  onMoveToEdge,
  onToggleHidden,
  onFrame,
  onEdit,
  jobBusy,
  onDelete,
}: {
  section: MediaSection;
  item: LibraryItem;
  /** The section's current pin, when it writes one — what makes "Clear" appear on the entry that holds
   *  it instead of "Use here". Only a SEAT writes one since the 2026-08-26 ruling. */
  pinned?: PinView;
  busy: boolean;
  ready: boolean;
  /** A whole ARRANGEMENT means something here AND this scope holds more than one entry to arrange. */
  canReorder: boolean;
  /** **Move to top** is meaningful here — the one order statement a key gallery can make (§6.5's
   *  duplicate tie-break). Implied by `canReorder`, and true on its own where a relative move is not. */
  canPromote: boolean;
  first: boolean;
  last: boolean;
  onBack: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onMove: (delta: number) => void;
  onMoveToEdge: (edge: "top" | "bottom") => void;
  onToggleHidden: () => void;
  onFrame: () => void;
  /** Re-crop the STORED bytes ("W10") — a job, not a config write, so it is the machine's own `busy`
   *  that gates it and the gallery's failure row that reports it. */
  onEdit: () => void;
  /** An image JOB is running (`useImageJob`'s latch), which is a different fact from `busy` above: that
   *  one is a config write in flight, and the two gate different controls. Its own prop rather than a
   *  widened `busy` because folding them would disable Delete and the position cluster during an
   *  upload the owner started somewhere else in the same section. */
  jobBusy: boolean;
  onDelete: () => void;
}) {
  const url = tileUrl(item.row, section);
  const badges = advisoriesOf(item.row, section.bounds);
  const name = item.bundled ? item.row.name : item.row.file;
  // A file with no readable bytes has nothing to frame: the sheet would open on a broken image and the
  // previews would be three empty boxes. The chips below already say why. (A BUNDLED entry is framable
  // since "W10" — see the note above; only the unusable rung survives, and it cannot fire on one.)
  const canFrame = section.caps.frame && item.row.unusable !== true;
  // The entry this section's PIN names — the only one that can clear it, and the reason "Use here"
  // disappears there (it is already the answer). By IDENTITY since "W9": the pin names one entry, so
  // the tile that offers Clear is that entry and no namesake of it.
  const pinnedHere = section.pin !== undefined && pinned?.id === item.id;
  // A SEAT's pill is its ONE control (§2.1) — it neither arranges the source library nor deletes out of
  // it, so the position cluster is replaced rather than joined.
  const seat = section.pin !== undefined;
  return (
    <div className="mgal-detail">
      {/* THE STAGE — the picture, edge to edge, on the same checkerboard the tiles use so alpha reads
          as alpha rather than as a missing file. No frame around it: a border here would draw the eye
          to the box instead of to the art. */}
      <div className="mgal-stage">
        {url !== undefined && <img src={url} alt="" decoding="async" />}
        <button type="button" className="mgal-back" onClick={onBack}>
          ‹ All images
        </button>
        {/* EDIT IN PLACE ("W10") — the way back into the crop step for a picture that is already
            stored. It mirrors the way OUT (`mgal-back`): the same floating scrim treatment at the
            opposite corner, because both are about the STAGE rather than about the entry, which is
            what the pill below is for. Absent — not disabled — where there is nothing to edit
            (`editable`: a seat writes no bytes, a bundled entry has no file, an unusable row cannot be
            decoded), the same GNOME rule the Delete verb follows. */}
        {editable(section, item) && (
          <button
            type="button"
            className="mgal-edit"
            aria-label="Edit image"
            disabled={!ready || jobBusy}
            onClick={onEdit}
          >
            <EditIcon size={16} />
          </button>
        )}
        <div className="mgal-pill">
          {seat ? (
            pinnedHere ? (
              <PillButton label="Clear" disabled={!ready} onClick={onUnpin}>
                <UnpinIcon />
              </PillButton>
            ) : (
              <PillButton label="Use here" disabled={!ready} onClick={onPin}>
                <PinIcon />
              </PillButton>
            )
          ) : (
            (canReorder || canPromote) && (
              <div className="mgal-pill-group">
                {/* MOVE TO TOP is activation (owner ruling 2026-08-26): the library's order IS the
                    priority, so "use this one" is a position. Offered wherever a priority can be
                    stated at all — including a KEY gallery, where a relative move would step through
                    neighbours that are not on screen but the duplicate tie-break still needs
                    settling. The ↑/↓ pair beside it is the WCAG single-pointer alternative to the
                    drag and stays focusable and functional whatever the pointer can do. */}
                {canPromote && (
                  <PillButton
                    label="To top"
                    disabled={!ready || first}
                    onClick={() => onMoveToEdge("top")}
                  >
                    <ToTopIcon />
                  </PillButton>
                )}
                {canReorder && (
                  <>
                    <PillButton label="Up" disabled={!ready || first} onClick={() => onMove(-1)}>
                      <UpIcon />
                    </PillButton>
                    <PillButton label="Down" disabled={!ready || last} onClick={() => onMove(1)}>
                      <DownIcon />
                    </PillButton>
                    <PillButton
                      label="To bottom"
                      disabled={!ready || last}
                      onClick={() => onMoveToEdge("bottom")}
                    >
                      <ToBottomIcon />
                    </PillButton>
                  </>
                )}
              </div>
            )
          )}
          {(canFrame || (section.caps.remove && !item.bundled)) && (
            <div className="mgal-pill-group">
              {canFrame && (
                <PillButton label="Framing" disabled={!ready} onClick={onFrame}>
                  <FrameIcon />
                  {/* WHETHER one is set, on the control itself: the alternative is a chip the owner
                      has to find, for a setting that is invisible until you compare two crops. */}
                  <span className="mgal-pill-note" aria-hidden>
                    {focalState(item.row) === "set" ? "set" : "not set"}
                  </span>
                </PillButton>
              )}
              {/* Absent on a bundled entry rather than disabled (§6.6) — there is nothing on disk to
                  delete. DESTRUCTIVE LAST, at the end of the row furthest from the position cluster. */}
              {section.caps.remove && !item.bundled && (
                <PillButton
                  label="Delete"
                  danger
                  disabled={busy || !ready}
                  onClick={() => {
                    void confirmDelete(item, onDelete);
                  }}
                >
                  <DeleteIcon />
                </PillButton>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mgal-detail-info">
        <h4 className="mgal-detail-name">{name}</h4>
        <p className="mgal-detail-meta">
          {item.bundled ? "Default — ships with the app" : metaText(item.row)}
          {/* WHICH rule bound this file, spelled out (§2.2): an upload sets the entry's `key`, an SSH
              drop binds by its stem, and the two are indistinguishable from the filename alone. */}
          {bindingNote(section, item)}
        </p>
        <div className="mgal-detail-badges">
          {/* ONE WORD, ONE MEANING (owner ruling 2026-08-26). **Active** is what this destination is
              painting right now — the resolver's own answer, the same fact the tile's accent ring
              shows. **In use** is membership, and it is the switch below. They used to be the same
              word in two places, which is how a section could look like it had two priorities. */}
          {item.active && <span className="badge">Active</span>}
          {item.bundled && <span className="badge dim">Default</span>}
          {item.hidden && <span className="badge dim">not in use</span>}
          {item.duplicate && <span className="badge dim">duplicate name</span>}
          {badges.map((code) => (
            <span className={"badge" + (ADVISORIES[code]?.bad ? " stale" : " dim")} key={code}>
              {/* The PROBED format rides the mismatch badge: the bytes are a jpeg however the name
                  reads, and that is the whole of what the owner has to act on. */}
              {(ADVISORIES[code]?.text ?? code) +
                (code === "format-mismatch" && item.row.format != null
                  ? ` (${item.row.format})`
                  : "")}
            </span>
          ))}
        </div>
        {/* The duplicate's own sentence, with the TIE-BREAK in it (§2.3, Emma's S2 review #6). A badge
            alone says there is a clash; what the owner needs is which entry answers to the name and
            how to change that — and the answer is the same one rule everywhere here: the library's own
            order decides, so moving this entry to the top is the fix. */}
        {item.duplicate && <p className="mgal-detail-note">{duplicateNote(item)}</p>}
        {section.caps.hidden && (
          <label className="mgal-act-row">
            <span>In use</span>
            {/* The ONE `aria-checked` in this gallery (Emma #9) — a real switch for a real two-state
                setting, rather than a tile pretending to be one. The tile CORNER is its twin and
                carries `aria-pressed`, which is what a two-state icon button is. */}
            <Switch
              on={!item.hidden}
              disabled={!ready}
              onToggle={onToggleHidden}
              label={`In use — ${name}`}
            />
          </label>
        )}
      </div>
    </div>
  );
}

/** The delete confirm (§6.5 — `requestConfirm`, no undo toast). The sentence names what goes and what
 *  survives: the file leaves the disk, the library keeps everything else, and whatever was next takes
 *  over in the same write.
 *
 *  It used to say "it is in use", which after the 2026-08-26 vocabulary split would be the wrong word
 *  twice over: in use is MEMBERSHIP, deleting a member that is not the active one changes nothing on
 *  screen, and what actually makes this delete visible is that the entry is the one being painted. So
 *  the sentence names the MODEL — the active image, and the next in the list taking over. */
async function confirmDelete(item: LibraryItem, onDelete: () => void): Promise<void> {
  const ok = await requestConfirm({
    title: `Delete ${item.row.file}?`,
    body: item.active
      ? "It is the active image — the next one in the list takes over. The file is removed from the server; this cannot be undone."
      : "The file is removed from the server. This cannot be undone.",
    confirmLabel: "Delete",
    danger: true,
  });
  if (ok) onDelete();
}

/** What the duplicate MEANS here: two files claim ONE BINDING KEY, and the library's order is the
 *  tie-break — so the fix, in the owner's own vocabulary, is to move this entry to the top.
 *
 *  It used to carry a second sentence for a PIN-capable seat, where a file stem and a bundled id both
 *  answered to one bare pin value. That ambiguity died with the shape: a pin names the identity union
 *  since "W9", so a seat has nothing left to disambiguate and only the key-shadow case remains. */
function duplicateNote(item: LibraryItem): string {
  const name = item.key ?? item.row.name;
  return `Two files answer to “${name}”. The one higher in the list wins — move this one to the top to use it.`;
}

/** How this file found its destination — the wire's `key` field, or its own filename stem. Only said
 *  where it MEANS something: a pool assigns by position, and there is no binding to name. */
function bindingNote(section: MediaSection, item: LibraryItem): string {
  if (item.bundled || section.kind === "pool" || section.kind === "seat") return "";
  if (item.keyBound) return ` · used for “${item.key ?? ""}”`;
  return ` · matched by its filename`;
}
