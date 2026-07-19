import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SettingsDoc } from "../../src/hooks/useSettings";

// ConfTab · the D42 Inference context-window rows (scope A): Local/Cloud `context window` Fields +
// a per-fallback-row `Context window` input, all reusing the Field + `dim`-style coercion (blank →
// null = auto, string → number at save). We stub the sub-editors (each mounts its own tree) and the
// data hooks, then drive the REAL Inference group through its DOM + assert the save payload coercion.

const h = vi.hoisted(() => ({ save: vi.fn() }));

const settings: SettingsDoc = {
  server: {
    host: "127.0.0.1",
    port: 5433,
    poll_seconds: 5,
    feature_cycle_seconds: 30,
    debug: false,
  },
  inference: {
    default_mode: "local",
    request_timeout_s: 120,
    system_prompt: "",
    system_prompt_append: "",
    failover: true,
    local: { base_url: "http://h/v1", api_key: null, model: "m", context_window: 8192 },
    cloud: { base_url: "", api_key: null, model: "", context_window: null },
    fallbacks: [{ base_url: "http://fb/v1", api_key: null, model: "fm", context_window: null }],
  },
  searxng: { base_url: "", enabled: false, language: null },
  embeddings: { base_url: "", api_key: null, model: "", enabled: false, dim: null },
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
      language: "",
      vad_filter: false,
      hotwords: "",
      auto_send: false,
      connect_timeout_s: 3,
      timeout_s: 30,
      extra_body: {},
      primary: { base_url: "", api_key: null, model: "" },
      fallback: { base_url: "", api_key: null, model: "" },
    },
    tts: {
      format: "mp3",
      connect_timeout_s: 3,
      timeout_s: 30,
      extra_body: {},
      primary: { base_url: "", api_key: null, model: "", voice: "" },
      fallback: { base_url: "", api_key: null, model: "", voice: "" },
    },
  },
  mcp_servers: [],
  openapi_servers: [],
};

// Stub the sub-editors (each mounts its own hook tree) + UtilsTab so only the Inference group is live.
vi.mock("../../src/components/AgentsEditor", () => ({ AgentsEditor: () => null }));
vi.mock("../../src/components/MachineEditor", () => ({ MachineEditor: () => null }));
vi.mock("../../src/components/MemoryEditor", () => ({ MemoryEditor: () => null }));
vi.mock("../../src/components/SkillsEditor", () => ({ SkillsEditor: () => null }));
vi.mock("../../src/components/ServerListEditor", () => ({ ServerListEditor: () => null }));
vi.mock("../../src/tabs/UtilsTab", () => ({ UtilsContent: () => null }));

// Data hooks → safe defaults (no react-query provider needed).
vi.mock("../../src/hooks/useSettings", () => ({
  useSettings: () => ({ data: settings }),
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

afterEach(cleanup);

/** Open the (collapsed-by-default? no — Inference is expanded) group and grab the Save button. */
function firstSaveButton() {
  return screen.getAllByRole("button", { name: /Save changes|Saved/ })[0];
}

type SavedInf = {
  inference: {
    local: { context_window: number | null };
    cloud: { context_window: number | null };
    fallbacks: { context_window: number | null }[];
  };
};
const value = (label: string) => screen.getByLabelText<HTMLInputElement>(label).value;

describe("ConfTab · Inference context-window rows (D42)", () => {
  it("renders the Local/Cloud/fallback context-window inputs with the loaded values", () => {
    render(<ConfTab active />);
    expect(value("Local context window")).toBe("8192");
    // null → blank (auto)
    expect(value("Cloud context window")).toBe("");
    // the fallback row's field is inside the collapsed row — expand it first
    fireEvent.click(screen.getByText("Fallback #1"));
    expect(value("Fallback context window")).toBe("");
  });

  it("coerces at save: blank → null (auto), string → number", () => {
    render(<ConfTab active />);
    // Cloud: set a numeric window; Local: clear it back to auto.
    fireEvent.change(screen.getByLabelText("Cloud context window"), { target: { value: "16384" } });
    fireEvent.change(screen.getByLabelText("Local context window"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Fallback #1"));
    fireEvent.change(screen.getByLabelText("Fallback context window"), {
      target: { value: "4096" },
    });

    fireEvent.click(firstSaveButton());
    expect(h.save).toHaveBeenCalledTimes(1);
    const inf = (h.save.mock.calls[0][0] as SavedInf).inference;
    expect(inf.local.context_window).toBeNull(); // blank → auto
    expect(inf.cloud.context_window).toBe(16384); // string → number
    expect(inf.fallbacks[0].context_window).toBe(4096);
  });
});
