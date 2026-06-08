import { useState } from "react";

import {
  useDeleteServer,
  useSaveServer,
  type IntegrationKind,
  type McpServer,
  type OpenApiServer,
  type ServerSummary,
} from "../hooks/useIntegrations";
import { requestConfirm } from "../store/confirm";

// Phase 7c-b — MCP + OpenAPI server manager. Reuses the vapor .mwrap/.mconf/.mform/.mfoot machine-row
// recipe (CSS already in vapor.css, D7); the key/value + list fields use textareas styled net-new in
// extras.css. Edits apply on the next agent turn (or the Rediscover button), never mid-turn.

const RISKS = [
  { val: "low", label: "Low" },
  { val: "med", label: "Med" },
  { val: "high", label: "High" },
];

// ── kv / list <-> text helpers (compact editors for headers/env/args/include) ──
const kvToText = (o: Record<string, string>, sep: string) =>
  Object.entries(o || {})
    .map(([k, v]) => `${k}${sep} ${v}`)
    .join("\n");
function textToKv(text: string, sep: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(sep);
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    if (k) out[k] = line.slice(i + 1).trim();
  }
  return out;
}
const listToText = (a: string[]) => (a || []).join("\n");
const textToList = (t: string) => t.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

function Seg(props: { current: string; onPick: (v: string) => void; options: { val: string; label: string }[] }) {
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

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div className={"switch" + (on ? " on" : "")} onClick={onToggle}>
      <div className="knob" />
    </div>
  );
}

function Foot(props: { isNew: boolean; busy: boolean; onSave: () => void; onCancel: () => void; onDelete?: () => void }) {
  return (
    <div className="mfoot">
      {props.isNew ? (
        <>
          <button type="button" onClick={props.onCancel}>cancel</button>
          <button type="button" className="save" disabled={props.busy} onClick={props.onSave}>
            {props.busy ? "adding…" : "add server"}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="danger" disabled={props.busy} onClick={props.onDelete}>remove</button>
          <button type="button" className="save" disabled={props.busy} onClick={props.onSave}>
            {props.busy ? "saving…" : "save"}
          </button>
        </>
      )}
    </div>
  );
}

// ── MCP form ──
interface McpDraft {
  name: string; transport: string; enabled: boolean; risk: string;
  url: string; headersText: string; command: string; argsText: string; envText: string;
}
const blankMcp = (): McpDraft => ({
  name: "", transport: "streamable_http", enabled: true, risk: "med",
  url: "", headersText: "", command: "", argsText: "", envText: "",
});
const mcpToDraft = (s: McpServer): McpDraft => ({
  name: s.name, transport: s.transport, enabled: s.enabled, risk: s.risk,
  url: s.url, headersText: kvToText(s.headers, ":"), command: s.command,
  argsText: listToText(s.args), envText: kvToText(s.env, "="),
});
function mcpBody(d: McpDraft) {
  return {
    name: d.name.trim(), transport: d.transport, enabled: d.enabled, risk: d.risk,
    url: d.url.trim(), headers: textToKv(d.headersText, ":"),
    command: d.command.trim(), args: textToList(d.argsText), env: textToKv(d.envText, "="),
  };
}

function McpForm(props: { initial: McpDraft; isNew: boolean; busy: boolean; onSave: (b: object) => void; onCancel: () => void; onDelete?: () => void }) {
  const [d, setD] = useState<McpDraft>(props.initial);
  const set = (p: Partial<McpDraft>) => setD({ ...d, ...p });
  const http = d.transport === "streamable_http";
  return (
    <>
      <div className="mform">
        <label>Name</label>
        <input value={d.name} placeholder="web-tools" disabled={!props.isNew} onChange={(e) => set({ name: e.target.value })} />
        <label>Transport</label>
        <Seg current={d.transport} onPick={(v) => set({ transport: v })} options={[{ val: "streamable_http", label: "HTTP" }, { val: "stdio", label: "stdio" }]} />
        <label>Risk</label>
        <Seg current={d.risk} onPick={(v) => set({ risk: v })} options={RISKS} />
        {http ? (
          <>
            <label>URL</label>
            <input value={d.url} placeholder="http://host:3003/mcp" onChange={(e) => set({ url: e.target.value })} />
            <label>Headers</label>
            <textarea className="kv-text" placeholder="Name: value (one per line)" value={d.headersText} onChange={(e) => set({ headersText: e.target.value })} />
          </>
        ) : (
          <>
            <label>Command</label>
            <input value={d.command} placeholder="npx" onChange={(e) => set({ command: e.target.value })} />
            <label>Args</label>
            <textarea className="kv-text" placeholder="one arg per line" value={d.argsText} onChange={(e) => set({ argsText: e.target.value })} />
            <label>Env</label>
            <textarea className="kv-text" placeholder="KEY=value (one per line)" value={d.envText} onChange={(e) => set({ envText: e.target.value })} />
          </>
        )}
        <label>Enabled</label>
        <Toggle on={d.enabled} onToggle={() => set({ enabled: !d.enabled })} />
      </div>
      <Foot {...props} onSave={() => props.onSave(mcpBody(d))} />
    </>
  );
}

// ── OpenAPI form ──
interface ApiDraft {
  name: string; base_url: string; spec_url: string; enabled: boolean; risk: string;
  api_key: string; auth_scheme: string; auth_header: string; headersText: string; includeText: string;
}
const blankApi = (): ApiDraft => ({
  name: "", base_url: "", spec_url: "", enabled: true, risk: "med",
  api_key: "", auth_scheme: "Bearer", auth_header: "Authorization", headersText: "", includeText: "",
});
const apiToDraft = (s: OpenApiServer): ApiDraft => ({
  name: s.name, base_url: s.base_url, spec_url: s.spec_url, enabled: s.enabled, risk: s.risk,
  api_key: "", auth_scheme: s.auth_scheme, auth_header: s.auth_header,
  headersText: kvToText(s.headers, ":"), includeText: listToText(s.include),
});
function apiBody(d: ApiDraft, isNew: boolean) {
  const b: Record<string, unknown> = {
    name: d.name.trim(), base_url: d.base_url.trim(), spec_url: d.spec_url.trim(),
    enabled: d.enabled, risk: d.risk, auth_scheme: d.auth_scheme.trim(),
    auth_header: d.auth_header.trim(), headers: textToKv(d.headersText, ":"), include: textToList(d.includeText),
  };
  // blank api_key on edit = keep stored secret (backend unmask); on create only send if set
  if (d.api_key || isNew) b.api_key = d.api_key;
  return b;
}

function ApiForm(props: { initial: ApiDraft; isNew: boolean; busy: boolean; onSave: (b: object) => void; onCancel: () => void; onDelete?: () => void }) {
  const [d, setD] = useState<ApiDraft>(props.initial);
  const [showKey, setShowKey] = useState(false);
  const set = (p: Partial<ApiDraft>) => setD({ ...d, ...p });
  return (
    <>
      <div className="mform">
        <label>Name</label>
        <input value={d.name} placeholder="open-webui-tools" disabled={!props.isNew} onChange={(e) => set({ name: e.target.value })} />
        <label>Base URL</label>
        <input value={d.base_url} placeholder="http://host:port" onChange={(e) => set({ base_url: e.target.value })} />
        <label>Spec URL</label>
        <input value={d.spec_url} placeholder="(blank → base + /openapi.json)" onChange={(e) => set({ spec_url: e.target.value })} />
        <label>Risk</label>
        <Seg current={d.risk} onPick={(v) => set({ risk: v })} options={RISKS} />
        <label>API key</label>
        <div className="pw">
          <input type={showKey ? "text" : "password"} value={d.api_key} placeholder="•••••••• (unchanged)" autoComplete="new-password" onChange={(e) => set({ api_key: e.target.value })} />
          <button type="button" className={"reveal" + (showKey ? " on" : "")} onClick={() => setShowKey(!showKey)}>{showKey ? "hide" : "show"}</button>
        </div>
        <label>Auth header</label>
        <input value={d.auth_header} placeholder="Authorization" onChange={(e) => set({ auth_header: e.target.value })} />
        <label>Auth scheme</label>
        <input value={d.auth_scheme} placeholder="Bearer" onChange={(e) => set({ auth_scheme: e.target.value })} />
        <label>Include</label>
        <textarea className="kv-text" placeholder="operationId or path (one per line; blank = all)" value={d.includeText} onChange={(e) => set({ includeText: e.target.value })} />
        <label>Enabled</label>
        <Toggle on={d.enabled} onToggle={() => set({ enabled: !d.enabled })} />
      </div>
      <Foot {...props} onSave={() => props.onSave(apiBody(d, props.isNew))} />
    </>
  );
}

export function ServerListEditor({
  kind,
  servers,
  summaries,
}: {
  kind: IntegrationKind;
  servers: (McpServer | OpenApiServer)[];
  summaries: ServerSummary[];
}) {
  const [openName, setOpenName] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const save = useSaveServer(kind);
  const remove = useDeleteServer(kind);
  const summaryOf = (name: string) => summaries.find((s) => s.server === name);

  const onSave = (name: string | null, body: object) => {
    save.mutate({ name, body: body as Record<string, unknown> }, {
      onSuccess: () => { setOpenName(null); setAdding(false); },
    });
  };
  const onDelete = async (name: string) => {
    const ok = await requestConfirm({ title: `Remove ${name}?`, body: "Removes this server from config.yaml.", confirmLabel: "remove", danger: true });
    if (ok) remove.mutate(name, { onSuccess: () => setOpenName(null) });
  };

  return (
    <div className="conf-card">
      {servers.map((s) => {
        const sum = summaryOf(s.name);
        return (
          <div className={"mwrap" + (openName === s.name ? " open" : "")} key={s.name}>
            <div className="confrow" onClick={() => { setOpenName(openName === s.name ? null : s.name); setAdding(false); }}>
              <div className="k">
                <div className="label">{s.name}{s.enabled ? "" : " · off"}</div>
                <div className="desc code">
                  {sum?.error ? `error: ${sum.error}` : sum ? `${sum.tools} tool${sum.tools === 1 ? "" : "s"}` : "not discovered"}
                </div>
              </div>
              <span className={"badge" + (sum && !sum.error ? "" : " stale")}>{s.risk}</span>
              <span className="chev" aria-hidden>›</span>
            </div>
            <div className="mconf">
              {openName === s.name &&
                (kind === "mcp" ? (
                  <McpForm initial={mcpToDraft(s as McpServer)} isNew={false} busy={save.isPending || remove.isPending}
                    onSave={(b) => onSave(s.name, b)} onCancel={() => setOpenName(null)} onDelete={() => onDelete(s.name)} />
                ) : (
                  <ApiForm initial={apiToDraft(s as OpenApiServer)} isNew={false} busy={save.isPending || remove.isPending}
                    onSave={(b) => onSave(s.name, b)} onCancel={() => setOpenName(null)} onDelete={() => onDelete(s.name)} />
                ))}
            </div>
          </div>
        );
      })}

      <div className={"mwrap add" + (adding ? " open" : "")}>
        <div className="confrow" onClick={() => { setAdding(!adding); setOpenName(null); }}>
          <div className="k">
            <div className="label">add {kind === "mcp" ? "MCP" : "OpenAPI"} server</div>
            <div className="desc">writes a new entry to config.yaml</div>
          </div>
          <span className="chev" aria-hidden>›</span>
        </div>
        <div className="mconf">
          {adding &&
            (kind === "mcp" ? (
              <McpForm initial={blankMcp()} isNew busy={save.isPending} onSave={(b) => onSave(null, b)} onCancel={() => setAdding(false)} />
            ) : (
              <ApiForm initial={blankApi()} isNew busy={save.isPending} onSave={(b) => onSave(null, b)} onCancel={() => setAdding(false)} />
            ))}
        </div>
      </div>
    </div>
  );
}
