import { useState } from "react";

import { Switch } from "./Switch";
import {
  useCreateHost,
  useDeleteHost,
  useDiscoverVpn,
  useUpdateHost,
} from "../hooks/useHostMutations";
import type { VpnApplyLine } from "../hooks/useHostMutations";
import { disclosureToggle } from "../lib/disclosure";
import { requestConfirm } from "../store/confirm";
import type { Host, HostServiceCfg, OSType } from "../types";

// Phase 7b — the Conf → Computers editor. Ports vapor.html's expandable machine rows + add-machine
// row (markup → React; the .mwrap/.mconf/.mform/.mfoot CSS is already in vapor.css, D7). The services
// sub-editor is net-new (no vapor markup) and styled in extras.css from VAPOR_PATTERNS recipes.

const OSES: OSType[] = ["linux", "windows", "macos"];
const CMD_ACTIONS = ["start", "stop", "restart"] as const;

interface SvcDraft {
  name: string;
  kind: string;
  port: string;
  path: string;
  autostart: boolean;
  cmd: Record<string, Record<string, string>>; // full {action:{os:command}}, other-OS entries carried
}

interface Draft {
  name: string;
  ip: string;
  vpn_host: string; // D3 slice 2 — VPN/overlay address (MagicDNS name preferred); "" clears it
  ssh_prefer_vpn: boolean; // D3 slice 2 — try the VPN address first for SSH
  wake_on_connect: boolean; // D2-B — WOL this machine when a client opens the live stream
  mac: string;
  ssh_username: string;
  ssh_password: string; // "" = unchanged (keep stored) on an existing host
  ssh_port: string;
  os_type: OSType;
  role: string;
  services: SvcDraft[];
  hasPassword: boolean;
}

function svcDraft(s: HostServiceCfg): SvcDraft {
  return {
    name: s.name,
    kind: s.kind ?? "",
    port: s.port == null ? "" : String(s.port),
    path: s.path ?? "",
    autostart: s.autostart,
    cmd: s.cmd ?? {},
  };
}

function draftFromHost(h: Host): Draft {
  return {
    name: h.name,
    ip: h.ip,
    vpn_host: h.vpn_host ?? "",
    ssh_prefer_vpn: !!h.ssh_prefer_vpn,
    wake_on_connect: !!h.wake_on_connect,
    mac: h.mac ?? "",
    ssh_username: h.ssh_username ?? "",
    ssh_password: "",
    ssh_port: String(h.ssh_port ?? 22),
    os_type: h.os_type,
    role: h.role ?? "",
    services: (h.services ?? []).map(svcDraft),
    hasPassword: !!h.has_password,
  };
}

function blankDraft(): Draft {
  return {
    name: "",
    ip: "",
    vpn_host: "",
    ssh_prefer_vpn: false,
    wake_on_connect: false,
    mac: "",
    ssh_username: "",
    ssh_password: "",
    ssh_port: "22",
    os_type: "linux",
    role: "",
    services: [],
    hasPassword: false,
  };
}

function toServiceCfg(s: SvcDraft): HostServiceCfg {
  return {
    name: s.name.trim(),
    kind: s.kind.trim() || null,
    port: s.port.trim() ? Number(s.port) : null,
    path: s.path.trim(),
    autostart: s.autostart,
    cmd: s.cmd,
  };
}

function toPayload(d: Draft) {
  return {
    name: d.name.trim(),
    ip: d.ip.trim(),
    // Always sent (this editor manages both fields now): a blank vpn_host clears it. The backend's
    // omit-preserves is only for OLD clients that never send them — explicit null here is correct (D47).
    vpn_host: d.vpn_host.trim() || null,
    ssh_prefer_vpn: d.ssh_prefer_vpn,
    // Always sent, like the vpn fields: the backend's omit-preserves guard exists for bodies that
    // don't model the field at all, so an explicit false from THIS editor is what clears the flag.
    wake_on_connect: d.wake_on_connect,
    mac: d.mac.trim() || null,
    ssh_username: d.ssh_username.trim() || null,
    ssh_password: d.ssh_password, // "" → keep (existing) / null-ish (new)
    ssh_port: Number(d.ssh_port) || 22,
    os_type: d.os_type,
    role: d.role.trim() || null,
    tags: [],
    services: d.services.map(toServiceCfg),
  };
}

/** One service's editable card (net-new component). Command fields target the host's OS; any
 * other-OS commands the service already had ride along untouched in `cmd`. */
function ServiceCard(props: {
  svc: SvcDraft;
  os: OSType;
  onChange: (s: SvcDraft) => void;
  onRemove: () => void;
}) {
  const { svc, os } = props;
  const set = (patch: Partial<SvcDraft>) => props.onChange({ ...svc, ...patch });
  const setCmd = (action: string, val: string) => {
    const cmd: Record<string, Record<string, string>> = { ...svc.cmd };
    const byOs = { ...(cmd[action] ?? {}) };
    if (val) byOs[os] = val;
    else delete byOs[os];
    if (Object.keys(byOs).length) cmd[action] = byOs;
    else delete cmd[action];
    set({ cmd });
  };
  return (
    <div className="svc-card">
      <div className="svc-grid">
        <input
          aria-label="service name"
          placeholder="name"
          value={svc.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        <input
          aria-label="service kind"
          placeholder="kind"
          value={svc.kind}
          onChange={(e) => set({ kind: e.target.value })}
        />
        <input
          aria-label="service port"
          placeholder="port"
          inputMode="numeric"
          value={svc.port}
          onChange={(e) => set({ port: e.target.value })}
        />
        <input
          aria-label="service path"
          placeholder="path"
          value={svc.path}
          onChange={(e) => set({ path: e.target.value })}
        />
      </div>
      <div className="svc-cmd">
        {CMD_ACTIONS.map((a) => (
          <input
            key={a}
            aria-label={`${a} command (${os})`}
            placeholder={`${a} cmd (${os})`}
            value={svc.cmd[a]?.[os] ?? ""}
            onChange={(e) => setCmd(a, e.target.value)}
          />
        ))}
      </div>
      <div className="svc-foot">
        <div className="svc-auto">
          <span>autostart</span>
          <Switch
            on={svc.autostart}
            onToggle={() => set({ autostart: !svc.autostart })}
            label="Autostart"
          />
        </div>
        <button type="button" className="svc-rm" onClick={props.onRemove}>
          remove
        </button>
      </div>
    </div>
  );
}

function MachineForm(props: {
  initial: Draft;
  isNew: boolean;
  busy: boolean;
  onSave: (d: Draft) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [d, setD] = useState<Draft>(props.initial);
  const [showPw, setShowPw] = useState(false);
  const [svcOpen, setSvcOpen] = useState(false); // services collapsed by default (usability)
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const setSvc = (i: number, s: SvcDraft) =>
    set({ services: d.services.map((x, j) => (j === i ? s : x)) });

  return (
    <>
      <div className="mform">
        <label>Hostname</label>
        <input
          aria-label="Hostname"
          autoComplete="off"
          value={d.name}
          placeholder={props.isNew ? "pegasus" : ""}
          onChange={(e) => set({ name: e.target.value })}
        />

        <label>IP or DNS name</label>
        {/* `ComputerCfg.ip` is a plain `str` — a DNS/MagicDNS name is as valid as a dotted quad, and
            the owner relies on that today (corsair's LAN SSH is firewalled, the tailnet name works).
            NO `inputMode` hint: `decimal` opened Android's number pad, making a name un-typeable
            (copy-paste only). Reverts to the full keyboard. (ROADMAP D3 splits LAN vs VPN properly.) */}
        <input
          aria-label="IP or DNS name"
          autoComplete="off"
          value={d.ip}
          placeholder="192.168.1.x or a DNS name"
          onChange={(e) => set({ ip: e.target.value })}
        />

        {/* D3 slice 2 — the VPN/overlay address. The field/payload key stay GENERIC (`vpn_host`); only
            this helper text names Tailscale. A MagicDNS name is preferred (it's reachable from any
            vantage); an overlay IP works too. Blank = LAN-only. Service links & SSH failover prefer it
            when you're on the tailnet (serviceBase + host_addresses). Plain text input, no inputMode. */}
        <label>VPN host</label>
        <input
          aria-label="VPN host"
          autoComplete="off"
          value={d.vpn_host}
          placeholder="corsair.tail-net.ts.net · MagicDNS name or IP"
          onChange={(e) => set({ vpn_host: e.target.value })}
        />

        <label>SSH via VPN first</label>
        <div className="mrow-switch">
          <Switch
            on={d.ssh_prefer_vpn}
            onToggle={() => set({ ssh_prefer_vpn: !d.ssh_prefer_vpn })}
            label="SSH via VPN first"
          />
        </div>

        <label>MAC</label>
        <input
          aria-label="MAC"
          value={d.mac}
          placeholder="aa:bb:cc:dd:ee:ff"
          onChange={(e) => set({ mac: e.target.value })}
        />

        {/* D2-B — wake-on-connect. Sits right after MAC because it depends on it: with no MAC the
            automatic wake degrades exactly like the Wake button does (a clean DENIED in the Event
            log, never a crash), so the hint says so instead of the form policing it. */}
        <label>Wake when I connect</label>
        <div className="mrow-switch">
          <Switch
            on={d.wake_on_connect}
            onToggle={() => set({ wake_on_connect: !d.wake_on_connect })}
            label="Wake when I connect"
          />
          <span className="mrow-hint">needs the MAC above</span>
        </div>

        <label>SSH user</label>
        <input
          aria-label="SSH user"
          autoComplete="off"
          value={d.ssh_username}
          placeholder="root"
          onChange={(e) => set({ ssh_username: e.target.value })}
        />

        <label>SSH port</label>
        <input
          aria-label="SSH port"
          value={d.ssh_port}
          placeholder="22"
          inputMode="numeric"
          onChange={(e) => set({ ssh_port: e.target.value })}
        />

        <label>SSH pass</label>
        <div className="pw">
          <input
            aria-label="SSH password"
            type={showPw ? "text" : "password"}
            value={d.ssh_password}
            placeholder={d.hasPassword ? "•••••••• (unchanged)" : "set a password"}
            autoComplete="new-password"
            onChange={(e) => set({ ssh_password: e.target.value })}
          />
          <button
            type="button"
            className={"reveal" + (showPw ? " on" : "")}
            onClick={() => setShowPw(!showPw)}
          >
            {showPw ? "hide" : "show"}
          </button>
        </div>

        <label>OS</label>
        <select
          aria-label="OS"
          value={d.os_type}
          onChange={(e) => set({ os_type: e.target.value as OSType })}
        >
          {OSES.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>

      <div className={"svc-edit" + (svcOpen ? " open" : "")}>
        <div className="svc-edit-head" {...disclosureToggle(svcOpen, () => setSvcOpen(!svcOpen))}>
          <span>Services{d.services.length ? ` · ${d.services.length}` : ""}</span>
          <span className="svc-chev" aria-hidden>
            ›
          </span>
        </div>
        {svcOpen && (
          <div className="svc-body">
            {d.services.length === 0 && <div className="svc-empty">no services declared</div>}
            {d.services.map((s, i) => (
              <ServiceCard
                key={i}
                svc={s}
                os={d.os_type}
                onChange={(ns) => setSvc(i, ns)}
                onRemove={() => set({ services: d.services.filter((_, j) => j !== i) })}
              />
            ))}
            <button
              type="button"
              className="svc-add"
              onClick={() =>
                set({
                  services: [
                    ...d.services,
                    { name: "", kind: "", port: "", path: "", autostart: false, cmd: {} },
                  ],
                })
              }
            >
              + service
            </button>
          </div>
        )}
      </div>

      <div className="mfoot">
        {props.isNew ? (
          <>
            <button type="button" onClick={props.onCancel}>
              cancel
            </button>
            <button
              type="button"
              className="save"
              disabled={props.busy}
              onClick={() => props.onSave(d)}
            >
              {props.busy ? "adding…" : "add machine"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="danger" disabled={props.busy} onClick={props.onDelete}>
              remove
            </button>
            <button
              type="button"
              className="save"
              disabled={props.busy}
              onClick={() => props.onSave(d)}
            >
              {props.busy ? "saving…" : "save"}
            </button>
          </>
        )}
      </div>
    </>
  );
}

/** Inline text for one discovery outcome line (D3 slice 3). */
function applyLineText(l: VpnApplyLine): string {
  switch (l.status) {
    case "filled":
      return "filled";
    case "already-set":
      return "already set";
    case "differs":
      return `differs: ${l.proposed ?? ""}`;
    case "no-match":
      return "no match";
    case "skipped":
      return "skipped — editor open";
    case "failed":
      return "fill failed";
  }
}

export function MachineEditor({ hosts }: { hosts: Host[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const create = useCreateHost();
  const update = useUpdateHost();
  const remove = useDeleteHost();
  const discover = useDiscoverVpn(); // D3 slice 3 — VPN-address discovery (on-demand only)

  const save = (id: string | null, d: Draft) => {
    const payload = toPayload(d);
    if (!payload.name || !payload.ip) return; // backend also 422s; keep the bad request from firing
    if (id) update.mutate({ id, payload }, { onSuccess: () => setOpenId(null) });
    else create.mutate(payload, { onSuccess: () => setAdding(false) });
  };

  const onDelete = async (h: Host) => {
    const ok = await requestConfirm({
      title: `Remove ${h.name}?`,
      body: "Deletes this machine (and its services) from config.yaml.",
      confirmLabel: "remove",
      danger: true,
    });
    if (ok) remove.mutate(h.id, { onSuccess: () => setOpenId(null) });
  };

  return (
    <div className="conf-card">
      {hosts.map((h) => (
        <div className={"mwrap" + (openId === h.id ? " open" : "")} key={h.id}>
          <div
            className="confrow"
            {...disclosureToggle(openId === h.id, () => {
              setOpenId(openId === h.id ? null : h.id);
              setAdding(false);
            })}
          >
            <div className="k">
              <div className="label">{h.name}</div>
              <div className="desc code">
                {h.ssh_username
                  ? `${h.ssh_username}@${h.ip}:${h.ssh_port}`
                  : `${h.ip}:${h.ssh_port}`}{" "}
                · {h.os_type}
                {h.vpn_host ? " · vpn" : ""}
              </div>
            </div>
            <span className={"badge" + (h.status?.online ? "" : " stale")}>
              {h.status?.online ? "awake" : "asleep"}
            </span>
            <span className="chev" aria-hidden>
              ›
            </span>
          </div>
          <div className="mconf">
            {openId === h.id && (
              <MachineForm
                initial={draftFromHost(h)}
                isNew={false}
                busy={update.isPending || remove.isPending}
                onSave={(d) => save(h.id, d)}
                onCancel={() => setOpenId(null)}
                onDelete={() => onDelete(h)}
              />
            )}
          </div>
        </div>
      ))}

      <div className={"mwrap add" + (adding ? " open" : "")}>
        <div
          className="confrow"
          {...disclosureToggle(adding, () => {
            setAdding(!adding);
            setOpenId(null);
          })}
        >
          <div className="k">
            <div className="label">add machine</div>
            <div className="desc">writes a new entry to config.yaml</div>
          </div>
          <span className="chev" aria-hidden>
            ›
          </span>
        </div>
        <div className="mconf">
          {adding && (
            <MachineForm
              initial={blankDraft()}
              isNew
              busy={create.isPending}
              onSave={(d) => save(null, d)}
              onCancel={() => setAdding(false)}
            />
          )}
        </div>
      </div>

      {/* D3 slice 3 — fill empty VPN hosts from the tailnet peer list. Read-only fetch, then auto-apply
          the proposal to every host whose vpn_host is blank (except the currently-open editor row, whose
          draft was seeded at mount). Existing values are never overwritten. Reuses the redisc bar recipe;
          the results below are transient (mutation state), not persisted. Tailscale wording lives only
          in the button label — the hook/types are provider-neutral. */}
      <div className="conf-savebar redisc">
        <span className="redisc-hint">// fill empty VPN hosts from the tailnet</span>
        <button
          type="button"
          className="conf-save alt"
          disabled={discover.isPending}
          onClick={() => discover.mutate({ skipId: openId })}
        >
          {discover.isPending ? "Discovering…" : "Discover from Tailscale"}
        </button>
      </div>
      {discover.data && (
        <div className="vpn-discover-results">
          {!discover.data.ok ? (
            <div className="vpn-discover-line err">{discover.data.reason}</div>
          ) : (
            discover.data.lines.map((l, i) => (
              <div className="vpn-discover-line" key={`${l.name}-${i}`}>
                <span className="vpn-dh">{l.name}</span>
                <span className={"vpn-ds " + l.status}>{applyLineText(l)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
