import { useEffect, useRef, useState } from "react";

import { LorebookPicker } from "./LorebooksEditor";
import { PromptRowFace } from "./PromptRowFace";
import { Seg } from "./Seg";
import { SettingRow } from "./SettingRow";
import { TickGrid } from "./TickGrid";
import { Switch } from "./Switch";
import { ApiError } from "../api/client";
import { useAgentToolGrid } from "../hooks/useActions";
import {
  personaChoices,
  personaLabel,
  pickLorebooks,
  pickRoleplay,
  useCreatePersona,
  useDeletePersona,
  useUpdatePersona,
  type PersonaCfg,
} from "../hooks/useRoleplay";
import { useSaveSettings, useSettings } from "../hooks/useSettings";
import { disclosureToggle } from "../lib/disclosure";
import { promptPreview } from "../lib/promptPreview";
import { requestConfirm } from "../store/confirm";
import { useRegisterDirty } from "../store/dirty";
import { requestPrompt } from "../store/prompt";

// Conf › Roleplay + Lorebooks (D70 §9) — the two GLOBAL blocks of the character subsystem. The
// per-agent half lives on the agent form in the gallery; what is here is the mode switch, the tools a
// conversational agent starts with, the owner's persona library, and the lorebook scan budgets.
//
// Both read the settings doc themselves and write `PUT /api/settings` partials — the backend
// deep-merges, so a partial patch leaves every field this UI does not surface untouched (the
// `roleplay.card_import.*` caps, `lorebooks.books`). ConfTab's own draft is untouched by them, which
// is why they are self-contained rather than prop-fed: they share nothing with it but the query.
//
// The save posture is MemoryEditor's, verbatim: the master switch saves IMMEDIATELY (the SkillsEditor
// idiom — a mode is not a draft), everything else rides a small local draft reseeded from the doc,
// with one Save under it. The PERSONA LIBRARY is the exception, and deliberately (D78 · Emma A-3): it
// is a map, and a map is edited through its own router, never the generic deep-merge (which cannot
// delete a key) — so it is `PersonasCard` below, per-ROW requests in the Automations posture.

export function RoleplayEditor() {
  const { data: settings } = useSettings();
  const save = useSaveSettings();
  const cfg = pickRoleplay(settings?.roleplay);
  // The SAME tool list the per-agent grid offers (`useAgentToolGrid`), so "the tools a character
  // starts with" cannot name a tool the agent form would refuse to show.
  const { toolNames, toolModes } = useAgentToolGrid();

  const [tools, setTools] = useState<string[]>(cfg.default_tools);
  // Reseeded from the DOC (the joined list, never the array: a fresh-but-equal array on every render
  // would reseed the draft continuously — the `clear_exclude_tools` lesson).
  const seededTools = cfg.default_tools.join(",");
  useEffect(() => setTools(seededTools ? seededTools.split(",") : []), [seededTools]);

  // The character tools are the one DRAFT left in this card — the personas moved to their own
  // per-row requests (D78), so this is all the "roleplay" dirty key still guards.
  const dirty = tools.join(",") !== seededTools;
  useRegisterDirty("roleplay", dirty);

  const toggleTool = (n: string) =>
    setTools((t) => (t.includes(n) ? t.filter((x) => x !== n) : [...t, n]));

  return (
    <>
      <div className="conf-card">
        <SettingRow
          label="Roleplay fields"
          desc="show the character fields (greeting, scenario, example dialogue, …) on every agent — an imported card lights up the ones it uses either way"
        >
          <Switch
            on={cfg.enabled}
            label="Roleplay fields"
            onToggle={() => save.mutate({ roleplay: { enabled: !cfg.enabled } })}
          />
        </SettingRow>

        <div className="confrow">
          <div className="k">
            <div className="label">Character tools</div>
            <div className="desc">
              the tools an imported card starts with — a starting set you widen per agent, never a
              ceiling
            </div>
          </div>
        </div>
        <div className="agent-allow">
          <div className="agent-allow-head">
            <span>{tools.length} selected</span>
          </div>
          <TickGrid
            all={toolNames}
            selected={new Set(tools)}
            onToggle={toggleTool}
            modes={toolModes}
          />
        </div>

        <div className="conf-savebar">
          <button
            className="conf-save"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ roleplay: { default_tools: tools } })}
          >
            {save.isPending ? "Saving…" : dirty ? "Save character tools" : "Saved"}
          </button>
        </div>
      </div>

      <PersonasCard
        personas={cfg.personas}
        defaultPersona={cfg.default_persona}
        onPickDefault={(v) => {
          // Re-picking the current value is not a save (AgentGlobals' "Default agent" guard).
          if (v !== cfg.default_persona) save.mutate({ roleplay: { default_persona: v } });
        }}
      />
    </>
  );
}

/** THE PERSONA LIBRARY (D78) — who the OWNER is to an agent, one row per persona, an add row, and the
 *  default. The Automations/lorebook list shape: every row edit is its own request (no group draft to
 *  reseed over — Emma A-3), and one row open at a time. Its own card because it saves nothing through
 *  the character tools' bar above: a Save under both would claim to cover rows it never sends. */
function PersonasCard(props: {
  personas: Record<string, PersonaCfg>;
  defaultPersona: string;
  onPickDefault: (slug: string) => void;
}) {
  const create = useCreatePersona();
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const entries = Object.entries(props.personas);

  // The one refusal worth saying where the owner is looking: the server minted a slug that is taken
  // (Emma A-2 — the mint is the server's, so only it can know). Anything else is the hook's toast.
  const takenMsg =
    create.error instanceof ApiError && create.error.status === 409 ? create.error.message : null;

  const closeAdd = () => {
    setAdding(false);
    setNewName("");
    create.reset();
  };

  const commitNew = () => {
    const name = newName.trim();
    if (!name || create.isPending) return;
    create.mutate(
      { name, description: "" },
      {
        onSuccess: (p) => {
          closeAdd();
          setOpenSlug(p.slug); // straight into the new row, to write its About
        },
      },
    );
  };

  return (
    <div className="conf-card">
      <div className="confrow">
        <div className="k">
          <div className="label">Personas</div>
          <div className="desc">
            who YOU are to the agents — the name is what {"{{user}}"} renders as, the About rides in
            as its own block · an agent can pick one on its form
          </div>
        </div>
      </div>

      {entries.map(([slug, p]) => (
        <PersonaRow
          key={slug}
          slug={slug}
          persona={p}
          open={openSlug === slug}
          onToggle={() => {
            setOpenSlug(openSlug === slug ? null : slug);
            closeAdd();
          }}
        />
      ))}

      <div className={"mwrap add" + (adding ? " open" : "")}>
        <div
          className="confrow"
          {...disclosureToggle(adding, () => {
            if (adding) closeAdd();
            else setAdding(true);
            setOpenSlug(null);
          })}
        >
          <div className="k">
            <div className="label">add persona</div>
            <div className="desc">a name now · the About once it exists</div>
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
                  aria-label="New persona name"
                  autoComplete="off"
                  value={newName}
                  placeholder="Ari"
                  aria-invalid={takenMsg !== null || undefined}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    if (create.isError) create.reset(); // a stale refusal must not outlive its name
                  }}
                />
                {takenMsg !== null && (
                  <div className="json-err" role="alert">
                    ⚠ {takenMsg}
                  </div>
                )}
              </div>
              <div className="mfoot">
                <button type="button" disabled={create.isPending} onClick={closeAdd}>
                  cancel
                </button>
                <button
                  type="button"
                  className="save"
                  disabled={create.isPending || !newName.trim()}
                  onClick={commitNew}
                >
                  {create.isPending ? "creating…" : "create"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* The default — the same control as Conf › Agents' "Default agent", saved IMMEDIATELY (the
          master-switch idiom: a pick is not a draft). A dangling default is legal and shows as
          `missing: <slug>` (Emma A-4) rather than lighting no segment at all. */}
      <div className="confrow">
        <div className="k">
          <div className="label">Default persona</div>
          <div className="desc">
            for every agent that does not pick its own · none = {"{{user}}"} is "User", no About
          </div>
        </div>
        <Seg<string>
          label="Default persona"
          current={props.defaultPersona}
          onPick={props.onPickDefault}
          options={[
            { val: "", label: "none" },
            ...personaChoices(props.personas, props.defaultPersona),
          ]}
        />
      </div>
    </div>
  );
}

/** One persona: an expandable row whose form edits a small draft saved by its own `PUT` — the slug in
 *  the URL never changes, so a rename is display only (D78). The draft follows `AgentRow`'s
 *  seeded-snapshot rule: reseeded only when the doc's VALUE moves, dirty against that snapshot, and
 *  registered with no `open` gate (a collapsed row keeps its draft, so the unload warning must too). */
function PersonaRow(props: {
  slug: string;
  persona: PersonaCfg;
  open: boolean;
  onToggle: () => void;
}) {
  const { slug } = props;
  const update = useUpdatePersona();
  const remove = useDeletePersona();
  const docJson = JSON.stringify({
    name: props.persona.name,
    description: props.persona.description,
  });
  const [draft, setDraft] = useState<PersonaCfg>(() => JSON.parse(docJson) as PersonaCfg);
  const seededRef = useRef(docJson);
  useEffect(() => {
    if (docJson === seededRef.current) return;
    seededRef.current = docJson;
    setDraft(JSON.parse(docJson) as PersonaCfg);
  }, [docJson]);

  const dirty = JSON.stringify(draft) !== seededRef.current;
  useRegisterDirty(`persona:${slug}`, dirty);

  const label = personaLabel(slug, props.persona);
  const canSave = dirty && !!draft.name.trim() && !update.isPending;

  const onSave = () => {
    if (!canSave) return;
    const sent: PersonaCfg = { name: draft.name.trim(), description: draft.description };
    const sentJson = JSON.stringify(sent);
    update.mutate(
      { slug, persona: sent },
      {
        onSuccess: (res) => {
          // The echo is the new epoch (AgentGlobals' saveGlobals shape): pin the seed at it so the
          // doc refetch lands as a no-op, and adopt it only while the draft is still what was sent —
          // a keystroke typed during the flight stays, and stays dirty, which is the truth.
          const echo = JSON.stringify({ name: res.name, description: res.description });
          seededRef.current = echo;
          setDraft((d) =>
            JSON.stringify({ ...d, name: d.name.trim() }) === sentJson
              ? (JSON.parse(echo) as PersonaCfg)
              : d,
          );
        },
      },
    );
  };

  const onRemove = async () => {
    const ok = await requestConfirm({
      title: `Remove persona ${label}?`,
      body: "Agents that picked it — and the default, if it is this one — show it as missing and fall back to the next choice until you re-point them.",
      confirmLabel: "remove",
      danger: true,
    });
    if (ok) remove.mutate(slug);
  };

  const editAbout = async () => {
    const next = await requestPrompt({
      title: `About — ${label}`,
      value: draft.description,
      placeholder: "who you are, for the agents that speak to you",
    });
    if (next != null) setDraft((d) => ({ ...d, description: next }));
  };

  return (
    <div className={"mwrap" + (props.open ? " open" : "")}>
      {/* D25 — keyboard-operable disclosure (button-free header → role=button is safe). */}
      <div className="confrow" {...disclosureToggle(props.open, props.onToggle)}>
        <div className="k">
          <div className="label">{label}</div>
          <div className="desc">{promptPreview(props.persona.description, "no About")}</div>
        </div>
        <span className="chev" aria-hidden>
          ›
        </span>
      </div>
      <div className="mconf">
        {props.open && (
          <>
            <div className="mform">
              <label>Name</label>
              <input
                aria-label={`Name of ${label}`}
                autoComplete="off"
                value={draft.name}
                placeholder={label}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
              <PromptRowFace
                label="About"
                description="injected as its own block when it is set"
                preview={promptPreview(draft.description, "empty — nothing injected")}
                openTitle={`Edit About — ${label}`}
                onOpen={() => void editAbout()}
              />
            </div>
            <div className="mfoot">
              <button
                type="button"
                className="danger"
                disabled={remove.isPending}
                onClick={() => void onRemove()}
              >
                remove
              </button>
              <button type="button" className="save" disabled={!canSave} onClick={onSave}>
                {update.isPending ? "saving…" : dirty ? "save" : "saved"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function LorebookGlobals() {
  const { data: settings } = useSettings();
  const save = useSaveSettings();
  const cfg = pickLorebooks(settings?.lorebooks);

  // Numeric settings ride a small local draft (numeric text → coerced on save), reseeded from the doc
  // — MemoryEditor's caps idiom.
  const [depth, setDepth] = useState(String(cfg.scan_depth));
  const [budget, setBudget] = useState(String(cfg.budget_chars));
  const [maxBytes, setMaxBytes] = useState(String(cfg.max_import_bytes));
  useEffect(() => setDepth(String(cfg.scan_depth)), [cfg.scan_depth]);
  useEffect(() => setBudget(String(cfg.budget_chars)), [cfg.budget_chars]);
  useEffect(() => setMaxBytes(String(cfg.max_import_bytes)), [cfg.max_import_bytes]);

  // D70 §6.5 — the GLOBAL attach list, on the same draft/save bar. Reseeded from the JOINED string,
  // never the array: a fresh-but-equal array on every render would reseed continuously (the
  // `default_tools` list right above learned this the same way). `deep_merge` replaces lists
  // wholesale, so the patch below is a clean full-list write.
  const [books, setBooks] = useState<string[]>(cfg.books);
  const seededBooks = cfg.books.join(",");
  useEffect(() => setBooks(seededBooks ? seededBooks.split(",") : []), [seededBooks]);

  const dirty =
    depth !== String(cfg.scan_depth) ||
    budget !== String(cfg.budget_chars) ||
    maxBytes !== String(cfg.max_import_bytes) ||
    books.join(",") !== seededBooks;
  useRegisterDirty("lorebooks", dirty);

  return (
    <div className="conf-card">
      <div className="confrow">
        <div className="k">
          <div className="label">Global lorebooks</div>
          <div className="desc">
            attached to every chat — an agent's own books come on top of these
          </div>
        </div>
      </div>
      <LorebookPicker value={books} onChange={setBooks} />
      <div className="confrow">
        <div className="k">
          <div className="label">Scan depth</div>
          <div className="desc">
            how many earlier messages join the new one when matching entries
          </div>
        </div>
        <input
          className="lim-input"
          inputMode="numeric"
          aria-label="Scan depth"
          value={depth}
          onChange={(e) => setDepth(e.target.value)}
        />
      </div>
      <div className="confrow">
        <div className="k">
          <div className="label">Budget</div>
          <div className="desc">characters of lorebook text one turn may carry</div>
        </div>
        <input
          className="lim-input"
          inputMode="numeric"
          aria-label="Lorebook budget"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </div>
      <div className="confrow">
        <div className="k">
          <div className="label">Import cap</div>
          <div className="desc">bytes — the largest book file an import will read</div>
        </div>
        <input
          className="lim-input"
          inputMode="numeric"
          aria-label="Lorebook import cap"
          value={maxBytes}
          onChange={(e) => setMaxBytes(e.target.value)}
        />
      </div>
      <div className="conf-savebar">
        <button
          className="conf-save"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate({
              lorebooks: {
                books,
                scan_depth: Math.max(0, Number(depth) || 0),
                budget_chars: Math.max(1, Number(budget) || cfg.budget_chars),
                max_import_bytes: Math.max(1, Number(maxBytes) || cfg.max_import_bytes),
              },
            })
          }
        >
          {save.isPending ? "Saving…" : dirty ? "Save lorebook settings" : "Saved"}
        </button>
      </div>
    </div>
  );
}
