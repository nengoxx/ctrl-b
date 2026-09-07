import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { del, getJSON, postForm, putJSON } from "../api/client";
import { pushToast } from "../store/toast";
import { CONF_SECTIONS, useScopedQuery } from "./useScopedQuery";

// The roleplay/lorebook CONFIG projections (D70 §9) — the `pickAgentSection` precedent: one place the
// settings doc's shape is turned into what the UI reads, so every consumer sees the same defaults.
//
// A hooks module rather than either editor's file because THREE surfaces read this and two of them are
// components that already import each other: the Conf cards, the agent form (whose roleplay fields are
// gated on `enabled`) and the gallery header (whose Import entry point is). S5's lorebook queries land
// here beside them.

/** The `roleplay` section as the UI reads it — defaults mirroring the backend's `RoleplayCfg`. */
export interface RoleplayCfg {
  enabled: boolean;
  default_tools: string[];
  persona: { name: string; description: string };
}

export function pickRoleplay(section: unknown): RoleplayCfg {
  const s = (section ?? {}) as Partial<RoleplayCfg> & { persona?: Partial<RoleplayCfg["persona"]> };
  return {
    enabled: s.enabled ?? false,
    default_tools: s.default_tools ?? ["web_search"],
    persona: { name: s.persona?.name ?? "", description: s.persona?.description ?? "" },
  };
}

/** The `lorebooks` section as the UI reads it — the scan/budget numerics plus `books`, the GLOBAL
 *  attach list (every chat gets these, agent-attached books on top, slug-deduped by the backend).
 *  `books` joined the projection in S5, when it got its editor; until then a partial PUT deliberately
 *  left the stored list alone. */
export interface LorebooksCfg {
  books: string[];
  scan_depth: number;
  budget_chars: number;
  max_import_bytes: number;
}

export function pickLorebooks(section: unknown): LorebooksCfg {
  const s = (section ?? {}) as Partial<LorebooksCfg>;
  return {
    books: s.books ?? [],
    scan_depth: s.scan_depth ?? 2,
    budget_chars: s.budget_chars ?? 4000,
    max_import_bytes: s.max_import_bytes ?? 15_000_000,
  };
}

// ── The lorebook FILE API (D70 §6.1/§6.6) — the `useSkills`/`useAgents` shape, third time: one list
// query, one lazy by-slug query, and create/overwrite/delete/import mutations over
// `/api/lorebooks[/{slug}]`. Two properties of the wire drive everything below:
//
//   ① `PUT /lorebooks/{slug}` is a FULL REPLACE with no ETag — a key absent from the body is deleted
//      from the file. Both models are `extra="allow"`, so an imported book carries fields v1 has no
//      editor for (`comment`, `uid`, `depth`, `selectiveLogic`, …), and the editor's ONE hard rule is
//      that it never rebuilds a book or an entry from form state: every edit is a spread over the
//      object the server handed back. The types below say so — a typed core plus an index signature,
//      exactly as `AgentDef` does for the same reason.
//   ② create and overwrite are the same request. The manager therefore refuses a duplicate slug
//      ITSELF (§6.6's add row); the server would silently overwrite a book.

/** One entry: the text, the keys that summon it, and the flags deciding how they match (§6.2). */
export interface LorebookEntry {
  keys: string[];
  content: string;
  enabled: boolean;
  constant: boolean; // always active, no scan needed
  secondary_keys: string[]; // the optional second gate, read per `logic`
  logic: "and_any" | "not_any";
  case_sensitive: boolean;
  whole_words: boolean;
  position: "head" | "tail";
  order: number; // render order among the activated entries (lower first)
  priority: number | null; // eviction order (higher survives); null → `order` stands in
  [k: string]: unknown; // the import stash — preserved verbatim, never rebuilt
}

/** One book. The slug is the FILENAME, never a field. */
export interface Lorebook {
  name: string;
  description: string;
  enabled: boolean;
  entries: LorebookEntry[];
  [k: string]: unknown; // as above
}

/** A NEW entry, at the backend's own defaults (`LorebookEntry`'s field defaults) — a factory, not a
 *  shared constant, so two appended entries never alias one array. */
export function newLorebookEntry(): LorebookEntry {
  return {
    keys: [],
    content: "",
    enabled: true,
    constant: false,
    secondary_keys: [],
    logic: "and_any",
    case_sensitive: false,
    whole_words: true,
    position: "head",
    order: 100,
    priority: null,
  };
}

/** One row of `GET /api/lorebooks` — the THIN list the manager paints (no entries, by design: the
 *  field's books run to hundreds of entries and the list must stay cheap). */
export interface LorebookInfo {
  slug: string;
  name: string;
  enabled: boolean;
  entries: number;
}

/** `GET`/`PUT /api/lorebooks/{slug}` — the whole book under its slug. */
export interface LorebookFile {
  slug: string;
  book: Lorebook;
}

/** What a book import DID (§6.5): which source keys were read, which were kept verbatim as stash, and
 *  every approximation v1 made (a collapsed position, an approximated key logic). The warnings are the
 *  half that matters — they are the record that the import changed what the author wrote. */
export interface LorebookImportReport {
  mapped: string[];
  stashed_keys: string[];
  warnings: string[];
}

export interface LorebookImportResult extends LorebookFile {
  report: LorebookImportReport;
}

/** Discovered books. Scoped to the CONF sections rather than `"conf"` alone: the attachment picker
 *  renders inside the agent form, which lives on the agents gallery (`CONF_SECTIONS` covers both). */
export function useLorebooks() {
  return useScopedQuery<LorebookInfo[]>(CONF_SECTIONS, {
    queryKey: ["lorebooks"],
    queryFn: async () => (await getJSON<{ lorebooks: LorebookInfo[] }>("/api/lorebooks")).lorebooks,
    staleTime: 30_000,
  });
}

/** The book fetch itself, as ONE spelling of the request. Exported because two paths in the manager
 *  read a book OUTSIDE the query cache, deliberately: the row SWITCH needs a whole fresh book to flip
 *  one field of a full-replace PUT (publishing that read would reseed — and wipe — an open row's
 *  draft), and the add row probes a slug the 30s-stale shelf may not know is taken. */
export function fetchLorebook(slug: string): Promise<LorebookFile> {
  return getJSON<LorebookFile>(`/api/lorebooks/${encodeURIComponent(slug)}`);
}

/** One whole book — fetched lazily when its editor row opens. `staleTime: 0` because a save's echo is
 *  written straight into this key and the next open must see the file, not a 30s-old copy. */
export function useLorebook(slug: string | null) {
  return useQuery({
    queryKey: ["lorebook", slug],
    queryFn: () => fetchLorebook(slug!),
    enabled: !!slug,
    staleTime: 0,
  });
}

/** Everything that renders a lorebook, refreshed after a write — the ONE definition of "the shelf
 *  changed". Private: no surface outside this module writes books. */
function invalidateLorebooks(qc: ReturnType<typeof useQueryClient>, slug?: string) {
  void qc.invalidateQueries({ queryKey: ["lorebooks"] });
  if (slug) void qc.invalidateQueries({ queryKey: ["lorebook", slug] });
}

/** Create or overwrite a book file. The 200 echoes the VALIDATED book (defaults filled in), so the
 *  echo — not the request — is what seeds the editor's next draft. */
export function useSaveLorebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, book }: { slug: string; book: Lorebook }) =>
      putJSON<LorebookFile>(`/api/lorebooks/${encodeURIComponent(slug)}`, { book }),
    onSuccess: (res) => {
      qc.setQueryData(["lorebook", res.slug], res);
      invalidateLorebooks(qc); // the list's name/enabled/count for this row
      pushToast("Lorebook saved", "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Save failed", "err"),
  });
}

export function useDeleteLorebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => del(`/api/lorebooks/${encodeURIComponent(slug)}`),
    onSuccess: (_d, slug) => {
      invalidateLorebooks(qc, slug);
      pushToast("Lorebook removed", "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Remove failed", "err"),
  });
}

/** Import a book (§6.5) — MULTIPART, one `file` field, the `useImportAgent` shape verbatim. No success
 *  toast: the REPORT is the outcome, and a toast over it would say less at the same moment. */
export function useImportLorebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return postForm<LorebookImportResult>("/api/lorebooks/import", form);
    },
    onSuccess: (res) => invalidateLorebooks(qc, res.slug),
    onError: (e: Error) => pushToast(e.message || "Import failed", "err"),
  });
}
