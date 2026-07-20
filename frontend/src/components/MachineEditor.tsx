import { useState } from "react";

import { Switch } from "./Switch";
import { useCreateHost, useDeleteHost, useUpdateHost } from "../hooks/useHostMutations";
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
          value={d.ip}
          placeholder="192.168.1.x or a DNS name"
          onChange={(e) => set({ ip: e.target.value })}
        />

        <label>MAC</label>
        <input
          aria-label="MAC"
          value={d.mac}
          placeholder="aa:bb:cc:dd:ee:ff"
          onChange={(e) => set({ mac: e.target.value })}
        />

        <label>SSH user</label>
        <input
          aria-label="SSH user"
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

export function MachineEditor({ hosts }: { hosts: Host[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const create = useCreateHost();
  const update = useUpdateHost();
  const remove = useDeleteHost();

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
                {h.ip} · {h.ssh_username ?? "—"}@{h.os_type}:{h.ssh_port}
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
    </div>
  );
}
