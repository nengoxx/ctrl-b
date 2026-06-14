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
import { promptPreview } from "../lib/promptPreview";
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

const PRIVS: { val: Privilege; label: string }[] = [
  { val: "readonly", label: "Read" },
  { val: "confirm", label: "Confirm" },
  { val: "auto_low", label: "Auto-low" },
  { val: "full", label: "Full" },
];

const SLUG = /^[a-z0-9][a-z0-9_-]*$/;

function Seg<T extends string>(props: { current: T; onPick: (v: T) => void; options: { val: T; label: string }[] }) {
  return (
    <div className="seg">
      {props.options.map((o) => (
        <button key={o.val} className={o.val === props.current ? "active" : ""} onClick={() => props.onPick(o.val)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div className={"switch" + (on ? " on" : "")} onClick={onToggle}>
      <div className="knob" />
    </div>
  );
}

function TickGrid({ all, selected, onToggle }: { all: string[]; selected: Set<string>; onToggle: (n: string) => void }) {
  if (!all.length) return <div className="agent-empty">none discovered</div>;
  return (
    <div className="tick-grid">
      {all.map((n) => (
        <button key={n} type="button" className={"tick" + (selected.has(n) ? " on" : "")} onClick={() => onToggle(n)}>
          {n}
        </button>
      ))}
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
  skillNames: string[];
  defaultPrompt: string;
  onChange: (a: AgentDef) => void;
  onSaveSoul: (content: string) => void;
}) {
  const { draft: a, onChange } = props;
  const set = (p: Partial<AgentDef>) => onChange({ ...a, ...p });
  const setModel = (p: Partial<AgentDef["model"]>) => onChange({ ...a, model: { ...a.model, ...p } });

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
      <input value={a.title} placeholder={a.name} onChange={(e) => set({ title: e.target.value })} />

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
      <input value={a.model.model ?? ""} placeholder="(inherit endpoint model)" onChange={(e) => setModel({ model: e.target.value })} />

      <label>Privilege</label>
      <Seg<Privilege> current={a.privilege} onPick={(v) => set({ privilege: v })} options={PRIVS} />

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
        <div className="prompt-preview">{promptPreview(a.prompt_append, "blank → nothing appended")}</div>
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
          <Switch on={toolsAll} onToggle={() => set({ tools: toolsAll ? [] : "*" })} />
        </div>
        {!toolsAll && <TickGrid all={props.toolNames} selected={toolSet} onToggle={toggleTool} />}
      </div>

      <label>Skills</label>
      <div className="agent-allow">
        <div className="agent-allow-head">
          <span>{skillsAll ? "all skills" : `${skillSet.size} selected`}</span>
          <Switch on={skillsAll} onToggle={() => set({ skills: skillsAll ? [] : "*" })} />
        </div>
        {!skillsAll && <TickGrid all={props.skillNames} selected={skillSet} onToggle={toggleSkill} />}
      </div>

      <label>Limits</label>
      <div className="agent-lim">
        {LIMITS.map((l) => (
          <div className="agent-lim-cell" key={l.key as string}>
            <span>{l.label}</span>
            <input
              inputMode="numeric"
              value={String(a[l.key] ?? "")}
              onChange={(e) => set({ [l.key]: Number(e.target.value) || 0 } as Partial<AgentDef>)}
            />
          </div>
        ))}
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

  const dirty = !!(detail && draft && JSON.stringify(pickFields(draft)) !== JSON.stringify(pickFields(detail.agent)));
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
            qc.invalidateQueries({ queryKey: ["agent", name] });
            qc.invalidateQueries({ queryKey: ["agentlist"] });
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
      <div className="confrow" onClick={props.onToggle}>
        <div className="k">
          <div className="label">
            {titleLabel}
            {titleLabel !== name ? <span className="agent-slug"> · {name}</span> : ""}
          </div>
          <div className="desc">{isDefault ? "default agent · workspace root" : `specialist · /agent ${name}`}</div>
        </div>
        {props.isResolvedDefault && <span className="badge">default</span>}
        <span className="chev" aria-hidden>›</span>
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
                skillNames={props.skillNames}
                defaultPrompt={props.defaultPrompt}
                onChange={setDraft}
                onSaveSoul={(content) => saveSoul.mutate({ name, content })}
              />
              <div className="mfoot">
                {!isDefault && (
                  <button type="button" className="danger" disabled={delAgent.isPending} onClick={onRemove}>
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

export function AgentsEditor(props: { cfg: AgentSectionCfg; toolNames: string[]; skillNames: string[] }) {
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

  // Globals (default-agent picker + subagent limits) — config.yaml, saved via PUT /api/settings.
  // `default_title` is edited inside the default agent's row, so it's excluded from this draft.
  const globalsDirty =
    cfg.default_agent !== props.cfg.default_agent ||
    cfg.global_subagent_limit !== props.cfg.global_subagent_limit ||
    cfg.subagent_clamp_privilege !== props.cfg.subagent_clamp_privilege;
  useRegisterDirty("agents-globals", globalsDirty);

  const toggle = (name: string) => setOpen((o) => (o === name ? null : name));

  const commitNew = () => {
    const slug = newSlug.trim().toLowerCase();
    if (!SLUG.test(slug)) return pushToast("slug: lowercase letters, digits, - or _", "err");
    if (slug === DEFAULT_AGENT || specialists.includes(slug)) return pushToast("an agent with that slug exists", "err");
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
      },
    });
  };

  const defaultOpts = [
    { val: "", label: "default (root)" },
    ...specialists.map((s) => ({ val: s, label: s })),
  ];

  return (
    <div className="conf-card">
      <AgentRow
        name={DEFAULT_AGENT}
        isDefault
        isResolvedDefault={resolvedDefault === DEFAULT_AGENT}
        open={open === DEFAULT_AGENT}
        onToggle={() => toggle(DEFAULT_AGENT)}
        toolNames={props.toolNames}
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
          skillNames={props.skillNames}
          defaultPrompt={defaultPrompt}
        />
      ))}

      <div className={"mwrap add" + (adding ? " open" : "")}>
        <div className="confrow" onClick={() => { setAdding(!adding); setOpen(null); }}>
          <div className="k">
            <div className="label">add agent</div>
            <div className="desc">scaffolds agents/&lt;slug&gt;/ (agent.yaml + SOUL.md)</div>
          </div>
          <span className="chev" aria-hidden>›</span>
        </div>
        <div className="mconf">
          {adding && (
            <div className="mform">
              <label>Slug</label>
              <input value={newSlug} placeholder="coder" onChange={(e) => setNewSlug(e.target.value)} />
              <label>Display name</label>
              <input value={newTitle} placeholder="(optional, e.g. Bob the Coder)" onChange={(e) => setNewTitle(e.target.value)} />
              <div className="mfoot">
                <button type="button" onClick={() => { setAdding(false); setNewSlug(""); setNewTitle(""); }}>cancel</button>
                <button type="button" className="save" disabled={saveAgent.isPending} onClick={commitNew}>
                  {saveAgent.isPending ? "creating…" : "create"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="confrow" style={{ marginTop: 6 }}>
        <div className="k">
          <div className="label">Default agent</div>
          <div className="desc">which agent new threads use · /agent switches per session</div>
        </div>
        <Seg<string> current={cfg.default_agent} onPick={(v) => setCfg({ ...cfg, default_agent: v })} options={defaultOpts} />
      </div>
      <div className="confrow">
        <div className="k">
          <div className="label">Subagent fan-out limit</div>
          <div className="desc">process-wide cap on concurrent subagents (whole tree)</div>
        </div>
        <input
          className="lim-input"
          inputMode="numeric"
          value={String(cfg.global_subagent_limit)}
          onChange={(e) => setCfg({ ...cfg, global_subagent_limit: Number(e.target.value) || 0 })}
        />
      </div>
      <div className="confrow">
        <div className="k">
          <div className="label">Clamp subagent privilege</div>
          <div className="desc">a subagent can never exceed its parent's privilege</div>
        </div>
        <Switch on={cfg.subagent_clamp_privilege} onToggle={() => setCfg({ ...cfg, subagent_clamp_privilege: !cfg.subagent_clamp_privilege })} />
      </div>

      <div className="conf-savebar">
        <button className="conf-save" disabled={!globalsDirty || saveSettings.isPending} onClick={saveGlobals}>
          {saveSettings.isPending ? "Saving…" : globalsDirty ? "Save agent settings" : "Saved"}
        </button>
      </div>
    </div>
  );
}
