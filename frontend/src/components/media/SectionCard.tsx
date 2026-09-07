import { useId } from "react";

import {
  libraryItems,
  OUTRANKED,
  scopedRows,
  type GalleryScope,
  type SectionView,
} from "../../hooks/useMediaLibrary";
import { deriveKeyBindings } from "../../lib/media";
import { rowId, tileUrl } from "../../lib/mediaLibrary";
import { useMediaKeySource } from "../../theme-engine/mediaKeySources";

// The ENTRY CARD (MEDIA_MANAGER_PLAN §6.1, R59 §11.1) — one card per art DESTINATION, and the card IS
// the button. Full-width, shaped like the destination (`aspect-ratio` from the registry), painted with
// whatever the section's §2.4 resolver says is live, and carrying the status line the old accordion
// header used to hold. No accordion, no hover-revealed actions (there is no hover on a phone).
//
// TITLED IN THE OWNER'S WORDS, ADDRESSED BY FOLDER (owner ruling 2026-08-26). A role card used to be
// headed by its FOLDER name — `reel`, `oracle`, `rigs`, `stack` — which is jargon at best and was an
// outright collision at worst (the `oracle` ROLE card and the `oracle` SEAT were both "Operator
// backdrop"). The heading is `MediaRoleDef.label` now, and the folder stays under it in mono, because
// an SSH drop into `media/<ns>/<role>/` is the other half of how art arrives and the owner has to be
// able to read the path from the screen.
//
// Four card BODIES, one shape — the H5 refinement, owner-ratified:
//   · a POOL / KEY / SEAT card paints its active art and opens its gallery;
//   · a FAMILY card (kit's services, service banners, machines — keys derived from the fleet itself)
//     lists its KEYS instead of one picture, because twelve services must not put twelve cards in
//     Conf. A key row opens the SAME gallery, scoped to that key;
//   · an UNASSIGNED card appears only when files bound nothing, and is the only way to reach them.
//
// A card that is currently OVERRIDDEN by a seat says so with a pointer to that seat, outside the
// button (a link inside a button is the nested-interactive trap D25 already pinned): the pool's own
// grid does not hold the winner, and painting a phantom would be the lie §2.4 exists to prevent.

export function SectionCard({
  view,
  onOpen,
}: {
  view: SectionView;
  /** Open one section's gallery. The SECTION is a parameter rather than implied, because a card can
   *  point at another one: an overridden pool links the seat that beat it. */
  onOpen: (sectionId: string, scope: GalleryScope) => void;
}) {
  const { section } = view;
  // One hook call, whatever the kind: a section with no `keySource` gets `null` back and no fetcher is
  // enabled (`useMediaKeySource`'s contract — the rules of hooks are why it is shaped that way).
  const source = useMediaKeySource(section.keySource);
  const declared = section.keys ?? source?.consumers?.map((c) => c.key);
  const descId = useId();

  if (section.kind === "unassigned") {
    // "We do not know the key list yet" is a THIRD state, not an empty one: annotating files against
    // a list that has not arrived would call every correctly-named file unassigned.
    if (declared === undefined) return null;
    const orphans = scopedRows(view.rows, { unassigned: true, keys: declared });
    if (orphans.length === 0) return null;
    return (
      <section className="mgal-sec">
        <button
          type="button"
          className="mgal-card compact"
          aria-haspopup="dialog"
          aria-label="Open the Unassigned gallery"
          onClick={() => onOpen(section.id, { unassigned: true, keys: declared })}
        >
          <span className="mgal-card-body">
            <span className="mgal-card-title">Unassigned</span>
            <span className="mgal-card-status">
              {orphans.length} {orphans.length === 1 ? "file matches" : "files match"} no name here
            </span>
          </span>
          <span className="badge dim">unused</span>
        </button>
        <p className="mgal-hint">{section.hint}</p>
      </section>
    );
  }

  if (section.kind === "family") {
    return <FamilyCard view={view} source={source} onOpen={onOpen} />;
  }

  const scope: GalleryScope = { key: section.key, rotation: section.kind === "rotation" };
  // The FOLDER, under the label that replaced it. Shown only where a label actually renamed something
  // (an UNDESCRIBED role is still headed by its own folder, so a second copy would be noise) and only
  // where this section IS that folder: a SEAT views another role's library, and a ROTATION is a theme's
  // bundled set rather than anything an owner can drop a file into.
  const folder =
    section.def.label !== undefined && (section.kind === "pool" || section.kind === "key")
      ? `media/${section.ns}/${section.role}/`
      : undefined;
  const items = libraryItems(
    scopedRows(view.rows, scope),
    view.active,
    section.def.kind === "named",
  );
  const active = items.filter((i) => i.active);
  const art = active
    .map((i) => tileUrl(i.row, section))
    .filter((u): u is string => u !== undefined);
  return (
    <section className="mgal-sec">
      <button
        type="button"
        className="mgal-card"
        aria-haspopup="dialog"
        aria-label={`Open the ${section.title} gallery`}
        aria-describedby={descId}
        onClick={() => onOpen(section.id, scope)}
      >
        <span
          className={"mgal-card-art" + (art.length > 1 ? " collage" : "")}
          style={{ aspectRatio: String(section.aspect ?? 1) }}
        >
          {art.length === 0 && section.builtin !== undefined ? (
            // The seat's BUILT-IN default (S6). It is what the ladder ends on rather than what is
            // painted this instant — a rung in between may be answering, and the hint under the card
            // is where that is spelled out — so it is captioned `default` and never called active.
            <>
              <img src={section.builtin.url} alt="" loading="lazy" decoding="async" />
              <span className="mgal-card-tag">default</span>
            </>
          ) : art.length === 0 ? (
            <span className="mgal-card-none">
              {items.length === 0 ? "Add an image" : "Nothing in use"}
            </span>
          ) : (
            // A COLLAGE for a multi-active role (R59 §11.1): one entry cannot represent a set, and the
            // mode word beside it says how the set is used. Capped at four — past that it is texture.
            art
              .slice(0, 4)
              .map((url) => <img key={url} src={url} alt="" loading="lazy" decoding="async" />)
          )}
        </span>
        <span className="mgal-card-body">
          <span className="mgal-card-title">{section.title}</span>
          {folder !== undefined && (
            <span className="mgal-card-path path">
              {/* A key section's own folder is shared with its siblings, so it says which GROUP the
                  key belongs to as well as where the file goes. */}
              {section.kind === "key" && `${section.def.label} · `}
              {folder}
            </span>
          )}
          <span className="mgal-card-status" id={descId}>
            {status(view, items, active)}
          </span>
          {warning(view, items) != null && (
            <span className="badge stale">{warning(view, items)}</span>
          )}
        </span>
      </button>
      {section.hint != null && <p className="mgal-hint">{section.hint}</p>}
      {view.overriddenBy != null && (
        <button
          type="button"
          className="mgal-seat-link"
          onClick={() => onOpen(view.overriddenBy?.sectionId ?? section.id, {})}
        >
          Currently set by {view.overriddenBy.label} →
        </button>
      )}
    </section>
  );
}

/** The role-FAMILY card: today's key panel, promoted to the entry affordance. Each row states what the
 *  file must be called, who uses it and what answers today; tapping one opens the same gallery scoped
 *  to that key. */
function FamilyCard({
  view,
  source,
  onOpen,
}: {
  view: SectionView;
  source: ReturnType<typeof useMediaKeySource>;
  onOpen: (sectionId: string, scope: GalleryScope) => void;
}) {
  const { section } = view;
  const asset = section.asset ?? "file";
  // The KEYS are the source's — `deriveKeyBindings` is what collapses two consumers onto one key and
  // says which keys a file could even be named after, so it is asked about the CONSUMERS and nothing
  // else. WHICH FILE answers a key is the role's own §2.4 ladder, asked through the section (the W8
  // council's F5): this card used to re-derive it with the generic classifier over the visible rows,
  // which is the same question with a second implementation — and the two disagree the moment a
  // bundled id matches a service key, because the ladder excludes the bundled tier and the classifier
  // does not. One question, one answer, and it is the answer the surface paints with. (The classifier
  // half of `deriveKeyBindings` is GONE with this tail, rather than left being fed an empty file list
  // from here — a computation over nothing that still read as load-bearing.)
  const byId = new Map(view.rows.map((r) => [rowId(r), r]));
  const derived = source?.consumers === undefined ? null : deriveKeyBindings(source.consumers);
  const rows = derived?.map((row) => {
    const id = view.activeForKey?.(row.key).ids[0];
    return { ...row, file: id === undefined ? undefined : byId.get(id) };
  });
  return (
    <section className="mgal-sec">
      <div className="mgal-head">
        <b>{section.title}</b>
        <span className="path">
          media/{section.ns}/{section.role}/
        </span>
      </div>
      {section.hint != null && <p className="mgal-hint">{section.hint}</p>}
      {/* The two UNKNOWN states, told apart: a spinner sentence for a request that will never arrive
          is the one thing worse than saying the bindings cannot be shown. */}
      {source != null && source.consumers === undefined && (
        <p className="mgal-empty">{source.failed ? source.def.failed : source.def.loading}</p>
      )}
      {rows != null &&
        (rows.length === 0 ? (
          <p className="mgal-empty">{source?.def.none}</p>
        ) : (
          <ul className="mgal-keys">
            {rows.map((row) => (
              <li key={row.key}>
                <button
                  type="button"
                  className="mgal-keyrow"
                  aria-haspopup="dialog"
                  // Named by the key AND what a file of this role IS, because two roles can share
                  // one key source: the kit's icons and its service banners both key on the service.
                  aria-label={`Open the ${row.key} ${asset} gallery`}
                  disabled={!row.representable}
                  onClick={() => onOpen(section.id, { key: row.key })}
                >
                  <span className="mgal-keyrow-art">
                    {row.file != null && (
                      <img
                        src={tileUrl(row.file, section) ?? ""}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                  </span>
                  <span className="mgal-keyrow-text">
                    <code>{row.key}</code>
                    <span className="h">
                      {row.consumers.join(" · ")}
                      {/* A consumer/consumer collision has no winner to pick — the two SHARE the file,
                          and saying so is the whole remedy. */}
                      {row.consumers.length > 1 &&
                        (row.file
                          ? ` — these share this ${asset}`
                          : ` — these use the same ${asset} key`)}
                      {!row.representable &&
                        ` — no ${asset}: no file on the server could be named this`}
                    </span>
                    <span className={"b" + (row.file ? "" : " none")}>
                      {row.file ? row.file.file : row.representable ? `no ${asset}` : "—"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

/** The status line: how many entries, and — in WORDS, never an invented badge — how they are used.
 *
 *  Every claim here comes from the section's §2.4 RESOLVER, never from the config value (Emma's S2
 *  review #3). The two differ exactly where it matters: a seat whose pin names an entry the library no
 *  longer holds resolves to NOTHING, the surface has already fallen through to its own next rung, and
 *  naming that picture would name one nobody can see — beside a warning chip saying it is missing. */
function status(
  view: SectionView,
  items: ReturnType<typeof libraryItems>,
  active: ReturnType<typeof libraryItems>,
): string {
  const n = `${items.length} ${items.length === 1 ? "image" : "images"}`;
  // OUTRANKED FROM OUTSIDE THE GALLERY (D70 §8.3) — said BEFORE any of the per-kind sentences below,
  // because every one of them would name a picture: this destination is the agent backdrop, and either
  // the active agent's own art is painting it or the mode is painting nothing. Neither is a section the
  // owner can be pointed at, so the card says the reason in words instead.
  if (view.active.outranked !== undefined) {
    const suffix = view.section.kind === "seat" ? " to choose from" : "";
    return `${n}${suffix} · ${OUTRANKED[view.active.outranked]}`;
  }
  if (view.section.kind === "seat") {
    // The resolver's own row — whatever this seat's own pin resolved to.
    if (active.length > 0) return `${active[0].row.name} is bound here`;
    if (view.pinned !== undefined)
      return `${n} to choose from · the bound image is gone — a fallback is used`;
    // "none bound" alone said nothing about what the surface actually shows, which is what left the
    // built-in default invisible (S6). Named only where there IS one to name.
    return view.section.builtin === undefined
      ? `${n} to choose from · none bound`
      : `${n} to choose from · none bound — the default`;
  }
  if (view.overriddenBy != null) return `${n} · overridden`;
  // ONE WORD, ONE MEANING (owner ruling 2026-08-26): ACTIVE is what this destination paints right now.
  // "nothing in use" is the other word and is the truthful one here — in a first-wins section nothing
  // can be active unless something is in use, so an empty answer means the owner switched them all off.
  if (active.length === 0) return `${n} · nothing in use`;
  if (view.active.mode === "deal") return `${n} · dealt to machines in this order`;
  if (view.active.mode === "all") return `${n} · all ${active.length} shown`;
  return `${n} · 1 active`;
}

/** The one chip, in severity order — the thing the owner has to act on, never a list of them. */
function warning(view: SectionView, items: ReturnType<typeof libraryItems>): string | null {
  const broken = items.filter((i) => i.row.unusable).length;
  if (broken > 0) return `${broken} will not paint`;
  // DANGLING by identity ("W9") — the same comparison the gallery's own notice makes.
  if (view.pinned !== undefined && !view.rows.some((r) => rowId(r) === view.pinned?.id)) {
    return "bound image is missing";
  }
  if (items.some((i) => i.duplicate)) return "duplicate names";
  return null;
}
