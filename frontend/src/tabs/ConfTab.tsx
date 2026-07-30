import { useEffect, useId, useRef, useState } from "react";

import { AgentsEditor } from "../components/AgentsEditor";
import { AutomationsPanel } from "../components/AutomationsPanel";
import { ConfGroup } from "../components/ConfGroup";
import { JsonField } from "../components/JsonField";
import { MachineEditor } from "../components/MachineEditor";
import { MemoryEditor } from "../components/MemoryEditor";
import { NumField } from "../components/NumField";
import { type PickerCatalog, type PickerValue } from "../components/ProviderModelPicker";
import { SectionRefEditor } from "../components/SectionRefEditor";
import { Seg } from "../components/Seg";
import { ServerListEditor } from "../components/ServerListEditor";
import { SettingRow } from "../components/SettingRow";
import { SkillsEditor } from "../components/SkillsEditor";
import { Swatches } from "../components/Swatches";
import { Switch } from "../components/Switch";
import { useAccessStatus, useSetServe } from "../hooks/useAccess";
import { useAppChrome } from "../hooks/useAppChrome";
import { AUTOMATIONS_GROUP_ID, automationsSummary, useAutomations } from "../hooks/useAutomations";
import { useSections } from "../hooks/useSections";
import { currentAppearancePatch, useSaveAppearance } from "../hooks/useAppearance";
import { agentModeOf, useActionSpecs } from "../hooks/useActions";
import { disclosureToggle } from "../lib/disclosure";
import { pickAgentSection, useAgentList, type AgentSectionCfg } from "../hooks/useAgents";
import { useDefaultPrompt } from "../hooks/useDefaultPrompt";
import { useHosts, useServerInfo } from "../hooks/useFleet";
import {
  notificationPermission,
  requestNotificationPermission,
} from "../hooks/useForegroundNotifications";
import { useIntegrationsStatus, useRediscover } from "../hooks/useIntegrations";
import { type MemoryCfg } from "../hooks/useMemory";
import {
  useProviders,
  useSaveSettings,
  useSettings,
  useSettingsProvidersRev,
  type ModelDoc,
  type ProviderDoc,
  type SavePatch,
  type SectionRef,
  type SettingsDoc,
} from "../hooks/useSettings";
import { useSkills } from "../hooks/useSkills";
import { promptPreview } from "../lib/promptPreview";
import { setCollapsed } from "../store/collapse";
import { isAnyDirty, useRegisterDirty } from "../store/dirty";
import { clearGroupScrollTarget, useGroupScrollTarget } from "../store/groupScroll";
import { requestPrompt } from "../store/prompt";
import { pushToast } from "../store/toast";
import { HOSTED_UTILS_GROUP_ID } from "../theme-engine/layout";
import { registry, registeredThemes } from "../theme-engine/registry";
import { defaultSwitchTarget } from "../theme-engine/resolve";
import { switchTheme } from "../theme-engine/switchTheme";
import type { LayoutId, Mode, ThemeId, ThemeSettingValue } from "../theme-engine/types";
import { setThemeSetting, setUI, useUISlice, type AppbarMode } from "../store/ui";
import { UtilsContent } from "./UtilsTab";

// Conf tab. Appearance is wired to the live UI store (client display state). Phase 7a wires the
// **Inference** + **Server** groups to the YAML-backed settings API (GET masked / PUT partial
// patch). Computers stays read-only here (hosts CRUD is Phase 7b); prompts/memory/integrations
// land in later 7 slices. vapor.css is untouched (D7) — net-new pixels live in theme/extras.css.

interface Props {
  active: boolean;
}

/** HTTPS access (Tailscale Serve) — 6c-2. A live-action card inside the Server group: flips the
 *  tailnet HTTPS front door on/off (so the phone mic gets a secure context) and shows the URL to open.
 *  Acts immediately (not via the draft/saveBar); tailscaled is the source of truth. Degrades to a hint
 *  when the CLI is unavailable. */
function TailscaleAccessCard() {
  const { data, isLoading } = useAccessStatus();
  const setServe = useSetServe();
  const copy = (url: string) =>
    void navigator.clipboard?.writeText(url).then(
      () => pushToast("URL copied", "ok"),
      () => pushToast("Copy failed", "err"),
    );

  if (isLoading || !data || !data.enabled) return null; // not ready, or control disabled in config

  if (!data.available) {
    return (
      <div className="conf-card access-card">
        <div className="confrow">
          <div className="k">
            <div className="label">HTTPS access (Tailscale Serve)</div>
            <div className="desc">
              unavailable — {data.reason ?? "tailscale not ready"} · see HTTPS_TAILSCALE.md
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="conf-card access-card">
      <SettingRow
        label="HTTPS access (Tailscale Serve)"
        desc={
          <>
            {data.serving
              ? "on — the phone mic works over HTTPS"
              : "off — enable for the phone mic (secure context)"}{" "}
            · port {data.target_port}
          </>
        }
      >
        <Switch
          on={data.serving}
          label="HTTPS (Tailscale Serve)"
          onToggle={() => {
            if (!setServe.isPending) setServe.mutate(!data.serving);
          }}
        />
      </SettingRow>
      {data.url && (
        <div className="confrow">
          <div className="k">
            <div className="label">URL</div>
            <div className="desc conf-url">{data.url}</div>
          </div>
          <button type="button" className="conf-copy" onClick={() => copy(data.url!)}>
            copy
          </button>
        </div>
      )}
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
  // a11y (D25): the visible label is a `<div>` (not a `<label>`), and inside `.confrow .k` (block flow)
  // swapping it to a native `<label>` would shift the block→inline layout. So we associate via
  // `aria-labelledby` instead — zero layout risk, same accessible name. (The editors, whose labels live
  // in `.mform` grids, use native `<label htmlFor>`; see D25 for why the mechanism differs by context.)
  const labelId = useId();
  return (
    <div className="confrow">
      <div className="k">
        <div className="label" id={labelId}>
          {props.label}
        </div>
        <div className="desc">
          {props.desc}
          {props.restart ? " · restart to apply" : ""}
        </div>
      </div>
      <input
        type={props.type ?? "text"}
        // Chrome's password manager pairs a bare type="password" with a nearby text field as a
        // "username" and offers to save the pair (the owner saw it latch onto the IP field). These
        // are API keys, not login credentials — `new-password` suppresses autofill AND the save
        // prompt (the MachineEditor/ServerListEditor precedent), derived here so every password
        // Field gets it and no call site can forget.
        autoComplete={props.type === "password" ? "new-password" : undefined}
        value={props.value}
        placeholder={props.placeholder}
        aria-labelledby={labelId}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

/** A prompt/markdown field shown as a 1-line preview + an "Edit fullscreen ↗" opener that routes to
 *  the shared PromptModal (7e-b). The full text lives behind the modal so the Conf list stays
 *  scannable; the modal hands back the edited string, which the caller folds into its group draft. */
function PromptRow(props: {
  label: string;
  desc: string;
  value: string;
  emptyHint: string;
  onEdit: () => void;
}) {
  return (
    <div className="confrow conf-promptrow">
      <div className="k">
        <div className="label">{props.label}</div>
        <div className="desc">{props.desc}</div>
        <div className="prompt-preview">{promptPreview(props.value, props.emptyHint)}</div>
      </div>
      <button type="button" className="prompt-open" onClick={props.onEdit}>
        Edit fullscreen ↗
      </button>
    </div>
  );
}

// A11 / D48 — provider name slug + the small enum option lists for the Providers cards.
const PROVIDER_SLUG = /^[a-z0-9][a-z0-9_+.-]{0,31}$/;
/** Provider/model names the backend rejects because they collide with a secret field (D48 C1 —
 *  `config.is_secret_sentinel_name`, the source of truth). Mirrored here ONLY because it is a fixed
 *  schema rule with no wire representation; the RESERVED VERBS, which do have one, are read from
 *  `GET /api/providers` instead of being copied. */
const SECRET_SENTINEL_NAMES = ["api_key", "ssh_password", "password", "token", "env", "headers"];
const API_MODES = [
  { val: "openai", label: "openai" },
  { val: "llamacpp", label: "llamacpp" },
  { val: "openrouter", label: "openrouter" },
  { val: "none", label: "none" },
];

function emptyProvider(): ProviderDoc {
  return { base_url: "", api_key: null, api_mode: "openai", models: {} };
}

// A stable per-instance id source for model rows (survives clean-name renames so a JSON block or the
// local edit state never jumps rows). Module-level counter — ids are only compared, never persisted.
let MODEL_ROW_SEQ = 0;

/** A small inline warnings/notice list (D48 B5 / R22). Visual precedent: `.redisc-hint`. Rendered in
 *  the owning ConfGroup; fed by PUT-response warnings (after save) + GET /api/providers boot warnings. */
function WarnRow({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <div className="conf-warnrow">
      {warnings.map((w, i) => (
        <div className="conf-warn" key={i}>
          ⚠ {w}
        </div>
      ))}
    </div>
  );
}

/** One provider card (D48 B1) on the vapor `.mwrap` disclosure recipe: connection fields + a model
 *  catalog sub-list. Rename is an explicit control (feeds `provider_renames`), never a bare key edit.
 *  Model clean names are edited on a LOCAL row array so a transient duplicate never collapses the map;
 *  a duplicate/blank name blocks the save (reported via `onValidity`). extra_body is a guarded JSON row. */
function ProviderCard(props: {
  name: string;
  doc: ProviderDoc;
  open: boolean;
  onToggle: () => void;
  referencedBy: string[];
  existingNames: string[];
  onChange: (doc: ProviderDoc) => void;
  onRename: (next: string) => void;
  serverNames: string[]; // names still live on the SERVER — a rename onto one of those 422s
  onRemove: () => void;
  onValidity: (id: string, valid: boolean) => void;
}) {
  const { name, doc, onValidity } = props;
  const set = (p: Partial<ProviderDoc>) => props.onChange({ ...doc, ...p });
  const prefix = `provider:${name}`;

  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(name);
  // P12 — per-model "Advanced" disclosure (wire id + max-tokens field + extra_body). A row auto-reveals
  // when any advanced field is non-default (preserving the old wire-id auto-reveal), but the user can still
  // override that in EITHER direction: the map holds an explicit per-row open/closed override keyed by the
  // row's stable id; when absent, the auto-reveal (`advNonDefault`) decides. A plain toggled Set couldn't
  // close an auto-opened row, and snapped rows shut when the last non-default field reset mid-edit.
  const [advOpen, setAdvOpen] = useState<Map<number, boolean>>(new Map());

  const seedRows = () =>
    Object.entries(doc.models ?? {}).map(([key, d]) => ({ id: MODEL_ROW_SEQ++, key, doc: d }));
  const [rows, setRows] = useState(seedRows);

  // Draft-epoch reseed guard: adopt an EXTERNAL change to the map (background refetch / save reconcile),
  // never our own just-committed edit. `committedRef` holds the JSON we last emitted.
  const committedRef = useRef(JSON.stringify(doc.models ?? {}));
  const modelsJson = JSON.stringify(doc.models ?? {});
  useEffect(() => {
    if (modelsJson === committedRef.current) return;
    committedRef.current = modelsJson;
    setRows(seedRows());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsJson]);

  // Clear this card's block on unmount (removed / renamed → remount) so no stale save-block lingers.
  const validityRef = useRef(props.onValidity);
  validityRef.current = props.onValidity;
  useEffect(() => () => validityRef.current(`${prefix}:models`, true), [prefix]);

  const commit = (next: typeof rows) => {
    setRows(next);
    const map: Record<string, ModelDoc> = {};
    let bad = false;
    for (const r of next) {
      const k = r.key.trim();
      if (!k || k in map) {
        bad = true;
        continue;
      }
      map[k] = r.doc;
    }
    onValidity(`${prefix}:models`, !bad);
    if (!bad) {
      committedRef.current = JSON.stringify(map);
      set({ models: map });
    }
  };
  const setRowKey = (i: number, key: string) =>
    commit(rows.map((r, j) => (j === i ? { ...r, key } : r)));
  const setRowDoc = (i: number, p: Partial<ModelDoc>) =>
    commit(rows.map((r, j) => (j === i ? { ...r, doc: { ...r.doc, ...p } } : r)));
  const addModel = () => {
    const base = "model";
    let n = base;
    let k = 2;
    const taken = new Set(rows.map((r) => r.key));
    while (taken.has(n)) n = `${base}-${k++}`;
    commit([...rows, { id: MODEL_ROW_SEQ++, key: n, doc: {} }]);
  };
  const removeModel = (i: number) => commit(rows.filter((_, j) => j !== i));

  // P6 — per-row name validity, surfaced inline at the offending field (the save-block is set in commit()
  // via onValidity; this mirrors the same rule for the visible ⚠). First occurrence wins; blanks + later
  // duplicates are flagged.
  const nameErrors = (() => {
    const seen = new Set<string>();
    return rows.map((r) => {
      const k = r.key.trim();
      if (!k) return "name can’t be blank";
      if (seen.has(k)) return "duplicate model name";
      seen.add(k);
      return null;
    });
  })();
  // P12 — a row's Advanced fold auto-opens when any advanced field is non-default (id set + differs from the
  // clean name, an explicit max-tokens override, or a non-empty extra_body).
  const advNonDefault = (r: (typeof rows)[number]) =>
    (r.doc.id != null && r.doc.id !== r.key) ||
    r.doc.max_tokens_field != null ||
    (r.doc.extra_body != null && Object.keys(r.doc.extra_body).length > 0) ||
    // A11/D48 Slice 2 — a set per-role voice/embeddings field also reveals the fold.
    r.doc.voice != null ||
    r.doc.speed != null ||
    r.doc.language != null ||
    r.doc.format != null ||
    r.doc.dim != null;

  const commitRename = () => {
    const nn = renameVal.trim().toLowerCase();
    setRenaming(false);
    if (nn === name) return;
    if (!PROVIDER_SLUG.test(nn)) {
      pushToast("provider name: a–z 0–9 _ + . - (max 32)", "err");
      setRenameVal(name);
      return;
    }
    if (props.existingNames.includes(nn) || props.serverNames.includes(nn)) {
      // `serverNames` too: renaming ONTO a name the draft has deleted but the server still has passes
      // the draft check and then 422s ("destination already exists"), because the server resolves the
      // rename against its own state (Codex, review of the fix wave).
      pushToast("a provider with that name exists", "err");
      setRenameVal(name);
      return;
    }
    props.onRename(nn);
  };

  return (
    <div className={"mwrap" + (props.open ? " open" : "")}>
      <div className="confrow" {...disclosureToggle(props.open, props.onToggle)}>
        <div className="k">
          <div className="label">{name}</div>
          <div className="desc">
            {doc.api_mode} · {Object.keys(doc.models ?? {}).length} model
            {Object.keys(doc.models ?? {}).length === 1 ? "" : "s"}
            {props.referencedBy.length ? ` · referenced by ${props.referencedBy.join(", ")}` : ""}
          </div>
        </div>
        <span className="chev" aria-hidden>
          ›
        </span>
      </div>
      <div className="mconf">
        {props.open && (
          <>
            <div className="mform">
              <label>Name</label>
              {renaming ? (
                <div className="pm-raw">
                  <input
                    aria-label="New provider name"
                    value={renameVal}
                    autoFocus
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") {
                        setRenaming(false);
                        setRenameVal(name);
                      }
                    }}
                  />
                  <button type="button" className="pm-listbtn" onClick={commitRename}>
                    ok
                  </button>
                </div>
              ) : (
                <div className="pm-raw">
                  <span className="provider-name">{name}</span>
                  <button
                    type="button"
                    className="pm-listbtn"
                    onClick={() => {
                      setRenameVal(name);
                      setRenaming(true);
                    }}
                  >
                    rename
                  </button>
                </div>
              )}

              <label>Base URL</label>
              <input
                aria-label="Base URL"
                value={doc.base_url}
                placeholder="http://host:port/v1"
                onChange={(e) => set({ base_url: e.target.value })}
              />

              <label>API key</label>
              <input
                aria-label="API key"
                type="password"
                autoComplete="new-password"
                value={doc.api_key ?? ""}
                placeholder="optional — leave blank to keep the saved key"
                onChange={(e) => set({ api_key: e.target.value })}
              />

              <label>API mode</label>
              <Seg
                label="API mode"
                current={doc.api_mode}
                options={API_MODES}
                onPick={(v) => set({ api_mode: v as ProviderDoc["api_mode"] })}
              />

              <label>Max concurrent</label>
              <NumField
                id={`${prefix}:max_concurrent`}
                value={doc.max_concurrent_requests}
                ariaLabel="Max concurrent requests"
                placeholder="unlimited"
                min={1}
                onChange={(v) => set({ max_concurrent_requests: v })}
                onValidity={onValidity}
              />

              <label>Retry attempts</label>
              <NumField
                id={`${prefix}:retry`}
                value={doc.retry_attempts}
                ariaLabel="Retry attempts"
                placeholder="inherit global"
                min={0}
                onChange={(v) => set({ retry_attempts: v })}
                onValidity={onValidity}
              />

              <label>Output-limit param</label>
              <select
                aria-label="Output-limit parameter"
                value={doc.max_tokens_field ?? ""}
                onChange={(e) =>
                  set({
                    max_tokens_field:
                      e.target.value === ""
                        ? null
                        : (e.target.value as ProviderDoc["max_tokens_field"]),
                  })
                }
              >
                <option value="">auto</option>
                <option value="max_tokens">max_tokens</option>
                <option value="max_completion_tokens">max_completion_tokens</option>
              </select>
              <p className="mform-note">
                which API field carries the output-token cap · auto picks it from the API mode
                (reasoning models need max_completion_tokens)
              </p>
            </div>

            <div className="fallback-section">
              <span className="label">Models</span>
              <span className="desc">one row per model</span>
            </div>
            {rows.map((r, i) => {
              const nameErr = nameErrors[i];
              const nameErrId = `${prefix}:model:${r.id}:name-err`;
              const advIsOpen = advOpen.get(r.id) ?? advNonDefault(r);
              const toggleAdv = () => setAdvOpen((s) => new Map(s).set(r.id, !advIsOpen));
              return (
                <div className="model-row" key={r.id}>
                  {/* the clean essentials — a default model row shows only name + context window (P12) */}
                  <div className="mform">
                    <label>Name</label>
                    <input
                      aria-label="Model name"
                      value={r.key}
                      placeholder="clean name"
                      aria-invalid={nameErr ? true : undefined}
                      aria-describedby={nameErr ? nameErrId : undefined}
                      onChange={(e) => setRowKey(i, e.target.value)}
                    />
                    {nameErr && (
                      <div className="json-err" id={nameErrId} role="alert">
                        ⚠ {nameErr}
                      </div>
                    )}
                    <label>Context window</label>
                    <NumField
                      id={`${prefix}:model:${r.id}:ctx`}
                      value={r.doc.context_window}
                      ariaLabel="Model context window"
                      placeholder="auto"
                      min={1}
                      onChange={(v) => setRowDoc(i, { context_window: v })}
                      onValidity={onValidity}
                    />
                  </div>
                  {/* Advanced fold — wire id + max-tokens field + extra_body + the per-role voice/embeddings
                      fields (voice/speed/language/format/dim), on the shared `.svc-edit` disclosure idiom.
                      Auto-opens when any is non-default (preserves the old wire-id auto-reveal). The voice
                      fields feed the STT/TTS/embeddings resolvers (D48 C8; FX17 deferral closed in Slice 2). */}
                  <div className={"svc-edit" + (advIsOpen ? " open" : "")}>
                    <div
                      className="svc-edit-head"
                      role="button"
                      tabIndex={0}
                      aria-expanded={advIsOpen}
                      onClick={toggleAdv}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleAdv();
                        }
                      }}
                    >
                      <span>Advanced</span>
                      <span className="svc-chev" aria-hidden>
                        ›
                      </span>
                    </div>
                    {advIsOpen && (
                      <div className="svc-body">
                        <div className="mform">
                          <label>Model ID</label>
                          <input
                            aria-label="Model ID"
                            value={r.doc.id ?? ""}
                            placeholder="defaults to the name"
                            onChange={(e) => setRowDoc(i, { id: e.target.value || null })}
                          />
                          <label>Output-limit param</label>
                          <select
                            aria-label="Model output-limit parameter"
                            value={(r.doc.max_tokens_field as string | null | undefined) ?? ""}
                            onChange={(e) =>
                              setRowDoc(i, {
                                max_tokens_field:
                                  e.target.value === ""
                                    ? null
                                    : (e.target.value as ModelDoc["max_tokens_field"]),
                              })
                            }
                          >
                            <option value="">inherit provider</option>
                            <option value="max_tokens">max_tokens</option>
                            <option value="max_completion_tokens">max_completion_tokens</option>
                          </select>
                          <label>Extra body</label>
                          <JsonField
                            id={`${prefix}:model:${r.id}:json`}
                            value={r.doc.extra_body}
                            ariaLabel="Model extra_body"
                            onChange={(v) => setRowDoc(i, { extra_body: v })}
                            onValidity={onValidity}
                          />
                          {/* A11/D48 Slice 2 (FX17 closes) — the per-role voice/embeddings model fields.
                              Each is optional and inherits the section/protocol default when blank; they
                              feed the STT/TTS/embeddings resolvers via ModelDoc.voice/speed/language/format/dim. */}
                          <label>Voice</label>
                          <input
                            aria-label="Model voice"
                            value={r.doc.voice ?? ""}
                            placeholder="model default"
                            onChange={(e) => setRowDoc(i, { voice: e.target.value || null })}
                          />
                          <p className="mform-note">
                            TTS server voice id · blank uses the protocol default
                          </p>
                          <label>Speed</label>
                          <NumField
                            id={`${prefix}:model:${r.id}:speed`}
                            value={r.doc.speed}
                            ariaLabel="Model speed"
                            placeholder="server default"
                            integer={false}
                            min={0}
                            exclusiveMin
                            onChange={(v) => setRowDoc(i, { speed: v })}
                            onValidity={onValidity}
                          />
                          <p className="mform-note">
                            TTS playback rate · blank uses the server default
                          </p>
                          <label>Language</label>
                          <input
                            aria-label="Model language"
                            value={r.doc.language ?? ""}
                            placeholder="service setting"
                            onChange={(e) => setRowDoc(i, { language: e.target.value || null })}
                          />
                          <p className="mform-note">
                            STT transcription language · blank uses the section setting
                          </p>
                          <label>Audio format</label>
                          <input
                            aria-label="Model audio format"
                            value={r.doc.format ?? ""}
                            placeholder="service setting"
                            onChange={(e) => setRowDoc(i, { format: e.target.value || null })}
                          />
                          <p className="mform-note">
                            TTS response container (mp3/opus/wav) · blank uses the section setting
                          </p>
                          <label>Embedding dim</label>
                          <NumField
                            id={`${prefix}:model:${r.id}:dim`}
                            value={r.doc.dim}
                            ariaLabel="Model embedding dim"
                            placeholder="unset"
                            min={1}
                            onChange={(v) => setRowDoc(i, { dim: v })}
                            onValidity={onValidity}
                          />
                          <p className="mform-note">
                            embedding vector size · blank leaves it unset
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  {/* remove-idiom rule (P13): a card ENTITY (a model / a provider) removes via the `.mfoot`
                      text-danger button; a compact INLINE list row (an inference fallback) removes via its
                      leading ✕ `.fb-remove` glyph. Follow this split for future editors. */}
                  <div className="mfoot">
                    <button type="button" className="danger" onClick={() => removeModel(i)}>
                      remove model
                    </button>
                  </div>
                </div>
              );
            })}
            <div className="fallback-add">
              <button type="button" className="svc-add" onClick={addModel}>
                + add model
              </button>
            </div>

            {/* P4 — a referenced provider can't be removed; say so in visible text (not just a tooltip). */}
            {props.referencedBy.length > 0 && (
              <div className="mfoot-note">
                referenced by {props.referencedBy.join(", ")} — remove those references first
              </div>
            )}
            {/* remove-idiom (P13): a provider is a card ENTITY → `.mfoot` text-danger button. */}
            <div className="mfoot">
              <button
                type="button"
                className="danger"
                disabled={props.referencedBy.length > 0}
                onClick={props.onRemove}
              >
                remove provider
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Just the slices the 7a form edits — kept verbatim from the loaded doc so a save round-trips the
// masked api_key (the backend restores it) and leaves every other section untouched. A11: `providers`
// rides the same draft with replacement semantics + the rename metadata.
type Draft = Pick<
  SettingsDoc,
  | "server"
  | "inference"
  | "searxng"
  | "embeddings"
  | "open_terminal"
  | "shell"
  | "voice"
  | "notifications"
  | "providers"
>;

// F1 — the seed used when the settings doc carries no `notifications` block. The live backend always
// sends one (`Settings` defaults the section, so the dump includes it), so this only bites against a
// doc from an older/mismatched build — but the draft, the changed-section diff and the row controls
// all assume a well-formed object, and `undefined` propagating through those is a worse failure than
// one explicit default. Same defensive shape `memoryCfg`/`agentCfg` use for their sections.
const NOTIFICATIONS_FALLBACK: SettingsDoc["notifications"] = {
  enabled: false,
  events: { agent_input: true, turn_done: true, action_failed: true, automation_done: true },
};

function pickDraft(s: SettingsDoc): Draft {
  return {
    server: s.server,
    providers: s.providers,
    inference: s.inference,
    searxng: s.searxng,
    embeddings: s.embeddings,
    open_terminal: s.open_terminal,
    shell: s.shell,
    voice: s.voice,
    notifications: s.notifications ?? NOTIFICATIONS_FALLBACK,
  };
}

const RISKS = [
  { val: "low", label: "Low" },
  { val: "med", label: "Med" },
  { val: "high", label: "High" },
];

/** A Conf section whose header collapses its body (persisted per `id`). Same vapor `.conftitle` look
 * + a leading disclosure chevron; collapsing doesn't alter the design, just hides the body.
 *
 * F29 — children stay MOUNTED when collapsed; CSS hides them via `.confgroup.collapsed > *:not(.conftitle) { display: none; }`
 * in extras.css. This preserves any in-progress edits in the sub-editors (Agents / Skills / Machines /
 * Integrations) across a collapse-expand cycle. Mirrors the project's existing "keep mounted, toggle
 * visibility" pattern from the four top-level tabs (Fleet/Agent/Utils stay mounted; only `.tab.active`
 * is visible). Reload-survival is a future enhancement — see UI_AUDIT.md §6b. */
export function ConfTab({ active }: Props) {
  // One slice per Appearance field — each toggle only re-renders the consumers that actually read that
  // specific field. The active theme's per-theme settings (M3 §14.3) come from one slice on its
  // `themeSettings[theme]` map (a stable ref until a setting changes); their schema comes from the
  // ThemeDef so the rows auto-render (no hardcoded skyline/loz/hero/waveform rows).
  const theme = useUISlice((s) => s.theme); // the active skin id
  const accent = useUISlice((s) => s.accent); // named palette / hue (vapor: dark/aqua/ember)
  const mode = useUISlice((s) => s.mode); // light/dark (only shown when the active theme declares modes)
  const motion = useUISlice((s) => s.motion);
  const perf = useUISlice((s) => s.perf);
  const appbarMode = useUISlice((s) => s.appbarMode); // global, per-device (local) — every theme honors it
  const layout = useUISlice((s) => s.layout); // the RAW section-layout lever (auto/4/3/2) — device-local like App bar
  // The resolved partition (D35 §F0): `hostsUtils` = the active layout renders utils INSIDE Conf, so this
  // tab hosts the Tools group. The scroll-to-group handoff (armed by `useSections.navigate` when it coerces
  // a `utils` nav here) is consumed by the effect below.
  const { hosted } = useSections();
  const hostsUtils = "utils" in hosted;
  const scrollTarget = useGroupScrollTarget();
  const themeVals = useUISlice((s) => s.themeSettings[theme]); // overrides for the active theme (or undefined)
  const saveAppearance = useSaveAppearance(); // optimistic cross-device write (§9.11)
  // Auto-TTS — the SAME controller the appbar's toggle uses (no new state). Surfaced here so it's reachable
  // even when a theme hides the app bar (minimal's `hideAppbar`); `ttsConfigured` gates it to a live TTS
  // backend, and `toggleAutoTts` flips the LOCAL `ui.ttsAuto` (device-local, not part of the synced doc).
  const { ttsAuto, ttsConfigured, toggleAutoTts } = useAppChrome();

  // Appearance picker is driven by the theme registry (D28 §9.8): the skin list + the active theme's
  // declared palette axes (vapor → named accents only, no mode axis) + its per-theme `settings` schema.
  // Adding a theme makes all three appear here automatically (one registry row, zero Conf change).
  const themeOptions = registeredThemes().map((d) => ({ val: d.id, label: d.label }));
  const activeDef = registry[theme];
  const accentOptions = (activeDef?.palettes.accents ?? []).map((a) => ({
    val: a.id,
    label: a.label,
    swatch: a.swatch,
  }));
  const modeOptions = (activeDef?.palettes.modes ?? []).map((m) => ({
    val: m,
    label: m === "dark" ? "Dark" : "Light",
  }));
  const settingsSpec = Object.entries(activeDef?.settings ?? {}); // [key, field][] for the auto-render

  // Appearance changes apply LOCALLY first (instant, the existing synchronous setUI/switchTheme path)
  // then write the FULL appearance doc to the server optimistically for cross-device sync (§9.11) —
  // `currentAppearancePatch()` snapshots the just-applied store so motion/perf/themeSettings ride along.
  // Switching skin adopts the target theme's default mode/accent (re-pick of the same skin is a no-op so
  // it never resets accent) and animates via the View-Transition path (instant under reduced-motion /
  // unsupported); within-theme accent/mode/settings changes stay instant `setUI`.
  const pickTheme = (id: ThemeId) => {
    if (id === theme) return;
    // A theme switch remounts the whole keyed theme root, which UNMOUNTS this tab — and the draft is
    // component state, so it goes with it. No navigation warning fires, because this is not navigation
    // (A11 pre-release FE audit, HIGH: edit providers, change theme, edits gone). Ordinary tab switching
    // is safe — the tabs stay mounted — so the block is scoped to the one action that destroys state.
    //
    // The blast radius is EVERY mounted editor, not this tab: the registry has six registrants (conf ·
    // agent:* · agents-globals · skill:* · memory:* · memory:caps), and because tabs stay mounted, a
    // dirty skill or agent draft is sitting right there while the owner is on Conf. Guarding only
    // `effectiveDirty` left the same class open through the other five (Fable, review of the fix wave).
    // Both terms are kept: `useRegisterDirty` syncs through an effect, so the registry can lag this
    // render by one tick, and the local flag is authoritative for this tab.
    if (effectiveDirty || isAnyDirty()) {
      pushToast("Save or discard your unsaved changes before switching theme", "err");
      return;
    }
    // The target theme's default mode/accent — the single source of truth is `defaultSwitchTarget`
    // (resolve.ts), shared with `coerceBootTheme`'s fallback (item ⑥) so the `?? "dark"` derivation lives
    // in one place.
    const target = defaultSwitchTarget(id);
    // Persist ONLY when the switch actually APPLIED. `switchTheme` can refuse at its supersede-point dirty
    // check (the owner started editing during a cold bundle load) or fail the bundle load; persisting
    // regardless wrote the new theme to the server + query cache while the local UI stayed on the old one,
    // so `useAppearance`'s reconcile re-applied the "refused" switch and other devices adopted it (Codex,
    // review of the fix wave). Build the patch INSIDE the callback so it reads post-switch store state; the
    // skin/mode/accent are the explicit target and motion/perf/themeSettings ride along unchanged.
    void switchTheme(id, target).then((outcome) => {
      if (outcome === "applied")
        saveAppearance.mutate({ ...currentAppearancePatch(), theme: id, ...target });
    });
  };
  const pickMode = (m: Mode) => {
    setUI({ mode: m });
    saveAppearance.mutate(currentAppearancePatch());
  };
  const pickAccent = (a: string) => {
    setUI({ accent: a });
    saveAppearance.mutate(currentAppearancePatch());
  };
  // Global levers (motion/perf) + per-theme settings all apply locally then sync the full doc.
  const setGlobal = (patch: { motion?: typeof motion; perf?: typeof perf }) => {
    setUI(patch);
    saveAppearance.mutate(currentAppearancePatch());
  };
  const pickSetting = (key: string, value: ThemeSettingValue) => {
    setThemeSetting(theme, key, value);
    saveAppearance.mutate(currentAppearancePatch());
  };
  // Group scroll handoff (D35 §F0): something armed `groupScroll` with a group's DOM id — either
  // `useSections.navigate` coercing a `utils` navigation to Conf, or a deep link from elsewhere in the app
  // (`openConfGroup`, e.g. the chat's created-automation card). Consume it here — force-EXPAND the group (a
  // plain toggle can't guarantee the open state), scroll it to the top, then clear. The clear is deferred to
  // a MICROTASK so DefaultRoot's parent scroll-reset effect (which runs AFTER this child effect in the same
  // passive-effect flush) still peeks a pending target and SKIPS its `scrollTo(0,0)` — otherwise it would
  // cancel this scroll. The hosted-utils target additionally waits for `hostsUtils`: that group only exists
  // in Conf while the layout hosts it, and consuming the handoff before it renders would scroll to nothing.
  useEffect(() => {
    if (!scrollTarget) return;
    if (scrollTarget === HOSTED_UTILS_GROUP_ID && !hostsUtils) return;
    setCollapsed(scrollTarget, false);
    document.getElementById(scrollTarget)?.scrollIntoView({ block: "start" });
    queueMicrotask(clearGroupScrollTarget);
  }, [scrollTarget, hostsUtils]);

  const { data: server } = useServerInfo();
  const { data: hosts = [] } = useHosts(server?.poll_seconds ?? 5);

  const { data: settings } = useSettings();
  const providersBaseRev = useSettingsProvidersRev(); // FR2-1 — the base rev bound to the settings snapshot
  const { data: providersInfo, dataUpdatedAt: providersUpdatedAt } = useProviders();
  const save = useSaveSettings();
  // `save.isPending` is a RENDERED value: two `mutate` calls in the same tick both see `false`, and the
  // second detaches TanStack's observer from the first, so the first call's per-call `onSuccess` — which
  // is where the epoch, the captured base and the rename queue are reconciled — never runs (Codex,
  // review of the fix wave). A ref is the only guard that is true at call time. Declared HERE (before the
  // provider identity ops) so the freeze guard (add/remove/rename) can read it. Released TWO ways: the
  // per-call `onSettled` in onSave is the normal path; this effect is the backstop, because the whole
  // reason the lock exists is that a per-call callback can fail to run when a second `mutate` detaches the
  // observer — and a lock nobody clears wedges the tab entirely. `isPending` going false covers every
  // terminal case.
  const savingRef = useRef(false);
  useEffect(() => {
    if (!save.isPending) savingRef.current = false;
  }, [save.isPending]);
  const { data: integrations } = useIntegrationsStatus();
  const rediscover = useRediscover();
  const { data: actionSpecs = [] } = useActionSpecs();
  const { data: skillList = [] } = useSkills();
  const { data: defaultPrompt = "" } = useDefaultPrompt();
  const [draft, setDraft] = useState<Draft | null>(null);
  // F1 — the BROWSER's notification grant. Deliberately component state, not draft/config: it's device
  // state owned by the browser, so it's read at mount and updated by the request below, never saved.
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">(
    notificationPermission,
  );
  const [openProvider, setOpenProvider] = useState<string | null>(null); // A11 — expanded provider card
  const [adding, setAdding] = useState(false); // A11 — the "add provider" affordance
  const [newProvName, setNewProvName] = useState("");
  // A11/D48 — queued provider renames (original stored name → final name), sent as PUT metadata and
  // cleared on save success; the visible draft selectors are cascaded locally when a rename happens.
  const [renames, setRenames] = useState<Record<string, string>>({});
  // Field-level save blocks (invalid extra_body JSON, duplicate/blank model names) keyed by a stable id.
  const [invalids, setInvalids] = useState<Record<string, boolean>>({});
  const setValidity = (id: string, valid: boolean) =>
    setInvalids((m) => {
      if (valid && !(id in m)) return m;
      if (valid) {
        const { [id]: _drop, ...rest } = m;
        return rest;
      }
      return m[id] ? m : { ...m, [id]: true };
    });
  // PUT-response warnings from the last save (D48 B5 / FX16 / FR2-3), stamped with the save moment. They
  // render as a BRIDGE until the ["providers"] query next delivers FRESH data (its `dataUpdatedAt` passes
  // the stamp) — the authoritative GET then supersedes them. Gating on freshness (not the rev) is what
  // drops a now-stale warning that changed at an UNCHANGED rev (a skill collision resolved/appeared).
  const [saveWarn, setSaveWarn] = useState<{ at: number | null; warnings: string[] }>({
    at: null,
    warnings: [],
  });
  // FR2-1 (was FX11) — the providers-base fingerprint bound to the DRAFT EPOCH, sourced from the settings
  // snapshot the draft seeds from (`providersBaseRev`), NOT the separate ["providers"] query. Captured at
  // seed time (first load / after a save) and NEVER advanced while the draft is dirty, so a 409 retry
  // resubmits the OLD base (loud, no silent clobber) until a reload/navigate reseeds the draft.
  const capturedBaseRef = useRef<string | null>(null);

  // Agents are folder-discovered (D14) — the list comes from /api/agents; the agent-section scalars
  // (default agent, default title, subagent limits) come off the settings doc.
  const { data: agentList } = useAgentList();
  const agentCount = (agentList?.agents.length ?? 0) + 1; // specialists + the default/root agent
  // A3 — the Automations group's header summary. Reads the SAME `["automations"]` query the panel
  // does (TanStack dedupes it), so the count can't disagree with the list underneath; the text itself
  // is a pure function of the envelope (`automationsSummary`), tested without rendering this tab.
  const { data: automations } = useAutomations();
  const automationsRight = automationsSummary(automations);
  const agentSection = settings?.agent as Partial<AgentSectionCfg> | undefined;
  // v1.3.1 — the projection is shared with the AgentsEditor (`pickAgentSection`), which re-uses it to
  // project its own save echo into the exact shape this prop takes.
  const agentCfg: AgentSectionCfg = pickAgentSection(agentSection);
  // The per-agent tool grid mirrors the global tri-state (8b, D22): show every tool that's an agent
  // tool *by default* (so a globally-disabled tool still appears, locked-off, rather than vanishing)
  // and pass each one's effective mode so the grid can lock core (on) / disabled (off).
  const governedTools = actionSpecs.filter(
    (s) => (s.default_agent_mode ?? agentModeOf(s)) !== "disabled",
  );
  const agentToolNames = governedTools.map((s) => s.name);
  const agentToolModes = Object.fromEntries(governedTools.map((s) => [s.name, agentModeOf(s)]));
  const skillNames = skillList.map((s) => s.name);

  // Memory caps/toggles come off the settings doc (config.yaml `memory.*`); the MemoryEditor edits
  // them + the per-agent/global memory files (7e-d-3). Defaults mirror MemoryCfg's backend defaults.
  const memorySection = settings?.memory as Partial<MemoryCfg> | undefined;
  const memoryCfg: MemoryCfg = {
    enabled: memorySection?.enabled ?? true,
    user_profile_enabled: memorySection?.user_profile_enabled ?? true,
    auto_write: memorySection?.auto_write ?? true,
    consolidation_nudge: memorySection?.consolidation_nudge ?? false,
    consolidation_nudge_pct: memorySection?.consolidation_nudge_pct ?? 80,
    memory_char_limit: memorySection?.memory_char_limit ?? 2200,
    user_char_limit: memorySection?.user_char_limit ?? 1375,
    state_enabled: memorySection?.state_enabled ?? false,
    state_char_limit: memorySection?.state_char_limit ?? 600,
    reflection_enabled: memorySection?.reflection_enabled ?? false,
    reflection_interval: memorySection?.reflection_interval ?? 10,
  };
  const skillsEnabled =
    (agentSection as { skills_enabled?: boolean } | undefined)?.skills_enabled ?? true;

  // Draft epoch (D48 B5 / R18). The reseed adopts the server doc ONLY when the draft is null (first
  // load) or CLEAN relative to the last seed — a background settings refetch while the user has unsaved
  // edits must NOT clobber the draft. `seededRef` holds the JSON of the last-adopted snapshot; a save
  // success adopts the PUT echo explicitly (onSave's per-call onSuccess), which also updates this ref.
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!settings) return;
    const picked = pickDraft(settings);
    const pickedJson = JSON.stringify(picked);
    setDraft((d) => {
      if (d === null || JSON.stringify(d) === seededRef.current) {
        seededRef.current = pickedJson; // first load, or the draft is clean → adopt the fresh doc
        // FR2-1 — bind the providers base to the SAME settings snapshot we just seeded from (its rev rode
        // in on GET /api/settings' X-Providers-Rev header). Captured only on adopt (null/clean draft), so a
        // dirty draft keeps its epoch base frozen — no background read can advance it under an in-flight edit.
        capturedBaseRef.current = providersBaseRev;
        return picked;
      }
      return d; // dirty draft → protect the in-flight edits (the save reconciles later)
    });
  }, [settings, providersBaseRev]);

  // v1.3.1 — unsaved-ness is measured against the draft's OWN epoch snapshot, never the live query
  // data. While the guard above freezes a dirty draft, a background refetch moves `settings`
  // underneath it, so a live-doc comparison reports sections the user never touched as changed (and
  // `onSave` would then patch them back to the stale values — the LWW race). `seededRef` is exactly
  // the doc this draft was seeded from; the fallback covers the first render before the seed lands.
  // The epoch snapshot in BOTH forms the guards need — parsed once per render, and re-used by `onSave`
  // (which diffs section-by-section against the same object) instead of parsing the string a third time.
  const seedRaw = seededRef.current;
  const seededDraft: Draft | null = !settings
    ? null
    : seedRaw
      ? (JSON.parse(seedRaw) as Draft)
      : pickDraft(settings);
  const seededJson = seededDraft ? (seedRaw ?? JSON.stringify(seededDraft)) : null;
  const dirty = settings && draft && JSON.stringify(draft) !== seededJson;
  // FX11 — is the providers SUBTREE specifically dirty (vs the whole draft)? Drives whether the save
  // carries the `providers` map + its base at all. A queued rename also requires sending the map (the
  // backend rekey/replacement needs it). The epoch base itself is captured at seed time (FR2-1, above).
  // v1.3.1 (Codex review) — the baseline is the EPOCH snapshot, not the live query data, for the same
  // reason `dirty` uses it: a background providers move under a dirty draft otherwise reads as "the
  // user edited providers", so the save carried the untouched map with an epoch-bound base and earned
  // a 409 the user never caused.
  const providersDirty =
    !!settings &&
    !!draft &&
    JSON.stringify(draft.providers) !== JSON.stringify(seededDraft?.providers);
  const sendProviders = providersDirty || Object.keys(renames).length > 0;
  // Unsaved-ness as the USER sees it. A number/JSON field holding text that does not parse keeps that
  // text OUT of the draft (by design — the draft stays valid), so `dirty` alone stayed false while
  // visible input was at risk: the bar said "Saved" and nothing warned on unload (A11 pre-release FE
  // audit, MED). Everything that protects unsaved work reads THIS, not `dirty`.
  const effectiveDirty = !!dirty || Object.keys(invalids).length > 0;
  // F19 — register with the cross-editor dirty registry so a refresh/close-tab while these
  // settings are unsaved triggers the browser's beforeunload prompt. Cleanup on unmount
  // auto-clears the registration (closing Conf doesn't leave the registry stuck).
  useRegisterDirty("conf", effectiveDirty);

  const inf = draft?.inference;
  const srv = draft?.server;
  // The draft provider order — seeds a newly-added fallback's provider in each SectionRefEditor.
  const providerNames = Object.keys(draft?.providers ?? {});

  function setInf<K extends keyof Draft["inference"]>(key: K, val: Draft["inference"][K]) {
    setDraft((d) => (d ? { ...d, inference: { ...d.inference, [key]: val } } : d));
  }
  // A11/D48 — the inference primary + ordered fallbacks as flat provider→model refs. The fallback
  // add/remove/reorder + row DOM live in the shared `SectionRefEditor`; here we just own the draft slice.
  function setPrimary(v: PickerValue) {
    setDraft((d) =>
      d ? { ...d, inference: { ...d.inference, provider: v.provider, model: v.model } } : d,
    );
  }
  function setFallbacks(next: Draft["inference"]["fallbacks"]) {
    setDraft((d) => (d ? { ...d, inference: { ...d.inference, fallbacks: next } } : d));
  }

  // A11/D48 — provider map edits (replacement semantics). Rename is an explicit control that ALSO
  // cascades the visible draft selectors (C1 UI cascade) + queues `provider_renames` (the backend
  // ordering is authoritative). Delete/add are plain map mutations.
  function setProvider(name: string, doc: ProviderDoc) {
    setDraft((d) => (d ? { ...d, providers: { ...d.providers, [name]: doc } } : d));
  }
  function addProviderCard() {
    // Freeze provider IDENTITY ops (add/remove/rename) while a save is in flight — the rename queue and
    // the credential blank-keep both resolve against the SUBMITTED snapshot, so mutating identity mid-flight
    // crosses credentials onto the wrong endpoint (Codex, review of the fix wave). `savingRef` is the
    // call-time truth (`save.isPending` is a rendered value, stale within a tick). Ordinary field edits stay
    // unguarded (reconcile-not-freeze); only identity ops freeze.
    if (savingRef.current) return pushToast("a save is in flight — try again in a moment", "err");
    const name = newProvName.trim().toLowerCase();
    if (!PROVIDER_SLUG.test(name))
      return pushToast("provider name: a–z 0–9 _ + . - (max 32)", "err");
    if (draft?.providers[name]) return pushToast("a provider with that name exists", "err");
    // Reusing a name this draft has renamed away (or deleted) is refused until that change is saved.
    // The two live in one PUT, and the server resolves the rename against its OWN state, where the
    // name is still taken — the backend now refuses to let the fresh entry inherit the old secret
    // (that was a credential-crossing HIGH), but the save would still be rejected or confusing. One
    // save first, then the name is genuinely free (A11 pre-release FE audit).
    if (settings && name in settings.providers)
      return pushToast(`"${name}" is still in use on the server — save your changes first`, "err");
    setDraft((d) => (d ? { ...d, providers: { ...d.providers, [name]: emptyProvider() } } : d));
    setNewProvName("");
    setAdding(false);
    setOpenProvider(name);
  }
  function removeProvider(name: string) {
    // Freeze identity ops while a save is in flight (see addProviderCard) — removing a provider mid-flight
    // erases a queued rename's provenance and can strand its credential on the wrong endpoint.
    if (savingRef.current) {
      pushToast("a save is in flight — try again in a moment", "err");
      return;
    }
    setDraft((d) => {
      if (!d) return d;
      const { [name]: _drop, ...rest } = d.providers;
      return { ...d, providers: rest };
    });
    setRenames((r) => {
      const next = { ...r };
      for (const [k, v] of Object.entries(next)) if (v === name || k === name) delete next[k];
      return next;
    });
    setOpenProvider((o) => (o === name ? null : o));
  }
  function renameProvider(from: string, to: string) {
    // Freeze identity ops while a save is in flight (see addProviderCard). Guarded HERE (the parent
    // chokepoint), NOT in the card — the card's local `setRenaming(false)` still runs, so the edit UI
    // closes and the toast explains why the name did not change.
    if (savingRef.current) {
      pushToast("a save is in flight — try again in a moment", "err");
      return;
    }
    setDraft((d) => {
      if (!d) return d;
      const provs: Record<string, ProviderDoc> = {};
      for (const [k, v] of Object.entries(d.providers)) provs[k === from ? to : k] = v;
      // D48 C1 — the rename control rewrites every VISIBLE draft selector that pointed at the old name:
      // the inference section AND the three Slice-2 section editors (voice.stt / voice.tts / embeddings),
      // each a primary `provider` + ordered `fallbacks[].provider`. Model names are provider-relative and
      // carry unchanged. (The reference-guard cascade + the queued `provider_renames` handle the rest.)
      const reref = <T extends { provider: string | null; fallbacks: SectionRef[] }>(s: T): T => ({
        ...s,
        provider: s.provider === from ? to : s.provider,
        fallbacks: s.fallbacks.map((f) => (f.provider === from ? { ...f, provider: to } : f)),
      });
      return {
        ...d,
        providers: provs,
        inference: reref(d.inference),
        embeddings: reref(d.embeddings),
        voice: { ...d.voice, stt: reref(d.voice.stt), tts: reref(d.voice.tts) },
      };
    });
    setRenames((r) => {
      const next = { ...r };
      const orig = Object.entries(next).find(([, cur]) => cur === from);
      if (orig) next[orig[0]] = to;
      // A provider created in THIS draft has no server-side identity to rename — queueing one would
      // send `provider_renames: {draftOnlyName: …}` and earn a 422 ("source provider does not exist")
      // for what is, from the server's point of view, simply a new entry under a different key
      // (A11 pre-release FE audit). Rekeying the draft, which happened above, is the whole job.
      else if (settings && from in settings.providers) next[from] = to;
      for (const [k, v] of Object.entries(next)) if (k === v) delete next[k];
      return next;
    });
    setOpenProvider((o) => (o === from ? to : o));
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
  function setShell<K extends keyof Draft["shell"]>(key: K, val: Draft["shell"][K]) {
    setDraft((d) => (d ? { ...d, shell: { ...d.shell, [key]: val } } : d));
  }
  function setVoiceEnabled(on: boolean) {
    setDraft((d) => (d ? { ...d, voice: { ...d.voice, enabled: on } } : d));
  }
  function setStt<K extends keyof Draft["voice"]["stt"]>(key: K, val: Draft["voice"]["stt"][K]) {
    setDraft((d) => (d ? { ...d, voice: { ...d.voice, stt: { ...d.voice.stt, [key]: val } } } : d));
  }
  function setTts<K extends keyof Draft["voice"]["tts"]>(key: K, val: Draft["voice"]["tts"][K]) {
    setDraft((d) => (d ? { ...d, voice: { ...d.voice, tts: { ...d.voice.tts, [key]: val } } } : d));
  }
  // A11/D48 Slice 2 — the primary provider+model refs for each consumer section (set together so a
  // provider switch resets the model in one draft update). Fallbacks flow through the section's own
  // `fallbacks` key via the setters above; the SectionRefEditor owns the row add/remove/reorder.
  function setSttPrimary(v: PickerValue) {
    setDraft((d) =>
      d
        ? {
            ...d,
            voice: { ...d.voice, stt: { ...d.voice.stt, provider: v.provider, model: v.model } },
          }
        : d,
    );
  }
  function setTtsPrimary(v: PickerValue) {
    setDraft((d) =>
      d
        ? {
            ...d,
            voice: { ...d.voice, tts: { ...d.voice.tts, provider: v.provider, model: v.model } },
          }
        : d,
    );
  }
  function setEmbPrimary(v: PickerValue) {
    setDraft((d) =>
      d ? { ...d, embeddings: { ...d.embeddings, provider: v.provider, model: v.model } } : d,
    );
  }

  // F1 — the notifications master + the three per-class toggles. `setNotifyEvent` writes into the ONE
  // nested `events` object (mirroring `NotificationEventsCfg`), so a future class is one more key here
  // and a new row below — never a second setter or a sibling map.
  function setNotifyEnabled(on: boolean) {
    setDraft((d) => (d ? { ...d, notifications: { ...d.notifications, enabled: on } } : d));
  }
  /** The master toggle does TWO things with different lifetimes: it edits the draft (saved with the
   *  bar, like every other setting) and — on the ENABLE gesture only — asks the browser for
   *  permission. The request must ride a user gesture (browsers reject or auto-deny otherwise), which
   *  is exactly why the engine can't ask for itself on mount. The grant is browser state, so it
   *  applies immediately and is never part of the save; a `denied` outcome still flips the config
   *  preference (it's a real preference) and the row explains why nothing will arrive. */
  async function toggleNotifications() {
    const next = !notif?.enabled;
    setNotifyEnabled(next);
    if (next) setNotifPerm(await requestNotificationPermission());
  }
  function setNotifyEvent<K extends keyof Draft["notifications"]["events"]>(
    key: K,
    val: Draft["notifications"]["events"][K],
  ) {
    setDraft((d) =>
      d
        ? {
            ...d,
            notifications: {
              ...d.notifications,
              events: { ...d.notifications.events, [key]: val },
            },
          }
        : d,
    );
  }

  const sx = draft?.searxng;
  const emb = draft?.embeddings;
  const term = draft?.open_terminal;
  const sh = draft?.shell;
  const vstt = draft?.voice.stt;
  const vtts = draft?.voice.tts;
  const notif = draft?.notifications;

  // A11/D48 B2 + R19 — the reference-guard. Collect every config-held ModelRef (the draft's inference
  // primary/fallbacks + the settings doc's agent.defaults.model / summarizer[s] / routing.lead), resolve
  // its provider through the queued renames, and check it still points at a live provider + model in the
  // draft. A dangling ref BLOCKS the save (the backend strict PUT 422s anyway — one source of truth). The
  // per-provider reference set also disables that card's Remove (you can't delete a referenced provider).
  const referenceReport = (() => {
    const refs: { label: string; provider: string | null; model: string | null }[] = [];
    if (draft) {
      refs.push({
        label: "inference default",
        provider: draft.inference.provider,
        model: draft.inference.model,
      });
      draft.inference.fallbacks.forEach((f, i) =>
        refs.push({
          label: `inference fallback #${i + 1}`,
          provider: f.provider || null,
          model: f.model,
        }),
      );
      // A11/D48 Slice 2 — voice + embeddings sections are ModelRefs too: a provider/model used ONLY by
      // STT/TTS/embeddings still blocks its own removal/rename (the strict PUT would 422 anyway — R19).
      const sectionRefs: [
        string,
        { provider: string | null; model: string | null; fallbacks: SectionRef[] },
      ][] = [
        ["Voice STT", draft.voice.stt],
        ["Voice TTS", draft.voice.tts],
        ["Embeddings", draft.embeddings],
      ];
      for (const [name, sec] of sectionRefs) {
        refs.push({ label: `${name} default`, provider: sec.provider, model: sec.model });
        sec.fallbacks.forEach((f, i) =>
          refs.push({
            label: `${name} fallback #${i + 1}`,
            provider: f.provider || null,
            model: f.model,
          }),
        );
      }
    }
    const agent = settings?.agent as Record<string, unknown> | undefined;
    const defaults = agent?.defaults as Record<string, unknown> | undefined;
    const asRef = (v: unknown) =>
      v && typeof v === "object" ? (v as { provider?: unknown; model?: unknown }) : null;
    const addAgent = (label: string, v: unknown) => {
      const r = asRef(v);
      if (r && typeof r.provider === "string")
        refs.push({
          label,
          provider: r.provider,
          model: typeof r.model === "string" ? r.model : null,
        });
    };
    addAgent("agent default model", defaults?.model);
    addAgent(
      "agent summarizer",
      (defaults?.compaction as Record<string, unknown> | undefined)?.summarizer,
    );
    addAgent(
      "global summarizer",
      (agent?.compaction as Record<string, unknown> | undefined)?.summarizer,
    );
    addAgent("routing lead", (defaults?.routing as Record<string, unknown> | undefined)?.lead);

    // FX12 (H1/Codex#5): a MODEL is only "removed" if it was a clean CATALOG name in the CURRENT settings
    // doc that the draft renamed/removed — never a raw-id passthrough the backend legitimately accepts.
    // The settings catalog is keyed by the ref's ORIGINAL (pre-rename) provider name.
    // ACCEPTED RESIDUAL (Codex#5, no provenance state): typing a raw id that happens to equal a FORMER
    // catalog key the draft removes is still flagged here (it reads as a removed catalog model), even though
    // the backend would resolve it as a raw passthrough. The guard deliberately errs toward blocking a
    // still-resolvable save over allowing a silent break; distinguishing the two needs per-ref provenance we
    // don't track — an acceptable false-positive, resolved by re-adding the catalog entry or renaming.
    const invRename: Record<string, string> = {};
    for (const [oldName, newName] of Object.entries(renames)) invRename[newName] = oldName;
    const settingsProviders = settings?.providers ?? {};

    const dangling: string[] = [];
    const byProvider: Record<string, string[]> = {};
    for (const r of refs) {
      if (!r.provider) continue; // null/blank primary → the backend default; not a dangling ref
      const rp = renames[r.provider] ?? r.provider;
      (byProvider[rp] ??= []).push(r.label);
      const pdoc = draft?.providers[rp];
      if (!pdoc) {
        dangling.push(`${r.label} → ${rp} (provider removed)`); // a DANGLING PROVIDER is always flagged
        continue;
      }
      if (!r.model) continue;
      const settingsProv = invRename[rp] ?? rp;
      const wasCataloged = r.model in (settingsProviders[settingsProv]?.models ?? {});
      if (wasCataloged && !(r.model in (pdoc.models ?? {}))) {
        dangling.push(`${r.label} → ${rp}/${r.model} (model removed)`);
      }
    }
    // FX-G — two more strict-resolve 422s reachable from the section editors that the provider-removed /
    // model-removed passes above skip (`if (!r.provider) continue` / `if (!r.model) continue`). Mirror the
    // backend `_build_section_chain` + `_build_target` strict errors for all four EDITABLE sections (agent
    // ModelRefs only warn on model-omission — not blocked here, matching `resolve_strict`).
    if (draft) {
      const guarded: [
        string,
        { provider: string | null; model: string | null; fallbacks: SectionRef[] },
      ][] = [
        ["inference", draft.inference],
        ["Voice STT", draft.voice.stt],
        ["Voice TTS", draft.voice.tts],
        ["Embeddings", draft.embeddings],
      ];
      const liveProvider = (name: string) => draft.providers[renames[name] ?? name];
      for (const [name, sec] of guarded) {
        // (1) a blank/absent primary WITH a configured (live) fallback → strict 422
        const hasLiveFallback = sec.fallbacks.some((f) => f.provider && liveProvider(f.provider));
        if (!sec.provider && hasLiveFallback) {
          dangling.push(`${name} default → has fallbacks but no default provider`);
        }
        // (2) a model OMITTED against a provider whose catalog isn't exactly one model → strict 422
        const rows: [string, string | null][] = [
          [`${name} default`, sec.model],
          ...sec.fallbacks.map(
            (f, i) => [`${name} fallback #${i + 1}`, f.model] as [string, string | null],
          ),
        ];
        const provs: (string | null)[] = [
          sec.provider,
          ...sec.fallbacks.map((f) => f.provider || null),
        ];
        rows.forEach(([label, model], i) => {
          const prov = provs[i];
          if (!prov || model) return; // blank primary handled above; a named model is fine
          const pdoc = liveProvider(prov);
          if (!pdoc) return; // provider-removed already flagged in the pass above
          const n = Object.keys(pdoc.models ?? {}).length;
          if (n !== 1)
            dangling.push(`${label} → needs a model — ${renames[prov] ?? prov} has ${n} models`);
        });
        // (3) a referenced provider with a BLANK base_url, and a fallback row with no provider at all.
        // Both are strict 422s the guard used to let through, so the owner met a server error where an
        // inline reason was available for free (A11 pre-release FE audit, MED).
        if (
          sec.provider &&
          liveProvider(sec.provider) &&
          !liveProvider(sec.provider).base_url?.trim()
        ) {
          dangling.push(
            `${name} default → ${renames[sec.provider] ?? sec.provider} has no base URL`,
          );
        }
        sec.fallbacks.forEach((f, i) => {
          if (!f.provider)
            dangling.push(`${name} fallback #${i + 1} → pick a provider or remove the row`);
          else if (liveProvider(f.provider) && !liveProvider(f.provider).base_url?.trim())
            dangling.push(`${name} fallback #${i + 1} → ${f.provider} has no base URL`);
        });
      }
      // (4) names the SERVER rejects outright. The reserved verbs come from the BACKEND
      // (`GET /api/providers` → `reserved_verbs`) rather than a second copy of the list over here — it
      // is already on the wire for exactly this kind of check, and a hardcoded mirror would drift the
      // first time a verb is added. The secret sentinels are a fixed schema-level rule (D48 C1), so
      // those are named locally with a pointer to their source of truth.
      const reserved = providersInfo?.reserved_verbs ?? [];
      const sentinel = (n: string) => SECRET_SENTINEL_NAMES.includes(n.trim().toLowerCase());
      for (const pname of Object.keys(draft.providers)) {
        if (reserved.includes(pname))
          dangling.push(`provider "${pname}" → that name is a built-in composer verb`);
        else if (sentinel(pname))
          dangling.push(`provider "${pname}" → that name collides with a secret field`);
        for (const mname of Object.keys(draft.providers[pname].models ?? {})) {
          if (sentinel(mname))
            dangling.push(`${pname} model "${mname}" → that name collides with a secret field`);
        }
      }
    }
    return { dangling, byProvider };
  })();

  const jsonBlocked = Object.keys(invalids).length > 0;
  const blockReasons = [
    ...referenceReport.dangling,
    ...(jsonBlocked ? ["fix the invalid provider fields highlighted above"] : []),
  ];
  const saveDisabled = !dirty || save.isPending || blockReasons.length > 0;

  function onSave() {
    if (!draft || saveDisabled || savingRef.current) return;
    savingRef.current = true;
    const coerced: SavePatch = {
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
      // A11/D48 Slice 2 — embeddings is a registry ref (provider/model/fallbacks) + enabled + timeout.
      embeddings: { ...draft.embeddings, timeout_s: Number(draft.embeddings.timeout_s) },
      open_terminal: draft.open_terminal,
      shell: {
        ...draft.shell,
        timeout_s: Number(draft.shell.timeout_s),
        max_output_chars: Number(draft.shell.max_output_chars),
      },
      voice: {
        ...draft.voice,
        stt: {
          ...draft.voice.stt,
          connect_timeout_s: Number(draft.voice.stt.connect_timeout_s),
          timeout_s: Number(draft.voice.stt.timeout_s),
        },
        tts: {
          ...draft.voice.tts,
          connect_timeout_s: Number(draft.voice.tts.connect_timeout_s),
          timeout_s: Number(draft.voice.tts.timeout_s),
        },
      },
      notifications: draft.notifications, // all booleans — nothing to coerce
    };
    // Send ONLY the sections that actually changed. Sending everything made every scalar save a
    // resolution-relevant patch (the backend strict-resolves any patch touching providers / inference /
    // agent / voice / embeddings), so on a config carrying a pre-existing lenient-tolerated conflict —
    // a min-wins gate clash, a dim mismatch — editing `server.poll_seconds` 422'd and the owner could
    // not save anything at all (A11 pre-release FE audit, MED). That is precisely the case FX7's
    // strict-gating was built to keep working, defeated from this side. Comparing the COERCED section
    // (what we would send) against the seeded doc, so a "5" typed over 5 is not a change.
    //
    // v1.3.1 — "the seeded doc" is the DRAFT EPOCH snapshot (`seededRef`), not the live query data.
    // The two diverge exactly when it matters: a background refetch (or a concurrent writer) moves
    // `settings` while the epoch guard holds the dirty draft still, and diffing against the moved doc
    // marks UNEDITED sections as changed — so the save silently reverted whatever the other write had
    // just landed. Against the epoch snapshot an untouched section diffs equal and stays out of the
    // patch, which is what makes "send only what changed" a genuine per-section guarantee. (The
    // `providers` subtree keeps its stronger, server-checked protection: the epoch-bound
    // `providers_base` 409s instead of merging.) The fallback is first-load safety only.
    const seeded: Record<string, unknown> = seededDraft ?? pickDraft(settings);
    const patch: SavePatch = {};
    for (const [key, value] of Object.entries(coerced)) {
      if (JSON.stringify(value) !== JSON.stringify(seeded[key])) patch[key] = value;
    }
    // FX11 — carry the providers map + its epoch-bound base ONLY when the subtree is dirty (or a rename is
    // queued); a clean-providers save omits both (no needless 409 surface, and `providers_base` never rides
    // without `providers`). The base is the DRAFT-EPOCH capture, never the live query rev.
    if (sendProviders) {
      patch.providers = draft.providers;
      patch.providers_base = capturedBaseRef.current ?? undefined;
    }
    const sentRenames = { ...renames };
    if (Object.keys(sentRenames).length) patch.provider_renames = sentRenames;
    // What we are actually submitting — the reconcile below compares against THIS, not against whatever
    // the draft looks like when the response lands (D48 B5: reconcile only the submitted snapshot).
    const submittedJson = JSON.stringify(draft);
    save.mutate(patch, {
      onSuccess: (res) => {
        // Draft epoch (R18): the PUT echo becomes the new clean baseline and the captured base advances
        // to the post-write rev, so the next save works from the fresh epoch.
        const echo = pickDraft(res.settings);
        seededRef.current = JSON.stringify(echo);
        capturedBaseRef.current = res.providers_rev;
        // …but the draft is only REPLACED when it is still what we sent. On a slow link the owner can
        // keep typing while the save is in flight, and unconditionally adopting the echo silently threw
        // those edits away (A11 pre-release FE audit, HIGH). Keeping them leaves the draft dirty against
        // the new baseline — the save bar says "Save changes" again, which is the truth.
        setDraft((d) => (JSON.stringify(d) === submittedJson ? echo : d));
        // REBASE the rename queue onto what the server just applied. Dropping every sent SOURCE key was
        // wrong for a chain: rename A→B, save, then rename B→C before the response lands, and the queue
        // is `{A: C}` (the control re-points the existing entry, it does not add one). Clearing key `A`
        // then threw the whole rename away — the draft calls it C, the server calls it B, and the next
        // PUT looks like a brand-new provider C whose masked key has nothing stored, so the credential
        // is DROPPED by the very MUST-FIX above (Codex, review of the fix wave — exactly the "rebasing
        // post-submit rename chains is subtle" it warned about when it argued for freezing instead).
        // So: an entry whose source was sent and whose destination still matches is done and goes; one
        // that moved on is re-keyed to the name the server now knows; anything untouched carries.
        setRenames((prev) => {
          const next: Record<string, string> = {};
          for (const [from, to] of Object.entries(prev)) {
            const applied = sentRenames[from];
            if (applied === undefined)
              next[from] = to; // never sent → still valid as-is
            else if (applied !== to) next[applied] = to; // re-renamed mid-flight → rebase onto the new name
            // applied === to → the server did exactly this; nothing left to queue
          }
          return next;
        });
        setSaveWarn({ at: Date.now(), warnings: res.warnings ?? [] }); // FX16/FR2-3 — replace, stamped with the save moment
      },
      onSettled: () => {
        savingRef.current = false; // the normal release; the isPending effect above is the backstop
      },
    });
  }

  // The scalar-settings groups below (Providers / Inference / Server / …) share ONE global `dirty` flag
  // and the same `onSave` patch — their forms compose into one PUT /api/settings. The bar renders at the
  // end of every saveable group so it's reachable from whichever section the user is in. A block-reason
  // row (dangling refs / invalid JSON) sits above it and disables the button. Editor-managed groups
  // (MCP, OpenAPI, Agents, …) keep their own save flows; Appearance is UI-store only.
  const saveBar = (
    <>
      {blockReasons.length > 0 && (
        <div className="conf-blockrow">
          <div className="conf-block-title">can’t save — resolve first:</div>
          {blockReasons.map((r, i) => (
            <div className="conf-block-reason" key={i}>
              · {r}
            </div>
          ))}
        </div>
      )}
      <div className="conf-savebar">
        <button className="conf-save" disabled={saveDisabled} onClick={onSave}>
          {save.isPending ? "Saving…" : effectiveDirty ? "Save changes" : "Saved"}
        </button>
      </div>
    </>
  );

  // Boot/lenient warnings (GET /api/providers) + the last PUT-response warnings, rendered inline in the
  // Providers group (D48 B5 / R22). FX16/FR2-3: the retained PUT warnings are a BRIDGE — shown only until
  // the ["providers"] query next delivers FRESH data (its `dataUpdatedAt` passes the save stamp), when the
  // authoritative GET supersedes them. Gating on freshness (not the rev) drops a warning that changed at an
  // UNCHANGED rev (a skill collision resolved/appeared). The merged list is DEDUPED by string identity so a
  // PUT warning echoed by the following GET shows once, not twice.
  const putWarnings =
    saveWarn.at != null && (providersUpdatedAt ?? 0) <= saveWarn.at ? saveWarn.warnings : [];
  const providerWarnings = [...new Set([...(providersInfo?.warnings ?? []), ...putWarnings])];
  // The picker catalog is the DRAFT's providers (live, so unsaved additions/renames appear immediately).
  const draftCatalog: PickerCatalog = Object.fromEntries(
    Object.entries(draft?.providers ?? {}).map(([n, p]) => [
      n,
      { models: Object.keys(p.models ?? {}) },
    ]),
  );

  return (
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-conf"
      data-screen-label="04 Conf"
      role="tabpanel"
      aria-labelledby="tabbtn-conf"
    >
      <ConfGroup
        id="providers"
        num="01"
        title="Providers"
        right={`${Object.keys(draft?.providers ?? {}).length} connection${
          Object.keys(draft?.providers ?? {}).length === 1 ? "" : "s"
        }`}
      >
        <div className="conf-card">
          <WarnRow warnings={providerWarnings} />
          {Object.entries(draft?.providers ?? {}).map(([name, doc]) => (
            <ProviderCard
              key={name}
              name={name}
              doc={doc}
              open={openProvider === name}
              onToggle={() => setOpenProvider(openProvider === name ? null : name)}
              referencedBy={referenceReport.byProvider[name] ?? []}
              existingNames={Object.keys(draft?.providers ?? {}).filter((n) => n !== name)}
              onChange={(d) => setProvider(name, d)}
              serverNames={Object.keys(settings?.providers ?? {}).filter(
                (n) => n !== name && renames[n] !== name,
              )}
              onRename={(next) => renameProvider(name, next)}
              onRemove={() => removeProvider(name)}
              onValidity={setValidity}
            />
          ))}
          <div className={"mwrap add" + (adding ? " open" : "")}>
            <div
              className="confrow"
              {...disclosureToggle(adding, () => {
                setAdding(!adding);
                setOpenProvider(null);
              })}
            >
              <div className="k">
                <div className="label">add provider</div>
                <div className="desc">a new connection + model catalog</div>
              </div>
              <span className="chev" aria-hidden>
                ›
              </span>
            </div>
            <div className="mconf">
              {adding && (
                <>
                  <div className="mform">
                    <label>Name</label>
                    <input
                      aria-label="New provider name"
                      value={newProvName}
                      placeholder="llamacpp"
                      onChange={(e) => setNewProvName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addProviderCard()}
                    />
                  </div>
                  <div className="mfoot">
                    <button
                      type="button"
                      onClick={() => {
                        setAdding(false);
                        setNewProvName("");
                      }}
                    >
                      cancel
                    </button>
                    <button type="button" className="save" onClick={addProviderCard}>
                      create
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {saveBar}
      </ConfGroup>

      <ConfGroup id="inference" num="02" title="Inference" right="chat backend">
        <div className="conf-card">
          <SectionRefEditor
            primaryDesc="primary provider · model — /<provider> overrides per message"
            value={{
              provider: inf?.provider ?? null,
              model: inf?.model ?? null,
              fallbacks: inf?.fallbacks ?? [],
            }}
            onChangePrimary={setPrimary}
            onChangeFallbacks={setFallbacks}
            catalog={draftCatalog}
            providerNames={providerNames}
          >
            {/* Inference is the only section with a failover toggle — it slots between Default and
                Fallbacks. Voice/embeddings chains always walk (no toggle rendered). */}
            <SettingRow
              label="Failover"
              desc="on failure, fall through the primary → fallbacks chain"
            >
              <Switch
                on={inf?.failover ?? true}
                label="Inference failover"
                onToggle={() => setInf("failover", !(inf?.failover ?? true))}
              />
            </SettingRow>
          </SectionRefEditor>
          <Field
            label="Request timeout"
            desc="seconds — thinking models load slowly"
            value={String(inf?.request_timeout_s ?? "")}
            onChange={(v) => setInf("request_timeout_s", v as unknown as number)}
          />
          <PromptRow
            label="System prompt"
            desc="optional override of the default agent prompt"
            value={inf?.system_prompt ?? ""}
            emptyHint="empty — using the baked default"
            onEdit={async () => {
              const next = await requestPrompt({
                title: "System prompt",
                value: inf?.system_prompt ?? "",
                defaultText: defaultPrompt,
                placeholder: "(empty → the built-in default)",
              });
              if (next != null) setInf("system_prompt", next);
            }}
          />
          <PromptRow
            label="System prompt append"
            desc="added after the base — applies to every agent unless it opts out"
            value={inf?.system_prompt_append ?? ""}
            emptyHint="empty — nothing appended"
            onEdit={async () => {
              const next = await requestPrompt({
                title: "System prompt append",
                value: inf?.system_prompt_append ?? "",
                placeholder: "extra instructions added to every agent",
              });
              if (next != null) setInf("system_prompt_append", next);
            }}
          />
        </div>
        {saveBar}
      </ConfGroup>

      <ConfGroup id="server" num="03" title="Server" right="tailnet-only">
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
          <SettingRow label="Debug" desc="verbose errors — off in prod · restart to apply">
            <Switch on={!!srv?.debug} onToggle={() => setSrv("debug", !srv?.debug)} label="Debug" />
          </SettingRow>
        </div>
        {/* HTTPS access (Tailscale Serve) — a live toggle (acts immediately, not part of the saved
            fields). Sits above the save bar so it reads as a control, not an afterthought (6c-2). */}
        <TailscaleAccessCard />
        {saveBar}
      </ConfGroup>

      <ConfGroup id="searxng" num="04" title="SearXNG" right="web_search">
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
          <SettingRow label="Enabled" desc="powers the agent web_search tool">
            <Switch
              on={!!sx?.enabled}
              onToggle={() => setSearx("enabled", !sx?.enabled)}
              label="SearXNG enabled"
            />
          </SettingRow>
        </div>
        {saveBar}
      </ConfGroup>

      <ConfGroup id="embeddings" num="05" title="Embeddings" right="vector memory">
        <div className="conf-card">
          {/* A11/D48 Slice 2 — the embeddings backend is a registry ref (provider + model, scoped to the
              chosen provider's catalog) with its own ordered fallback chain. The vector `dim` is now a
              per-model field (edited on the provider card's model row). */}
          <SectionRefEditor
            primaryDesc="embedding provider · model — all fallbacks must share the vector dim"
            value={{
              provider: emb?.provider ?? null,
              model: emb?.model ?? null,
              fallbacks: emb?.fallbacks ?? [],
            }}
            onChangePrimary={setEmbPrimary}
            onChangeFallbacks={(next) => setEmb("fallbacks", next)}
            catalog={draftCatalog}
            providerNames={providerNames}
            sectionLabel="Embeddings"
          />
          <Field
            label="Read timeout"
            desc="seconds — embedding request window"
            value={String(emb?.timeout_s ?? "")}
            onChange={(v) => setEmb("timeout_s", v as unknown as number)}
          />
          <SettingRow label="Enabled" desc="semantic recall (Phase 7e)">
            <Switch
              on={!!emb?.enabled}
              onToggle={() => setEmb("enabled", !emb?.enabled)}
              label="Embeddings enabled"
            />
          </SettingRow>
        </div>
        {saveBar}
      </ConfGroup>

      <ConfGroup id="openterminal" num="06" title="Open-terminal" right="remote shell tools">
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
          <SettingRow label="Exec risk" desc="terminal_exec gate — high = confirm">
            <Seg<string>
              label="Exec risk"
              current={term?.exec_risk ?? "high"}
              options={RISKS}
              onPick={(v) => setTerm("exec_risk", v)}
            />
          </SettingRow>
          <SettingRow label="Write risk" desc="file write/replace gate">
            <Seg<string>
              label="Write risk"
              current={term?.write_risk ?? "high"}
              options={RISKS}
              onPick={(v) => setTerm("write_risk", v)}
            />
          </SettingRow>
          <SettingRow label="Read risk" desc="read/list/grep/glob gate">
            <Seg<string>
              label="Read risk"
              current={term?.read_risk ?? "low"}
              options={RISKS}
              onPick={(v) => setTerm("read_risk", v)}
            />
          </SettingRow>
          <SettingRow label="Enabled" desc="curated remote shell + file tools">
            <Switch
              on={!!term?.enabled}
              onToggle={() => setTerm("enabled", !term?.enabled)}
              label="Open-terminal enabled"
            />
          </SettingRow>
        </div>
        {saveBar}
      </ConfGroup>

      <ConfGroup id="shell" num="07" title="Shell" right="! escape hatch">
        <div className="conf-card">
          <SettingRow label="User exec" desc="the !<cmd> composer escape hatch">
            <Switch
              on={!!sh?.user_exec_enabled}
              label="Shell user exec"
              onToggle={() => setShell("user_exec_enabled", !sh?.user_exec_enabled)}
            />
          </SettingRow>
          <SettingRow
            label="Agent run_shell"
            desc="let the agent call run_shell (else confirm at full only)"
          >
            <Switch
              on={!!sh?.agent_exec_enabled}
              label="Agent run_shell"
              onToggle={() => setShell("agent_exec_enabled", !sh?.agent_exec_enabled)}
            />
          </SettingRow>
          <Field
            label="Workdir"
            desc="cwd for commands — blank → workspace home"
            value={sh?.workdir ?? ""}
            onChange={(v) => setShell("workdir", v)}
            placeholder="$CTRLB_HOME"
          />
          <Field
            label="Timeout"
            desc="seconds — kill the process after"
            value={String(sh?.timeout_s ?? "")}
            onChange={(v) => setShell("timeout_s", v as unknown as number)}
          />
          <Field
            label="Max output"
            desc="chars — truncate captured stdout/stderr"
            value={String(sh?.max_output_chars ?? "")}
            onChange={(v) => setShell("max_output_chars", v as unknown as number)}
          />
          <SettingRow label="Enabled" desc="master switch for local shell exec">
            <Switch
              on={!!sh?.enabled}
              onToggle={() => setShell("enabled", !sh?.enabled)}
              label="Local shell enabled"
            />
          </SettingRow>
        </div>
        {saveBar}
      </ConfGroup>

      <ConfGroup id="voice-stt" num="08" title="Voice · STT" right="speech-to-text">
        <div className="conf-card">
          <SettingRow label="Enabled" desc="master switch — disables STT and TTS">
            <Switch
              on={!!draft?.voice.enabled}
              label="Voice enabled"
              onToggle={() => setVoiceEnabled(!draft?.voice.enabled)}
            />
          </SettingRow>
          <Field
            label="Language"
            desc="ISO code (en, sv); blank → auto-detect"
            value={vstt?.language ?? ""}
            onChange={(v) => setStt("language", v)}
            placeholder="en"
          />
          <SettingRow
            label="VAD filter"
            desc="skip silence (avoids whisper silence-hallucinations)"
          >
            <Switch
              on={!!vstt?.vad_filter}
              label="STT VAD filter"
              onToggle={() => setStt("vad_filter", !vstt?.vad_filter)}
            />
          </SettingRow>
          <Field
            label="Hotwords"
            desc="space-separated recognition bias (fleet / jargon names)"
            value={vstt?.hotwords ?? ""}
            onChange={(v) => setStt("hotwords", v)}
            placeholder="corsair vault emma minig"
          />
          <SettingRow
            label="Auto-send"
            desc="send the transcript immediately; off → fill the composer to review first"
          >
            <Switch
              on={!!vstt?.auto_send}
              onToggle={() => setStt("auto_send", !vstt?.auto_send)}
              label="STT auto-send"
            />
          </SettingRow>
          {/* A11/D48 Slice 2 — the STT primary + ordered fallbacks point at the registry (provider + model
              scoped to its catalog); the whisper endpoint/key/model now live on the provider card. */}
          <SectionRefEditor
            primaryDesc="STT provider · model — the whisper backend"
            value={{
              provider: vstt?.provider ?? null,
              model: vstt?.model ?? null,
              fallbacks: vstt?.fallbacks ?? [],
            }}
            onChangePrimary={setSttPrimary}
            onChangeFallbacks={(next) => setStt("fallbacks", next)}
            catalog={draftCatalog}
            providerNames={providerNames}
            sectionLabel="Voice STT"
          />
          <Field
            label="Connect timeout"
            desc="seconds — fail-fast to fall over"
            value={String(vstt?.connect_timeout_s ?? "")}
            onChange={(v) => setStt("connect_timeout_s", v as unknown as number)}
          />
          <Field
            label="Read timeout"
            desc="seconds — transcription window"
            value={String(vstt?.timeout_s ?? "")}
            onChange={(v) => setStt("timeout_s", v as unknown as number)}
          />
        </div>
        {saveBar}
      </ConfGroup>

      <ConfGroup id="voice-tts" num="09" title="Voice · TTS" right="text-to-speech">
        <div className="conf-card">
          {/* Auto read-aloud — a device-local UX toggle (the appbar's mirror, via the SAME useAppChrome
              controller; flips local `ui.ttsAuto`, independent of this group's draft/Save). Shown only when
              a TTS backend is live (`ttsConfigured`) so it's never a dead control; also the only way to
              reach it when a theme hides the app bar (minimal's `hideAppbar`). */}
          {ttsConfigured && (
            <SettingRow label="Auto read-aloud" desc="speak each reply aloud as it finishes">
              <Switch on={ttsAuto} onToggle={toggleAutoTts} label="Auto read-aloud" />
            </SettingRow>
          )}
          <SettingRow
            label="Format"
            desc="audio container — mp3 is universally seekable (mini-player)"
          >
            <Seg<string>
              label="Format"
              current={vtts?.format ?? "mp3"}
              options={[
                { val: "mp3", label: "mp3" },
                { val: "opus", label: "opus" },
                { val: "wav", label: "wav" },
              ]}
              onPick={(v) => setTts("format", v)}
            />
          </SettingRow>
          {/* A11/D48 Slice 2 — the TTS primary + ordered fallbacks point at the registry; the server
              voice id + playback speed are per-model fields (edited on the provider card's model row). */}
          <SectionRefEditor
            primaryDesc="TTS provider · model — the synthesis backend"
            value={{
              provider: vtts?.provider ?? null,
              model: vtts?.model ?? null,
              fallbacks: vtts?.fallbacks ?? [],
            }}
            onChangePrimary={setTtsPrimary}
            onChangeFallbacks={(next) => setTts("fallbacks", next)}
            catalog={draftCatalog}
            providerNames={providerNames}
            sectionLabel="Voice TTS"
          />
          <Field
            label="Connect timeout"
            desc="seconds — fail-fast to fall over"
            value={String(vtts?.connect_timeout_s ?? "")}
            onChange={(v) => setTts("connect_timeout_s", v as unknown as number)}
          />
          <Field
            label="Read timeout"
            desc="seconds — synthesis window"
            value={String(vtts?.timeout_s ?? "")}
            onChange={(v) => setTts("timeout_s", v as unknown as number)}
          />
        </div>
        {saveBar}
      </ConfGroup>

      {/* F1 — placed right after the Voice groups: both are "how the app reaches out to you on this
          device", both depend on a secure context (Tailscale Serve HTTPS), and both mix a saved
          config preference with an immediate browser-capability gesture. */}
      <ConfGroup id="notifications" num="10" title="Notifications" right="while the app is open">
        <div className="conf-card">
          <SettingRow
            label="Enabled"
            desc={
              notifPerm === "unsupported"
                ? "needs HTTPS (Tailscale Serve) — the browser hides notifications on a plain http origin"
                : notifPerm === "denied"
                  ? "blocked in the browser — allow notifications for this site in its site settings"
                  : "buzz this device on the events below. best-effort: delivery needs the app open or backgrounded — push to a closed app is a future feature"
            }
          >
            <Switch
              on={!!notif?.enabled}
              onToggle={() => void toggleNotifications()}
              label="Notifications enabled"
              disabled={notifPerm === "unsupported"}
            />
          </SettingRow>
          {/* The four classes mirror `NotificationEventsCfg` one-for-one. Inert (but visible, and
              still saved) until the master is on — the master is the spam guard, so these describe
              WHICH events would notify, not whether any do. */}
          <SettingRow label="Agent needs you" desc="a confirm bubble or a question is waiting">
            <Switch
              on={!!notif?.events.agent_input}
              onToggle={() => setNotifyEvent("agent_input", !notif?.events.agent_input)}
              label="Notify on agent input"
              disabled={!notif?.enabled}
            />
          </SettingRow>
          <SettingRow label="Turn finished" desc="an agent turn completed, capped or errored">
            <Switch
              on={!!notif?.events.turn_done}
              onToggle={() => setNotifyEvent("turn_done", !notif?.events.turn_done)}
              label="Notify on turn done"
              disabled={!notif?.enabled}
            />
          </SettingRow>
          <SettingRow label="Action failed" desc="a recorded action ended error, denied or timeout">
            <Switch
              on={!!notif?.events.action_failed}
              onToggle={() => setNotifyEvent("action_failed", !notif?.events.action_failed)}
              label="Notify on action failed"
              disabled={!notif?.enabled}
            />
          </SettingRow>
          {/* A3 14d — the class that makes an unattended run reportable at all: nobody is watching the
              tab when a 03:00 job fires. A FAILED run notifies here too, not under "Action failed". */}
          <SettingRow label="Automation finished" desc="a scheduled or manual run reached a result">
            <Switch
              on={!!notif?.events.automation_done}
              onToggle={() => setNotifyEvent("automation_done", !notif?.events.automation_done)}
              label="Notify on automation done"
              disabled={!notif?.enabled}
            />
          </SettingRow>
        </div>
        {saveBar}
      </ConfGroup>

      <ConfGroup
        id="mcp"
        num="11"
        title="MCP servers"
        right={`${settings?.mcp_servers?.length ?? 0} server${(settings?.mcp_servers?.length ?? 0) === 1 ? "" : "s"}`}
      >
        <ServerListEditor
          kind="mcp"
          servers={settings?.mcp_servers ?? []}
          summaries={integrations?.mcp ?? []}
        />
      </ConfGroup>

      <ConfGroup
        id="openapi"
        num="12"
        title="OpenAPI tool servers"
        right={`${settings?.openapi_servers?.length ?? 0} server${(settings?.openapi_servers?.length ?? 0) === 1 ? "" : "s"}`}
      >
        <ServerListEditor
          kind="openapi"
          servers={settings?.openapi_servers ?? []}
          summaries={integrations?.openapi ?? []}
        />
        <div className="conf-savebar redisc">
          {integrations?.dirty && (
            <span className="redisc-hint">// changes apply on next chat · or</span>
          )}
          <button
            className="conf-save alt"
            disabled={rediscover.isPending}
            onClick={() => rediscover.mutate()}
          >
            {rediscover.isPending ? "Rediscovering…" : "Rediscover tools"}
          </button>
        </div>
      </ConfGroup>

      <ConfGroup
        id="agents"
        num="13"
        title="Agents"
        right={`${agentCount} agent${agentCount === 1 ? "" : "s"}`}
        defaultCollapsed
      >
        <AgentsEditor
          cfg={agentCfg}
          toolNames={agentToolNames}
          toolModes={agentToolModes}
          skillNames={skillNames}
        />
      </ConfGroup>

      {/* A3 / D49 §D-6 — scheduled automations. The group is the LIST; the editor opens in a sheet the
          panel owns (ConfTab is long enough, and phone width is the primary viewport). The records live
          in SQLite behind `AutomationService`, NOT in config.yaml — so this group has no draft and no
          save bar: every row edit is its own request. */}
      <ConfGroup
        id={AUTOMATIONS_GROUP_ID}
        num="14"
        title="Automations"
        right={automationsRight}
        defaultCollapsed
      >
        <AutomationsPanel />
      </ConfGroup>

      <ConfGroup
        id="skills"
        num="15"
        title="Skills"
        right={`${skillNames.length} discovered`}
        defaultCollapsed
      >
        <SkillsEditor enabled={skillsEnabled} />
      </ConfGroup>

      <ConfGroup
        id="memory"
        num="16"
        title="Memory"
        right={memoryCfg.enabled ? "on" : "off"}
        defaultCollapsed
      >
        <MemoryEditor cfg={memoryCfg} />
      </ConfGroup>

      <ConfGroup
        id="computers"
        num="17"
        title="Computers"
        right={`${hosts.length} machine${hosts.length === 1 ? "" : "s"}`}
      >
        <MachineEditor hosts={hosts} />
      </ConfGroup>

      {/* Hosted Tools group (D35 §F0): when the active layout hosts utils in Conf (3-/2-tab), the Tools
          content renders here as the LAST functional group before Appearance — the group header replaces
          utils's standalone `.sec`. Numbered 17 (slotting in before the terminal Appearance group, which
          shifts to 18 while hosted); the standalone UtilsTab is unmounted in this layout, so its
          "agent-tools" child group has no duplicate DOM id. */}
      {hostsUtils && (
        <ConfGroup id={HOSTED_UTILS_GROUP_ID} num="18" title="Tools" right="utility tools">
          <UtilsContent />
        </ConfGroup>
      )}

      <ConfGroup id="appearance" num={hostsUtils ? "19" : "18"} title="Appearance">
        {/* Every row uses the shared `SettingRow` (label + desc + trailing control) so the group has one
            consistent shape; the Palette axis uses the `Swatches` color-chip radiogroup. */}
        <div className="conf-card">
          <SettingRow
            label="Theme"
            desc={themeOptions.map((t) => t.label.toLowerCase()).join(" · ")}
          >
            <Seg<ThemeId> label="Theme" current={theme} options={themeOptions} onPick={pickTheme} />
          </SettingRow>
          {modeOptions.length > 1 && (
            <SettingRow label="Mode" desc="light · dark">
              <Seg<Mode> label="Mode" current={mode} options={modeOptions} onPick={pickMode} />
            </SettingRow>
          )}
          {accentOptions.length > 0 && (
            <SettingRow
              label="Palette"
              desc={accentOptions.map((a) => a.label.toLowerCase()).join(" · ")}
            >
              <Swatches
                current={accent}
                options={accentOptions}
                onPick={pickAccent}
                ariaLabel="Palette"
              />
            </SettingRow>
          )}
          {/* Per-theme settings (M3 §14.3) — auto-rendered from the active theme's `ThemeDef.settings`
              schema (vapor → App mark / Sun & grid / Horizon / Live waveform). switch→Switch, seg→Seg;
              values resolve against the theme's declared defaults. A new theme's options appear here with
              zero Conf change. */}
          {settingsSpec.map(([key, field]) => {
            const value = themeVals?.[key] ?? field.default;
            return (
              <SettingRow key={key} label={field.label} desc={field.desc}>
                {field.type === "switch" ? (
                  <Switch
                    on={value as boolean}
                    onToggle={() => pickSetting(key, !value)}
                    label={field.label}
                  />
                ) : (
                  <Seg<string>
                    label={field.label}
                    current={value as string}
                    options={field.options.map((o) => ({ val: o.val, label: o.label }))}
                    onPick={(v) => pickSetting(key, v)}
                  />
                )}
              </SettingRow>
            );
          })}
          {/* Global levers (apply to every theme) — synced like the rest of appearance (owner directive). */}
          <SettingRow label="Motion" desc="ambient effects · LED · equalizer · sun bob">
            <Switch
              on={motion === "full"}
              label="Motion"
              onToggle={() => setGlobal({ motion: motion === "full" ? "reduced" : "full" })}
            />
          </SettingRow>
          <SettingRow label="Blur" desc="frosted glass bars · off is faster (esp. Firefox)">
            <Switch
              on={perf === "full"}
              label="Blur"
              onToggle={() => setGlobal({ perf: perf === "full" ? "lite" : "full" })}
            />
          </SettingRow>
          {/* Global, per-device (local — not synced like motion/perf): every theme's Root honors it.
              minimal = no app bar + no tab bar; nav via the floating orbit menu (DefaultRoot themes;
              vapor treats minimal as off for now). */}
          <SettingRow
            label="App bar"
            desc="on · clear (transparent bar) · off (more screen) · minimal (orbit-menu nav)"
          >
            <Seg<AppbarMode>
              label="App bar"
              current={appbarMode}
              options={[
                { val: "visible", label: "On" },
                { val: "transparent", label: "Clear" },
                { val: "off", label: "Off" },
                { val: "minimal", label: "Min" },
              ]}
              onPick={(v) => setUI({ appbarMode: v })}
            />
          </SettingRow>
          {/* Section layout (D35 §F0) — global, per-device (local, NOT synced — like App bar). `current` is
              the RAW lever (auto/4/3/2), not the resolved id. ALL options always show; an unsupported pick
              for the active theme is coerced to its nearest supported preset (+ a one-time warn) by
              `resolveLayout` — capability-aware greying is a later polish. */}
          <SettingRow
            label="Layout"
            desc="sections on the tab bar · 3-tab hosts tools in conf · 2-tab moves conf to the menu"
          >
            <Seg<"auto" | LayoutId>
              label="Layout"
              current={layout}
              options={[
                { val: "auto", label: "Auto" },
                { val: "4-tab", label: "4" },
                { val: "3-tab", label: "3" },
                { val: "2-tab", label: "2" },
              ]}
              onPick={(v) => setUI({ layout: v })}
            />
          </SettingRow>
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
