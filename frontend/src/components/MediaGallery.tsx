import { useMediaIndex, type MediaFile } from "../hooks/useMedia";
import { useSaveSettings } from "../hooks/useSettings";
import {
  classifyNamed,
  deriveKeyBindings,
  normalizeMediaKey,
  type NamedBinding,
} from "../lib/media";
import { useMediaKeySource } from "../theme-engine/mediaKeySources";
import type { MediaNsDef, MediaRoleDef } from "../theme-engine/mediaRegistry";

// The owner-media gallery (D52/G5, GACHA_PLAN §5.4) — the Conf half of the media surface.
//
// **AS BUILT, this component performs no file operations**: it ORDERS and PINS what is on disk and tells
// the owner when a file will not work; the owner copies files in from another machine. That was once a
// RULE (§5.4's option (b): no write API, ever) — **D65 reversed it.** A typed media write path exists
// (raw-body `PUT`/`DELETE /api/media/{ns}/files/{role}/{filename}`, never multipart, never POST — the
// CORS-preflight defence, SECURITY_MODEL §2.7), and the library gallery that drives it is
// MEDIA_MANAGER_PLAN §6, landing at S2/S3. So read the absence of upload/crop/delete below as "not yet
// built here", not as "must never exist" — and build it against that plan.
//
// NAMESPACE-GENERIC: everything descriptive arrives as a `MediaNsDef` row from `theme-engine/mediaRegistry`
// (D53 §5's inversion — a namespace need not belong to a theme), and which roles EXIST comes from the
// server's index. So the next namespace is a registry row, not a second gallery.
//
// CONFIG writes still go through the ordinary `PUT /api/settings` — `media.<ns>.roles.<role>.order` and
// `media.<ns>.slots.<key>` — and that stays true after D65: only FILE BYTES use the media write path.

/** Advisory code → what the owner should read. Two come from the server's `unusable_reason` (only it read
 *  the bytes); the other two are derived HERE from the file's numbers against the role's bounds, because
 *  "too big" is per-role policy and the server ships facts (MEDIA_PLAN §5). An unrecognised server reason
 *  is shown verbatim rather than swallowed, so a new one is never invisible. */
const ADVISORIES: Record<string, { text: string; bad?: boolean }> = {
  unreadable: { text: "unreadable file", bad: true },
  "format-mismatch": { text: "wrong extension", bad: true },
  oversize: { text: "large file" },
  dimensions: { text: "very large image" },
};

/** The badges for one file, in severity order: what makes it unusable first, then the size advisories.
 *  A role the registry does not describe still shows the server's verdict — it only loses the bounds. */
function advisories(f: MediaFile, role: MediaRoleDef | undefined): string[] {
  const out: string[] = [];
  if (f.unusable_reason != null) out.push(f.unusable_reason);
  if (role != null) {
    if (f.size_bytes > role.bounds.bytes) out.push("oversize");
    if (f.width != null && f.height != null && f.width * f.height > role.bounds.pixels)
      out.push("dimensions");
  }
  return out;
}

/** A STATIC-key `named` role's binding (the frontier stack): the declared keys, plus the SAME generic
 *  classification the data-derived source gets — `classifyNamed`, so both key sources diagnose a drop
 *  identically (Codex M3 MED-1: the static path used to record only the winners, which left a shadowed
 *  `Cube.webp` and a mistyped `platform_mis.png` looking exactly like a file that had bound).
 *
 *  It runs through the same operation the THEME resolves through, so the gallery cannot claim a binding
 *  the render will not honour — including the two rules that decide the contested cases (an unusable
 *  file never binds; on a stem collision the first in this listing wins). */
function bindings(files: MediaFile[], role: MediaRoleDef | undefined) {
  const keys = role?.keys;
  if (keys === undefined) return null;
  return {
    keys,
    binding: classifyNamed(
      files,
      keys.map((k) => k.key),
    ),
  };
}

/** What a `named` role says about one file, from the file's own side. `null` = nothing to say (it bound
 *  a key, and the key badge beside it already says which; or the file is broken and carries the
 *  server's verdict instead).
 *
 *  UNKNOWN while a DERIVED role's data is still loading — or unreachable — is the load-bearing case
 *  (Opus M5): "no service is called that" is a claim about a list we do not have, and rendering it would
 *  tell the owner their correctly-named file is wrong. A static-key role has its keys from the registry,
 *  so it is never in that state. */
function fileNote(
  f: MediaFile,
  binding: NamedBinding<MediaFile> | null,
  unknown: boolean,
): { text: string; title: string } | null {
  if (unknown) return { text: "unknown", title: "the list of keys is not available yet" };
  if (binding === null || f.unusable || binding.keyOf.has(f)) return null;
  const key = normalizeMediaKey(f.name);
  return binding.shadowed.has(f)
    ? { text: "duplicate", title: `another file already binds "${key}"` }
    : { text: "no match", title: `nothing here is named "${key}"` };
}

/** `640×854 · 88 KB` — the two numbers the §10.4 hint is about, and nothing else. */
function metaText(f: MediaFile): string {
  const size =
    f.size_bytes >= 1_000_000
      ? `${(f.size_bytes / 1e6).toFixed(1)} MB`
      : `${Math.round(f.size_bytes / 1000)} KB`;
  return f.width && f.height ? `${f.width}×${f.height} · ${size}` : size;
}

export function MediaGallery({ ns, def }: { ns: string; def: MediaNsDef }) {
  // FRESH on entry (Codex F7). The files are dropped in OUT OF BAND — over SSH, from another machine —
  // so a long-lived query with a 60s staleTime would show the owner a listing that predates the copy
  // they just finished. This observer alone opts out: an always-refetch on mount plus the default
  // refetch-on-window-focus means arriving at the gallery, or coming back to the tab, re-reads the
  // directory. NOT a polling interval: the theme's own surfaces share this key, and nothing here is
  // worth a request every N seconds on a phone.
  const { data, isLoading, error } = useMediaIndex(ns, {
    staleTime: 0,
    refetchOnMount: "always",
  });
  const save = useSaveSettings();
  // Reordering is DISABLED while a save is in flight, deliberately: the next order is computed from the
  // list currently on screen, so a second tap landing before the index refetched would be computed off a
  // stale list and undo the first move. Blocking the input is the honest fix; a local optimistic order
  // would be a second source of truth for something the server already owns.
  const busy = save.isPending;

  if (error)
    return <div className="conf-card mgal-msg">media index unreachable: {error.message}</div>;
  if (!data) return <div className="conf-card mgal-msg">{isLoading ? "loading…" : "no media"}</div>;
  // The namespace could not be prepared, so nothing is mounted and there is nothing to order (W2). An
  // empty grid would read as "you have not dropped anything in yet", which is the one wrong thing to
  // say here: the theme is on its bundled art and only the owner can fix the folder.
  if (data.disabled === true) {
    return (
      <div className="conf-card mgal-msg">
        <b>media disabled</b> — {data.reason || "this namespace could not be prepared."}
      </div>
    );
  }

  const patch = (block: Record<string, unknown>) => save.mutate({ media: { [ns]: block } });

  /** Move one file within its role and persist the WHOLE role order — the config field is the order
   *  itself, not a diff, and writing the full list is what keeps the stored order meaningful after the
   *  owner drops a new file in beside it (unlisted names simply follow, in the server's collation). */
  const move = (role: string, from: number, to: number) => {
    const names = (data.roles[role] ?? []).map((f) => f.file);
    if (to < 0 || to >= names.length) return;
    const next = [...names];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    patch({ roles: { [role]: { order: next } } });
  };

  const roles = Object.keys(data.roles);
  return (
    <div className="conf-card mgal">
      {roles.map((role) => (
        <RoleSection
          key={role}
          ns={ns}
          role={role}
          files={data.roles[role] ?? []}
          // The server is the authority on which roles EXIST; the registry only describes them, so a role
          // it has no row for still lists and still reorders — it just carries no hint, no size advisories
          // and no key panel.
          roleDef={def.roles[role]}
          busy={busy}
          onMove={move}
        />
      ))}

      {/* The PINS (§5.2). Optional in every sense — the role folders above cover the ordinary case on
          their own — so they sit last, and every one of them offers "—" as its first option. */}
      {def.slots != null && def.slots.length > 0 && (
        <section className="mgal-role mgal-pins">
          <div className="mgal-head">
            <b>pins</b>
            <span className="path">optional</span>
          </div>
          <p className="mgal-hint">
            Bind one image into a role, overriding that folder&apos;s own first pick.
          </p>
          <div className="mgal-pin-grid">
            {def.slots.map((slot) => {
              // The options come from the slot's OWN source role, which is not always the role being
              // pinned (ruled, Codex F4): the gacha reel figure needs a transparent cutout, so it offers
              // `reel/` and never the cast — a character pinned there would sweep the screen as a
              // rectangle. When that folder is still empty the source role's BUNDLED ids stand in, so the
              // pin is useful on a fresh install instead of an empty select.
              //
              // Those ids come from the ROLE, not from a per-slot copy (D65 retired `MediaSlotDef.bundled`):
              // one list, derived from the theme's own ladder module, so the select can never offer a name
              // the resolver would refuse. A role the registry has no row for falls back to no options,
              // exactly as an undeclared `bundled` did.
              const files = data.roles[slot.from] ?? [];
              const bundled = def.roles[slot.from]?.bundled ?? [];
              const options = files.length > 0 ? files.map((f) => f.name) : bundled;
              const current = data.slots[slot.key];
              return (
                <label className="mgal-pin" key={slot.key}>
                  <span>{slot.label}</span>
                  <select
                    value={current ?? ""}
                    disabled={busy}
                    onChange={(e) =>
                      patch({
                        slots: { [slot.key]: e.target.value === "" ? null : e.target.value },
                      })
                    }
                  >
                    <option value="">—</option>
                    {options.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                    {/* A pin the options no longer contain still shows, so the owner can SEE the value
                        they need to clear — including a LEGACY one naming something this slot stopped
                        offering. The theme has already degraded to the role's default underneath. */}
                    {current != null && !options.includes(current) && (
                      <option value={current}>{current} (missing)</option>
                    )}
                  </select>
                  {/* The per-pin line (G6.3), for a pin whose ladder the section's generic copy above
                      does not describe — gacha's backdrop, which falls through to the SHARED background
                      rather than to a folder of its own. Rendered only when the registry declares one. */}
                  {slot.hint != null && <small className="mgal-pin-hint">{slot.hint}</small>}
                </label>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/** One role folder: the heading + the path to copy into, the registry's hint, the KEY panel when the role
 *  is `named`, and the files themselves.
 *
 *  Its own component because of the key panel's second source (D53 M3): a `named` role's keys are either a
 *  static registry list or DATA — and reading that data is a hook, which a `.map()` inside the gallery
 *  could not call once per role. Everything else here is the M2 render, moved verbatim.
 *
 *  The DERIVED-key path is source-agnostic (Codex A1): `useMediaKeySource` answers with one shape for
 *  every `keySource`, the role's own `asset` noun supplies the word for what a file of it IS, and the
 *  sentences below compose the two. Adding a source is a row in `mediaKeySources.ts` — never a branch here. */
function RoleSection({
  ns,
  role,
  files,
  roleDef,
  busy,
  onMove,
}: {
  ns: string;
  role: string;
  files: MediaFile[];
  roleDef: MediaRoleDef | undefined;
  busy: boolean;
  onMove: (role: string, from: number, to: number) => void;
}) {
  // The role's own data dependency, and only its own: a role with no `keySource` gets `null` back and
  // no fetcher is enabled (the hook is still CALLED — rules of hooks).
  const source = useMediaKeySource(roleDef?.keySource);
  // What ONE file of this role is, in the sentences below. Every phrase using it is article-free by
  // contract, so a role that declares nothing still reads correctly with the generic fallback.
  const asset = roleDef?.asset ?? "file";
  // "We do not know yet" is a THIRD state, not an empty list: annotating files against an empty list
  // would flag every correctly-named one as unmatched for as long as the query takes (§5). And it has
  // two causes with two different sentences — still loading, or it will never arrive.
  const unknown = source != null && source.consumers === undefined;
  const derived =
    source?.consumers !== undefined ? deriveKeyBindings(source.consumers, files) : null;
  // A NAMED role is not a list the owner orders — it is a set of slots they FILL by filename, so the keys
  // are shown with what each one currently resolves to. Without this a named role would render
  // indistinguishably from a pool, and the one thing the owner must know (what to call the file) would
  // appear nowhere.
  const named = bindings(files, roleDef);
  // ONE binding either way (Codex M3 MED-1): both key sources classify through `classifyNamed`, so the
  // badges below are rendered once rather than once per source.
  const binding = named?.binding ?? derived?.binding ?? null;

  return (
    <section className="mgal-role">
      <div className="mgal-head">
        <b>{role}</b>
        {/* The folder to copy into, spelled out — the whole owner-facing contract of a namespace whose
            name they never chose (§3: `kit` is house vocabulary; this is where it is documented). */}
        <span className="path">
          media/{ns}/{role}/
        </span>
      </div>
      {roleDef?.hint != null && <p className="mgal-hint">{roleDef.hint}</p>}
      {named != null && (
        <ul className="mgal-keys">
          {named.keys.map((k) => {
            const file = named.binding.byKey.get(k.key);
            return (
              <li key={k.key}>
                <code>{k.key}</code>
                <span className="h">{k.hint}</span>
                <span className={"b" + (file ? "" : " none")}>{file ? file.file : "bundled"}</span>
              </li>
            );
          })}
        </ul>
      )}
      {/* The two UNKNOWN states, told apart (Codex M3 LOW-2): a spinner sentence for a request that will
          never arrive is the one thing worse than saying the bindings cannot be shown. */}
      {source != null && source.consumers === undefined && (
        <p className="mgal-empty">{source.failed ? source.def.failed : source.def.loading}</p>
      )}
      {source != null &&
        derived != null &&
        (derived.rows.length === 0 ? (
          <p className="mgal-empty">{source.def.none}</p>
        ) : (
          <ul className="mgal-keys">
            {derived.rows.map((row) => (
              <li key={row.key}>
                <code>{row.key}</code>
                <span className="h">
                  {/* Every collision is stated where the owner meets it. A consumer/consumer collision has
                      no winner to pick — services and machines are not in the media index — so BOTH rows
                      share the one file, and saying so is the whole remedy (§0). */}
                  {row.consumers.join(" · ")}
                  {/* …and only "share" it when there IS one (Codex M3 LOW-1): on a fresh install, or
                      when the only candidate file is unusable, the truthful statement is about the KEY
                      they collapse to, not about a picture neither of them has. */}
                  {row.consumers.length > 1 &&
                    (row.file
                      ? ` — these share this ${asset}`
                      : ` — these use the same ${asset} key`)}
                  {/* The REASON stays general (Codex M3-R1 NEW-1): the rule is the conservative
                      cross-platform stem set (separators, reserved characters and names, edge dots/
                      spaces — lib/media.ts#isStemRepresentable), so naming one character class here
                      would be a false diagnosis for the others. */}
                  {!row.representable &&
                    ` — no ${asset}: no file on the server could be named this`}
                </span>
                <span className={"b" + (row.file ? "" : " none")}>
                  {row.file ? row.file.file : row.representable ? `no ${asset}` : "—"}
                </span>
              </li>
            ))}
          </ul>
        ))}
      {files.length === 0 ? (
        <p className="mgal-empty">
          {source != null
            ? `Empty — no ${asset} is painted anywhere yet. Copy .png/.jpg/.webp files named after the ${source.def.consumers} above into this folder.`
            : "Empty — the theme uses its bundled art. Copy .png/.jpg/.webp files into this folder."}
        </p>
      ) : (
        <ul className="mgal-list">
          {files.map((f, i) => {
            const note = fileNote(f, binding, unknown);
            const key = binding?.keyOf.get(f);
            return (
              <li className={"mgal-item" + (f.unusable ? " bad" : "")} key={f.file}>
                {/* The thumbnail comes from the SAME mount the theme paints from, so a file that
                    renders here is a file that renders there — the gallery cannot flatter a drop. */}
                <img className="mgal-thumb" src={f.url} alt="" loading="lazy" decoding="async" />
                <div className="mgal-meta">
                  <span className="name">{f.file}</span>
                  <span className="dim">{metaText(f)}</span>
                  {/* Which KEY this file took, for a named role — the same answer as the rows above,
                      read from the file's side. `note` is the other half, and only a derived-key role
                      has one: what a file that took NO key is doing there. */}
                  {key != null && (
                    <span className="badge dim" title={`binds as ${key}`}>
                      {key}
                    </span>
                  )}
                  {note != null && (
                    <span className="badge dim" title={note.title}>
                      {note.text}
                    </span>
                  )}
                  {advisories(f, roleDef).map((w) => (
                    <span
                      className={"badge" + (ADVISORIES[w]?.bad ? " stale" : " dim")}
                      key={w}
                      title={w}
                    >
                      {/* The PROBED format rides the mismatch badge: the bytes are a jpeg however the
                          name reads, and that is the whole of what the owner has to act on. */}
                      {(ADVISORIES[w]?.text ?? w) +
                        (w === "format-mismatch" && f.format != null ? ` (${f.format})` : "")}
                    </span>
                  ))}
                </div>
                <div className="mgal-move">
                  <button
                    type="button"
                    aria-label={`Move ${f.file} up`}
                    disabled={busy || i === 0}
                    onClick={() => onMove(role, i, i - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${f.file} down`}
                    disabled={busy || i === files.length - 1}
                    onClick={() => onMove(role, i, i + 1)}
                  >
                    ↓
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
