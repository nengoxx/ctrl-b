import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// R51 Tier 0 — the auto-stop dictation rows live in the Voice · STT group, hand-authored beside
// `auto_send` (nothing in this form auto-renders from the config shape). Two things are worth pinning:
// they really render in that group reading the live config, and the two numerics coerce to NUMBERS on
// save (a string would 422 at the backend, and a blank must become a visible 422 rather than a silent
// value the mic would then act on).
//
// Sub-editors + data hooks are stubbed exactly as in confMonitor.test.tsx so only the real Conf groups
// are live.

const makeSettings = () => ({
  server: {
    host: "127.0.0.1",
    port: 5433,
    poll_seconds: 5,
    feature_cycle_seconds: 30,
    debug: false,
  },
  providers: {},
  inference: {
    provider: null,
    model: null,
    fallbacks: [],
    failover: true,
    request_timeout_s: 120,
    system_prompt: "",
    system_prompt_append: "",
  },
  searxng: { base_url: "", enabled: false, language: null },
  embeddings: { provider: null, model: null, fallbacks: [], enabled: false, timeout_s: 60 },
  open_terminal: {
    base_url: "",
    api_key: null,
    enabled: false,
    exec_risk: "high",
    write_risk: "high",
    read_risk: "low",
  },
  shell: {
    enabled: false,
    user_exec_enabled: true,
    agent_exec_enabled: false,
    workdir: "",
    timeout_s: 30,
    max_output_chars: 10000,
  },
  voice: {
    enabled: false,
    stt: {
      provider: null,
      model: null,
      fallbacks: [],
      language: "",
      vad_filter: false,
      hotwords: "",
      auto_send: false,
      auto_stop: false,
      auto_stop_silence_s: 3,
      auto_stop_threshold: 0.01,
      connect_timeout_s: 3,
      timeout_s: 30,
      extra_body: {},
    },
    tts: {
      provider: null,
      model: null,
      fallbacks: [],
      format: "mp3",
      chunking: "sentence",
      chunk_format: "opus",
      chunk_min_words: 4,
      chunk_min_chars: 50,
      chunk_max_chars: 400,
      chunk_lookahead: 1,
      connect_timeout_s: 3,
      timeout_s: 30,
      extra_body: {},
    },
  },
  notifications: {
    enabled: false,
    events: { agent_input: true, turn_done: true, action_failed: true, automation_done: true },
  },
  monitor: { enabled: true, poll_seconds: 30, down_after_checks: 3, up_after_checks: 2 },
  wake: {
    cooldown_s: 300,
    presence_devices: [] as { name: string }[],
    presence_offline_after_s: 120,
    presence_cooldown_s: 3600,
    tailscale_socket_path: "/var/run/tailscale/tailscaled.sock",
    lan_probe_count: 3,
    lan_probe_timeout_s: 1,
    lan_health_ip: null as string | null,
    quiet_hours: null as { start: string; end: string } | null,
  },
  mcp_servers: [],
  openapi_servers: [],
  agent: { defaults: {} },
});

const h = vi.hoisted(() => ({
  save: vi.fn(),
  settings: null as unknown as ReturnType<typeof makeSettings>,
}));

// D70 §8.4/§9 — the agent-side children ConfTab renders are the globals card + the two roleplay
// cards (the per-agent list moved to the gallery). `pickRoleplay` stays real: ConfTab reads the
// Roleplay group's header summary through it.
vi.mock("../../src/components/AgentGlobals", () => ({ AgentGlobals: () => null }));
vi.mock("../../src/components/RoleplayEditor", async (importActual) => {
  const actual = await importActual<typeof import("../../src/components/RoleplayEditor")>();
  return { ...actual, RoleplayEditor: () => null, LorebookGlobals: () => null };
});
// D70 §6.6 — the lorebook manager is a query consumer (the book shelf); this suite has no
// QueryClientProvider. `LorebookPicker` is named too: `AgentsEditor` imports it, so a mock without
// it would fail that module's binding rather than its render.
vi.mock("../../src/components/LorebooksEditor", () => ({
  LorebooksEditor: () => null,
  LorebookPicker: () => null,
}));
vi.mock("../../src/components/MachineEditor", () => ({ MachineEditor: () => null }));
vi.mock("../../src/components/MemoryEditor", () => ({ MemoryEditor: () => null }));
vi.mock("../../src/components/SkillsEditor", () => ({ SkillsEditor: () => null }));
vi.mock("../../src/components/ServerListEditor", () => ({ ServerListEditor: () => null }));
vi.mock("../../src/components/AutomationsPanel", () => ({ AutomationsPanel: () => null }));
// D53 M3 — the `kit` media gallery is ALWAYS-ON, so this tab now renders one under every theme. It is a
// query consumer and this suite has no QueryClientProvider; the groups it produces are covered in
// confMediaGroups.test.tsx.
vi.mock("../../src/components/MediaGallery", () => ({ MediaGallery: () => null }));
vi.mock("../../src/hooks/useAutomations", async (importActual) => ({
  ...(await importActual<typeof import("../../src/hooks/useAutomations")>()),
  useAutomations: () => ({ data: undefined }),
}));
// Phase 18 — same shape for the Prompts group: the panel is stubbed out, and ConfTab's own header
// read is stubbed while the REAL `promptsSummary` (a pure function of the envelope) still runs.
vi.mock("../../src/components/PromptsEditor", () => ({ PromptsEditor: () => null }));
vi.mock("../../src/hooks/usePrompts", async (importActual) => ({
  ...(await importActual<typeof import("../../src/hooks/usePrompts")>()),
  usePrompts: () => ({ data: undefined }),
}));
// Both exports are stubbed: `UtilsContent` is what ConfTab hosts, and `UtilsTab` is read at MODULE-EVAL
// time by the kit DefaultRoot's `DEFAULT_BODIES` map — which this tree now reaches, because vapor's eager
// Root hosts DefaultRoot since D51 V4 (a mock missing the name throws on the binding access, not on render).
vi.mock("../../src/tabs/UtilsTab", () => ({ UtilsContent: () => null, UtilsTab: () => null }));
vi.mock("../../src/hooks/useSettings", () => ({
  useSettings: () => ({ data: h.settings }),
  useSettingsProvidersRev: () => "revA",
  useProviders: () => ({
    data: {
      providers: {},
      rev: "revA",
      sections: {
        inference: { provider: null, model: null, fallbacks: [] },
        stt: { provider: null, model: null, fallbacks: [] },
        tts: { provider: null, model: null, fallbacks: [] },
        embeddings: { provider: null, model: null, fallbacks: [] },
      },
      reserved_verbs: [],
      verbs: [],
      warnings: [],
    },
    dataUpdatedAt: 0,
  }),
  useSaveSettings: () => ({ mutate: h.save, isPending: false }),
}));
vi.mock("../../src/hooks/useFleet", () => ({
  useServerInfo: () => ({ data: { poll_seconds: 5 } }),
  useHosts: () => ({ data: [] }),
}));
vi.mock("../../src/hooks/useAccess", () => ({
  useAccessStatus: () => ({ data: undefined, isLoading: false }),
  useSetServe: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../src/hooks/useAppChrome", () => ({
  useAppChrome: () => ({ ttsAuto: false, ttsConfigured: false, toggleAutoTts: vi.fn() }),
}));
vi.mock("../../src/hooks/useSections", () => ({ useSections: () => ({ hosted: {} }) }));
vi.mock("../../src/hooks/useAppearance", () => ({
  useSaveAppearance: () => ({ mutate: vi.fn() }),
  currentAppearancePatch: () => ({}),
}));
vi.mock("../../src/hooks/useActions", () => ({
  useActionSpecs: () => ({ data: [] }),
  agentModeOf: () => "enabled",
  useAgentToolGrid: () => ({ toolNames: [], toolModes: {} }),
}));
vi.mock("../../src/hooks/useAgents", async (importActual) => {
  const actual = await importActual<typeof import("../../src/hooks/useAgents")>();
  return { ...actual, useAgentList: () => ({ data: { agents: [], default: "default" } }) };
});
vi.mock("../../src/hooks/useDefaultPrompt", () => ({ useDefaultPrompt: () => ({ data: "" }) }));
vi.mock("../../src/hooks/useIntegrations", () => ({
  useIntegrationsStatus: () => ({ data: undefined }),
  useRediscover: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../src/hooks/useSkills", () => ({ useSkills: () => ({ data: [] }) }));

import { ConfTab } from "../../src/tabs/ConfTab";

beforeEach(() => {
  h.settings = makeSettings();
  h.save.mockClear();
});
afterEach(cleanup);

/** The Voice · STT group's DOM anchor (ConfGroup renders its `id`). */
const sttGroup = () => {
  const el = document.getElementById("voice-stt");
  if (!el) throw new Error("the Voice · STT group is not rendered");
  return within(el);
};
const field = (name: string) => sttGroup().getByLabelText<HTMLInputElement>(name);
const saveButton = () =>
  screen.getAllByRole<HTMLButtonElement>("button", { name: /Save changes|Saved|Saving/ })[0];
const voiceOf = (call = 0) =>
  (h.save.mock.calls[call][0] as { voice?: { stt?: Record<string, unknown> } }).voice?.stt;

describe("ConfTab · auto-stop dictation rows (R51 Tier 0)", () => {
  it("renders the toggle + both thresholds in the STT group, from the live config", () => {
    render(<ConfTab active />);
    expect(sttGroup().getByLabelText("STT auto-stop").getAttribute("aria-checked")).toBe("false");
    expect(field("Silence window").value).toBe("3");
    expect(field("Silence threshold").value).toBe("0.01");
    // the knob it composes with is its neighbour, which is the point of the placement
    expect(sttGroup().getByLabelText("STT auto-send").getAttribute("aria-checked")).toBe("false");
  });

  it("saves the switch + BOTH thresholds as numbers, leaving untouched sections home", () => {
    render(<ConfTab active />);
    fireEvent.click(sttGroup().getByLabelText("STT auto-stop"));
    fireEvent.change(field("Silence window"), { target: { value: "1.5" } });
    fireEvent.change(field("Silence threshold"), { target: { value: "0.02" } });
    fireEvent.click(saveButton());

    expect(h.save).toHaveBeenCalledTimes(1);
    expect(voiceOf()).toMatchObject({
      auto_stop: true,
      auto_stop_silence_s: 1.5, // coerced, not the typed "1.5"
      auto_stop_threshold: 0.02,
    });
    expect((h.save.mock.calls[0][0] as { monitor?: unknown }).monitor).toBeUndefined();
  });

  it("a CLEARED threshold rides to the backend as 0 — a visible 422, never a silent mute", () => {
    // Both fields floor well above 0 (0.5 s / 0.001), so 0 is never a meaningful value: bare `Number`
    // like the timeouts beside them, so a blank earns the same 422 every other cleared numeric earns.
    render(<ConfTab active />);
    fireEvent.change(field("Silence threshold"), { target: { value: "" } });
    fireEvent.click(saveButton());
    expect(voiceOf()?.auto_stop_threshold).toBe(0);
  });
});
