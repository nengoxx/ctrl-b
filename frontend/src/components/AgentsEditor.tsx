import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useDefaultPrompt } from "../hooks/useDefaultPrompt";
import { useSaveSettings } from "../hooks/useSettings";
import {
  DEFAULT_AGENT,
  pickFields,
  useAgent,
  useAgentList,
  useDeleteAgent,
  useSaveAgent,
  useSaveAgentSoul,
  type AgentDef,
  type AgentSectionCfg,
  type Privilege,
} from "../hooks/useAgents";
import { Seg } from "./Seg";
import { Switch } from "./Switch";
import { disclosureToggle } from "../lib/disclosure";
import { PRIVILEGE_LEVELS } from "../lib/privilege";
import { promptPreview } from "../lib/promptPreview";
import type { AgentMode } from "../types";
import { requestConfirm } from "../store/confirm";
import { useRegisterDirty } from "../store/dirty";
import { requestPrompt } from "../store/prompt";
import { pushToast } from "../store/toast";

// Phase 7e-c (D14). Agents are folder-only. This is the unified editor: the default/root agent is
// the first row (its fields ↔ config.yaml `agent.defaults`, title ↔ `agent.default_title`, persona ↔
// root SOUL.md) and each specialist is a row backed by its own `agents/<slug>/` (agent.yaml + SOUL.md).
// Field edits are a per-row draft saved through the file API (specialist) or PUT /api/settings
// (default); the SOUL.md persona saves directly (file-backed, D14 7e-b Q2). Reuses the vapor
// .mwrap/.mform recipe (D7); the tick grids + limits grid are net-new in extras.css.

const SLUG = /^[a-z0-9][a-z0-9_-]*$/;

// `modes` (8b, D22) mirrors the Tools-tab tri-state onto the per-agent selection grid: a globally
// **disabled** tool shows locked-off (it can't be granted), a **core** tool locked-on (it's always
// available regardless of the allowlist). Only **enabled** tools are interactive. The skills grid
// passes no `modes` → every entry stays interactive.
function TickGrid({
  all,
  selected,
  onToggle,
  modes,
}: {
  all: string[];
  selected: Set<string>;
  onToggle: (n: string) => void;
  modes?: Record<string, AgentMode>;
}) {
  if (!all.length) return <div className="agent-empty">none discovered</div>;
  return (
    <div className="tick-grid">
      {all.map((n) => {
        const mode = modes?.[n];
        const locked = mode === "core" || mode === "disabled";
        const on = mode === "core" ? true : mode === "disabled" ? false : selected.has(n);
        const title =
          mode === "core"
            ? "always available (core) — set in Tools tab"
            : mode === "disabled"
              ? "globally disabled — set in Tools tab"
              : undefined;
        return (
          <button
            key={n}
            type="button"
            disabled={locked}
            title={title}
            className={"tick" + (on ? " on" : "") + (locked ? " locked" : "")}
            onClick={() => !locked && onToggle(n)}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

const LIMITS: { key: keyof AgentDef; label: string }[] = [
  { key: "max_iterations", label: "max iters" },
  { key: "max_repeat_calls", label: "repeat cap" },
  { key: "max_calls_per_tool", label: "per-tool cap" },
  { key: "max_stall_iterations", label: "stall cap" },
  { key: "max_subagent_depth", label: "subagent depth" },
  { key: "max_concurrent_subagents", label: "fan-out cap" },
];

/** The editable-fields form for one agent (default or specialist). `prompt`/SOUL is edited via the
 *  modal + saved directly (not in the draft); everything else is the draft saved by the parent row. */
function AgentFieldsForm(props: {
  draft: AgentDef;
  isDefault: boolean;
  soul: string;
  toolNames: string[];
  toolModes: Record<string, AgentMode>;
  skillNames: string[];
  defaultPrompt: string;
  onChange: (a: AgentDef) => void;
  onSaveSoul: (content: string) => void;
}) {
  const { draft: a, onChange } = props;
  const set = (p: Partial<AgentDef>) => onChange({ ...a, ...p });
  const setModel = (p: Partial<AgentDef["model"]>) =>
    onChange({ ...a, model: { ...a.model, ...p } });

  const toolsAll = a.tools === "*";
  const toolSet = new Set(toolsAll ? [] : (a.tools as string[]));
  const toggleTool = (n: string) => {
    const next = new Set(toolSet);
    next.has(n) ? next.delete(n) : next.add(n);
    set({ tools: [...next] });
  };

  // Skills mirror the Tools control above: an "all" switch, else a tick-grid (empty grid = no skills).
  // A two-state field over a two-value store ("*" | list) — no ambiguous third mode (was: All/None/
  // Custom, where an empty Custom collided with None so Custom could never be entered).
  const skillsAll = a.skills === "*";
  const skillSet = new Set(skillsAll ? [] : (a.skills as string[]));
  const toggleSkill = (n: string) => {
    const next = new Set(skillSet);
    next.has(n) ? next.delete(n) : next.add(n);
    set({ skills: [...next] });
  };

  const modeVal = (a.model.mode || "") as "" | "local" | "cloud";
  const label = a.title || a.name;

  // Where this agent's data lives — so it's unambiguous which file each field edits.
  const store = props.isDefault
    ? "config.yaml · agent.defaults + root SOUL.md"
    : `agents/${a.name}/ · agent.yaml + SOUL.md`;

  const editSoul = async () => {
    const next = await requestPrompt({
      title: `Persona (SOUL.md) — ${label}`,
      value: props.soul,
      defaultText: props.defaultPrompt,
      placeholder: "(empty → the built-in default agent prompt)",
    });
    if (next != null && next !== props.soul) props.onSaveSoul(next);
  };

  const editAppend = async () => {
    const next = await requestPrompt({
      title: `Prompt append (${props.isDefault ? "agent.defaults" : "agent.yaml"}) — ${label}`,
      value: a.prompt_append,
      placeholder: "extra instructions added after the persona",
    });
    if (next != null) set({ prompt_append: next });
  };

  return (
    <div className="mform">
      <div className="agent-store">{store}</div>

      <label>Display name</label>
      <input
        aria-label="Display name"
        value={a.title}
        placeholder={a.name}
        onChange={(e) => set({ title: e.target.value })}
      />

      {!props.isDefault && (
        <>
          <label>Description</label>
          <input
            aria-label="Description"
            value={a.description ?? ""}
            placeholder="when to pick me (matched by the auto-router)"
            onChange={(e) => set({ description: e.target.value })}
          />
        </>
      )}

      <label>Backend</label>
      <Seg<"" | "local" | "cloud">
        current={modeVal}
        onPick={(v) => setModel({ mode: v })}
        options={[
          { val: "", label: "Inherit" },
          { val: "local", label: "Local" },
          { val: "cloud", label: "Cloud" },
        ]}
      />
      <label>Model</label>
      <input
        aria-label="Model"
        value={a.model.model ?? ""}
        placeholder="(inherit endpoint model)"
        onChange={(e) => setModel({ model: e.target.value })}
      />

      <label>Privilege</label>
      <Seg<Privilege>
        current={a.privilege}
        onPick={(v) => set({ privilege: v })}
        options={PRIVILEGE_LEVELS}
      />

      <label>Persona · SOUL.md</label>
      <div className="kv-prompt">
        <div className="prompt-preview">
          {promptPreview(props.soul, "blank → built-in default prompt")}
        </div>
        <button type="button" className="prompt-open" onClick={editSoul}>
          Edit fullscreen ↗
        </button>
      </div>

      <label>Prompt append</label>
      <div className="kv-prompt">
        <div className="prompt-preview">
          {promptPreview(a.prompt_append, "blank → nothing appended")}
        </div>
        <button type="button" className="prompt-open" onClick={editAppend}>
          Edit fullscreen ↗
        </button>
      </div>

      <label>Inherit global append</label>
      <Seg<"yes" | "no">
        current={a.inherit_append ? "yes" : "no"}
        onPick={(v) => set({ inherit_append: v === "yes" })}
        options={[
          { val: "yes", label: "Inherit" },
          { val: "no", label: "Ignore" },
        ]}
      />

      <label>Tools</label>
      <div className="agent-allow">
        <div className="agent-allow-head">
          <span>{toolsAll ? "all agent tools" : `${toolSet.size} selected`}</span>
          <Switch
            on={toolsAll}
            onToggle={() => set({ tools: toolsAll ? [] : "*" })}
            label="All tools"
          />
        </div>
        {!toolsAll && (
          <TickGrid
            all={props.toolNames}
            selected={toolSet}
            onToggle={toggleTool}
            modes={props.toolModes}
          />
        )}
      </div>

      <label>Skills</label>
      <div className="agent-allow">
        <div className="agent-allow-head">
          <span>{skillsAll ? "all skills" : `${skillSet.size} selected`}</span>
          <Switch
            on={skillsAll}
            onToggle={() => set({ skills: skillsAll ? [] : "*" })}
            label="All skills"
          />
        </div>
        {!skillsAll && (
          <TickGrid all={props.skillNames} selected={skillSet} onToggle={toggleSkill} />
        )}
      </div>

      <label>Limits</label>
      <div className="agent-lim">
        {LIMITS.map((l) => {
          // eslint-disable-next-line @typescript-eslint/no-base-to-string -- limit fields are numeric; String() is safe (the rule can't narrow the indexed-access union)
          const shown = String(a[l.key] ?? "");
          return (
            <div className="agent-lim-cell" key={l.key}>
              <span>{l.label}</span>
              <input
                aria-label={l.label}
                inputMode="numeric"
                value={shown}
                onChange={(e) => set({ [l.key]: Number(e.target.value) || 0 })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One expandable agent row. Loads its def/persona when open, edits a field draft, and saves through
 *  the file API (specialist) or PUT /api/settings (default → agent.defaults/default_title). */
function AgentRow(props: {
  name: string;
  isDefault: boolean;
  isResolvedDefault: boolean;
  open: boolean;
  onToggle: () => void;
  toolNames: string[];
  toolModes: Record<string, AgentMode>;
  skillNames: string[];
  defaultPrompt: string;
}) {
  const { name, isDefault } = props;
  const qc = useQueryClient();
  const { data: detail, isLoading } = useAgent(props.open ? name : null);
  const saveAgent = useSaveAgent();
  const saveSettings = useSaveSettings();
  const saveSoul = useSaveAgentSoul();
  const delAgent = useDeleteAgent();
  const [draft, setDraft] = useState<AgentDef | null>(null);

  useEffect(() => {
    if (detail) setDraft(detail.agent);
  }, [detail]);

  const dirty = !!(
    detail &&
    draft &&
    JSON.stringify(pickFields(draft)) !== JSON.stringify(pickFields(detail.agent))
  );
  useRegisterDirty(`agent:${name}`, props.open && dirty);

  const onSave = () => {
    if (!draft || !dirty) return;
    const fields = pickFields(draft);
    if (isDefault) {
      const { title, ...defaults } = fields; // title → default_title; the rest → the inheritance base
      saveSettings.mutate(
        { agent: { default_title: title, defaults } },
        {
          onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ["agent", name] });
            void qc.invalidateQueries({ queryKey: ["agentlist"] });
          },
        },
      );
    } else {
      saveAgent.mutate({ name, agent: fields });
    }
  };

  const onRemove = async () => {
    const ok = await requestConfirm({
      title: `Remove agent ${draft?.title || name}?`,
      body: "Deletes its folder (agent.yaml, SOUL.md, memories).",
      confirmLabel: "remove",
      danger: true,
    });
    if (ok) delAgent.mutate(name, { onSuccess: props.onToggle });
  };

  const saving = saveAgent.isPending || saveSettings.isPending;
  const titleLabel = (draft?.title || detail?.agent.title || "").trim() || name;

  return (
    <div className={"mwrap" + (props.open ? " open" : "")}>
      {/* D25 — keyboard-operable disclosure (button-free header → role=button is safe). */}
      <div className="confrow" {...disclosureToggle(props.open, props.onToggle)}>
        <div className="k">
          <div className="label">
            {titleLabel}
            {titleLabel !== name ? <span className="agent-slug"> · {name}</span> : ""}
          </div>
          <div className="desc">
            {isDefault ? "default agent · workspace root" : `specialist · /agent ${name}`}
          </div>
        </div>
        {props.isResolvedDefault && <span className="badge">default</span>}
        <span className="chev" aria-hidden>
          ›
        </span>
      </div>
      <div className="mconf">
        {props.open &&
          (isLoading || !draft ? (
            <div className="agent-empty">loading…</div>
          ) : (
            <>
              <AgentFieldsForm
                draft={draft}
                isDefault={isDefault}
                soul={detail?.soul ?? ""}
                toolNames={props.toolNames}
                toolModes={props.toolModes}
                skillNames={props.skillNames}
                defaultPrompt={props.defaultPrompt}
                onChange={setDraft}
                onSaveSoul={(content) => saveSoul.mutate({ name, content })}
              />
              <div className="mfoot">
                {!isDefault && (
                  <button
                    type="button"
                    className="danger"
                    disabled={delAgent.isPending}
                    onClick={onRemove}
                  >
                    remove
                  </button>
                )}
                <button type="button" className="save" disabled={!dirty || saving} onClick={onSave}>
                  {saving ? "saving…" : dirty ? "save" : "saved"}
                </button>
              </div>
            </>
          ))}
      </div>
    </div>
  );
}

export function AgentsEditor(props: {
  cfg: AgentSectionCfg;
  toolNames: string[];
  toolModes: Record<string, AgentMode>;
  skillNames: string[];
}) {
  const { data: list } = useAgentList();
  const saveSettings = useSaveSettings();
  const saveAgent = useSaveAgent();
  const specialists = list?.agents ?? [];
  const resolvedDefault = list?.default ?? DEFAULT_AGENT;

  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [cfg, setCfg] = useState<AgentSectionCfg>(props.cfg);
  const { data: defaultPrompt = "" } = useDefaultPrompt();

  useEffect(() => setCfg(props.cfg), [props.cfg]);

  // Auto-router controls (7e-g) save immediately (mirrors the SkillsEditor master switch), so they
  // read straight off the server doc (props.cfg) rather than the savebar draft. The min-overlap
  // input keeps a local draft and commits on blur to avoid a save per keystroke.
  const [minOverlap, setMinOverlap] = useState(String(props.cfg.auto_rotate_min_overlap));
  useEffect(
    () => setMinOverlap(String(props.cfg.auto_rotate_min_overlap)),
    [props.cfg.auto_rotate_min_overlap],
  );
  const commitMinOverlap = () => {
    const n = Math.max(1, Number(minOverlap) || 1);
    if (n !== props.cfg.auto_rotate_min_overlap)
      saveSettings.mutate({ agent: { auto_rotate_min_overlap: n } });
    else setMinOverlap(String(props.cfg.auto_rotate_min_overlap)); // normalize a junk entry back
  };

  // Globals (default-agent picker + subagent limits) — config.yaml, saved via PUT /api/settings.
  // `default_title` is edited inside the default agent's row, so it's excluded from this draft.
  const globalsDirty =
    cfg.default_agent !== props.cfg.default_agent ||
    cfg.global_subagent_limit !== props.cfg.global_subagent_limit ||
    cfg.subagent_clamp_privilege !== props.cfg.subagent_clamp_privilege ||
    cfg.streaming !== props.cfg.streaming;
  useRegisterDirty("agents-globals", globalsDirty);

  const toggle = (name: string) => setOpen((o) => (o === name ? null : name));

  const commitNew = () => {
    const slug = newSlug.trim().toLowerCase();
    if (!SLUG.test(slug)) return pushToast("slug: lowercase letters, digits, - or _", "err");
    if (slug === DEFAULT_AGENT || specialists.includes(slug))
      return pushToast("an agent with that slug exists", "err");
    saveAgent.mutate(
      { name: slug, agent: { title: newTitle.trim() } },
      {
        onSuccess: () => {
          setNewSlug("");
          setNewTitle("");
          setAdding(false);
          setOpen(slug);
        },
      },
    );
  };

  const saveGlobals = () => {
    if (!globalsDirty) return;
    saveSettings.mutate({
      agent: {
        default_agent: cfg.default_agent,
        global_subagent_limit: cfg.global_subagent_limit,
        subagent_clamp_privilege: cfg.subagent_clamp_privilege,
        streaming: cfg.streaming,
      },
    });
  };

  const defaultOpts = [
    { val: "", label: "default (root)" },
    ...specialists.map((s) => ({ val: s, label: s })),
  ];

  return (
    <div className="conf-card">
      <div className="confrow">
        <div className="k">
          <div className="label">Auto-route to specialists</div>
          <div className="desc">
            when no /agent is pinned, pick the best-matching specialist per turn
          </div>
        </div>
        <Switch
          on={props.cfg.auto_rotate}
          label="Auto-route to specialists"
          onToggle={() => saveSettings.mutate({ agent: { auto_rotate: !props.cfg.auto_rotate } })}
        />
      </div>
      {/* The threshold is only meaningful while auto-route is on — show it as its own labelled sub-row
          (like Memory's State-cap), not crammed next to the toggle, so the numeric field aligns with the
          other right-edge inputs. */}
      {props.cfg.auto_rotate && (
        <div className="confrow">
          <div className="k">
            <div className="label">Min matching words</div>
            <div className="desc">
              query words a specialist must match before a turn routes to it
            </div>
          </div>
          <input
            className="lim-input"
            inputMode="numeric"
            aria-label="min matching words to route"
            value={minOverlap}
            onChange={(e) => setMinOverlap(e.target.value)}
            onBlur={commitMinOverlap}
          />
        </div>
      )}

      <AgentRow
        name={DEFAULT_AGENT}
        isDefault
        isResolvedDefault={resolvedDefault === DEFAULT_AGENT}
        open={open === DEFAULT_AGENT}
        onToggle={() => toggle(DEFAULT_AGENT)}
        toolNames={props.toolNames}
        toolModes={props.toolModes}
        skillNames={props.skillNames}
        defaultPrompt={defaultPrompt}
      />

      {specialists.map((s) => (
        <AgentRow
          key={s}
          name={s}
          isDefault={false}
          isResolvedDefault={resolvedDefault === s}
          open={open === s}
          onToggle={() => toggle(s)}
          toolNames={props.toolNames}
          toolModes={props.toolModes}
          skillNames={props.skillNames}
          defaultPrompt={defaultPrompt}
        />
      ))}

      <div className={"mwrap add" + (adding ? " open" : "")}>
        <div
          className="confrow"
          {...disclosureToggle(adding, () => {
            setAdding(!adding);
            setOpen(null);
          })}
        >
          <div className="k">
            <div className="label">add agent</div>
            <div className="desc">scaffolds agents/&lt;slug&gt;/ (agent.yaml + SOUL.md)</div>
          </div>
          <span className="chev" aria-hidden>
            ›
          </span>
        </div>
        <div className="mconf">
          {adding && (
            <>
              <div className="mform">
                <label>Slug</label>
                <input
                  aria-label="Slug"
                  value={newSlug}
                  placeholder="coder"
                  onChange={(e) => setNewSlug(e.target.value)}
                />
                <label>Display name</label>
                <input
                  aria-label="Display name"
                  value={newTitle}
                  placeholder="(optional, e.g. Bob the Coder)"
                  onChange={(e) => setNewTitle(e.target.value)}
                />
              </div>
              {/* .mfoot outside the .mform grid — the canonical double-button footer (matches the edit
                  form + MachineEditor); inside the grid it gets squeezed into the 90px label column. */}
              <div className="mfoot">
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setNewSlug("");
                    setNewTitle("");
                  }}
                >
                  cancel
                </button>
                <button
                  type="button"
                  className="save"
                  disabled={saveAgent.isPending}
                  onClick={commitNew}
                >
                  {saveAgent.isPending ? "creating…" : "create"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="confrow" style={{ marginTop: 6 }}>
        <div className="k">
          <div className="label">Default agent</div>
          <div className="desc">which agent new threads use · /agent switches per session</div>
        </div>
        <Seg<string>
          current={cfg.default_agent}
          onPick={(v) => setCfg({ ...cfg, default_agent: v })}
          options={defaultOpts}
        />
      </div>
      <div className="confrow">
        <div className="k">
          <div className="label">Subagent fan-out limit</div>
          <div className="desc">process-wide cap on concurrent subagents (whole tree)</div>
        </div>
        <input
          className="lim-input"
          inputMode="numeric"
          aria-label="Subagent fan-out limit"
          value={String(cfg.global_subagent_limit)}
          onChange={(e) => setCfg({ ...cfg, global_subagent_limit: Number(e.target.value) || 0 })}
        />
      </div>
      <div className="confrow">
        <div className="k">
          <div className="label">Clamp subagent privilege</div>
          <div className="desc">a subagent can never exceed its parent's privilege</div>
        </div>
        <Switch
          on={cfg.subagent_clamp_privilege}
          label="Clamp subagent privilege"
          onToggle={() =>
            setCfg({ ...cfg, subagent_clamp_privilege: !cfg.subagent_clamp_privilege })
          }
        />
      </div>
      <div className="confrow">
        <div className="k">
          <div className="label">Chat delivery</div>
          <div className="desc">
            auto = client decides · on = always stream · off = buffer whole reply (flaky link)
          </div>
        </div>
        <Seg<"auto" | "on" | "off">
          current={cfg.streaming}
          onPick={(v) => setCfg({ ...cfg, streaming: v })}
          options={[
            { val: "auto", label: "Auto" },
            { val: "on", label: "Stream" },
            { val: "off", label: "Buffer" },
          ]}
        />
      </div>

      <div className="conf-savebar">
        <button
          className="conf-save"
          disabled={!globalsDirty || saveSettings.isPending}
          onClick={saveGlobals}
        >
          {saveSettings.isPending ? "Saving…" : globalsDirty ? "Save agent settings" : "Saved"}
        </button>
      </div>
    </div>
  );
}
