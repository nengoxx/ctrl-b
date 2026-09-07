import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Switch } from "./Switch";
import { TickGrid } from "./TickGrid";
import {
  fetchLorebook,
  newLorebookEntry,
  useDeleteLorebook,
  useImportLorebook,
  useLorebook,
  useLorebooks,
  useSaveLorebook,
  type Lorebook,
  type LorebookEntry,
  type LorebookFile,
  type LorebookImportReport,
  type LorebookInfo,
} from "../hooks/useRoleplay";
import { disclosureToggle } from "../lib/disclosure";
import { numOrKeep, numOrKeepNullable } from "../lib/num";
import { requestConfirm } from "../store/confirm";
import { useRegisterDirty } from "../store/dirty";
import { pushToast } from "../store/toast";

// Phase 23 / D70 §6.6 — the LOREBOOK MANAGER. Structurally this is `SkillsEditor`: a file-per-slug
// list where a row expands into the editor for that file, plus an add row and (like the agents
// gallery) an import affordance with an inline report. Three things differ, each for a reason:
//
//  ① The book row carries an enable SWITCH, so it cannot be a `disclosureToggle` row — a
//     `role="button"` containing a control is the `nested-interactive` violation D25 fixed. It is the
//     BREAKOUT shape instead (plain `<div onClick>` + a child `<button aria-expanded>`), the one
//     `AutomationsPanel` and vapor's `DeviceRow` already use.
//  ② The add row takes a NAME and mints the slug, because a book is authored content with a display
//     name (a skill is addressed by its folder). The mint mirrors the backend's own `_slugify`, and a
//     slug already on the shelf is refused HERE: `PUT /lorebooks/{slug}` is create-or-overwrite, so a
//     collision the UI let through would silently destroy a book.
//  ③ The book editor's default view is a COLLAPSED LIST of entries (§6.6, the owner's first-class
//     requirement after eyeballing their real books — the field install holds 209-entry books). One
//     row per entry: a key summary, one preview line, its own enable switch. Only the OPEN entry
//     mounts a form.
//
// THE LOAD-BEARING RULE, everywhere below: nothing is ever REBUILT from form state. Both wire models
// are `extra="allow"`, the PUT is a full replace with no ETag, and an imported book carries fields v1
// has no editor for (`comment`, `uid`, `depth`, `selectiveLogic`, …). So every edit is a spread over
// the object the server handed back — `{ ...entry, content: v }`, never `{ keys, content, … }` — and
// the save PUTs the draft as-is. `tests/tabs/confLorebooks.test.tsx` pins it.

/** The backend's `_slugify` (card_import.py) client-side: casefold, everything outside the grammar
 *  collapsed to `-`, runs collapsed, edges trimmed, capped at 64. It is spelled twice deliberately —
 *  the create path is a PUT at a slug WE choose, so a name that slugifies to nothing (or onto an
 *  existing book) has to be refused before the request, not diagnosed from a 422 afterwards. */
const MAX_SLUG = 64;
const trimEdges = (s: string) => s.replace(/^[-_]+/, "").replace(/[-_]+$/, "");
function slugify(name: string): string {
  const collapsed = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-");
  return trimEdges(trimEdges(collapsed).slice(0, MAX_SLUG));
}

/** A comma-separated key list ⇄ the wire's array. The TEXT is held locally by the form that owns the
 *  field (below) so a half-typed `"ghost, "` survives a keystroke — parsing it back into the draft on
 *  every change would rewrite the input from under the cursor. */
const splitKeys = (raw: string): string[] =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

/** The first line of an entry's content, for the collapsed row's one-line preview. CAPPED, because the
 *  first line of an unwrapped entry IS the whole entry: CSS ellipses what overflows but the DOM would
 *  still carry every character, 209 times over on the field's real books. */
const PREVIEW_CHARS = 160;
function previewLine(content: string): string {
  const first = content.split("\n").find((l) => l.trim() !== "");
  return (first?.trim() ?? "").slice(0, PREVIEW_CHARS);
}

/** WHAT THE IMPORTED FILE CONTAINED (§6.5). The agents gallery's `ImportReportCard` is the same idea
 *  and the same CSS, but its shape is the CARD report's (container · fields_mapped · stripped_paths ·
 *  post_history) and a book report is three lists — so this is a sibling renderer on the SAME
 *  `.agrep*` classes rather than a shared component fed four empty fields. Warnings lead: an entry
 *  whose position v1 collapsed is the one thing here that changes what the owner does next. */
function BookReportCard({
  report,
  slug,
  onDismiss,
}: {
  report: LorebookImportReport;
  slug: string;
  onDismiss: () => void;
}) {
  const line = (label: string, items: readonly string[]) =>
    items.length === 0 ? null : (
      <div className="agrep-row" key={label}>
        <b>{label}</b>
        <span>{items.join(" · ")}</span>
      </div>
    );
  return (
    <div className="conf-card agrep">
      <div className="agrep-head">
        <b>imported {slug}</b>
        <button type="button" className="agrep-x" onClick={onDismiss}>
          dismiss
        </button>
      </div>
      {report.warnings.length > 0 && (
        <ul className="agrep-warn">
          {report.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {line("mapped", report.mapped)}
      {line("stashed", report.stashed_keys)}
    </div>
  );
}

/** The expanded form for ONE entry. Mounted only while its row is open, so a 209-entry book keeps 209
 *  light rows and one form.
 *
 *  The four fields whose TEXT is not their value — the two key lists and the two numerics — hold local
 *  text state seeded once at mount, and push the parsed value into the draft on every change. That is
 *  the only way a controlled input over a derived value stays typeable: `"ghost, "` must not snap back
 *  to `"ghost"` mid-word, and a cleared number must not reappear as the last valid one. */
function EntryForm({
  entry,
  index,
  onPatch,
  onRemove,
}: {
  entry: LorebookEntry;
  index: number;
  onPatch: (patch: Partial<LorebookEntry>) => void;
  onRemove: () => void;
}) {
  const [keysText, setKeysText] = useState(() => entry.keys.join(", "));
  const [secText, setSecText] = useState(() => entry.secondary_keys.join(", "));
  const [orderText, setOrderText] = useState(() => String(entry.order));
  const [priText, setPriText] = useState(() =>
    entry.priority == null ? "" : String(entry.priority),
  );
  const n = index + 1;

  return (
    <div className="lb-body">
      <div className="mform">
        <label>Keys</label>
        <input
          aria-label={`Entry ${n} keys`}
          value={keysText}
          placeholder="comma-separated · any hit activates"
          onChange={(e) => {
            setKeysText(e.target.value);
            onPatch({ keys: splitKeys(e.target.value) });
          }}
        />

        <label>Content</label>
        <textarea
          aria-label={`Entry ${n} content`}
          className="kv-text lb-content"
          value={entry.content}
          onChange={(e) => onPatch({ content: e.target.value })}
        />

        <label>Always on</label>
        <div className="mrow-switch">
          <Switch
            on={entry.constant}
            label={`Entry ${n} always on`}
            onToggle={() => onPatch({ constant: !entry.constant })}
          />
          <span className="mrow-hint">no keyword needed</span>
        </div>

        <label>Second gate</label>
        <input
          aria-label={`Entry ${n} secondary keys`}
          value={secText}
          placeholder="(blank → no second gate)"
          onChange={(e) => {
            setSecText(e.target.value);
            onPatch({ secondary_keys: splitKeys(e.target.value) });
          }}
        />

        <label>Gate logic</label>
        <select
          aria-label={`Entry ${n} gate logic`}
          value={entry.logic}
          onChange={(e) => onPatch({ logic: e.target.value as LorebookEntry["logic"] })}
        >
          <option value="and_any">and any — one of them must also hit</option>
          <option value="not_any">not any — none of them may hit</option>
        </select>

        <label>Case sensitive</label>
        <div className="mrow-switch">
          <Switch
            on={entry.case_sensitive}
            label={`Entry ${n} case sensitive`}
            onToggle={() => onPatch({ case_sensitive: !entry.case_sensitive })}
          />
        </div>

        <label>Whole words</label>
        <div className="mrow-switch">
          <Switch
            on={entry.whole_words}
            label={`Entry ${n} whole words`}
            onToggle={() => onPatch({ whole_words: !entry.whole_words })}
          />
          <span className="mrow-hint">off → match inside longer words</span>
        </div>

        <label>Position</label>
        <select
          aria-label={`Entry ${n} position`}
          value={entry.position}
          onChange={(e) => onPatch({ position: e.target.value as LorebookEntry["position"] })}
        >
          <option value="head">head — with the system prompt</option>
          <option value="tail">tail — just before the reply</option>
        </select>

        <label>Order</label>
        <input
          aria-label={`Entry ${n} order`}
          inputMode="numeric"
          value={orderText}
          onChange={(e) => {
            setOrderText(e.target.value);
            onPatch({ order: numOrKeep(e.target.value, entry.order) });
          }}
        />

        <label>Priority</label>
        <input
          aria-label={`Entry ${n} priority`}
          inputMode="numeric"
          value={priText}
          placeholder="(blank → use the order)"
          onChange={(e) => {
            setPriText(e.target.value);
            // BLANK is the wire's own sentinel (`null` → `order` ranks the eviction too), so it must
            // never be coerced to 0 — `numOrKeepNullable` is exactly that contract.
            onPatch({ priority: numOrKeepNullable(e.target.value, entry.priority) });
          }}
        />
      </div>
      <div className="mfoot">
        <button type="button" className="danger" onClick={onRemove}>
          remove entry
        </button>
      </div>
    </div>
  );
}

/** §6.6's collapsed entry list — the book editor's default view. Rows are keyed by INDEX and render in
 *  array order: an entry has no stable id (a `uid` is a stash field, not a guarantee) and v1 has no
 *  reorder UI at all — `order` is a number you type, so nothing here ever moves a row. */
function EntryList({
  entries,
  onChange,
}: {
  entries: LorebookEntry[];
  onChange: (next: LorebookEntry[]) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const patch = (i: number, p: Partial<LorebookEntry>) =>
    // THE RULE: spread the EXISTING entry. Anything the editor has no field for rides through.
    onChange(entries.map((e, j) => (j === i ? { ...e, ...p } : e)));

  return (
    <div className="lb-entries">
      <div className="lb-entries-head">
        <span>
          {entries.length} entr{entries.length === 1 ? "y" : "ies"}
        </span>
        <button
          type="button"
          className="lb-add"
          onClick={() => {
            onChange([...entries, newLorebookEntry()]);
            setOpen(entries.length); // the appended one, opened for editing
          }}
        >
          + add entry
        </button>
      </div>
      {entries.map((e, i) => {
        const isOpen = open === i;
        const toggle = () => setOpen(isOpen ? null : i);
        const keys = e.keys.join(", ");
        const preview = previewLine(e.content);
        return (
          <div className={"lb-entry" + (isOpen ? " open" : "")} key={i}>
            {/* The D25 BREAKOUT again — the row carries the entry's own switch. */}
            <div className="confrow" onClick={toggle}>
              <div className="k">
                <div className="label">
                  {keys || (e.constant ? "" : <span className="lb-nokeys">(no keys)</span>)}
                  {e.constant && <span className="badge dim">constant</span>}
                </div>
                <div className="desc lb-prev">{preview || "(empty)"}</div>
              </div>
              <span className="row-acts">
                {/* DRAFT-only, unlike the book switch above it: an entry has no file of its own, so
                    its enabled flag is saved with the book like every other entry field. */}
                <span className="auto-sw" onClick={(ev) => ev.stopPropagation()}>
                  <Switch
                    on={e.enabled}
                    label={`Entry ${i + 1} enabled`}
                    onToggle={() => patch(i, { enabled: !e.enabled })}
                  />
                </span>
                <button
                  type="button"
                  className="chev"
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "collapse" : "expand"} entry ${i + 1}`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    toggle();
                  }}
                >
                  ›
                </button>
              </span>
            </div>
            {isOpen && (
              <EntryForm
                entry={e}
                index={i}
                onPatch={(p) => patch(i, p)}
                onRemove={() => {
                  setOpen(null); // indices shift under a removal — never leave one open across it
                  onChange(entries.filter((_, j) => j !== i));
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One book's row: the header (name · entry count · enable switch) and, while open, its editor.
 *
 *  The DRAFT is the `AgentRow` recipe verbatim — seeded from the fetched book by VALUE guard (a fresh
 *  object identity from the cache must not wipe unsaved edits), dirty by JSON compare, saved whole. */
function LorebookRow({
  info,
  open,
  onToggle,
}: {
  info: LorebookInfo;
  open: boolean;
  onToggle: () => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useLorebook(open ? info.slug : null);
  const save = useSaveLorebook();
  const remove = useDeleteLorebook();
  const [draft, setDraft] = useState<Lorebook | null>(null);
  const seeded = useRef<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const next = JSON.stringify(data.book);
    if (next === seeded.current) return;
    seeded.current = next;
    setDraft(data.book);
  }, [data]);

  const dirty = !!(data && draft && JSON.stringify(draft) !== JSON.stringify(data.book));
  useRegisterDirty(`lorebook:${info.slug}`, open && dirty);

  const label = info.name.trim() || info.slug;

  /** The row switch is the app's MASTER-SWITCH posture (SkillsEditor/MemoryEditor): a mode is not a
   *  draft, so it saves immediately. It PUTs the SERVER's copy with `enabled` flipped — never the open
   *  draft, which would commit unrelated unsaved edits — and then patches the draft's own `enabled` so
   *  a later Save does not revert the toggle. */
  const flipEnabled = async () => {
    // `fetchQuery` over the SAME key `useLorebook` uses: a closed row has never fetched its book, and
    // flipping one field of a full-replace PUT needs all of it. The READ is the one step here with no
    // error path of its own — the mutation toasts its own failures — and an unhandled rejection out of
    // a click handler is a page error, so it says what happened and stops.
    let file: LorebookFile;
    try {
      file =
        data ??
        (await qc.fetchQuery({
          queryKey: ["lorebook", info.slug],
          queryFn: () => fetchLorebook(info.slug),
        }));
    } catch (e) {
      return pushToast((e as Error).message || "Could not read the lorebook", "err");
    }
    const enabled = !file.book.enabled;
    save.mutate(
      { slug: info.slug, book: { ...file.book, enabled } },
      {
        onSuccess: (res) => {
          // The echo lands in the cache, and the seed effect above would read it as "the file
          // changed" and reseed — throwing away unsaved edits for a toggle about one field. Pin the
          // guard at the echo and patch only what the toggle meant.
          seeded.current = JSON.stringify(res.book);
          setDraft((d) => (d ? { ...d, enabled } : d));
        },
      },
    );
  };

  const onRemove = async () => {
    const ok = await requestConfirm({
      title: `Remove lorebook ${label}?`,
      body: "Deletes its file. Agents still listing it simply stop getting its entries.",
      confirmLabel: "remove",
      danger: true,
    });
    if (ok) remove.mutate(info.slug, { onSuccess: onToggle });
  };

  return (
    <div className={"mwrap lb-book" + (open ? " open" : "")}>
      {/* D25 BREAKOUT: the row contains the enable Switch, so the row itself must not be a button. */}
      <div className="confrow" onClick={onToggle}>
        <div className="k">
          <div className="label">
            {label}
            {label !== info.slug ? <span className="agent-slug"> · {info.slug}</span> : ""}
          </div>
          <div className="desc">
            {info.entries} entr{info.entries === 1 ? "y" : "ies"}
          </div>
        </div>
        <span className="row-acts">
          <span className="auto-sw" onClick={(e) => e.stopPropagation()}>
            <Switch
              on={info.enabled}
              label={`${label} enabled`}
              onToggle={() => void flipEnabled()}
            />
          </span>
          <button
            type="button"
            className="chev"
            aria-expanded={open}
            aria-label={`${open ? "collapse" : "expand"} ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            ›
          </button>
        </span>
      </div>
      <div className="mconf">
        {open &&
          (isLoading || !draft ? (
            <div className="agent-empty">loading…</div>
          ) : (
            <>
              <div className="mform">
                <label>Name</label>
                <input
                  aria-label="Lorebook name"
                  value={draft.name}
                  placeholder={info.slug}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
                <label>Description</label>
                {/* A book description is a line or two of the owner's own note — the `.kv-text`
                    integrations textarea, not the fullscreen `LongField` the PROMPT fields use. */}
                <textarea
                  aria-label="Lorebook description"
                  className="kv-text"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <EntryList
                entries={draft.entries}
                onChange={(entries) => setDraft({ ...draft, entries })}
              />
              <div className="mfoot">
                <button
                  type="button"
                  className="danger"
                  disabled={remove.isPending}
                  onClick={onRemove}
                >
                  remove
                </button>
                <button
                  type="button"
                  className="save"
                  disabled={!dirty || save.isPending}
                  onClick={() => save.mutate({ slug: info.slug, book: draft })}
                >
                  {save.isPending ? "saving…" : dirty ? "save" : "saved"}
                </button>
              </div>
            </>
          ))}
      </div>
    </div>
  );
}

export function LorebooksEditor() {
  const { data: books = [] } = useLorebooks();
  const save = useSaveLorebook();
  const importBook = useImportLorebook();
  const fileRef = useRef<HTMLInputElement>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [report, setReport] = useState<{ slug: string; report: LorebookImportReport } | null>(null);

  const commitNew = () => {
    const slug = slugify(newName);
    if (!slug) return pushToast("name: needs a letter or a digit", "err");
    // `PUT /lorebooks/{slug}` is create-or-OVERWRITE — an unrefused collision would destroy a book.
    if (books.some((b) => b.slug === slug)) return pushToast(`a lorebook '${slug}' exists`, "err");
    save.mutate(
      {
        slug,
        book: { name: newName.trim(), description: "", enabled: true, entries: [] },
      },
      {
        onSuccess: () => {
          setNewName("");
          setAdding(false);
          setOpenSlug(slug);
        },
      },
    );
  };

  return (
    <>
      {report !== null && (
        <BookReportCard
          report={report.report}
          slug={report.slug}
          onDismiss={() => setReport(null)}
        />
      )}
      <div className="conf-card">
        {books.map((b) => (
          <LorebookRow
            key={b.slug}
            info={b}
            open={openSlug === b.slug}
            onToggle={() => {
              setOpenSlug(openSlug === b.slug ? null : b.slug);
              setAdding(false);
            }}
          />
        ))}

        <div className={"mwrap add" + (adding ? " open" : "")}>
          <div
            className="confrow"
            {...disclosureToggle(adding, () => {
              setAdding(!adding);
              setOpenSlug(null);
            })}
          >
            <div className="k">
              <div className="label">add lorebook</div>
              <div className="desc">creates lorebooks/&lt;slug&gt;.yaml from the name</div>
            </div>
            <span className="chev" aria-hidden>
              ›
            </span>
          </div>
          <div className="mconf">
            {adding && (
              <>
                <div className="mform">
                  <label>Name</label>
                  <input
                    aria-label="lorebook name"
                    value={newName}
                    placeholder="Hollow Sea"
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <div className="mrow-hint">file: lorebooks/{slugify(newName) || "…"}.yaml</div>
                </div>
                <div className="mfoot">
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setNewName("");
                    }}
                  >
                    cancel
                  </button>
                  <button
                    type="button"
                    className="save"
                    disabled={save.isPending}
                    onClick={commitNew}
                  >
                    {save.isPending ? "creating…" : "create"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* The gallery's import affordance, second instance: a HIDDEN input + a styled button, with
            `input.value` reset in the handler so picking the SAME file twice still fires `change`. */}
        <div className="lb-import">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              importBook.mutate(file, {
                onSuccess: (res) => {
                  setReport({ slug: res.slug, report: res.report });
                  setOpenSlug(null);
                },
              });
            }}
          />
          <button
            type="button"
            disabled={importBook.isPending}
            onClick={() => fileRef.current?.click()}
          >
            {importBook.isPending ? "importing…" : "import a lorebook"}
          </button>
        </div>
      </div>
    </>
  );
}

/** THE ATTACHMENT PICKER (§6.5) — one component, two consumers: an agent's own `lorebooks` list and
 *  the global `lorebooks.books` in Conf. The value is SLUGS; the chips are drawn with each book's
 *  display name.
 *
 *  An attached slug the shelf no longer lists still renders — ticked, marked missing — because the
 *  save that follows writes exactly what is ticked: a picker that hid a dangling attachment would
 *  delete it on the owner's next unrelated save. Unticking is how you remove one. */
export function LorebookPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { data: books = [] } = useLorebooks();
  const known = books.map((b) => b.slug);
  const missing = value.filter((s) => !known.includes(s));
  const labels: Record<string, string> = {};
  for (const b of books) labels[b.slug] = b.name.trim() || b.slug;

  return (
    <div className="agent-allow">
      <div className="agent-allow-head">
        <span>{value.length} attached</span>
      </div>
      <TickGrid
        all={[...known, ...missing]}
        selected={new Set(value)}
        onToggle={(slug) =>
          onChange(value.includes(slug) ? value.filter((s) => s !== slug) : [...value, slug])
        }
        labels={labels}
        missing={new Set(missing)}
      />
    </div>
  );
}
