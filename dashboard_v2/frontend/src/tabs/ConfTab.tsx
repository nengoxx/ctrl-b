import { useHosts, useServerInfo } from "../hooks/useFleet";
import { setUI, useUI, type Skyline, type Theme, type Loz } from "../store/ui";

// Conf tab. Phase 1 wires the **Appearance** group to the live UI store (theme/skyline/app-mark
// + hero/waveform toggles) — the home for the theming deliverable — and shows the real fleet
// read-only under Computers. Inference / prompts / server / hosts-CRUD are static here and get
// their YAML-backed editors in Phase 7.

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

export function ConfTab({ active }: Props) {
  const { theme, skyline, loz, heroOn, waveformOn } = useUI();
  const { data: server } = useServerInfo();
  const { data: hosts = [] } = useHosts(server?.poll_seconds ?? 5);

  return (
    <div className={"tab" + (active ? " active" : "")} id="tab-conf" data-screen-label="04 Conf">
      <div className="confgroup">
        <div className="conftitle">
          <span className="num">01</span>
          <b>Inference</b>
          <span className="right">phase 7</span>
        </div>
        <div className="conf-card">
          <div className="confrow">
            <div className="k">
              <div className="label">Mode</div>
              <div className="desc">local · cloud (OpenAI-compatible)</div>
            </div>
            <div className="seg">
              <button className="active">Local</button>
              <button>Cloud</button>
            </div>
          </div>
          <div className="confrow">
            <div className="k">
              <div className="label">Local endpoint</div>
              <div className="desc">llama.cpp · /v1</div>
            </div>
            <input type="text" defaultValue="http://localhost:8080/v1" disabled />
          </div>
        </div>
      </div>

      <div className="confgroup">
        <div className="conftitle">
          <span className="num">02</span>
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
          <span className="num">03</span>
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
