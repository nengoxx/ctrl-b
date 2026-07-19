import { useEffect, useId, useState } from "react";

import { AgentsEditor } from "../components/AgentsEditor";
import { ConfGroup } from "../components/ConfGroup";
import { MachineEditor } from "../components/MachineEditor";
import { MemoryEditor } from "../components/MemoryEditor";
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
import { useSaveSettings, useSettings, type SettingsDoc } from "../hooks/useSettings";
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

// Just the slices the 7a form edits — kept verbatim from the loaded doc so a save round-trips the
// masked api_key (the backend restores it) and leaves every other section untouched.
type Draft = Pick<
  SettingsDoc,
  "server" | "inference" | "searxng" | "embeddings" | "open_terminal" | "shell" | "voice"
>;

function pickDraft(s: SettingsDoc): Draft {
  return {
    server: s.server,
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
  const save = useSaveSettings();
  const { data: integrations } = useIntegrationsStatus();
  const rediscover = useRediscover();
  const { data: actionSpecs = [] } = useActionSpecs();
  const { data: skillList = [] } = useSkills();
  const { data: defaultPrompt = "" } = useDefaultPrompt();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openFallback, setOpenFallback] = useState<number | null>(null); // D18 — expanded fallback row

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

  // Reseed the draft whenever the server doc changes (initial load + after a successful save, which
  // replaces the cache with the masked echo → clears the dirty state).
  useEffect(() => {
    if (settings) setDraft(pickDraft(settings));
  }, [settings]);

  const dirty = settings && draft && JSON.stringify(draft) !== JSON.stringify(pickDraft(settings));
  // F19 — register with the cross-editor dirty registry so a refresh/close-tab while these
  // settings are unsaved triggers the browser's beforeunload prompt. Cleanup on unmount
  // auto-clears the registration (closing Conf doesn't leave the registry stuck).
  useRegisterDirty("conf", !!dirty);

  const inf = draft?.inference;
  const srv = draft?.server;

  function setInf<K extends keyof Draft["inference"]>(key: K, val: Draft["inference"][K]) {
    setDraft((d) => (d ? { ...d, inference: { ...d.inference, [key]: val } } : d));
  }
  function setEndpoint(
    which: "local" | "cloud",
    key: "base_url" | "api_key" | "model" | "context_window",
    val: string | null,
  ) {
    setDraft((d) =>
      d
        ? { ...d, inference: { ...d.inference, [which]: { ...d.inference[which], [key]: val } } }
        : d,
    );
  }
  // D18 — the inference `fallbacks` list (edited inline; saved by the Inference saveBar like the other
  // scalar fields). Edits operate on the draft array immutably.
  function setFallbacks(next: Draft["inference"]["fallbacks"]) {
    setDraft((d) => (d ? { ...d, inference: { ...d.inference, fallbacks: next } } : d));
  }
  function setFallback(
    idx: number,
    key: "base_url" | "api_key" | "model" | "context_window",
    val: string | null,
  ) {
    setFallbacks(
      (draft?.inference.fallbacks ?? []).map((fb, i) => (i === idx ? { ...fb, [key]: val } : fb)),
    );
  }
  function addFallback() {
    const next = [
      ...(draft?.inference.fallbacks ?? []),
      { base_url: "", api_key: null, model: "", context_window: null },
    ];
    setFallbacks(next);
    setOpenFallback(next.length - 1); // open the new row so its fields are immediately editable
  }
  function removeFallback(idx: number) {
    setFallbacks((draft?.inference.fallbacks ?? []).filter((_, i) => i !== idx));
    setOpenFallback(null);
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

  function onSave() {
    if (!draft) return;
    // Coerce numeric text fields; the backend validates and 422s on a bad value (surfaced as toast).
    const dimRaw = String(draft.embeddings.dim ?? "").trim();
    // Per-endpoint context window (D42): blank → null (auto), else numeric. Same shape as `dim`.
    const cw = (v: number | string | null | undefined): number | null => {
      const s = String(v ?? "").trim();
      return s ? Number(s) : null;
    };
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
        local: {
          ...draft.inference.local,
          context_window: cw(draft.inference.local.context_window),
        },
        cloud: {
          ...draft.inference.cloud,
          context_window: cw(draft.inference.cloud.context_window),
        },
        fallbacks: draft.inference.fallbacks.map((fb) => ({
          ...fb,
          context_window: cw(fb.context_window),
        })),
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
    save.mutate(patch);
  }

  // The five "scalar settings" groups below (Inference / Server / SearXNG / Embeddings /
  // Open-terminal) all share a single global `dirty` flag and the same `onSave` patch,
  // because their forms compose into one PUT /api/settings. Rather than parking one Save
  // button at the bottom of just the last group (where users editing Inference can't find
  // it), we render the same bar at the end of every saveable group so it's reachable from
  // whichever section the user is actually in. Editor-managed groups (MCP, OpenAPI, Agents,
  // Skills, Tool descriptions, Computers) have their own save flows; Appearance is UI-store
  // only and needs no save button.
  const saveBar = (
    <div className="conf-savebar">
      <button className="conf-save" disabled={!dirty || save.isPending} onClick={onSave}>
        {save.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
      </button>
    </div>
  );

  return (
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-conf"
      data-screen-label="04 Conf"
      role="tabpanel"
      aria-labelledby="tabbtn-conf"
    >
      <ConfGroup id="inference" num="01" title="Inference" right="openai-compatible">
        <div className="conf-card">
          <SettingRow
            label="Default mode"
            desc="local · cloud — /local //cloud override per message"
          >
            <Seg<string>
              label="Default mode"
              current={inf?.default_mode ?? "local"}
              options={[
                { val: "local", label: "Local" },
                { val: "cloud", label: "Cloud" },
              ]}
              onPick={(v) => setInf("default_mode", v)}
            />
          </SettingRow>
          <SettingRow
            label="Failover"
            desc="on failure, fall through local↔cloud (+ any configured fallbacks)"
          >
            <Switch
              on={inf?.failover ?? true}
              label="Inference failover"
              onToggle={() => setInf("failover", !(inf?.failover ?? true))}
            />
          </SettingRow>
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
            label="Local context window"
            desc="tokens — blank = auto: probed from the server"
            value={inf?.local.context_window == null ? "" : String(inf.local.context_window)}
            onChange={(v) => setEndpoint("local", "context_window", v === "" ? null : v)}
            placeholder="auto"
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
            label="Cloud context window"
            desc="tokens — blank = auto: token-threshold fallback"
            value={inf?.cloud.context_window == null ? "" : String(inf.cloud.context_window)}
            onChange={(v) => setEndpoint("cloud", "context_window", v === "" ? null : v)}
            placeholder="auto"
          />
          {/* D18 — fallback endpoints as collapsible rows, tried in order after local↔cloud (failover
              on). Reuses the .mwrap/.mconf machine-row dropdown pattern so each row's fields are clearly
              grouped. */}
          <div className="fallback-section">
            <span className="label">Fallbacks</span>
            <span className="desc">tried in order after local↔cloud</span>
          </div>
          {(inf?.fallbacks ?? []).map((fb, i) => (
            <div className={"mwrap" + (openFallback === i ? " open" : "")} key={i}>
              <div
                className="confrow"
                {...disclosureToggle(openFallback === i, () =>
                  setOpenFallback(openFallback === i ? null : i),
                )}
              >
                <div className="k">
                  <div className="label">Fallback #{i + 1}</div>
                  <div className="desc">{fb.base_url || "tap to configure"}</div>
                </div>
                <span className="chev" aria-hidden>
                  ›
                </span>
              </div>
              <div className="mconf">
                {openFallback === i && (
                  <>
                    <div className="mform">
                      <label>Endpoint</label>
                      <input
                        aria-label="Fallback endpoint"
                        type="text"
                        value={fb.base_url}
                        placeholder="https://host/v1"
                        onChange={(e) => setFallback(i, "base_url", e.target.value)}
                      />
                      <label>Model</label>
                      <input
                        aria-label="Fallback model"
                        type="text"
                        value={fb.model}
                        placeholder="model id"
                        onChange={(e) => setFallback(i, "model", e.target.value)}
                      />
                      <label>Key</label>
                      <input
                        aria-label="Fallback API key"
                        type="password"
                        value={fb.api_key ?? ""}
                        placeholder="optional — masked"
                        onChange={(e) => setFallback(i, "api_key", e.target.value)}
                      />
                      <label>Context window</label>
                      <input
                        aria-label="Fallback context window"
                        inputMode="numeric"
                        value={fb.context_window == null ? "" : String(fb.context_window)}
                        placeholder="auto"
                        onChange={(e) =>
                          setFallback(
                            i,
                            "context_window",
                            e.target.value === "" ? null : e.target.value,
                          )
                        }
                      />
                    </div>
                    <div className="mfoot">
                      <button type="button" className="danger" onClick={() => removeFallback(i)}>
                        remove
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
          <div className="fallback-add">
            <button type="button" className="svc-add" onClick={addFallback}>
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
          <SettingRow label="Debug" desc="verbose errors — off in prod · restart to apply">
            <Switch on={!!srv?.debug} onToggle={() => setSrv("debug", !srv?.debug)} label="Debug" />
          </SettingRow>
        </div>
        {/* HTTPS access (Tailscale Serve) — a live toggle (acts immediately, not part of the saved
            fields). Sits above the save bar so it reads as a control, not an afterthought (6c-2). */}
        <TailscaleAccessCard />
        {saveBar}
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

      <ConfGroup id="shell" num="06" title="Shell" right="! escape hatch">
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

      <ConfGroup id="voice-stt" num="07" title="Voice · STT" right="speech-to-text">
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

      <ConfGroup id="voice-tts" num="08" title="Voice · TTS" right="text-to-speech">
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
        num="09"
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
        num="10"
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
        num="11"
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
        num="12"
        title="Skills"
        right={`${skillNames.length} discovered`}
        defaultCollapsed
      >
        <SkillsEditor enabled={skillsEnabled} />
      </ConfGroup>

      <ConfGroup
        id="memory"
        num="13"
        title="Memory"
        right={memoryCfg.enabled ? "on" : "off"}
        defaultCollapsed
      >
        <MemoryEditor cfg={memoryCfg} />
      </ConfGroup>

      <ConfGroup
        id="computers"
        num="14"
        title="Computers"
        right={`${hosts.length} machine${hosts.length === 1 ? "" : "s"}`}
      >
        <MachineEditor hosts={hosts} />
      </ConfGroup>

      {/* Hosted Tools group (D35 §F0): when the active layout hosts utils in Conf (3-/2-tab), the Tools
          content renders here as the LAST functional group before Appearance — the group header replaces
          utils's standalone `.sec`. Numbered 15 (slotting in before the terminal Appearance group, which
          shifts to 16 while hosted); the standalone UtilsTab is unmounted in this layout, so its
          "agent-tools" child group has no duplicate DOM id. */}
      {hostsUtils && (
        <ConfGroup id={HOSTED_UTILS_GROUP_ID} num="15" title="Tools" right="utility tools">
          <UtilsContent />
        </ConfGroup>
      )}

      <ConfGroup id="appearance" num={hostsUtils ? "16" : "15"} title="Appearance">
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
