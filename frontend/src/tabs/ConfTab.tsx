import { useEffect, useId, useRef, useState } from "react";

import { AgentsEditor } from "../components/AgentsEditor";
import { ConfGroup } from "../components/ConfGroup";
import { JsonField } from "../components/JsonField";
import { MachineEditor } from "../components/MachineEditor";
import { MemoryEditor } from "../components/MemoryEditor";
import { MoveButtons } from "../components/MoveButtons";
import { NumField } from "../components/NumField";
import { useDragReorder } from "../components/useDragReorder";
import {
  ProviderModelPicker,
  type PickerCatalog,
  type PickerValue,
} from "../components/ProviderModelPicker";
import { Seg } from "../components/Seg";
import { ServerListEditor } from "../components/ServerListEditor";
import { SettingRow } from "../components/SettingRow";
import { SkillsEditor } from "../components/SkillsEditor";
import { Swatches } from "../components/Swatches";
import { Switch } from "../components/Switch";
import { useAccessStatus, useSetServe } from "../hooks/useAccess";
import { useAppChrome } from "../hooks/useAppChrome";
import { useSections } from "../hooks/useSections";
import { currentAppearancePatch, useSaveAppearance } from "../hooks/useAppearance";
import { agentModeOf, useActionSpecs } from "../hooks/useActions";
import { disclosureToggle } from "../lib/disclosure";
import { useAgentList, type AgentSectionCfg } from "../hooks/useAgents";
import { useDefaultPrompt } from "../hooks/useDefaultPrompt";
import { useHosts, useServerInfo } from "../hooks/useFleet";
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
  type SettingsDoc,
} from "../hooks/useSettings";
import { useSkills } from "../hooks/useSkills";
import { promptPreview } from "../lib/promptPreview";
import { setCollapsed } from "../store/collapse";
import { useRegisterDirty } from "../store/dirty";
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
    (r.doc.extra_body != null && Object.keys(r.doc.extra_body).length > 0);

  const commitRename = () => {
    const nn = renameVal.trim().toLowerCase();
    setRenaming(false);
    if (nn === name) return;
    if (!PROVIDER_SLUG.test(nn)) {
      pushToast("provider name: a–z 0–9 _ + . - (max 32)", "err");
      setRenameVal(name);
      return;
    }
    if (props.existingNames.includes(nn)) {
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

              <label>Max-tokens field</label>
              <select
                aria-label="Max tokens field"
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
                <option value="">auto (from api mode)</option>
                <option value="max_tokens">max_tokens</option>
                <option value="max_completion_tokens">max_completion_tokens</option>
              </select>
            </div>

            <div className="fallback-section">
              <span className="label">Models</span>
              <span className="desc">clean name · id · window · extra_body</span>
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
                  {/* Advanced fold — wire id + max-tokens field + extra_body, on the shared `.svc-edit`
                      disclosure idiom. Auto-opens when any is non-default (preserves the old wire-id
                      auto-reveal). FX17 (C6): the model-level max_tokens_field override is chat-relevant;
                      voice/speed/language/format/dim editors land in Slice 2 (schema already round-trips). */}
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
                          <label>Wire id</label>
                          <input
                            aria-label="Model id"
                            value={r.doc.id ?? ""}
                            placeholder="(defaults to the name)"
                            onChange={(e) => setRowDoc(i, { id: e.target.value || null })}
                          />
                          <label>Max-tokens field</label>
                          <select
                            aria-label="Model max tokens field"
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
                        </div>
                      </div>
                    )}
                  </div>
                  {/* remove-idiom rule (P13): a card ENTITY (a model / a provider) removes via the `.mfoot`
                      text-danger button; a compact INLINE list row (an inference fallback) removes via the
                      square ✕ `.row-remove`. Follow this split for future editors. */}
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
  | "providers"
>;

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
    // The target theme's default mode/accent — the single source of truth is `defaultSwitchTarget`
    // (resolve.ts), shared with `coerceBootTheme`'s fallback (item ⑥) so the `?? "dark"` derivation lives
    // in one place.
    const target = defaultSwitchTarget(id);
    void switchTheme(id, target); // async (loads the bundle first) → DON'T read the store for theme below
    // The skin/mode/accent are the explicit target; motion/perf/themeSettings ride along unchanged.
    saveAppearance.mutate({ ...currentAppearancePatch(), theme: id, ...target });
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
  // Hosted-utils scroll handoff (D35 §F0): when `useSections.navigate` coerces a `utils` navigation to Conf
  // it arms `groupScroll` with the hosted group's DOM id. Consume it here — force-EXPAND the group (a plain
  // toggle can't guarantee the open state), scroll it to the top, then clear. The clear is deferred to a
  // MICROTASK so DefaultRoot's parent scroll-reset effect (which runs AFTER this child effect in the same
  // passive-effect flush) still peeks a pending target and SKIPS its `scrollTo(0,0)` — otherwise it would
  // cancel this scroll. Guarded on `hostsUtils` so it only fires when the group is actually rendered here.
  useEffect(() => {
    if (scrollTarget !== HOSTED_UTILS_GROUP_ID || !hostsUtils) return;
    setCollapsed(HOSTED_UTILS_GROUP_ID, false);
    document.getElementById(HOSTED_UTILS_GROUP_ID)?.scrollIntoView({ block: "start" });
    queueMicrotask(clearGroupScrollTarget);
  }, [scrollTarget, hostsUtils]);

  const { data: server } = useServerInfo();
  const { data: hosts = [] } = useHosts(server?.poll_seconds ?? 5);

  const { data: settings } = useSettings();
  const providersBaseRev = useSettingsProvidersRev(); // FR2-1 — the base rev bound to the settings snapshot
  const { data: providersInfo, dataUpdatedAt: providersUpdatedAt } = useProviders();
  const save = useSaveSettings();
  const { data: integrations } = useIntegrationsStatus();
  const rediscover = useRediscover();
  const { data: actionSpecs = [] } = useActionSpecs();
  const { data: skillList = [] } = useSkills();
  const { data: defaultPrompt = "" } = useDefaultPrompt();
  const [draft, setDraft] = useState<Draft | null>(null);
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
  const agentSection = settings?.agent as Partial<AgentSectionCfg> | undefined;
  const agentCfg: AgentSectionCfg = {
    default_agent: agentSection?.default_agent ?? "",
    default_title: agentSection?.default_title ?? "",
    global_subagent_limit: agentSection?.global_subagent_limit ?? 6,
    subagent_clamp_privilege: agentSection?.subagent_clamp_privilege ?? true,
    auto_rotate: agentSection?.auto_rotate ?? false,
    auto_rotate_min_overlap: agentSection?.auto_rotate_min_overlap ?? 2,
    streaming: agentSection?.streaming ?? "auto",
    // D42 — global compaction defaults (per-agent overrides stay YAML-only). Defaults mirror
    // CompactionCfg's backend defaults; only these four knobs are surfaced.
    compaction: {
      enabled: agentSection?.compaction?.enabled ?? true,
      threshold_frac: agentSection?.compaction?.threshold_frac ?? 0.85,
      keep_recent_tokens: agentSection?.compaction?.keep_recent_tokens ?? 4096,
      clear_output_min_tokens: agentSection?.compaction?.clear_output_min_tokens ?? 500,
    },
  };
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

  const dirty = settings && draft && JSON.stringify(draft) !== JSON.stringify(pickDraft(settings));
  // FX11 — is the providers SUBTREE specifically dirty (vs the whole draft)? Drives whether the save
  // carries the `providers` map + its base at all. A queued rename also requires sending the map (the
  // backend rekey/replacement needs it). The epoch base itself is captured at seed time (FR2-1, above).
  const providersDirty =
    !!settings && !!draft && JSON.stringify(draft.providers) !== JSON.stringify(settings.providers);
  const sendProviders = providersDirty || Object.keys(renames).length > 0;
  // F19 — register with the cross-editor dirty registry so a refresh/close-tab while these
  // settings are unsaved triggers the browser's beforeunload prompt. Cleanup on unmount
  // auto-clears the registration (closing Conf doesn't leave the registry stuck).
  useRegisterDirty("conf", !!dirty);

  const inf = draft?.inference;
  const srv = draft?.server;
  // P11 — pointer drag reorder for the fallback chain, layered over the retained MoveButtons. Commits
  // through the same moveFallback the arrows use. (moveFallback is a hoisted declaration below.)
  const fbDrag = useDragReorder(inf?.fallbacks.length ?? 0, moveFallback);

  function setInf<K extends keyof Draft["inference"]>(key: K, val: Draft["inference"][K]) {
    setDraft((d) => (d ? { ...d, inference: { ...d.inference, [key]: val } } : d));
  }
  // A11/D48 — the inference primary + ordered fallbacks as flat provider→model refs.
  function setPrimary(v: PickerValue) {
    setDraft((d) =>
      d ? { ...d, inference: { ...d.inference, provider: v.provider, model: v.model } } : d,
    );
  }
  function setFallbacks(next: Draft["inference"]["fallbacks"]) {
    setDraft((d) => (d ? { ...d, inference: { ...d.inference, fallbacks: next } } : d));
  }
  function setFallbackRef(idx: number, v: PickerValue) {
    setFallbacks(
      (draft?.inference.fallbacks ?? []).map((f, i) =>
        i === idx ? { provider: v.provider ?? "", model: v.model } : f,
      ),
    );
  }
  function addFallbackRef() {
    const first = Object.keys(draft?.providers ?? {})[0] ?? "";
    const models = first ? Object.keys(draft?.providers[first]?.models ?? {}) : [];
    setFallbacks([
      ...(draft?.inference.fallbacks ?? []),
      { provider: first, model: models.length >= 2 ? models[0] : null },
    ]);
  }
  function removeFallbackRef(idx: number) {
    setFallbacks((draft?.inference.fallbacks ?? []).filter((_, i) => i !== idx));
  }
  function moveFallback(from: number, to: number) {
    const arr = [...(draft?.inference.fallbacks ?? [])];
    if (to < 0 || to >= arr.length) return;
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
    setFallbacks(arr);
  }

  // A11/D48 — provider map edits (replacement semantics). Rename is an explicit control that ALSO
  // cascades the visible draft selectors (C1 UI cascade) + queues `provider_renames` (the backend
  // ordering is authoritative). Delete/add are plain map mutations.
  function setProvider(name: string, doc: ProviderDoc) {
    setDraft((d) => (d ? { ...d, providers: { ...d.providers, [name]: doc } } : d));
  }
  function addProviderCard() {
    const name = newProvName.trim().toLowerCase();
    if (!PROVIDER_SLUG.test(name))
      return pushToast("provider name: a–z 0–9 _ + . - (max 32)", "err");
    if (draft?.providers[name]) return pushToast("a provider with that name exists", "err");
    setDraft((d) => (d ? { ...d, providers: { ...d.providers, [name]: emptyProvider() } } : d));
    setNewProvName("");
    setAdding(false);
    setOpenProvider(name);
  }
  function removeProvider(name: string) {
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
    setDraft((d) => {
      if (!d) return d;
      const provs: Record<string, ProviderDoc> = {};
      for (const [k, v] of Object.entries(d.providers)) provs[k === from ? to : k] = v;
      const i = d.inference;
      return {
        ...d,
        providers: provs,
        inference: {
          ...i,
          provider: i.provider === from ? to : i.provider,
          fallbacks: i.fallbacks.map((f) => (f.provider === from ? { ...f, provider: to } : f)),
        },
      };
    });
    setRenames((r) => {
      const next = { ...r };
      const orig = Object.entries(next).find(([, cur]) => cur === from);
      if (orig) next[orig[0]] = to;
      else next[from] = to;
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
  function setVoiceEp(
    svc: "stt" | "tts",
    tier: "primary" | "fallback",
    key: "base_url" | "api_key" | "model" | "voice",
    val: string,
  ) {
    setDraft((d) =>
      d
        ? {
            ...d,
            voice: {
              ...d.voice,
              [svc]: { ...d.voice[svc], [tier]: { ...d.voice[svc][tier], [key]: val } },
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
    return { dangling, byProvider };
  })();

  const jsonBlocked = Object.keys(invalids).length > 0;
  const blockReasons = [
    ...referenceReport.dangling,
    ...(jsonBlocked ? ["fix the invalid provider fields highlighted above"] : []),
  ];
  const saveDisabled = !dirty || save.isPending || blockReasons.length > 0;

  function onSave() {
    if (!draft || saveDisabled) return;
    const dimRaw = String(draft.embeddings.dim ?? "").trim();
    const patch: SavePatch = {
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
    };
    // FX11 — carry the providers map + its epoch-bound base ONLY when the subtree is dirty (or a rename is
    // queued); a clean-providers save omits both (no needless 409 surface, and `providers_base` never rides
    // without `providers`). The base is the DRAFT-EPOCH capture, never the live query rev.
    if (sendProviders) {
      patch.providers = draft.providers;
      patch.providers_base = capturedBaseRef.current ?? undefined;
    }
    if (Object.keys(renames).length) patch.provider_renames = renames;
    save.mutate(patch, {
      onSuccess: (res) => {
        // Draft epoch (R18): adopt the PUT echo as the new clean baseline + clear the rename queue, and
        // advance the captured base to the post-write rev (the draft reseeds clean at the new epoch).
        const echo = pickDraft(res.settings);
        seededRef.current = JSON.stringify(echo);
        setDraft(echo);
        setRenames({});
        capturedBaseRef.current = res.providers_rev;
        setSaveWarn({ at: Date.now(), warnings: res.warnings ?? [] }); // FX16/FR2-3 — replace, stamped with the save moment
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
          {save.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
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
          <SettingRow
            label="Default"
            desc="primary provider · model — /<provider> overrides per message"
          >
            <ProviderModelPicker
              label="Default"
              value={{ provider: inf?.provider ?? null, model: inf?.model ?? null }}
              onChange={setPrimary}
              catalog={draftCatalog}
              allowRawId
            />
          </SettingRow>
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
          <div className="fallback-section">
            <span className="label">Fallbacks</span>
            <span className="desc">tried in order after the default</span>
          </div>
          {(inf?.fallbacks ?? []).map((fb, i) => (
            <div className="confrow fallback-row" key={i} {...fbDrag.rowProps(i)}>
              <div className="k">
                <div className="label">#{i + 1}</div>
              </div>
              <ProviderModelPicker
                label={`Fallback ${i + 1}`}
                value={{ provider: fb.provider || null, model: fb.model }}
                onChange={(v) => setFallbackRef(i, v)}
                catalog={draftCatalog}
                allowRawId
              />
              {/* drag reorder (P11) — a layer over the arrows; the ⠿ handle carries touch-action:none. */}
              <button
                type="button"
                className="drag-handle"
                aria-label={`reorder fallback ${i + 1} — drag, or use the arrow buttons`}
                title="drag to reorder"
                {...fbDrag.handleProps(i)}
              >
                ⠿
              </button>
              <MoveButtons
                index={i}
                count={inf?.fallbacks.length ?? 0}
                onMove={moveFallback}
                label={`fallback ${i + 1}`}
              />
              {/* remove-idiom (P13): a fallback is a compact INLINE list row → the square ✕ `.row-remove`. */}
              <button
                type="button"
                className="row-remove"
                aria-label={`remove fallback ${i + 1}`}
                title="remove"
                onClick={() => removeFallbackRef(i)}
              >
                ✕
              </button>
            </div>
          ))}
          {/* debounced drag position announcements for AT (visually hidden) */}
          <div
            aria-live="polite"
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              margin: -1,
              padding: 0,
              overflow: "hidden",
              clip: "rect(0 0 0 0)",
              whiteSpace: "nowrap",
              border: 0,
            }}
          >
            {fbDrag.announce}
          </div>
          <div className="fallback-add">
            <button type="button" className="svc-add" onClick={addFallbackRef}>
              + add fallback
            </button>
          </div>
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
          <Field
            label="Primary endpoint"
            desc="vault · /v1 base url"
            value={vstt?.primary.base_url ?? ""}
            onChange={(v) => setVoiceEp("stt", "primary", "base_url", v)}
            placeholder="http://host:9000/v1"
          />
          <Field
            label="Primary model"
            desc="whisper model id"
            value={vstt?.primary.model ?? ""}
            onChange={(v) => setVoiceEp("stt", "primary", "model", v)}
          />
          <Field
            label="Primary key"
            desc="optional — local servers ignore it"
            type="password"
            value={vstt?.primary.api_key ?? ""}
            onChange={(v) => setVoiceEp("stt", "primary", "api_key", v)}
          />
          <Field
            label="Fallback endpoint"
            desc="emma · tried only if primary fails"
            value={vstt?.fallback.base_url ?? ""}
            onChange={(v) => setVoiceEp("stt", "fallback", "base_url", v)}
            placeholder="http://host:9000/v1 (blank → no fallback)"
          />
          <Field
            label="Fallback model"
            desc="whisper model id"
            value={vstt?.fallback.model ?? ""}
            onChange={(v) => setVoiceEp("stt", "fallback", "model", v)}
          />
          <Field
            label="Fallback key"
            desc="optional"
            type="password"
            value={vstt?.fallback.api_key ?? ""}
            onChange={(v) => setVoiceEp("stt", "fallback", "api_key", v)}
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
          <Field
            label="Primary endpoint"
            desc="vault · /v1 base url"
            value={vtts?.primary.base_url ?? ""}
            onChange={(v) => setVoiceEp("tts", "primary", "base_url", v)}
            placeholder="http://host:7851/v1"
          />
          <Field
            label="Primary model"
            desc="tts model id"
            value={vtts?.primary.model ?? ""}
            onChange={(v) => setVoiceEp("tts", "primary", "model", v)}
          />
          <Field
            label="Primary voice"
            desc="server voice id"
            value={vtts?.primary.voice ?? ""}
            onChange={(v) => setVoiceEp("tts", "primary", "voice", v)}
            placeholder="echo"
          />
          <Field
            label="Primary key"
            desc="optional"
            type="password"
            value={vtts?.primary.api_key ?? ""}
            onChange={(v) => setVoiceEp("tts", "primary", "api_key", v)}
          />
          <Field
            label="Fallback endpoint"
            desc="emma · tried only if primary fails"
            value={vtts?.fallback.base_url ?? ""}
            onChange={(v) => setVoiceEp("tts", "fallback", "base_url", v)}
            placeholder="http://host:7851/v1 (blank → no fallback)"
          />
          <Field
            label="Fallback model"
            desc="tts model id"
            value={vtts?.fallback.model ?? ""}
            onChange={(v) => setVoiceEp("tts", "fallback", "model", v)}
          />
          <Field
            label="Fallback voice"
            desc="server voice id"
            value={vtts?.fallback.voice ?? ""}
            onChange={(v) => setVoiceEp("tts", "fallback", "voice", v)}
            placeholder="echo"
          />
          <Field
            label="Fallback key"
            desc="optional"
            type="password"
            value={vtts?.fallback.api_key ?? ""}
            onChange={(v) => setVoiceEp("tts", "fallback", "api_key", v)}
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

      <ConfGroup
        id="mcp"
        num="10"
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
        num="11"
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
        num="12"
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

      <ConfGroup
        id="skills"
        num="13"
        title="Skills"
        right={`${skillNames.length} discovered`}
        defaultCollapsed
      >
        <SkillsEditor enabled={skillsEnabled} />
      </ConfGroup>

      <ConfGroup
        id="memory"
        num="14"
        title="Memory"
        right={memoryCfg.enabled ? "on" : "off"}
        defaultCollapsed
      >
        <MemoryEditor cfg={memoryCfg} />
      </ConfGroup>

      <ConfGroup
        id="computers"
        num="15"
        title="Computers"
        right={`${hosts.length} machine${hosts.length === 1 ? "" : "s"}`}
      >
        <MachineEditor hosts={hosts} />
      </ConfGroup>

      {/* Hosted Tools group (D35 §F0): when the active layout hosts utils in Conf (3-/2-tab), the Tools
          content renders here as the LAST functional group before Appearance — the group header replaces
          utils's standalone `.sec`. Numbered 16 (slotting in before the terminal Appearance group, which
          shifts to 17 while hosted); the standalone UtilsTab is unmounted in this layout, so its
          "agent-tools" child group has no duplicate DOM id. */}
      {hostsUtils && (
        <ConfGroup id={HOSTED_UTILS_GROUP_ID} num="16" title="Tools" right="utility tools">
          <UtilsContent />
        </ConfGroup>
      )}

      <ConfGroup id="appearance" num={hostsUtils ? "17" : "16"} title="Appearance">
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
