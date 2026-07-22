import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ConfTab · A11/D48 Providers + Inference (Slice 1). The Inference section is now the shared
// provider→model picker (primary + reorderable fallback rows) over the top-level `providers` map; the
// Providers group edits that map with rename/reference-guard/draft-epoch. We stub the sub-editors and
// data hooks, then drive the REAL Providers + Inference groups through their DOM and assert the save
// payload (replacement map + providers_base + queued renames), the draft epoch, and the reference-guard.

const makeSettings = () => ({
  server: {
    host: "127.0.0.1",
    port: 5433,
    poll_seconds: 5,
    feature_cycle_seconds: 30,
    debug: false,
  },
  providers: {
    llamacpp: {
      base_url: "http://h/v1",
      api_key: null,
      api_mode: "llamacpp",
      models: { "minig+": { context_window: 32768 } },
    },
    openrouter: {
      base_url: "https://openrouter.ai/api/v1",
      api_key: "sk…yz",
      api_mode: "openrouter",
      models: {
        "qwen3.5": { id: "qwen/qwen3.5", context_window: 262144 },
        "qwen-embed": { id: "qwen/qwen3-embedding", dim: 2560 },
      },
    },
  },
  inference: {
    provider: "llamacpp" as string | null,
    model: null as string | null,
    fallbacks: [{ provider: "openrouter", model: "qwen3.5" as string | null }],
    failover: true,
    request_timeout_s: 120,
    system_prompt: "",
    system_prompt_append: "",
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
  agent: { defaults: {} },
});

const makeProvidersInfo = () => ({
  providers: {
    llamacpp: { api_mode: "llamacpp", models: ["minig+"] },
    openrouter: { api_mode: "openrouter", models: ["qwen3.5", "qwen-embed"] },
  },
  rev: "revA",
  sections: { inference: { provider: "llamacpp", model: null, fallbacks: [] } },
  reserved_verbs: [] as string[],
  verbs: [] as string[],
  warnings: [] as string[],
});

const h = vi.hoisted(() => ({
  save: vi.fn(),
  settings: null as unknown as ReturnType<typeof makeSettings>,
  providers: null as unknown as ReturnType<typeof makeProvidersInfo>,
  settingsRev: "revA", // FR2-1 — the providers base rev bound to the settings snapshot
  providersUpdatedAt: 0, // FR2-3 — the ["providers"] query's dataUpdatedAt (freshness gate)
}));

// Stub the sub-editors (each mounts its own hook tree) + UtilsTab so only Providers/Inference are live.
vi.mock("../../src/components/AgentsEditor", () => ({ AgentsEditor: () => null }));
vi.mock("../../src/components/MachineEditor", () => ({ MachineEditor: () => null }));
vi.mock("../../src/components/MemoryEditor", () => ({ MemoryEditor: () => null }));
vi.mock("../../src/components/SkillsEditor", () => ({ SkillsEditor: () => null }));
vi.mock("../../src/components/ServerListEditor", () => ({ ServerListEditor: () => null }));
vi.mock("../../src/tabs/UtilsTab", () => ({ UtilsContent: () => null }));

vi.mock("../../src/hooks/useSettings", () => ({
  useSettings: () => ({ data: h.settings }),
  useSettingsProvidersRev: () => h.settingsRev,
  useProviders: () => ({ data: h.providers, dataUpdatedAt: h.providersUpdatedAt }),
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

beforeEach(() => {
  h.settings = makeSettings();
  h.providers = makeProvidersInfo();
  h.settingsRev = "revA";
  h.providersUpdatedAt = 0;
  h.save.mockClear();
});
afterEach(cleanup);

const sel = (label: string) => screen.getByLabelText<HTMLSelectElement>(label);
const saveButton = () =>
  screen.getAllByRole<HTMLButtonElement>("button", { name: /Save changes|Saved|Saving/ })[0];

type SavedPatch = {
  providers?: Record<string, unknown>;
  providers_base?: string;
  provider_renames?: Record<string, string>;
  inference: { provider: string | null; model: string | null; fallbacks: unknown[] };
};
const lastPatch = () => h.save.mock.calls[0][0] as SavedPatch;
const baseInput = (name: string) => screen.getByLabelText<HTMLInputElement>(name);

describe("ConfTab · Inference picker (A11/D48)", () => {
  it("renders the primary provider picker; the sole-model provider hides the model select", () => {
    render(<ConfTab active />);
    expect(sel("Default provider").value).toBe("llamacpp");
    // llamacpp has exactly one model → the model select is auto-hidden.
    expect(screen.queryByLabelText("Default model")).toBeNull();
    // the fallback row's provider (openrouter, 2 models) shows a model select.
    expect(sel("Fallback 1 provider").value).toBe("openrouter");
    expect(sel("Fallback 1 model").value).toBe("qwen3.5");
  });

  it("changing ONLY the primary provider omits the providers map + base (FX11 — clean providers)", () => {
    render(<ConfTab active />);
    fireEvent.change(sel("Default provider"), { target: { value: "openrouter" } });
    fireEvent.click(saveButton());
    expect(h.save).toHaveBeenCalledTimes(1);
    const p = lastPatch();
    expect(p.inference.provider).toBe("openrouter");
    // the providers SUBTREE is untouched → no map + no base ride the save (no needless 409 surface)
    expect(p.providers).toBeUndefined();
    expect(p.providers_base).toBeUndefined();
    expect(p.provider_renames).toBeUndefined();
  });

  it("a DIRTY providers save sends the SETTINGS-snapshot base, ignoring the skewed providers-query rev (FR2-1)", () => {
    // The skew exists from the START (before the draft dirties): the settings snapshot the draft seeds
    // from carries rev A (its X-Providers-Rev header), while the independently-fetched providers query
    // sits at rev B the whole time. The base must bind to A — proving it is settings-sourced, not query-sourced.
    h.settingsRev = "revA";
    h.providers = { ...makeProvidersInfo(), rev: "revB" };
    render(<ConfTab active />);
    // dirty the providers subtree: open llamacpp + edit its Base URL.
    fireEvent.click(screen.getByText("llamacpp", { selector: "div.label" }));
    fireEvent.change(baseInput("Base URL"), { target: { value: "http://h2/v1" } });
    fireEvent.click(saveButton());
    const p = lastPatch();
    expect(p.providers).toBeDefined(); // subtree dirty → map rides
    expect(p.providers_base).toBe("revA"); // the settings-snapshot base, NOT the providers-query "revB"
  });
});

describe("ConfTab · draft epoch (R18)", () => {
  it("a background settings change does NOT clobber a dirty draft", () => {
    const { rerender } = render(<ConfTab active />);
    // Make the draft dirty via the primary picker.
    fireEvent.change(sel("Default provider"), { target: { value: "openrouter" } });
    expect(sel("Default provider").value).toBe("openrouter");
    // Simulate a background refetch: a NEW settings object with different content.
    const next = makeSettings();
    next.inference.request_timeout_s = 999;
    h.settings = next;
    rerender(<ConfTab active />);
    // The unsaved edit survives (epoch guard); the draft was NOT reseeded from the fresh doc.
    expect(sel("Default provider").value).toBe("openrouter");
  });

  it("a clean draft DOES adopt a background settings change", () => {
    const { rerender } = render(<ConfTab active />);
    expect(sel("Default provider").value).toBe("llamacpp");
    const next = makeSettings();
    next.inference.provider = "openrouter";
    next.inference.model = "qwen3.5";
    h.settings = next;
    rerender(<ConfTab active />);
    expect(sel("Default provider").value).toBe("openrouter"); // clean → reseeded
  });
});

describe("ConfTab · reference-guard (B2/R19)", () => {
  it("removing a provider referenced by inference is blocked (Remove disabled + reason)", () => {
    render(<ConfTab active />);
    // openrouter is referenced by inference fallback #1 → its card's Remove is disabled.
    fireEvent.click(screen.getByText("openrouter", { selector: "div.label" })); // open the card header
    const removeBtn = screen.getByRole<HTMLButtonElement>("button", { name: "remove provider" });
    expect(removeBtn.disabled).toBe(true);
  });

  it("a raw-id (uncataloged) agent default model does NOT block the save (FX12)", () => {
    // an agent default pointing at an uncataloged raw wire id is legal passthrough (C5) — the guard must
    // not treat it as a removed catalog model. Dirty the draft (primary pick) so the save is otherwise on.
    h.settings = makeSettings();
    h.settings.agent = {
      defaults: { model: { provider: "openrouter", model: "vendor/raw-model" } },
    };
    render(<ConfTab active />);
    fireEvent.change(sel("Default provider"), { target: { value: "openrouter" } });
    expect(screen.queryByText(/can’t save/)).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  it("removing a referenced CATALOG model still blocks the save (FX12)", () => {
    render(<ConfTab active />);
    // openrouter/qwen3.5 is referenced by inference fallback #1. Remove that catalog model from the card.
    fireEvent.click(screen.getByText("openrouter", { selector: "div.label" }));
    fireEvent.click(screen.getAllByRole("button", { name: "remove model" })[0]); // qwen3.5 (first row)
    expect(screen.getAllByText(/can’t save/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/model removed/).length).toBeGreaterThan(0);
    expect(saveButton().disabled).toBe(true);
  });
});

describe("ConfTab · numeric guard (FX13)", () => {
  it("invalid numeric text blocks the save with a reason (never a silent null)", () => {
    render(<ConfTab active />);
    fireEvent.click(screen.getByText("llamacpp", { selector: "div.label" })); // open the card
    fireEvent.change(baseInput("Max concurrent requests"), { target: { value: "abc" } });
    expect(screen.getAllByText(/invalid provider fields/).length).toBeGreaterThan(0);
    expect(saveButton().disabled).toBe(true);
  });
});

describe("ConfTab · typed model fields round-trip (FX17)", () => {
  it("voice/speed/language/format/dim survive the draft round-trip untouched (deferred editors)", () => {
    h.settings = makeSettings();
    (h.settings.providers.openrouter.models as Record<string, unknown>)["qwen-embed"] = {
      id: "qwen/qwen3-embedding",
      dim: 2560,
      voice: "bf_isabella",
      speed: 1.1,
      language: "en",
      format: "mp3",
    };
    render(<ConfTab active />);
    // dirty the providers subtree (base_url edit) so the full map rides the save.
    fireEvent.click(screen.getByText("openrouter", { selector: "div.label" }));
    fireEvent.change(baseInput("Base URL"), { target: { value: "https://openrouter.ai/api/v2" } });
    fireEvent.click(saveButton());
    const providers = lastPatch().providers as Record<
      string,
      { models: Record<string, Record<string, unknown>> }
    >;
    expect(providers.openrouter.models["qwen-embed"]).toMatchObject({
      dim: 2560,
      voice: "bf_isabella",
      speed: 1.1,
      language: "en",
      format: "mp3",
    });
  });
});

describe("ConfTab · warnings lifecycle (FX16)", () => {
  it("a PUT warning echoed by the GET is shown once, not duplicated", () => {
    h.providers = { ...makeProvidersInfo(), rev: "revA", warnings: ["shadow: foo spells bar"] };
    const { rerender } = render(<ConfTab active />);
    fireEvent.change(sel("Default provider"), { target: { value: "openrouter" } });
    fireEvent.click(saveButton());
    // invoke the save's onSuccess with the SAME warning + the current rev.
    const onSuccess = (h.save.mock.calls[0][1] as { onSuccess: (r: unknown) => void }).onSuccess;
    act(() =>
      onSuccess({
        settings: h.settings,
        restart_required: [],
        warnings: ["shadow: foo spells bar"],
        providers_rev: "revA",
      }),
    );
    rerender(<ConfTab active />);
    expect(screen.getAllByText("shadow: foo spells bar", { exact: false })).toHaveLength(1);
  });

  it("a retained PUT warning clears when the providers query refetches, even at an UNCHANGED rev (FR2-3)", () => {
    h.providers = { ...makeProvidersInfo(), rev: "revA", warnings: [] };
    h.providersUpdatedAt = 1; // an old fetch — < the save stamp, so the PUT warning shows
    const { rerender } = render(<ConfTab active />);
    fireEvent.change(sel("Default provider"), { target: { value: "openrouter" } });
    fireEvent.click(saveButton());
    const onSuccess = (h.save.mock.calls[0][1] as { onSuccess: (r: unknown) => void }).onSuccess;
    act(() =>
      onSuccess({
        settings: h.settings,
        restart_required: [],
        warnings: ["shadow: freshly collided"],
        providers_rev: "revA", // rev UNCHANGED by this save
      }),
    );
    rerender(<ConfTab active />);
    expect(
      screen.getAllByText("shadow: freshly collided", { exact: false }).length,
    ).toBeGreaterThan(0); // the bridge shows it immediately after save
    // a background providers refetch delivers FRESH data (dataUpdatedAt passes the save stamp) at the SAME
    // rev, with the collision now resolved (warnings empty) — the retained PUT warning must drop.
    h.providers = { ...makeProvidersInfo(), rev: "revA", warnings: [] };
    h.providersUpdatedAt = Date.now() + 1_000_000;
    rerender(<ConfTab active />);
    expect(screen.queryByText("shadow: freshly collided", { exact: false })).toBeNull();
  });
});

describe("ConfTab · provider rename (C1 cascade)", () => {
  it("renaming a provider cascades the inference selector and queues the rename on save", () => {
    render(<ConfTab active />);
    fireEvent.click(screen.getByText("llamacpp", { selector: "div.label" })); // open the card
    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    fireEvent.change(screen.getByLabelText("New provider name"), {
      target: { value: "local-llm" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ok" }));
    // The visible inference primary selector cascaded to the new name.
    expect(sel("Default provider").value).toBe("local-llm");
    fireEvent.click(saveButton());
    const p = lastPatch();
    expect(p.provider_renames).toEqual({ llamacpp: "local-llm" });
    expect(Object.keys(p.providers ?? {})).toContain("local-llm");
    expect(Object.keys(p.providers ?? {})).not.toContain("llamacpp");
    expect(p.inference.provider).toBe("local-llm");
  });
});
