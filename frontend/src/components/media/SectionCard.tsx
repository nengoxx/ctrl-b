import { useId } from "react";

import {
  libraryItems,
  scopedRows,
  type GalleryScope,
  type SectionView,
} from "../../hooks/useMediaLibrary";
import { deriveKeyBindings } from "../../lib/media";
import { shown, tileUrl } from "../../lib/mediaLibrary";
import { useMediaKeySource } from "../../theme-engine/mediaKeySources";

// The ENTRY CARD (MEDIA_MANAGER_PLAN §6.1, R59 §11.1) — one card per art DESTINATION, and the card IS
// the button. Full-width, shaped like the destination (`aspect-ratio` from the registry), painted with
// whatever the section's §2.4 resolver says is live, and carrying the status line the old accordion
// header used to hold. No accordion, no hover-revealed actions (there is no hover on a phone).
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

  const items = libraryItems(
    scopedRows(view.rows, { key: section.key }),
    view.active,
    section.pin !== undefined,
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
        onClick={() => onOpen(section.id, { key: section.key })}
      >
        <span
          className={"mgal-card-art" + (art.length > 1 ? " collage" : "")}
          style={{ aspectRatio: String(section.aspect ?? 1) }}
        >
          {art.length === 0 ? (
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
  const derived =
    source?.consumers !== undefined ? deriveKeyBindings(source.consumers, shown(view.rows)) : null;
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
      {derived != null &&
        (derived.rows.length === 0 ? (
          <p className="mgal-empty">{source?.def.none}</p>
        ) : (
          <ul className="mgal-keys">
            {derived.rows.map((row) => (
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
 *  saying "deleted in use" would name a picture nobody can see — beside a warning chip saying that
 *  same picture is missing. */
function status(
  view: SectionView,
  items: ReturnType<typeof libraryItems>,
  active: ReturnType<typeof libraryItems>,
): string {
  const n = `${items.length} ${items.length === 1 ? "image" : "images"}`;
  if (view.section.kind === "seat") {
    // The resolver's own row — the pin's, or whatever the seat's ladder fell through to (the hero
    // slide reads the fleet backdrop's pin when it has none of its own).
    if (active.length > 0) return `${active[0].row.name} in use`;
    const pinned = view.pinned != null && view.pinned !== "";
    return pinned
      ? `${n} to choose from · the pinned image is gone — a fallback is in use`
      : `${n} to choose from · none pinned`;
  }
  if (view.overriddenBy != null) return `${n} · overridden`;
  if (active.length === 0) return `${n} · nothing in use`;
  if (view.active.mode === "deal") return `${n} · dealt to machines in this order`;
  if (view.active.mode === "all") return `${n} · all ${active.length} shown`;
  return `${n} · 1 in use`;
}

/** The one chip, in severity order — the thing the owner has to act on, never a list of them. */
function warning(view: SectionView, items: ReturnType<typeof libraryItems>): string | null {
  const broken = items.filter((i) => i.row.unusable).length;
  if (broken > 0) return `${broken} will not paint`;
  if (view.pinned != null && view.pinned !== "" && !view.rows.some((r) => r.name === view.pinned)) {
    return "pinned image is missing";
  }
  if (items.some((i) => i.duplicate)) return "duplicate names";
  return null;
}
