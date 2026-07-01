// A generic Tools-tab utility card (Phase 8, D8). Driven entirely by a tool's `input_schema` +
// `ToolResult` shape — NO per-tool code. Renders the Vapor `.util` card (glyph from `icon`, title,
// description; one `.field` input per schema property + a run button), invokes via `runTool`, and
// renders the result with the existing Vapor result classes (`.vtitle` / `.kv` / `.download`):
// summary, kv rows from `data` (scalars, minus the `download` key), and a client-side "Download JSON"
// when the tool returns `data.download = {filename, content}`.
//
// Tools keep flat scalar input models (string/number), so this stays generic; richer schemas
// (oneOf/$ref/nested) are out of scope by design — keep tool inputs flat. vapor.css untouched (D7).

import { Fragment, useState } from "react";

import { ModeSeg } from "./ModeSeg";
import { agentModeOf } from "../hooks/useActions";
import { runTool } from "../hooks/useTools";
import { useSaveToolOverrides } from "../hooks/useToolOverrides";
import { requestPrompt } from "../store/prompt";
import { pushToast } from "../store/toast";
import type { AgentMode, ToolResult, UtilTool } from "../types";

interface SchemaProp {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
}

function downloadJson(filename: string, content: unknown): void {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Render a tool's `data` (minus the download payload) as kv rows; skips null/empty. */
function kvRows(data: Record<string, unknown>): [string, string][] {
  const rows: [string, string][] = [];
  for (const [k, v] of Object.entries(data)) {
    if (k === "download" || v == null || v === "") continue;
    const val = Array.isArray(v)
      ? v.join(", ")
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
    rows.push([k, val]);
  }
  return rows;
}

export function UtilCard({ tool }: { tool: UtilTool }) {
  const schema = tool.input_schema as {
    properties?: Record<string, SchemaProp>;
    required?: string[];
  };
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const fieldNames = Object.keys(props);

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fieldNames.map((n) => [n, props[n].default != null ? String(props[n].default) : ""]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);
  const saveOverride = useSaveToolOverrides();

  // Edit the tool's model-facing description in place (Phase 8b, D22) — the same `tool_overrides`
  // value the Section-B catalog manages; a blank entry restores the built-in. Reuses the shared
  // prompt modal; the shared save hook invalidates ["tools"] so the card re-renders.
  async function editDescription() {
    const next = await requestPrompt({
      title: `Description — ${tool.name}`,
      value: tool.description,
      placeholder: "model-facing tool description (steers the agent's tool choice)",
      saveLabel: "Set",
    });
    if (next != null && next.trim() !== tool.description) {
      saveOverride.mutate({ [tool.name]: { description: next.trim() } });
    }
  }

  // The tri-state agent-access mode for this utility (Phase 8b, D22) — the same `tool_overrides`
  // axis the Section-B catalog manages, saved immediately (like the description edit). It governs
  // whether the *agent* may call the tool; running it from this card (USER) is unaffected. Picking
  // the default clears the override.
  const mode = agentModeOf(tool);
  const defMode = tool.default_agent_mode ?? mode;
  const pickMode = (m: AgentMode) =>
    saveOverride.mutate({ [tool.name]: { agent_mode: m === defMode ? null : m } });

  const missingRequired = fieldNames.some((n) => required.has(n) && !values[n].trim());

  async function run() {
    if (busy || missingRequired) return;
    setBusy(true);
    setResult(null);
    // Coerce per schema type; drop empty optional fields so the backend default/None applies.
    const args: Record<string, unknown> = {};
    for (const n of fieldNames) {
      const raw = values[n].trim();
      if (raw === "" && !required.has(n)) continue;
      const t = props[n].type;
      args[n] = t === "integer" || t === "number" ? Number(raw) : raw;
    }
    try {
      const resp = await runTool(tool.name, args);
      if (resp.result) setResult(resp.result);
    } catch (e) {
      pushToast(`${tool.title} failed: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
    }
  }

  const download = (result?.data?.download ?? null) as {
    filename?: string;
    content?: unknown;
  } | null;
  const rows = result ? kvRows(result.data) : [];
  const isErr = result != null && result.state !== "ok";

  return (
    <div className="util">
      <div className="uhead">
        <div className="glyph">
          <span className={"ico " + (tool.icon ?? "")} />
        </div>
        <div className="t">
          <div className="util-title-row">
            <div className="nm">{tool.title}</div>
            {/* Compact agent-access tri-state, inline with the title (governs whether the *agent*
                may call this tool; you can always run it from the card below). */}
            <ModeSeg value={mode} def={defMode} onPick={pickMode} small />
          </div>
          <div className="desc util-desc" onClick={editDescription} title="Edit description">
            {tool.description || <span className="tcat-faint">no description</span>}
            <span className="tcat-edit"> ✎</span>
          </div>
        </div>
      </div>
      <div className="ubody">
        <div className="field">
          {fieldNames.map((n) => (
            <input
              key={n}
              type={props[n].type === "integer" || props[n].type === "number" ? "number" : "text"}
              placeholder={props[n].description ?? props[n].title ?? n}
              value={values[n]}
              disabled={busy}
              onChange={(e) => setValues((v) => ({ ...v, [n]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") run();
              }}
            />
          ))}
          <button onClick={run} disabled={busy || missingRequired}>
            {busy ? "…" : "run"}
          </button>
        </div>

        {result && (
          <div className="result">
            <div className={"tool-summary" + (isErr ? " err" : "")}>{result.summary}</div>
            {isErr && result.error && <div className="tool-err">{result.error}</div>}
            {rows.length > 0 && (
              <div className="kv">
                {rows.map(([k, v]) => (
                  <Fragment key={k}>
                    <span className="k">{k}</span>
                    <span className="v">{v}</span>
                  </Fragment>
                ))}
              </div>
            )}
            {download?.filename && (
              <button
                className="download"
                title={download.filename}
                onClick={() => downloadJson(download.filename!, download.content)}
              >
                ↓ download .json
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
