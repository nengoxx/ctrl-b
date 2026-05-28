import { useEffect, useState } from "react";

import { useHosts, useServerInfo } from "../hooks/useFleet";
import { useSaveSettings, useSettings, type SettingsDoc } from "../hooks/useSettings";
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
type Draft = Pick<SettingsDoc, "server" | "inference">;

function pickDraft(s: SettingsDoc): Draft {
  return { server: s.server, inference: s.inference };
}

export function ConfTab({ active }: Props) {
  const { theme, skyline, loz, heroOn, waveformOn } = useUI();
  const { data: server } = useServerInfo();
  const { data: hosts = [] } = useHosts(server?.poll_seconds ?? 5);

  const { data: settings } = useSettings();
  const save = useSaveSettings();
  const [draft, setDraft] = useState<Draft | null>(null);

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

  function onSave() {
    if (!draft) return;
    // Coerce numeric text fields; the backend validates and 422s on a bad value (surfaced as toast).
    const patch: Draft = {
      server: {
        ...draft.server,
        port: Number(draft.server.port),
        poll_seconds: Number(draft.server.poll_seconds),
      },
      inference: {
        ...draft.inference,
        request_timeout_s: Number(draft.inference.request_timeout_s),
      },
    };
    save.mutate(patch as unknown as Record<string, unknown>);
  }

  return (
    <div className={"tab" + (active ? " active" : "")} id="tab-conf" data-screen-label="04 Conf">
      <div className="confgroup">
        <div className="conftitle">
          <span className="num">01</span>
          <b>Inference</b>
          <span className="right">openai-compatible</span>
        </div>
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
      </div>

      <div className="confgroup">
        <div className="conftitle">
          <span className="num">02</span>
          <b>Server</b>
          <span className="right">tailnet-only</span>
        </div>
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
          <div className="confrow">
            <div className="k">
              <div className="label">Debug</div>
              <div className="desc">verbose errors — off in prod · restart to apply</div>
            </div>
            <Switch on={!!srv?.debug} onToggle={() => setSrv("debug", !srv?.debug)} />
          </div>
        </div>
        <div className="conf-savebar">
          <button
            className="conf-save"
            disabled={!dirty || save.isPending}
            onClick={onSave}
          >
            {save.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </div>

      <div className="confgroup">
        <div className="conftitle">
          <span className="num">03</span>
          <b>Computers</b>
          <span className="right">
            {hosts.length} machine{hosts.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="conf-card">
          {hosts.map((h) => (
            <div className="confrow" key={h.id}>
              <div className="k">
                <div className="label">{h.name}</div>
                <div className="desc code">
                  {h.ip} · {h.ssh_username ?? "—"}@{h.os_type}:{h.ssh_port}
                </div>
              </div>
              <span className={"badge" + (h.status?.online ? "" : " stale")}>
                {h.status?.online ? "awake" : "asleep"}
              </span>
              <span className="chev">›</span>
            </div>
          ))}
        </div>
      </div>

      <div className="confgroup">
        <div className="conftitle">
          <span className="num">04</span>
          <b>Appearance</b>
        </div>
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
      </div>

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
