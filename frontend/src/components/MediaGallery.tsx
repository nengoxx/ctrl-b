import { useMediaIndex, type MediaFile } from "../hooks/useMedia";
import { useSaveSettings } from "../hooks/useSettings";
import type { ThemeMedia } from "../theme-engine/types";

// The owner-media gallery (D52/G5, GACHA_PLAN §5.4) — the Conf half of the read-only media surface.
//
// WHAT IT IS NOT is the shortest way to say what it is: there are no file operations here. No upload, no
// delete, no rename — §5.4 ruled option (b), and the app has no application-layer auth (the tailnet IS the
// boundary), so a write endpoint would be reachable by anything on the tailnet. The owner copies files in
// from another machine; this ORDERS and PINS them, and tells them when a file will not work.
//
// NAMESPACE-GENERIC: everything theme-shaped arrives as `ThemeMedia` DATA from the active `ThemeDef` (the
// same descriptor-not-code shape the per-theme settings rows already use), and the ROLES come from the
// server's index. So the next art-bearing theme is a declaration, not a second gallery.
//
// Writes go through the ordinary `PUT /api/settings` — `themes.<ns>.roles.<role>.order` and
// `themes.<ns>.slots.<key>`. There is no media-specific write path to secure or to keep in sync.

/** Warning code → what the owner should read. Codes come from the index's magic-byte reader; anything
 *  unrecognised is shown verbatim rather than swallowed, so a new server-side code is never invisible. */
const WARNINGS: Record<string, { text: string; bad?: boolean }> = {
  unreadable: { text: "unreadable file", bad: true },
  "format-mismatch": { text: "wrong extension", bad: true },
  oversize: { text: "large file" },
  dimensions: { text: "very large image" },
};

/** `640×854 · 88 KB` — the two numbers the §10.4 hint is about, and nothing else. */
function metaText(f: MediaFile): string {
  const size =
    f.size_bytes >= 1_000_000
      ? `${(f.size_bytes / 1e6).toFixed(1)} MB`
      : `${Math.round(f.size_bytes / 1000)} KB`;
  return f.width && f.height ? `${f.width}×${f.height} · ${size}` : size;
}

export function MediaGallery({ media }: { media: ThemeMedia }) {
  const { data, isLoading, error } = useMediaIndex(media.ns);
  const save = useSaveSettings();
  // Reordering is DISABLED while a save is in flight, deliberately: the next order is computed from the
  // list currently on screen, so a second tap landing before the index refetched would be computed off a
  // stale list and undo the first move. Blocking the input is the honest fix; a local optimistic order
  // would be a second source of truth for something the server already owns.
  const busy = save.isPending;

  if (error)
    return <div className="conf-card mgal-msg">media index unreachable: {error.message}</div>;
  if (!data) return <div className="conf-card mgal-msg">{isLoading ? "loading…" : "no media"}</div>;

  const patch = (block: Record<string, unknown>) => save.mutate({ themes: { [media.ns]: block } });

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
      {roles.map((role) => {
        const files = data.roles[role] ?? [];
        return (
          <section className="mgal-role" key={role}>
            <div className="mgal-head">
              <b>{role}</b>
              <span className="path">
                media/{media.ns}/{role}/
              </span>
            </div>
            {media.roles?.[role] != null && <p className="mgal-hint">{media.roles[role]}</p>}
            {files.length === 0 ? (
              <p className="mgal-empty">
                Empty — the theme uses its bundled art. Copy .png/.jpg/.webp files into this folder.
              </p>
            ) : (
              <ul className="mgal-list">
                {files.map((f, i) => (
                  <li className={"mgal-item" + (f.unusable ? " bad" : "")} key={f.file}>
                    {/* The thumbnail comes from the SAME mount the theme paints from, so a file that
                        renders here is a file that renders there — the gallery cannot flatter a drop. */}
                    <img
                      className="mgal-thumb"
                      src={f.url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="mgal-meta">
                      <span className="name">{f.file}</span>
                      <span className="dim">{metaText(f)}</span>
                      {f.warnings.map((w) => (
                        <span
                          className={"badge" + (WARNINGS[w]?.bad ? " stale" : " dim")}
                          key={w}
                          title={w}
                        >
                          {WARNINGS[w]?.text ?? w}
                        </span>
                      ))}
                    </div>
                    <div className="mgal-move">
                      <button
                        type="button"
                        aria-label={`Move ${f.file} up`}
                        disabled={busy || i === 0}
                        onClick={() => move(role, i, i - 1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${f.file} down`}
                        disabled={busy || i === files.length - 1}
                        onClick={() => move(role, i, i + 1)}
                      >
                        ↓
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {/* The PINS (§5.2). Optional in every sense — the role folders above cover the ordinary case on
          their own — so they sit last, and every one of them offers "—" as its first option. */}
      {media.slots != null && media.slots.length > 0 && (
        <section className="mgal-role mgal-pins">
          <div className="mgal-head">
            <b>pins</b>
            <span className="path">optional</span>
          </div>
          <p className="mgal-hint">
            Bind one image into a role, overriding that folder&apos;s own first pick.
          </p>
          <div className="mgal-pin-grid">
            {media.slots.map((slot) => (
              <label className="mgal-pin" key={slot.key}>
                <span>{slot.label}</span>
                <select
                  value={data.slots[slot.key] ?? ""}
                  disabled={busy}
                  onChange={(e) =>
                    patch({ slots: { [slot.key]: e.target.value === "" ? null : e.target.value } })
                  }
                >
                  <option value="">—</option>
                  {(data.roles[slot.from] ?? []).map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                  {/* A pin whose file is gone still shows, so the owner can SEE the dangling value they
                      need to clear — the theme has already degraded to the role's default underneath. */}
                  {data.slots[slot.key] != null &&
                    !(data.roles[slot.from] ?? []).some((f) => f.name === data.slots[slot.key]) && (
                      <option value={data.slots[slot.key]}>{data.slots[slot.key]} (missing)</option>
                    )}
                </select>
              </label>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
