import { useEffect, useState } from "react";

import {
  blankAgent,
  useSaveAgents,
  type AgentDef,
  type AgentSectionCfg,
  type Privilege,
} from "../hooks/useAgents";
import { useDefaultPrompt } from "../hooks/useDefaultPrompt";
import { promptPreview } from "../lib/promptPreview";
import { requestConfirm } from "../store/confirm";
import { useRegisterDirty } from "../store/dirty";
import { requestPrompt } from "../store/prompt";
import { pushToast } from "../store/toast";

// Phase 7d-b — Agents management. Manage Settings.agents[] (the D11 agent definitions) + the
// agent-section scalars (default agent, subagent limits) as one group-level draft saved through
// PUT /api/settings. Reuses the vapor .mwrap/.mform/.mfoot machine-row recipe (CSS in vapor.css,
// D7); the tool/skill tick grids + the limits grid are net-new in extras.css.

const PRIVS: { val: Privilege; label: string }[] = [
  { val: "readonly", label: "Read" },
  { val: "confirm", label: "Confirm" },
  { val: "auto_low", label: "Auto-low" },
  { val: "full", label: "Full" },
];

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

/** A grid of toggleable name chips (tools / skills allowlist). */
function TickGrid({ all, selected, onToggle }: { all: string[]; selected: Set<string>; onToggle: (n: string) => void }) {
  if (!all.length) return <div className="agent-empty">none discovered</div>;
  return (
    <div className="tick-grid">
      {all.map((n) => (
        <button
          key={n}
          type="button"
          className={"tick" + (selected.has(n) ? " on" : "")}
          onClick={() => onToggle(n)}
        >
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

function AgentForm(props: {
  agent: AgentDef;
  isNew: boolean;
  toolNames: string[];
  skillNames: string[];
  onChange: (a: AgentDef) => void;
  onRemove?: () => void;
}) {
  const { agent: a, onChange } = props;
  const set = (p: Partial<AgentDef>) => onChange({ ...a, ...p });
  const setModel = (p: Partial<AgentDef["model"]>) => onChange({ ...a, model: { ...a.model, ...p } });
  const { data: defaultPrompt = "" } = useDefaultPrompt();

  const toolsAll = a.tools === "*";
  const toolSet = new Set(toolsAll ? [] : (a.tools as string[]));
  const toggleTool = (n: string) => {
    const next = new Set(toolSet);
    next.has(n) ? next.delete(n) : next.add(n);
    set({ tools: [...next] });
  };

  const skillMode = a.skills === "*" ? "all" : (a.skills as string[]).length === 0 ? "none" : "custom";
  const skillSet = new Set(skillMode === "custom" ? (a.skills as string[]) : []);
  const toggleSkill = (n: string) => {
    const next = new Set(skillSet);
    next.has(n) ? next.delete(n) : next.add(n);
    set({ skills: [...next] });
  };

  const modeVal = (a.model.mode || "") as "" | "local" | "cloud";

  return (
    <div className="mform">
      <label>Name</label>
      <input value={a.name} placeholder="local" disabled={!props.isNew} onChange={(e) => set({ name: e.target.value })} />

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

      <label>Prompt</label>
      <div className="kv-prompt">
        <div className="prompt-preview">{promptPreview(a.prompt, "blank → built-in default agent prompt")}</div>
        <button
          type="button"
          className="prompt-open"
          onClick={async () => {
            const next = await requestPrompt({
              title: `Agent prompt: ${a.name || "new"}`,
              value: a.prompt,
              defaultText: defaultPrompt,
              placeholder: "(empty → the built-in default agent prompt)",
            });
            if (next != null) set({ prompt: next });
          }}
        >
          Edit fullscreen ↗
        </button>
      </div>

      <label>Append</label>
      <div className="kv-prompt">
        <div className="prompt-preview">{promptPreview(a.prompt_append, "blank → nothing appended")}</div>
        <button
          type="button"
          className="prompt-open"
          onClick={async () => {
            const next = await requestPrompt({
              title: `Agent prompt append: ${a.name || "new"}`,
              value: a.prompt_append,
              placeholder: "extra instructions for this agent",
            });
            if (next != null) set({ prompt_append: next });
          }}
        >
          Edit fullscreen ↗
        </button>
      </div>

      <label>Inherit append</label>
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
        <Seg<"all" | "none" | "custom">
          current={skillMode}
          onPick={(v) => set({ skills: v === "all" ? "*" : v === "none" ? [] : (a.skills === "*" ? [] : a.skills) })}
          options={[
            { val: "all", label: "All" },
            { val: "none", label: "None" },
            { val: "custom", label: "Custom" },
          ]}
        />
        {skillMode === "custom" && <TickGrid all={props.skillNames} selected={skillSet} onToggle={toggleSkill} />}
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

      {!props.isNew && (
        <div className="mfoot">
          <button type="button" className="danger" onClick={props.onRemove}>remove</button>
        </div>
      )}
    </div>
  );
}

export function AgentsEditor(props: {
  agents: AgentDef[];
  cfg: AgentSectionCfg;
  toolNames: string[];
  skillNames: string[];
}) {
  const save = useSaveAgents();
  const [agents, setAgents] = useState<AgentDef[]>(props.agents);
  const [cfg, setCfg] = useState<AgentSectionCfg>(props.cfg);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [newAgent, setNewAgent] = useState<AgentDef>(blankAgent());

  // Reseed from the server doc (initial load + after a save replaces the cache).
  useEffect(() => setAgents(props.agents), [props.agents]);
  useEffect(() => setCfg(props.cfg), [props.cfg]);

  const dirty =
    JSON.stringify(agents) !== JSON.stringify(props.agents) ||
    JSON.stringify(cfg) !== JSON.stringify(props.cfg);
  // F19 — beforeunload guard (store/dirty.ts). Auto-cleared on unmount.
  useRegisterDirty("agents", dirty);

  const editAt = (i: number, a: AgentDef) => setAgents(agents.map((x, j) => (j === i ? a : x)));
  const removeAt = async (i: number) => {
    const ok = await requestConfirm({ title: `Remove agent ${agents[i].name}?`, confirmLabel: "remove", danger: true });
    if (!ok) return;
    setAgents(agents.filter((_, j) => j !== i));
    setOpenIdx(null);
  };
  const commitNew = () => {
    const name = newAgent.name.trim();
    if (!name) return pushToast("agent needs a name", "err");
    if (agents.some((a) => a.name === name)) return pushToast("an agent with that name exists", "err");
    setAgents([...agents, { ...newAgent, name }]);
    setNewAgent(blankAgent());
    setAdding(false);
  };

  const onSave = () => {
    if (!dirty) return;
    save.mutate({ agents, agent: cfg });
  };

  const defaultOpts = [
    { val: "", label: "Built-in" },
    ...agents.map((a) => ({ val: a.name, label: a.name })),
  ];

  return (
    <div className="conf-card">
      <div className="confrow">
        <div className="k">
          <div className="label">Default agent</div>
          <div className="desc">which definition new threads use · /agent switches per session</div>
        </div>
        <Seg<string> current={cfg.default_agent} onPick={(v) => setCfg({ ...cfg, default_agent: v })} options={defaultOpts} />
      </div>

      {agents.map((a, i) => (
        <div className={"mwrap" + (openIdx === i ? " open" : "")} key={`${a.name}-${i}`}>
          <div className="confrow" onClick={() => { setOpenIdx(openIdx === i ? null : i); setAdding(false); }}>
            <div className="k">
              <div className="label">{a.name}{cfg.default_agent === a.name ? " · default" : ""}</div>
              <div className="desc">
                {a.model.mode || "inherit"}
                {a.model.model ? ` · ${a.model.model}` : ""} · {a.privilege}
              </div>
            </div>
            <span className="badge">{a.tools === "*" ? "all tools" : `${(a.tools as string[]).length} tools`}</span>
            <span className="chev" aria-hidden>›</span>
          </div>
          <div className="mconf">
            {openIdx === i && (
              <AgentForm
                agent={a}
                isNew={false}
                toolNames={props.toolNames}
                skillNames={props.skillNames}
                onChange={(na) => editAt(i, na)}
                onRemove={() => removeAt(i)}
              />
            )}
          </div>
        </div>
      ))}

      <div className={"mwrap add" + (adding ? " open" : "")}>
        <div className="confrow" onClick={() => { setAdding(!adding); setOpenIdx(null); }}>
          <div className="k">
            <div className="label">add agent</div>
            <div className="desc">a new definition (saved with the group below)</div>
          </div>
          <span className="chev" aria-hidden>›</span>
        </div>
        <div className="mconf">
          {adding && (
            <>
              <AgentForm agent={newAgent} isNew toolNames={props.toolNames} skillNames={props.skillNames} onChange={setNewAgent} />
              <div className="mfoot">
                <button type="button" onClick={() => { setAdding(false); setNewAgent(blankAgent()); }}>cancel</button>
                <button type="button" className="save" onClick={commitNew}>add to list</button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="confrow" style={{ marginTop: 6 }}>
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
        <button className="conf-save" disabled={!dirty || save.isPending} onClick={onSave}>
          {save.isPending ? "Saving…" : dirty ? "Save agents" : "Saved"}
        </button>
      </div>
    </div>
  );
}
