import { useState } from "react";

import { ModeSeg } from "./ModeSeg";
import { agentModeOf, useActionSpecs } from "../hooks/useActions";
import { useSaveToolOverrides } from "../hooks/useToolOverrides";
import { requestPrompt } from "../store/prompt";
import type { ActionSpec, AgentMode, ApprovalRule } from "../types";

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
 *  undefined = untouched); `approvals` is the FULL replacement 'always allow' list (D44 W3, undefined
 *  = untouched — a revoke/add sets the whole next list, since the backend replaces the approvals list
 *  wholesale, never list-through-merge). Saved as a partial `tool_overrides` entry. */
interface Edit {
  mode?: AgentMode;
  desc?: string;
  approvals?: ApprovalRule[];
}

/** Stable JSON for an approvals list — the change probe (a rule is a flat `{args}` object, so key
 *  order is stable enough; this only decides whether to include the tool + light the Save button). */
const apprKey = (rules: ApprovalRule[]): string => JSON.stringify(rules);

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
  // The effective 'always allow' rules for a tool — the pending draft if edited, else the live list
  // from the actions DTO (`s.approvals`, `[]` when none). Revoke/add operate on THIS list.
  const apprOf = (s: ActionSpec): ApprovalRule[] => draft[s.name]?.approvals ?? s.approvals ?? [];

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

  // A tool is "changed" if its draft mode differs from the live mode, its draft description (trimmed,
  // as it'll be persisted) differs from the effective one, or its 'always allow' list was edited
  // (D44 W3 — compared by stable JSON against the live list). Comparing trimmed means a whitespace-only
  // edit isn't flagged as a change (it would write an override equal to the default). Only changed
  // tools are sent (each as a partial override).
  const apprChanged = (s: ActionSpec) =>
    draft[s.name]?.approvals !== undefined &&
    apprKey(draft[s.name].approvals!) !== apprKey(s.approvals ?? []);
  const isChanged = (s: ActionSpec) =>
    (draft[s.name]?.mode != null && draft[s.name].mode !== agentModeOf(s)) ||
    (draft[s.name]?.desc !== undefined && draft[s.name].desc!.trim() !== s.description) ||
    apprChanged(s);

  const changed = specs.filter(isChanged);

  const onSave = () => {
    const overrides: Record<
      string,
      { description?: string; agent_mode?: AgentMode | null; approvals?: ApprovalRule[] }
    > = {};
    for (const s of changed) {
      const e = draft[s.name];
      const entry: {
        description?: string;
        agent_mode?: AgentMode | null;
        approvals?: ApprovalRule[];
      } = {};
      if (e.mode != null && e.mode !== agentModeOf(s)) {
        // Store only the deviation from default: picking the default clears the override (null).
        entry.agent_mode = e.mode === s.default_agent_mode ? null : e.mode;
      }
      if (e.desc !== undefined && e.desc.trim() !== s.description) {
        entry.description = e.desc.trim(); // "" → restore the built-in description
      }
      if (apprChanged(s)) {
        // The FULL replacement list (deep_merge replaces the approvals list wholesale, D44 §4/H2);
        // `[]` clears every rule for the tool.
        entry.approvals = e.approvals!;
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
                  {/* The tri-state agent-access seg sits at the right of the name row — `.tcat-seg`
                      is pushed right. FULL-SIZE, not `small` (owner device round 2026-07-31): the
                      compact variant belongs to the run-card title row it was made for; here it
                      shrank the section's main control below every other section's seg size and the
                      catalog read "too small". On a narrow phone the standard seg wraps onto its own
                      right-anchored line, which is the confrow convention, not a regression. */}
                  <ModeSeg
                    value={mode}
                    def={s.default_agent_mode ?? agentModeOf(s)}
                    readOnly={isShell}
                    onPick={(m) => setEdit(s.name, { mode: m })}
                  />
                </div>
                <div className="tcat-desc" onClick={() => editDesc(s)} title="Edit description">
                  {descOf(s) || <span className="tcat-faint">no description</span>}
                  <span className="tcat-edit"> ✎</span>
                </div>
                {isShell && (
                  <div className="tcat-shellnote tcat-faint">governed by Conf → Shell</div>
                )}
                {/* D44 W3 — the 'always allow' rules editor: the deliberate widening surface (globs +
                    field-omission allowed here, unlike the args-exact bubble grant). A designer
                    forced-confirm tool can't be approved (invariant 2), so hide the editor there —
                    a rule would be inert. */}
                {!s.confirm && (
                  <ApprovalsEditor
                    rules={apprOf(s)}
                    onChange={(next) => setEdit(s.name, { approvals: next })}
                  />
                )}
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

/** One field:pattern pair in the add-rule form (ephemeral UI state only). */
interface Pair {
  field: string;
  pattern: string;
}

/** The per-tool 'always allow' rules editor (D44 W3) — lists existing rules (each rule's args as
 *  compact `field=pattern` chips; `args: null` reads "any args", `args: {}` reads "no args"), a
 *  one-tap revoke, and a
 *  minimal add form (field:pattern pairs; globs and field-omission allowed HERE — the deliberate
 *  widening surface, §3/§5). Every edit calls `onChange` with the FULL next list; ToolCatalog folds it
 *  into the tool's draft and the ONE `useSaveToolOverrides` write (no second write path). Only the
 *  ephemeral add-form inputs live locally. */
function ApprovalsEditor({
  rules,
  onChange,
}: {
  rules: ApprovalRule[];
  onChange: (next: ApprovalRule[]) => void;
}) {
  const [pairs, setPairs] = useState<Pair[]>([{ field: "", pattern: "" }]);

  const setPair = (i: number, patch: Partial<Pair>) =>
    setPairs((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const addPair = () => setPairs((ps) => [...ps, { field: "", pattern: "" }]);
  const removePair = (i: number) =>
    setPairs((ps) =>
      ps.length === 1 ? [{ field: "", pattern: "" }] : ps.filter((_, idx) => idx !== i),
    );

  const revoke = (i: number) => onChange(rules.filter((_, idx) => idx !== i));

  const addRule = () => {
    const args: Record<string, string> = {};
    for (const p of pairs) {
      const f = p.field.trim();
      if (f) args[f] = p.pattern; // pattern may be "" (matches only the empty string)
    }
    // No fields → a whole-action grant (args: null = "any args"), the deliberate widening (§3).
    onChange([...rules, { args: Object.keys(args).length ? args : null }]);
    setPairs([{ field: "", pattern: "" }]); // reset the form
  };

  return (
    <div className="tcat-appr">
      <div className="tcat-appr-head tcat-faint">always-allow rules</div>
      {rules.length === 0 && <div className="tcat-appr-empty tcat-faint">none</div>}
      {rules.map((r, i) => (
        <div className="tcat-appr-rule" key={i}>
          <div className="tcat-appr-chips">
            {r.args == null ? (
              // `null`/omitted only — a whole-action grant. `{}` is the empty AND (matches a
              // zero-field call and nothing else), so it must NOT read as "any args".
              <span className="tcat-appr-chip any">any args</span>
            ) : Object.keys(r.args).length === 0 ? (
              <span className="tcat-appr-chip any">no args</span>
            ) : (
              Object.entries(r.args).map(([f, p]) => (
                <span className="tcat-appr-chip" key={f}>
                  {f}={p}
                </span>
              ))
            )}
          </div>
          <button
            type="button"
            className="tcat-appr-revoke"
            title="revoke this rule"
            aria-label="revoke rule"
            onClick={() => revoke(i)}
          >
            ×
          </button>
        </div>
      ))}
      <div className="tcat-appr-form">
        {pairs.map((p, i) => (
          <div className="tcat-appr-pair" key={i}>
            <input
              className="tcat-appr-input"
              placeholder="field"
              aria-label="rule field"
              value={p.field}
              onChange={(e) => setPair(i, { field: e.target.value })}
            />
            <span className="tcat-appr-eq" aria-hidden>
              =
            </span>
            <input
              className="tcat-appr-input"
              placeholder="pattern (glob)"
              aria-label="rule pattern"
              value={p.pattern}
              onChange={(e) => setPair(i, { pattern: e.target.value })}
            />
            <button
              type="button"
              className="tcat-appr-pairbtn"
              title="remove field"
              aria-label="remove field"
              onClick={() => removePair(i)}
            >
              −
            </button>
          </div>
        ))}
        <div className="tcat-appr-actions">
          <button type="button" className="tcat-appr-pairbtn" onClick={addPair}>
            + field
          </button>
          <button type="button" className="tcat-appr-add" onClick={addRule}>
            add rule
          </button>
        </div>
      </div>
    </div>
  );
}
