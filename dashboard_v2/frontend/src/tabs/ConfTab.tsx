import { useEffect, useState, type ReactNode } from "react";

import { AgentsEditor } from "../components/AgentsEditor";
import { MachineEditor } from "../components/MachineEditor";
import { ServerListEditor } from "../components/ServerListEditor";
import { SkillsEditor } from "../components/SkillsEditor";
import { ToolDescriptionsEditor } from "../components/ToolDescriptionsEditor";
import { useActionSpecs } from "../hooks/useActions";
import { type AgentDef, type AgentSectionCfg } from "../hooks/useAgents";
import { useHosts, useServerInfo } from "../hooks/useFleet";
import { useIntegrationsStatus, useRediscover } from "../hooks/useIntegrations";
import { useSaveSettings, useSettings, type SettingsDoc } from "../hooks/useSettings";
import { useSkills } from "../hooks/useSkills";
import { useCollapsed } from "../store/collapse";
import { setUI, useUI, type Skyline, type Theme, type Loz } from "../store/ui";

// Conf tab. Appearance is wired to the live UI store (client display state). Phase 7a wires the
// **Inference** + **Server** groups to the YAML-backed settings API (GET masked / PUT partial
// patch). Computers stays read-only here (hosts CRUD is Phase 7b); prompts/memory/integrations
// land in later 7 slices. vapor.css is untouched (D7) — net-new pixels live in theme/extras.css.

interface Props {
  active: boolean;
}

function Seg<T extends string>(props: {
  current: T;
  options: { val: T; label: string }[];
  onPick: (v: T) => void;
}) {
  return (
    <div className="seg">
      {props.options.map((o) => (
        <button
          key={o.val}
          className={o.val === props.current ? "active" : ""}
          onClick={() => props.onPick(o.val)}
        >
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

/** A labelled text/password input row (vapor `.confrow` + `.k`). `desc` is the small caps subtitle;
 * pass `restart` to mark a field that only applies after a server restart. */
function Field(props: {
  label: string;
  desc: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "password";
  placeholder?: string;
  restart?: boolean;
}) {
  return (
    <div className="confrow">
      <div className="k">
        <div className="label">{props.label}</div>
        <div className="desc">
          {props.desc}
          {props.restart ? " · restart to apply" : ""}
        </div>
      </div>
      <input
        type={props.type ?? "text"}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

// Just the slices the 7a form edits — kept verbatim from the loaded doc so a save round-trips the
// masked api_key (the backend restores it) and leaves every other section untouched.
type Draft = Pick<SettingsDoc, "server" | "inference" | "searxng" | "embeddings" | "open_terminal">;

function pickDraft(s: SettingsDoc): Draft {
  return {
    server: s.server,
    inference: s.inference,
    searxng: s.searxng,
    embeddings: s.embeddings,
    open_terminal: s.open_terminal,
  };
}

const RISKS = [
  { val: "low", label: "Low" },
  { val: "med", label: "Med" },
  { val: "high", label: "High" },
];

/** A Conf section whose header collapses its body (persisted per `id`). Same vapor `.conftitle` look
 * + a leading disclosure chevron; collapsing doesn't alter the design, just hides the body. */
function ConfGroup(props: {
  id: string;
  num: string;
  title: string;
  right?: ReactNode;
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const [collapsed, toggle] = useCollapsed(props.id, props.defaultCollapsed);
  return (
    <div className={"confgroup" + (collapsed ? " collapsed" : "")}>
      <div className="conftitle conf-toggle" onClick={toggle}>
        <span className="conf-chev">›</span>
        <span className="num">{props.num}</span>
        <b>{props.title}</b>
        {props.right != null && <span className="right">{props.right}</span>}
      </div>
      {!collapsed && props.children}
    </div>
  );
}

export function ConfTab({ active }: Props) {
  const { theme, skyline, loz, heroOn, waveformOn } = useUI();
  const { data: server } = useServerInfo();
  const { data: hosts = [] } = useHosts(server?.poll_seconds ?? 5);

  const { data: settings } = useSettings();
  const save = useSaveSettings();
  const { data: integrations } = useIntegrationsStatus();
  const rediscover = useRediscover();
  const { data: actionSpecs = [] } = useActionSpecs();
  const { data: skillList = [] } = useSkills();
  const [draft, setDraft] = useState<Draft | null>(null);

  // Agent definitions + the agent-section scalars come straight off the settings doc.
  const agents = (settings?.agents as AgentDef[] | undefined) ?? [];
  const agentSection = settings?.agent as Partial<AgentSectionCfg> | undefined;
  const agentCfg: AgentSectionCfg = {
    default_agent: agentSection?.default_agent ?? "",
    global_subagent_limit: agentSection?.global_subagent_limit ?? 6,
    subagent_clamp_privilege: agentSection?.subagent_clamp_privilege ?? true,
  };
  const agentToolNames = actionSpecs.filter((s) => s.agent_exposed).map((s) => s.name);
  const skillNames = skillList.map((s) => s.name);
  const skillsEnabled = (agentSection as { skills_enabled?: boolean } | undefined)?.skills_enabled ?? true;

  // Reseed the draft whenever the server doc changes (initial load + after a successful save, which
  // replaces the cache with the masked echo → clears the dirty state).
  useEffect(() => {
    if (settings) setDraft(pickDraft(settings));
  }, [settings]);

  const dirty = settings && draft && JSON.stringify(draft) !== JSON.stringify(pickDraft(settings));

  const inf = draft?.inference;
  const srv = draft?.server;

  function setInf<K extends keyof Draft["inference"]>(key: K, val: Draft["inference"][K]) {
    setDraft((d) => (d ? { ...d, inference: { ...d.inference, [key]: val } } : d));
  }
  function setEndpoint(which: "local" | "cloud", key: "base_url" | "api_key" | "model", val: string) {
    setDraft((d) =>
      d ? { ...d, inference: { ...d.inference, [which]: { ...d.inference[which], [key]: val } } } : d,
    );
  }
  function setSrv<K extends keyof Draft["server"]>(key: K, val: Draft["server"][K]) {
    setDraft((d) => (d ? { ...d, server: { ...d.server, [key]: val } } : d));
  }
  function setSearx<K extends keyof Draft["searxng"]>(key: K, val: Draft["searxng"][K]) {
    setDraft((d) => (d ? { ...d, searxng: { ...d.searxng, [key]: val } } : d));
  }
  function setEmb<K extends keyof Draft["embeddings"]>(key: K, val: Draft["embeddings"][K]) {
    setDraft((d) => (d ? { ...d, embeddings: { ...d.embeddings, [key]: val } } : d));
  }
  function setTerm<K extends keyof Draft["open_terminal"]>(key: K, val: Draft["open_terminal"][K]) {
    setDraft((d) => (d ? { ...d, open_terminal: { ...d.open_terminal, [key]: val } } : d));
  }

  const sx = draft?.searxng;
  const emb = draft?.embeddings;
  const term = draft?.open_terminal;

  function onSave() {
    if (!draft) return;
    // Coerce numeric text fields; the backend validates and 422s on a bad value (surfaced as toast).
    const dimRaw = String(draft.embeddings.dim ?? "").trim();
    const patch: Draft = {
      server: {
        ...draft.server,
        port: Number(draft.server.port),
        poll_seconds: Number(draft.server.poll_seconds),
        feature_cycle_seconds: Number(draft.server.feature_cycle_seconds),
      },
      inference: {
        ...draft.inference,
        request_timeout_s: Number(draft.inference.request_timeout_s),
      },
      searxng: draft.searxng,
      embeddings: { ...draft.embeddings, dim: dimRaw ? Number(dimRaw) : null },
      open_terminal: draft.open_terminal,
    };
    save.mutate(patch as unknown as Record<string, unknown>);
  }

  return (
    <div className={"tab" + (active ? " active" : "")} id="tab-conf" data-screen-label="04 Conf">
      <ConfGroup id="inference" num="01" title="Inference" right="openai-compatible">
        <div className="conf-card">
          <div className="confrow">
            <div className="k">
              <div className="label">Default mode</div>
              <div className="desc">local · cloud — /local //cloud override per message</div>
            </div>
            <Seg<string>
              current={inf?.default_mode ?? "local"}
              options={[
                { val: "local", label: "Local" },
                { val: "cloud", label: "Cloud" },
              ]}
              onPick={(v) => setInf("default_mode", v)}
            />
          </div>
          <Field
            label="Local endpoint"
            desc="llama.cpp · /v1 base url"
            value={inf?.local.base_url ?? ""}
            onChange={(v) => setEndpoint("local", "base_url", v)}
            placeholder="http://host:port/v1"
          />
          <Field
            label="Local model"
            desc="model id the backend loads"
            value={inf?.local.model ?? ""}
            onChange={(v) => setEndpoint("local", "model", v)}
          />
          <Field
            label="Local key"
            desc="optional — most local servers ignore it"
            type="password"
            value={inf?.local.api_key ?? ""}
            onChange={(v) => setEndpoint("local", "api_key", v)}
          />
          <Field
            label="Cloud endpoint"
            desc="openai-compatible base url"
            value={inf?.cloud.base_url ?? ""}
            onChange={(v) => setEndpoint("cloud", "base_url", v)}
            placeholder="https://openrouter.ai/api/v1"
          />
          <Field
            label="Cloud model"
            desc="cloud model id"
            value={inf?.cloud.model ?? ""}
            onChange={(v) => setEndpoint("cloud", "model", v)}
          />
          <Field
            label="Cloud key"
            desc="bearer api key (stored masked)"
            type="password"
            value={inf?.cloud.api_key ?? ""}
            onChange={(v) => setEndpoint("cloud", "api_key", v)}
          />
          <Field
            label="Request timeout"
            desc="seconds — thinking models load slowly"
            value={String(inf?.request_timeout_s ?? "")}
            onChange={(v) => setInf("request_timeout_s", v as unknown as number)}
          />
          <div className="confrow conf-textrow">
            <div className="k">
              <div className="label">System prompt</div>
              <div className="desc">optional override of the default agent prompt</div>
            </div>
            <textarea
              className="conf-textarea"
              value={inf?.system_prompt ?? ""}
              placeholder="(use the built-in default)"
              onChange={(e) => setInf("system_prompt", e.target.value)}
            />
          </div>
        </div>
      </ConfGroup>

      <ConfGroup id="server" num="02" title="Server" right="tailnet-only">
        <div className="conf-card">
          <Field
            label="Bind host"
            desc="127.0.0.1 — fronted by Tailscale Serve"
            value={srv?.host ?? ""}
            onChange={(v) => setSrv("host", v)}
            restart
          />
          <Field
            label="Port"
            desc="default 5433"
            value={String(srv?.port ?? "")}
            onChange={(v) => setSrv("port", v as unknown as number)}
            restart
          />
          <Field
            label="Poll cadence"
            desc="seconds — fleet status sweep"
            value={String(srv?.poll_seconds ?? "")}
            onChange={(v) => setSrv("poll_seconds", v as unknown as number)}
          />
          <Field
            label="Feature cycle"
            desc="seconds — hero auto-cycles the featured online host"
            value={String(srv?.feature_cycle_seconds ?? "")}
            onChange={(v) => setSrv("feature_cycle_seconds", v as unknown as number)}
          />
          <div className="confrow">
            <div className="k">
              <div className="label">Debug</div>
              <div className="desc">verbose errors — off in prod · restart to apply</div>
            </div>
            <Switch on={!!srv?.debug} onToggle={() => setSrv("debug", !srv?.debug)} />
          </div>
        </div>
      </ConfGroup>

      <ConfGroup id="searxng" num="03" title="SearXNG" right="web_search">
        <div className="conf-card">
          <Field
            label="Endpoint"
            desc="searxng base url — needs JSON format enabled"
            value={sx?.base_url ?? ""}
            onChange={(v) => setSearx("base_url", v)}
            placeholder="http://host:8888"
          />
          <Field
            label="Language"
            desc="optional default ui language"
            value={sx?.language ?? ""}
            onChange={(v) => setSearx("language", v || null)}
            placeholder="en"
          />
          <div className="confrow">
            <div className="k">
              <div className="label">Enabled</div>
              <div className="desc">powers the agent web_search tool</div>
            </div>
            <Switch on={!!sx?.enabled} onToggle={() => setSearx("enabled", !sx?.enabled)} />
          </div>
        </div>
      </ConfGroup>

      <ConfGroup id="embeddings" num="04" title="Embeddings" right="vector memory">
        <div className="conf-card">
          <Field
            label="Endpoint"
            desc="openai-compatible /v1 base url"
            value={emb?.base_url ?? ""}
            onChange={(v) => setEmb("base_url", v)}
            placeholder="https://openrouter.ai/api/v1"
          />
          <Field
            label="Model"
            desc="embedding model id"
            value={emb?.model ?? ""}
            onChange={(v) => setEmb("model", v)}
            placeholder="qwen/qwen3-embedding-4b"
          />
          <Field
            label="API key"
            desc="bearer key (stored masked)"
            type="password"
            value={emb?.api_key ?? ""}
            onChange={(v) => setEmb("api_key", v)}
          />
          <Field
            label="Dimension"
            desc="optional — vector size hint"
            value={emb?.dim == null ? "" : String(emb.dim)}
            onChange={(v) => setEmb("dim", (v === "" ? null : v) as unknown as number)}
            placeholder="2560"
          />
          <div className="confrow">
            <div className="k">
              <div className="label">Enabled</div>
              <div className="desc">semantic recall (Phase 7e)</div>
            </div>
            <Switch on={!!emb?.enabled} onToggle={() => setEmb("enabled", !emb?.enabled)} />
          </div>
        </div>
      </ConfGroup>

      <ConfGroup id="openterminal" num="05" title="Open-terminal" right="remote shell tools">
        <div className="conf-card">
          <Field
            label="Endpoint"
            desc="open-terminal rest api base url"
            value={term?.base_url ?? ""}
            onChange={(v) => setTerm("base_url", v)}
            placeholder="http://host:9999"
          />
          <Field
            label="API key"
            desc="bearer token (stored masked)"
            type="password"
            value={term?.api_key ?? ""}
            onChange={(v) => setTerm("api_key", v)}
          />
          <div className="confrow">
            <div className="k">
              <div className="label">Exec risk</div>
              <div className="desc">terminal_exec gate — high = confirm</div>
            </div>
            <Seg<string> current={term?.exec_risk ?? "high"} options={RISKS} onPick={(v) => setTerm("exec_risk", v)} />
          </div>
          <div className="confrow">
            <div className="k">
              <div className="label">Write risk</div>
              <div className="desc">file write/replace gate</div>
            </div>
            <Seg<string> current={term?.write_risk ?? "high"} options={RISKS} onPick={(v) => setTerm("write_risk", v)} />
          </div>
          <div className="confrow">
            <div className="k">
              <div className="label">Read risk</div>
              <div className="desc">read/list/grep/glob gate</div>
            </div>
            <Seg<string> current={term?.read_risk ?? "low"} options={RISKS} onPick={(v) => setTerm("read_risk", v)} />
          </div>
          <div className="confrow">
            <div className="k">
              <div className="label">Enabled</div>
              <div className="desc">curated remote shell + file tools</div>
            </div>
            <Switch on={!!term?.enabled} onToggle={() => setTerm("enabled", !term?.enabled)} />
          </div>
        </div>
        <div className="conf-savebar">
          <button className="conf-save" disabled={!dirty || save.isPending} onClick={onSave}>
            {save.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </ConfGroup>

      <ConfGroup
        id="mcp"
        num="06"
        title="MCP servers"
        right={`${settings?.mcp_servers?.length ?? 0} server${(settings?.mcp_servers?.length ?? 0) === 1 ? "" : "s"}`}
      >
        <ServerListEditor kind="mcp" servers={settings?.mcp_servers ?? []} summaries={integrations?.mcp ?? []} />
      </ConfGroup>

      <ConfGroup
        id="openapi"
        num="07"
        title="OpenAPI tool servers"
        right={`${settings?.openapi_servers?.length ?? 0} server${(settings?.openapi_servers?.length ?? 0) === 1 ? "" : "s"}`}
      >
        <ServerListEditor kind="openapi" servers={settings?.openapi_servers ?? []} summaries={integrations?.openapi ?? []} />
        <div className="conf-savebar redisc">
          {integrations?.dirty && <span className="redisc-hint">// changes apply on next chat · or</span>}
          <button className="conf-save alt" disabled={rediscover.isPending} onClick={() => rediscover.mutate()}>
            {rediscover.isPending ? "Rediscovering…" : "Rediscover tools"}
          </button>
        </div>
      </ConfGroup>

      <ConfGroup
        id="agents"
        num="08"
        title="Agents"
        right={`${agents.length} defined`}
        defaultCollapsed
      >
        <AgentsEditor agents={agents} cfg={agentCfg} toolNames={agentToolNames} skillNames={skillNames} />
      </ConfGroup>

      <ConfGroup
        id="skills"
        num="09"
        title="Skills"
        right={`${skillNames.length} discovered`}
        defaultCollapsed
      >
        <SkillsEditor enabled={skillsEnabled} />
      </ConfGroup>

      <ConfGroup
        id="tooldesc"
        num="10"
        title="Agent tools"
        right="descriptions"
        defaultCollapsed
      >
        <ToolDescriptionsEditor overrides={(settings?.tool_descriptions as Record<string, string>) ?? {}} />
      </ConfGroup>

      <ConfGroup
        id="computers"
        num="11"
        title="Computers"
        right={`${hosts.length} machine${hosts.length === 1 ? "" : "s"}`}
      >
        <MachineEditor hosts={hosts} />
      </ConfGroup>

      <ConfGroup id="appearance" num="12" title="Appearance">
        <div className="conf-card">
          <div className="confrow">
            <div className="k">
              <div className="label">Theme</div>
              <div className="desc">vapor · aqua · ember</div>
            </div>
            <Seg<Theme>
              current={theme}
              options={[
                { val: "dark", label: "Vapor" },
                { val: "aqua", label: "Aqua" },
                { val: "ember", label: "Ember" },
              ]}
              onPick={(v) => setUI({ theme: v })}
            />
          </div>
          <div className="confrow">
            <div className="k">
              <div className="label">App mark</div>
              <div className="desc">logo · spinning ring</div>
            </div>
            <Seg<Loz>
              current={loz}
              options={[
                { val: "logo", label: "Logo" },
                { val: "ring", label: "Ring" },
              ]}
              onPick={(v) => setUI({ loz: v })}
            />
          </div>
          <div className="confrow">
            <div className="k">
              <div className="label">Sun &amp; grid</div>
              <div className="desc">animated hero scene</div>
            </div>
            <Switch on={heroOn} onToggle={() => setUI({ heroOn: !heroOn })} />
          </div>
          <div className="confrow">
            <div className="k">
              <div className="label">Horizon</div>
              <div className="desc">city · mountains</div>
            </div>
            <Seg<Skyline>
              current={skyline}
              options={[
                { val: "city", label: "City" },
                { val: "mountains", label: "Mountains" },
              ]}
              onPick={(v) => setUI({ skyline: v })}
            />
          </div>
          <div className="confrow">
            <div className="k">
              <div className="label">Live waveform</div>
              <div className="desc">ping graph on hero</div>
            </div>
            <Switch on={waveformOn} onToggle={() => setUI({ waveformOn: !waveformOn })} />
          </div>
        </div>
      </ConfGroup>

      <div className="conf-foot">
        ctrl·b · vapor build ·{" "}
        <a href="https://github.com/nengoxx/ctrl-b" target="_blank" rel="noopener">
          github.com/nengoxx/ctrl-b
        </a>
      </div>
      <div style={{ height: 24 }} />
    </div>
  );
}
