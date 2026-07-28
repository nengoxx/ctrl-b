import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  embeddings: {
    provider: null as string | null,
    model: null as string | null,
    fallbacks: [] as { provider: string; model: string | null }[],
    enabled: false,
    timeout_s: 60,
  },
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
      provider: null as string | null,
      model: null as string | null,
      fallbacks: [] as { provider: string; model: string | null }[],
      language: "",
      vad_filter: false,
      hotwords: "",
      auto_send: false,
      connect_timeout_s: 3,
      timeout_s: 30,
      extra_body: {},
    },
    tts: {
      provider: null as string | null,
      model: null as string | null,
      fallbacks: [] as { provider: string; model: string | null }[],
      format: "mp3",
      connect_timeout_s: 3,
      timeout_s: 30,
      extra_body: {},
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
  sections: {
    inference: { provider: "llamacpp", model: null, fallbacks: [] },
    stt: { provider: null, model: null, fallbacks: [] },
    tts: { provider: null, model: null, fallbacks: [] },
    embeddings: { provider: null, model: null, fallbacks: [] },
  },
  reserved_verbs: [] as string[],
  verbs: [] as string[],
  warnings: [] as string[],
});

const h = vi.hoisted(() => ({
  save: vi.fn(),
  settings: null as unknown as ReturnType<typeof makeSettings>,
  providers: null as unknown as ReturnType<typeof makeProvidersInfo>,
  settingsRev: "revA", // FR2-1 — the providers base rev bound to the settings snapshot
  saveAppearance: vi.fn(), // the persisted side effect of pickTheme — the theme-block test asserts on it
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
  useSaveAppearance: () => ({ mutate: h.saveAppearance }),
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

import { setDirty } from "../../src/store/dirty";
import { ConfTab } from "../../src/tabs/ConfTab";

beforeEach(() => {
  h.settings = makeSettings();
  h.providers = makeProvidersInfo();
  h.settingsRev = "revA";
  h.providersUpdatedAt = 0;
  h.save.mockClear();
  h.saveAppearance.mockClear();
});
afterEach(cleanup);

const sel = (label: string) => screen.getByLabelText<HTMLSelectElement>(label);
const saveButton = () =>
  screen.getAllByRole<HTMLButtonElement>("button", { name: /Save changes|Saved|Saving/ })[0];

type SectionRefPatch = { provider: string | null; model: string | null; fallbacks: unknown[] };
type SavedPatch = {
  providers?: Record<string, { models: Record<string, Record<string, unknown>> }>;
  providers_base?: string;
  provider_renames?: Record<string, string>;
  inference: SectionRefPatch;
  embeddings: SectionRefPatch & { enabled: boolean; timeout_s: number };
  voice: { enabled: boolean; stt: SectionRefPatch; tts: SectionRefPatch };
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

describe("ConfTab · model Advanced disclosure (P12 override)", () => {
  const advHead = (row = 0) =>
    screen.getAllByText("Advanced")[row].closest('[role="button"]') as HTMLElement;

  it("an auto-opened non-default fold can be CLOSED and stays closed through a field edit", () => {
    render(<ConfTab active />);
    // openrouter/qwen3.5 carries a wire id that differs from its clean name → its Advanced fold auto-reveals.
    fireEvent.click(screen.getByText("openrouter", { selector: "div.label" }));
    expect(advHead(0).getAttribute("aria-expanded")).toBe("true");
    // the user closes it — the explicit override must win over the auto-reveal.
    fireEvent.click(advHead(0));
    expect(advHead(0).getAttribute("aria-expanded")).toBe("false");
    // an unrelated field edit (the id override is still present) must NOT snap it back open.
    fireEvent.change(screen.getAllByLabelText("Model name")[0], { target: { value: "qwen3.5x" } });
    expect(advHead(0).getAttribute("aria-expanded")).toBe("false");
  });

  it("a user-opened default fold SURVIVES a field edit (no snap-shut)", () => {
    render(<ConfTab active />);
    // llamacpp/minig+ has no advanced overrides → its fold starts closed.
    fireEvent.click(screen.getByText("llamacpp", { selector: "div.label" }));
    expect(advHead().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(advHead()); // user opens it
    expect(advHead().getAttribute("aria-expanded")).toBe("true");
    // editing an unrelated field keeps the row all-default; the override must keep it open.
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "minig2" } });
    expect(advHead().getAttribute("aria-expanded")).toBe("true");
  });
});

describe("ConfTab · Slice 2 section editors (Voice STT / TTS / Embeddings)", () => {
  it("Embeddings: primary picker renders; switching provider resets the model + omits the providers map", () => {
    h.settings = makeSettings();
    h.settings.embeddings.provider = "openrouter";
    h.settings.embeddings.model = "qwen3.5";
    render(<ConfTab active />);
    // openrouter has 2 models → the model select shows; the section's accessible names are distinct.
    expect(sel("Embeddings default provider").value).toBe("openrouter");
    expect(sel("Embeddings default model").value).toBe("qwen3.5");
    // switch to the sole-model provider → the model select auto-hides.
    fireEvent.change(sel("Embeddings default provider"), { target: { value: "llamacpp" } });
    expect(screen.queryByLabelText("Embeddings default model")).toBeNull();
    fireEvent.click(saveButton());
    const p = lastPatch();
    expect(p.embeddings.provider).toBe("llamacpp");
    // only a section REF changed (not the providers map) → the map + base do not ride the save.
    expect(p.providers).toBeUndefined();
    expect(p.embeddings.timeout_s).toBe(60); // the numeric knob is coerced through
  });

  it("Embeddings: add / remove / reorder fallbacks (drag-handle keyboard path)", () => {
    h.settings = makeSettings();
    h.settings.embeddings.provider = "openrouter";
    h.settings.embeddings.model = "qwen3.5";
    render(<ConfTab active />);
    const grp = () => within(document.getElementById("embeddings")!);
    // add two fallbacks (each seeds to providerNames[0] = "llamacpp", the sole-model provider).
    fireEvent.click(grp().getByRole("button", { name: "+ add fallback" }));
    fireEvent.click(grp().getByRole("button", { name: "+ add fallback" }));
    expect(sel("Embeddings fallback 1 provider").value).toBe("llamacpp");
    expect(sel("Embeddings fallback 2 provider").value).toBe("llamacpp");
    // distinguish the two, then reorder via the handle's ArrowDown (the accessible reorder path).
    fireEvent.change(sel("Embeddings fallback 1 provider"), { target: { value: "openrouter" } });
    expect(sel("Embeddings fallback 1 provider").value).toBe("openrouter");
    fireEvent.keyDown(
      grp().getByRole("button", {
        name: "reorder Embeddings fallback 1 — drag, or press the up/down arrow keys",
      }),
      { key: "ArrowDown" },
    );
    expect(sel("Embeddings fallback 1 provider").value).toBe("llamacpp"); // swapped down
    expect(sel("Embeddings fallback 2 provider").value).toBe("openrouter");
    // remove the (now-second) openrouter fallback.
    fireEvent.click(grp().getByRole("button", { name: "remove Embeddings fallback 2" }));
    expect(screen.queryByLabelText("Embeddings fallback 2 provider")).toBeNull();
    expect(sel("Embeddings fallback 1 provider").value).toBe("llamacpp");
  });

  it("Voice STT: primary picker + a service knob round-trip (no failover switch rendered)", () => {
    h.settings = makeSettings();
    h.settings.voice.stt.provider = "openrouter";
    h.settings.voice.stt.model = "qwen3.5";
    render(<ConfTab active />);
    expect(sel("Voice STT default provider").value).toBe("openrouter");
    // the STT chain always walks — there is deliberately no Failover switch in this section.
    expect(
      within(document.getElementById("voice-stt")!).queryByLabelText("STT VAD filter"),
    ).not.toBeNull();
    expect(within(document.getElementById("voice-stt")!).queryByText("Failover")).toBeNull();
    fireEvent.change(sel("Voice STT default provider"), { target: { value: "llamacpp" } });
    fireEvent.click(saveButton());
    expect(lastPatch().voice.stt.provider).toBe("llamacpp");
  });

  it("Voice TTS: primary picker present + the format Seg knob stays (C8 service fallback)", () => {
    h.settings = makeSettings();
    h.settings.voice.tts.provider = "openrouter";
    h.settings.voice.tts.model = "qwen3.5";
    render(<ConfTab active />);
    expect(sel("Voice TTS default provider").value).toBe("openrouter");
    // the service-level Format control stays (model format > service format — the C8 fallback).
    expect(within(document.getElementById("voice-tts")!).queryByLabelText("Format")).not.toBeNull();
    fireEvent.change(sel("Voice TTS default provider"), { target: { value: "llamacpp" } });
    fireEvent.click(saveButton());
    expect(lastPatch().voice.tts.provider).toBe("llamacpp");
  });
});

describe("ConfTab · Slice 2 reference-guard (voice/embeddings)", () => {
  it("a provider referenced ONLY by a voice/embeddings section can't be removed", () => {
    h.settings = makeSettings();
    h.settings.inference.fallbacks = []; // drop the inference reference to openrouter
    h.settings.voice.tts.provider = "openrouter"; // now referenced only by TTS
    h.settings.voice.tts.model = "qwen3.5";
    render(<ConfTab active />);
    fireEvent.click(screen.getByText("openrouter", { selector: "div.label" }));
    const removeBtn = screen.getByRole<HTMLButtonElement>("button", { name: "remove provider" });
    expect(removeBtn.disabled).toBe(true);
  });

  it("removing a catalog model referenced by embeddings blocks the save", () => {
    h.settings = makeSettings();
    h.settings.inference.fallbacks = [];
    h.settings.embeddings.provider = "openrouter";
    h.settings.embeddings.model = "qwen3.5";
    render(<ConfTab active />);
    fireEvent.click(screen.getByText("openrouter", { selector: "div.label" }));
    fireEvent.click(screen.getAllByRole("button", { name: "remove model" })[0]); // qwen3.5
    expect(screen.getAllByText(/can’t save/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/model removed/).length).toBeGreaterThan(0);
    expect(saveButton().disabled).toBe(true);
  });
});

describe("ConfTab · per-model voice fields (Slice 2 editors)", () => {
  it("voice/speed/language/format/dim edit on a model row and round-trip through the save", () => {
    render(<ConfTab active />);
    fireEvent.click(screen.getByText("openrouter", { selector: "div.label" }));
    // qwen3.5's Advanced fold auto-opens (its wire id differs from the clean name).
    fireEvent.change(screen.getAllByLabelText("Model voice")[0], {
      target: { value: "bf_isabella" },
    });
    fireEvent.change(screen.getAllByLabelText("Model speed")[0], { target: { value: "1.15" } });
    fireEvent.change(screen.getAllByLabelText("Model language")[0], { target: { value: "en" } });
    fireEvent.change(screen.getAllByLabelText("Model audio format")[0], {
      target: { value: "opus" },
    });
    fireEvent.change(screen.getAllByLabelText("Model embedding dim")[0], {
      target: { value: "1024" },
    });
    fireEvent.click(saveButton());
    expect(lastPatch().providers!.openrouter.models["qwen3.5"]).toMatchObject({
      voice: "bf_isabella",
      speed: 1.15,
      language: "en",
      format: "opus",
      dim: 1024,
    });
  });

  it("a non-numeric speed blocks the save (guarded float field)", () => {
    render(<ConfTab active />);
    fireEvent.click(screen.getByText("openrouter", { selector: "div.label" }));
    fireEvent.change(screen.getAllByLabelText("Model speed")[0], { target: { value: "fast" } });
    expect(screen.getAllByText(/invalid provider fields/).length).toBeGreaterThan(0);
    expect(saveButton().disabled).toBe(true);
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

  it("rename ALSO rewrites the voice/embeddings draft selectors + save payload (FX-F / D48 C1)", () => {
    h.settings = makeSettings();
    h.settings.inference.fallbacks = []; // drop inference's ref → the rename is exercised via the sections
    h.settings.voice.stt.provider = "openrouter"; // STT primary references openrouter
    h.settings.voice.stt.model = "qwen3.5";
    h.settings.embeddings.provider = "llamacpp"; // a valid sole-model primary (no FX-G block)
    h.settings.embeddings.model = null;
    h.settings.embeddings.fallbacks = [{ provider: "openrouter", model: "qwen-embed" }]; // embeddings fb ref
    render(<ConfTab active />);
    fireEvent.click(screen.getByText("openrouter", { selector: "div.label" }));
    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    fireEvent.change(screen.getByLabelText("New provider name"), { target: { value: "cloud-x" } });
    fireEvent.click(screen.getByRole("button", { name: "ok" }));
    // both visible section selectors cascaded to the new name
    expect(sel("Voice STT default provider").value).toBe("cloud-x");
    expect(sel("Embeddings fallback 1 provider").value).toBe("cloud-x");
    fireEvent.click(saveButton());
    const p = lastPatch();
    expect(p.voice.stt.provider).toBe("cloud-x");
    expect((p.embeddings.fallbacks as { provider: string }[])[0].provider).toBe("cloud-x");
    expect(p.provider_renames).toEqual({ openrouter: "cloud-x" });
  });
});

describe("ConfTab · Slice 2 reference-guard — strict-resolve mirrors (FX-G)", () => {
  it("a blank primary WITH a configured fallback blocks the save; clearing the fallback unblocks", () => {
    h.settings = makeSettings();
    h.settings.inference.fallbacks = [];
    h.settings.voice.tts.provider = null; // blank primary…
    h.settings.voice.tts.model = null;
    h.settings.voice.tts.fallbacks = [{ provider: "openrouter", model: "qwen3.5" }]; // …but a fallback set
    render(<ConfTab active />);
    expect(screen.getAllByText(/can’t save/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/has fallbacks but no default provider/).length).toBeGreaterThan(0);
    expect(saveButton().disabled).toBe(true);
    // clear the fallback → the strict-422 mirror resolves
    fireEvent.click(
      within(document.getElementById("voice-tts")!).getByRole("button", {
        name: "remove Voice TTS fallback 1",
      }),
    );
    expect(screen.queryByText(/has fallbacks but no default provider/)).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  it("a model OMITTED against a multi-model provider blocks the save; picking a model unblocks", () => {
    h.settings = makeSettings();
    h.settings.inference.fallbacks = [];
    h.settings.embeddings.provider = "openrouter"; // 2 models…
    h.settings.embeddings.model = null; // …with the model omitted → ambiguous (strict 422)
    render(<ConfTab active />);
    expect(screen.getAllByText(/can’t save/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/needs a model/).length).toBeGreaterThan(0);
    expect(saveButton().disabled).toBe(true);
    // pick a model → the strict-422 mirror resolves
    fireEvent.change(sel("Embeddings default model"), { target: { value: "qwen3.5" } });
    expect(screen.queryByText(/needs a model/)).toBeNull();
  });

  it("the SOLE-model case stays legal (model omitted is fine with a one-model catalog)", () => {
    h.settings = makeSettings();
    h.settings.inference.fallbacks = [];
    h.settings.embeddings.provider = "llamacpp"; // exactly one model → omitting the model is legal
    h.settings.embeddings.model = null;
    render(<ConfTab active />);
    expect(screen.queryByText(/needs a model/)).toBeNull();
  });
});

// ── A11 pre-release FE audit — the four HIGHs and the guard gaps it found ────────────────────────
describe("ConfTab · pre-release audit regressions", () => {
  it("sends ONLY the sections that changed, so an unrelated edit is not strict-resolved", () => {
    // MED: the payload always carried inference + voice + embeddings, which makes EVERY scalar save a
    // resolution-relevant patch. On a config with a pre-existing lenient-tolerated conflict that 422s —
    // so editing a poll interval became impossible. This is the exact case FX7's gating exists for.
    render(<ConfTab active />);
    fireEvent.change(baseInput("Poll cadence"), { target: { value: "9" } });
    fireEvent.click(saveButton());
    const p = lastPatch() as unknown as Record<string, unknown>;
    expect((p.server as { poll_seconds: number }).poll_seconds).toBe(9);
    for (const untouched of ["inference", "voice", "embeddings", "providers", "shell", "searxng"]) {
      expect(p[untouched]).toBeUndefined();
    }
  });

  it("keeps edits made while the save was in flight instead of adopting the echo over them", () => {
    // HIGH: success replaced the whole draft unconditionally, so anything typed during the round trip
    // vanished (D48 B5 says reconcile only the SUBMITTED snapshot).
    render(<ConfTab active />);
    fireEvent.change(baseInput("Poll cadence"), { target: { value: "9" } });
    fireEvent.click(saveButton());
    // …the owner keeps typing before the response lands…
    fireEvent.change(baseInput("Poll cadence"), { target: { value: "11" } });
    const onSuccess = h.save.mock.calls[0][1].onSuccess as (r: unknown) => void;
    const echo = makeSettings(); // the server echo for what WAS submitted (poll_seconds 9)
    echo.server.poll_seconds = 9;
    act(() =>
      onSuccess({ settings: echo, providers_rev: "revB", warnings: [], restart_required: [] }),
    );
    expect(baseInput("Poll cadence").value).toBe("11"); // the later edit survived
    expect(saveButton().textContent).toMatch(/Save changes/); // …and is correctly still unsaved
  });

  it("refuses a theme switch while ANOTHER editor is dirty, not just this tab", () => {
    // The remount kills every mounted editor's draft, and tabs stay mounted — so a dirty skill or agent
    // draft is sitting there while the owner is on Conf. Guarding only Conf's own draft left the same
    // class open through the other five registrants.
    render(<ConfTab active />);
    setDirty("skill:deploy", true); // some other editor has unsaved work
    const themeBtn = screen.queryByRole("button", { name: /^cosmos$/i });
    expect(themeBtn).toBeTruthy();
    fireEvent.click(themeBtn!);
    expect(h.saveAppearance).not.toHaveBeenCalled();
    setDirty("skill:deploy", false); // …and once it is clean the switch goes through
    fireEvent.click(themeBtn!);
    expect(h.saveAppearance).toHaveBeenCalledTimes(1);
  });

  it("refuses a theme switch while Conf is dirty (the switch unmounts the tab and its draft)", () => {
    render(<ConfTab active />);
    fireEvent.change(baseInput("Poll cadence"), { target: { value: "9" } });
    const themeBtn = screen.queryByRole("button", { name: /^cosmos$/i });
    expect(themeBtn).toBeTruthy();
    fireEvent.click(themeBtn!);
    // The switch is refused, so the tab is still mounted with the edit intact. (`switchTheme` is async
    // and would remount the theme root in the real app — here the observable is that nothing changed.)
    expect(h.saveAppearance).not.toHaveBeenCalled(); // refused before switchTheme/persist
    expect(baseInput("Poll cadence").value).toBe("9"); // …and the draft is still here
  });

  it("rebases a rename chained during an in-flight save instead of dropping it", () => {
    // Rename A→B, save, then rename B→C before the response lands: the control re-points the existing
    // entry, so the queue is {A: C}. Clearing the sent SOURCE key threw the whole rename away — the
    // draft said C, the server said B, and the next PUT looked like a brand-new provider whose masked
    // key has nothing stored, so the credential was dropped by the mask guard. It rebases now.
    render(<ConfTab active />);
    fireEvent.click(screen.getByText("llamacpp", { selector: "div.label" }));
    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    fireEvent.change(screen.getByLabelText("New provider name"), { target: { value: "step-b" } });
    fireEvent.click(screen.getByRole("button", { name: "ok" }));
    fireEvent.click(saveButton());
    expect(lastPatch().provider_renames).toEqual({ llamacpp: "step-b" });
    // …the response has NOT landed, and the owner renames again…
    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    fireEvent.change(screen.getByLabelText("New provider name"), { target: { value: "step-c" } });
    fireEvent.click(screen.getByRole("button", { name: "ok" }));
    const opts = h.save.mock.calls[0][1] as {
      onSuccess: (r: unknown) => void;
      onSettled: () => void;
    };
    const echo = makeSettings();
    const echoProviders = echo.providers as Record<string, unknown>;
    echoProviders["step-b"] = echoProviders.llamacpp; // the server applied A→B
    delete echoProviders.llamacpp;
    echo.inference.provider = "step-b";
    act(() => {
      // the real callback order, including the release of the same-tick save lock
      opts.onSuccess({ settings: echo, providers_rev: "revB", warnings: [], restart_required: [] });
      opts.onSettled();
    });
    fireEvent.click(saveButton());
    // the second save must tell the server about B→C, NOT drop it and not re-send the applied A→B
    expect((h.save.mock.calls[1][0] as SavedPatch).provider_renames).toEqual({
      "step-b": "step-c",
    });
  });

  it("does not queue a rename for a provider that exists only in the draft", () => {
    // The server resolves `provider_renames` against ITS state, so renaming a not-yet-saved provider
    // earned a 422 for what is just a new entry under a different key.
    render(<ConfTab active />);
    fireEvent.click(screen.getByText("add provider", { selector: "div.label" }));
    fireEvent.change(screen.getByLabelText("New provider name"), { target: { value: "fresh" } });
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    fireEvent.change(screen.getByLabelText("New provider name"), { target: { value: "fresher" } });
    fireEvent.click(screen.getByRole("button", { name: "ok" }));
    fireEvent.click(saveButton());
    expect(lastPatch().provider_renames).toBeUndefined(); // rekeyed locally, nothing queued
    expect(Object.keys(lastPatch().providers ?? {})).toContain("fresher");
  });

  it("refuses to reuse a name that still exists on the server", () => {
    render(<ConfTab active />);
    fireEvent.click(screen.getByText("add provider", { selector: "div.label" }));
    fireEvent.change(screen.getByLabelText("New provider name"), {
      target: { value: "openrouter" },
    });
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    // refused → still exactly ONE card by that name, and nothing became unsaved
    expect(screen.getAllByText("openrouter", { selector: "div.label" }).length).toBe(1);
    expect(saveButton().textContent).toMatch(/Saved/);
  });

  it("blocks the save on names the server rejects and on a blank referenced base URL", () => {
    h.settings = makeSettings();
    // `token` is a secret sentinel — the backend 422s the name (D48 C1); the guard now says so inline.
    (h.settings.providers as Record<string, unknown>).token = {
      base_url: "http://x/v1",
      api_key: null,
      api_mode: "openai",
      models: { m: {} },
    };
    h.providers = makeProvidersInfo();
    h.providers.reserved_verbs = ["agent", "clear", "compact", "help", "priv", "privilege"];
    render(<ConfTab active />);
    // make an otherwise-valid edit first: a clean draft disables the button anyway, so without this
    // the assertion below would pass with the guard removed (Codex).
    fireEvent.change(baseInput("Poll cadence"), { target: { value: "9" } });
    expect(screen.getAllByText(/collides with a secret field/).length).toBeGreaterThan(0);
    expect(saveButton().disabled).toBe(true);
  });

  it("blocks the save when a referenced provider has no base URL", () => {
    h.settings = makeSettings();
    h.settings.providers.llamacpp.base_url = "";
    render(<ConfTab active />);
    fireEvent.change(baseInput("Poll cadence"), { target: { value: "9" } }); // …a real edit, as above
    expect(screen.getAllByText(/has no base URL/).length).toBeGreaterThan(0);
    expect(saveButton().disabled).toBe(true);
  });
});
