import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { putJSON } from "../api/client";
import { useActionSpecs } from "../hooks/useActions";
import { pushToast } from "../store/toast";
import type { ActionSpec } from "../types";

// Phase 7d-a — per-tool description overrides. The agent picks tools by their model-facing
// description, so sharpening a tool's wording steers a weak local model (the big 2026-05-28
// finding). The registry (GET /api/actions) is the source of the *effective* descriptions (built-in
// or already-overridden); a save PUTs `{tool_descriptions: {name: text}}` to /api/settings, which
// applies it onto the live specs (no restart). Blanking a field resets that tool to its built-in.
// vapor.css untouched (D7) — the rows reuse the .conf-textrow/.conf-textarea recipe from 7a.

const RISK_ORDER = ["high", "med", "low"];

/** The tools whose description matters to the model: agent-exposed, grouped by category. */
function groupTools(specs: ActionSpec[]): [string, ActionSpec[]][] {
  const agentTools = specs.filter((s) => s.agent_exposed);
  const byCat = new Map<string, ActionSpec[]>();
  for (const s of agentTools) {
    const list = byCat.get(s.category) ?? [];
    list.push(s);
    byCat.set(s.category, list);
  }
  // Stable, readable order: action → builtin → utility → mcp → anything else.
  const catOrder = ["action", "builtin", "utility", "mcp"];
  return [...byCat.entries()].sort(
    (a, b) => (catOrder.indexOf(a[0]) + 1 || 99) - (catOrder.indexOf(b[0]) + 1 || 99),
  );
}

const CAT_LABEL: Record<string, string> = {
  action: "fleet & service actions",
  builtin: "agent builtins",
  utility: "utilities",
  mcp: "mcp & openapi tools",
};

export function ToolDescriptionsEditor({ overrides }: { overrides: Record<string, string> }) {
  const qc = useQueryClient();
  const { data: specs = [] } = useActionSpecs();

  // Draft keyed by tool name → the textarea value (seeded from the effective description).
  const [draft, setDraft] = useState<Record<string, string>>({});
  // Baseline = the effective descriptions when the form was (re)seeded; diffing against it tells us
  // which rows the owner actually edited (so we PUT only those, and a blank ≠ a reset of an unchanged
  // built-in — only an edited-to-blank row sends "" to clear an override).
  const [base, setBase] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!specs.length) return;
    const eff: Record<string, string> = {};
    for (const s of specs) if (s.agent_exposed) eff[s.name] = s.description;
    setDraft(eff);
    setBase(eff);
  }, [specs]);

  const changed = Object.keys(draft).filter((n) => (draft[n] ?? "") !== (base[n] ?? ""));

  const save = useMutation({
    mutationFn: () => {
      const td: Record<string, string> = {};
      for (const n of changed) td[n] = draft[n].trim();
      return putJSON("/api/settings", { tool_descriptions: td });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["actions"] }); // effective descriptions changed
      qc.invalidateQueries({ queryKey: ["settings"] });
      pushToast("Tool descriptions saved", "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Save failed", "err"),
  });

  const groups = groupTools(specs);

  return (
    <div className="conf-card">
      {groups.map(([cat, tools]) => (
        <div key={cat}>
          <div className="tooldesc-cat">{CAT_LABEL[cat] ?? cat}</div>
          {tools
            .slice()
            .sort((a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk) || a.name.localeCompare(b.name))
            .map((s) => {
              const custom = !!(overrides[s.name] && overrides[s.name].trim());
              return (
                <div className="confrow conf-textrow" key={s.name}>
                  <div className="k">
                    <div className="label code">
                      {s.name}
                      {custom && <span className="tooldesc-tag"> · custom</span>}
                    </div>
                    <div className="desc">
                      {s.risk}
                      {s.confirm ? " · confirm" : ""} — blank resets to built-in
                    </div>
                  </div>
                  <textarea
                    className="conf-textarea"
                    value={draft[s.name] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [s.name]: e.target.value }))}
                  />
                </div>
              );
            })}
        </div>
      ))}
      <div className="conf-savebar">
        <button
          className="conf-save"
          disabled={!changed.length || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "Saved"}
        </button>
      </div>
    </div>
  );
}
