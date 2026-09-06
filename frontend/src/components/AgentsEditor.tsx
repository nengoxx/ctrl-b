import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useProviders, useSaveSettings } from "../hooks/useSettings";
import {
  DEFAULT_AGENT,
  pickFields,
  useAgent,
  useDeleteAgent,
  useSaveAgent,
  useSaveAgentSoul,
  type AgentDef,
  type Privilege,
  type ReasoningEffort,
} from "../hooks/useAgents";
import { ProviderModelPicker, type PickerCatalog } from "./ProviderModelPicker";
import { Seg } from "./Seg";
import { Switch } from "./Switch";
import { disclosureToggle } from "../lib/disclosure";
import { numOrNull } from "../lib/num";
import { PRIVILEGE_LEVELS } from "../lib/privilege";
import { promptPreview } from "../lib/promptPreview";
import type { AgentMode } from "../types";
import { requestConfirm } from "../store/confirm";
import { useRegisterDirty } from "../store/dirty";
import { requestPrompt } from "../store/prompt";
import { pushToast } from "../store/toast";

// Phase 7e-c (D14). Agents are folder-only. This is the unified per-agent editor: the default/root
// agent's fields ↔ config.yaml `agent.defaults`, its title ↔ `agent.default_title`, its persona ↔ the
// root SOUL.md; each specialist is backed by its own `agents/<slug>/` (agent.yaml + SOUL.md). Field
// edits are a per-row draft saved through the file API (specialist) or PUT /api/settings (default);
// the SOUL.md persona saves directly (file-backed, D14 7e-b Q2). Reuses the vapor .mwrap/.mform
// recipe (D7); the tick grids + limits grid are net-new in extras.css.
//
// D70 §8.4 — the SECTION these rows render in moved. The per-agent list and the add disclosure are
// the agents GALLERY's now (`tabs/AgentsTab`) — one home for every agent regardless of kind — while
// the `agent.*` globals kept their Conf home (`components/AgentGlobals`). Nothing about a row changed
// with the move: what was this file's own list body is the two exported pieces the gallery composes.

const SLUG = /^[a-z0-9][a-z0-9_-]*$/;

// Garbage-safe numeric coercion (D42 post-build audit) lives in one place — `../lib/num` (shared with
// ConfTab's context-window coercion). `numOrNull` = the nullable `ge=1` budget fields.

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

  // A11/D48 C7-b — the backend is the shared provider→model picker fed by GET /api/providers, replacing
  // the hardwired local/cloud Seg + free-text model. Inherit (blank provider) + raw-id escape kept.
  const { data: providersInfo } = useProviders();
  const catalog: PickerCatalog = Object.fromEntries(
    Object.entries(providersInfo?.providers ?? {}).map(([n, p]) => [n, { models: p.models }]),
  );

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
      <ProviderModelPicker
        label="Backend"
        value={{ provider: a.model.provider ?? null, model: a.model.model ?? null }}
        onChange={(v) => setModel({ provider: v.provider, model: v.model })}
        catalog={catalog}
        allowInherit
        inheritLabel="— default —"
        allowRawId
      />

      {/* D42 (A10) — per-agent call config on the ModelRef. Blank numeric → null (inherit); the
          Reasoning-effort Seg follows the Backend Seg's "" = Inherit convention, mapped to null. */}
      <label>Max output tokens</label>
      <input
        aria-label="Max output tokens"
        inputMode="numeric"
        value={a.model.max_tokens == null ? "" : String(a.model.max_tokens)}
        placeholder="(inherit — uncapped)"
        onChange={(e) => setModel({ max_tokens: numOrNull(e.target.value) })}
      />

      <label>Reasoning effort</label>
      {/* A <select>, not a Seg (owner, 2026-07-21): the 8-rung ladder wraps a capsule Seg into a
          multi-row blob at phone width. Same "" = Inherit convention, mapped to null (the
          MachineEditor OS select precedent). */}
      <select
        aria-label="Reasoning effort"
        value={a.model.reasoning_effort ?? ""}
        onChange={(e) =>
          setModel({
            reasoning_effort: e.target.value === "" ? null : (e.target.value as ReasoningEffort),
          })
        }
      >
        <option value="">inherit</option>
        <option value="off">off</option>
        <option value="minimal">minimal</option>
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
        <option value="xhigh">xhigh</option>
        <option value="max">max</option>
      </select>

      <label>Reasoning tokens</label>
      <input
        aria-label="Reasoning tokens"
        title="Overrides the level above on endpoints that accept a token budget (llama.cpp, OpenRouter) — EXCEPT when the level is Off, which always wins and means no reasoning at all. Effort-only endpoints (OpenAI) ignore this and use the level above. An agent can hit both across turns, so leave blank to let the level decide."
        inputMode="numeric"
        value={a.model.reasoning_tokens == null ? "" : String(a.model.reasoning_tokens)}
        placeholder="(inherit — the level above decides)"
        onChange={(e) => setModel({ reasoning_tokens: numOrNull(e.target.value) })}
      />

      <label>Privilege</label>
      <Seg<Privilege>
        label="Privilege"
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
        label="Inherit global append"
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
 *  the file API (specialist) or PUT /api/settings (default → agent.defaults/default_title).
 *
 *  Exported since D70 §8.4: the gallery opens exactly this row for the card the owner tapped, so the
 *  detail view IS the row everyone has been editing — one form, not a second one that would have to
 *  be kept in step with it. */
export function AgentRow(props: {
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

  // Same value-guard idiom as the globals draft below: seed from the fetched def only when its VALUE
  // actually changed. Unguarded, this reset the row's unsaved edits on any new `detail` object — it
  // survived only because TanStack's structural sharing usually hands back the same reference, which
  // is a property of the cache, not a guarantee this component should lean on (v1.3.1).
  const seededDetailRef = useRef<string | null>(null);
  useEffect(() => {
    if (!detail) return;
    const next = JSON.stringify(detail.agent);
    if (next === seededDetailRef.current) return;
    seededDetailRef.current = next;
    setDraft(detail.agent);
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
/** The "add agent" disclosure — the gallery header's New affordance (D70 §8.4). Unchanged from the
 *  row it was inside the old list body: a slug + optional display name, scaffolded through the same
 *  `PUT /api/agents/{name}` every save uses, and the caller is told which slug landed so it can open
 *  the new agent straight away. */
export function NewAgentRow(props: {
  taken: readonly string[];
  onCreated: (slug: string) => void;
}) {
  const saveAgent = useSaveAgent();
  const [adding, setAdding] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newTitle, setNewTitle] = useState("");

  const commitNew = () => {
    const slug = newSlug.trim().toLowerCase();
    if (!SLUG.test(slug)) return pushToast("slug: lowercase letters, digits, - or _", "err");
    if (slug === DEFAULT_AGENT || props.taken.includes(slug))
      return pushToast("an agent with that slug exists", "err");
    saveAgent.mutate(
      { name: slug, agent: { title: newTitle.trim() } },
      {
        onSuccess: () => {
          setNewSlug("");
          setNewTitle("");
          setAdding(false);
          props.onCreated(slug);
        },
      },
    );
  };

  return (
    <div className={"mwrap add" + (adding ? " open" : "")}>
      <div className="confrow" {...disclosureToggle(adding, () => setAdding(!adding))}>
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
  );
}
