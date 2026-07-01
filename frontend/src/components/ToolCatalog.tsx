import { useState } from "react";

import { ModeSeg } from "./ModeSeg";
import { agentModeOf, useActionSpecs } from "../hooks/useActions";
import { useSaveToolOverrides } from "../hooks/useToolOverrides";
import { requestPrompt } from "../store/prompt";
import type { ActionSpec, AgentMode } from "../types";

// Tools tab · Section B — the agent-tool catalog (Phase 8b, D22). Manages *every* agent tool with a
// per-tool description override + a tri-state agent-access mode (core / enabled / disabled), written
// to the unified `tool_overrides` map via PUT /api/settings.
//
// The catalog's *current* state is reconstructed entirely from the actions DTO (GET /api/actions):
// the live `(agent_exposed, core)` pair gives the effective mode (same mapping as the backend's
// `agent_mode_of`), `default_agent_mode` gives the compile-time default (so a user-disabled tool
// still shows and stores only the deviation), and `description` is the effective model-facing text.
// Pending edits live in a local draft; a save PUTs only the changed axis per tool (deep_merge keeps
// the untouched one) and invalidates ["actions"] so the registry's live overlay re-renders. No
// settings query is needed here (it's Conf-scoped and wouldn't fetch on the Tools tab anyway).
//
// vapor.css untouched (D7) — the rows reuse vapor's `.seg` segmented control + tokens; the catalog
// shell/badges are net-new in extras.css.

const RISK_ORDER = ["high", "med", "low"];
const CAT_ORDER = ["action", "builtin", "utility", "mcp"];
const CAT_LABEL: Record<string, string> = {
  action: "fleet & service actions",
  builtin: "agent builtins",
  utility: "utilities",
  mcp: "mcp & openapi tools",
};

/** A pending per-tool edit: `mode` is the chosen tri-state; `desc` is the override text ("" clears,
 *  undefined = untouched). Saved as a partial `tool_overrides` entry. */
interface Edit {
  mode?: AgentMode;
  desc?: string;
}

/** Tools the catalog governs — the **agent-only** set (D22): every agent tool *except* the Section-A
 *  run cards (utility + ui_exposed), which are user+agent and managed on their own card above. A tool
 *  whose compile-time default is `disabled` (agent_exposed=False at registration, e.g. USER-only host
 *  actions) is intentionally not an agent tool and stays out too. Filtering on the default (not the
 *  live state) keeps a user-disabled tool visible so it can be re-enabled. Grouped by category,
 *  risk-sorted. */
function groupTools(specs: ActionSpec[]): [string, ActionSpec[]][] {
  const governed = specs.filter(
    (s) =>
      (s.default_agent_mode ?? agentModeOf(s)) !== "disabled" &&
      !(s.category === "utility" && s.ui_exposed), // those are the Section-A run cards
  );
  const byCat = new Map<string, ActionSpec[]>();
  for (const s of governed) {
    const list = byCat.get(s.category) ?? [];
    list.push(s);
    byCat.set(s.category, list);
  }
  // Surface the tools that warrant attention first: severity (high → med → low), then confirm-gated,
  // then core (always-on) tools, then name. The confirm + core tiebreakers keep a low-severity core
  // tool grouped at the TOP of the low band instead of scattered alphabetically and lost (owner ask).
  const coreFirst = (s: ActionSpec) => (agentModeOf(s) === "core" ? 0 : 1);
  for (const list of byCat.values()) {
    list.sort(
      (a, b) =>
        RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk) ||
        Number(b.confirm) - Number(a.confirm) ||
        coreFirst(a) - coreFirst(b) ||
        a.name.localeCompare(b.name),
    );
  }
  return [...byCat.entries()].sort(
    (a, b) => (CAT_ORDER.indexOf(a[0]) + 1 || 99) - (CAT_ORDER.indexOf(b[0]) + 1 || 99),
  );
}

export function ToolCatalog() {
  const { data: specs = [] } = useActionSpecs();
  const save = useSaveToolOverrides();
  const [draft, setDraft] = useState<Record<string, Edit>>({});

  const modeOf = (s: ActionSpec): AgentMode => draft[s.name]?.mode ?? agentModeOf(s);
  const descOf = (s: ActionSpec): string =>
    draft[s.name]?.desc !== undefined ? draft[s.name].desc! : s.description;

  const setEdit = (name: string, patch: Edit) =>
    setDraft((d) => ({ ...d, [name]: { ...d[name], ...patch } }));

  const editDesc = async (s: ActionSpec) => {
    const next = await requestPrompt({
      title: `Description — ${s.name}`,
      value: descOf(s),
      placeholder: "model-facing tool description (steers the agent's tool choice)",
      saveLabel: "Set",
    });
    if (next != null) setEdit(s.name, { desc: next });
  };

  // A tool is "changed" if its draft mode differs from the live mode, or its draft description
  // (trimmed, as it'll be persisted) differs from the effective one. Comparing trimmed means a
  // whitespace-only edit isn't flagged as a change (it would write an override equal to the default).
  // Only changed tools are sent (each as a partial override).
  const isChanged = (s: ActionSpec) =>
    (draft[s.name]?.mode != null && draft[s.name].mode !== agentModeOf(s)) ||
    (draft[s.name]?.desc !== undefined && draft[s.name].desc!.trim() !== s.description);

  const changed = specs.filter(isChanged);

  const onSave = () => {
    const overrides: Record<string, { description?: string; agent_mode?: AgentMode | null }> = {};
    for (const s of changed) {
      const e = draft[s.name];
      const entry: { description?: string; agent_mode?: AgentMode | null } = {};
      if (e.mode != null && e.mode !== agentModeOf(s)) {
        // Store only the deviation from default: picking the default clears the override (null).
        entry.agent_mode = e.mode === s.default_agent_mode ? null : e.mode;
      }
      if (e.desc !== undefined && e.desc.trim() !== s.description) {
        entry.description = e.desc.trim(); // "" → restore the built-in description
      }
      overrides[s.name] = entry;
    }
    // setDraft on success: the refreshed DTO now reflects the new effective state.
    save.mutate(overrides, { onSuccess: () => setDraft({}) });
  };

  const groups = groupTools(specs);

  return (
    <div className="conf-card tcat">
      {groups.map(([cat, tools]) => (
        <div key={cat}>
          <div className="tooldesc-cat">{CAT_LABEL[cat] ?? cat}</div>
          {tools.map((s) => {
            const mode = modeOf(s);
            const isShell = s.name === "run_shell";
            const modeDeviates = mode !== (s.default_agent_mode ?? mode);
            return (
              <div className="tcat-row" key={s.name}>
                <div className="tcat-head">
                  <span className="tcat-name">{s.name}</span>
                  <span className={"tcat-risk r-" + s.risk}>{s.risk}</span>
                  {s.confirm && <span className="tcat-risk confirm">confirm</span>}
                  {modeDeviates && <span className="tcat-mod">modified</span>}
                </div>
                <div className="tcat-desc" onClick={() => editDesc(s)} title="Edit description">
                  {descOf(s) || <span className="tcat-faint">no description</span>}
                  <span className="tcat-edit"> ✎</span>
                </div>
                <div className="tcat-ctl">
                  <ModeSeg
                    value={mode}
                    def={s.default_agent_mode ?? agentModeOf(s)}
                    readOnly={isShell}
                    small
                    onPick={(m) => setEdit(s.name, { mode: m })}
                  />
                  {isShell && <span className="tcat-faint">governed by Conf → Shell</span>}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <div className="conf-savebar">
        <button className="conf-save" disabled={!changed.length || save.isPending} onClick={onSave}>
          {save.isPending
            ? "Saving…"
            : changed.length
              ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}`
              : "Saved"}
        </button>
      </div>
    </div>
  );
}
