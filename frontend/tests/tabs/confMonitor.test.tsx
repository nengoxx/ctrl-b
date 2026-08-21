import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// D2-A / D50 (15c) — the monitor + presence-wake knobs live INSIDE the Server group (owner ruling:
// no new section). Three things worth pinning: they really render in that group (the placement is
// the ruling, and `monitor.poll_seconds` is cross-field validated against `server.poll_seconds`
// right above it), the numeric fields coerce like their Server-group siblings, and the one field
// with a shape of its own — the comma/space-separated device IPs — parses to the wire list (blank
// → `[]`, i.e. the presence trigger is inert) without dragging untouched sections into the patch.
//
// Sub-editors + data hooks are stubbed exactly as in confNotifications.test.tsx so only the real
// Server group is live.

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
    presence_device_ips: [] as string[],
    presence_offline_after_s: 120,
    presence_cooldown_s: 3600,
    tailscale_socket_path: "/var/run/tailscale/tailscaled.sock",
  },
  mcp_servers: [],
  openapi_servers: [],
  agent: { defaults: {} },
});

const h = vi.hoisted(() => ({
  save: vi.fn(),
  settings: null as unknown as ReturnType<typeof makeSettings>,
}));

vi.mock("../../src/components/AgentsEditor", () => ({ AgentsEditor: () => null }));
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

/** The Server group's DOM anchor (ConfGroup renders its `id`) — the placement ruling in one query. */
const serverGroup = () => {
  const el = document.getElementById("server");
  if (!el) throw new Error("the Server group is not rendered");
  return within(el);
};
const field = (name: string) => serverGroup().getByLabelText<HTMLInputElement>(name);
const saveButton = () =>
  screen.getAllByRole<HTMLButtonElement>("button", { name: /Save changes|Saved|Saving/ })[0];
const patchOf = (call = 0) =>
  h.save.mock.calls[call][0] as {
    monitor?: Record<string, unknown>;
    wake?: Record<string, unknown>;
    server?: Record<string, unknown>;
  };

describe("ConfTab · monitor + presence wake (15c / D50)", () => {
  it("renders every knob INSIDE the Server group — not a new section", () => {
    render(<ConfTab active />);
    // the master switch + the three damping/cadence fields
    expect(serverGroup().getByLabelText("Fleet monitor").getAttribute("aria-checked")).toBe("true");
    expect(field("Monitor cadence").value).toBe("30");
    expect(field("Down after").value).toBe("3");
    expect(field("Up after").value).toBe("2");
    // the presence-wake half, incl. the cross-trigger floor that had no UI at all before 15c
    expect(field("My device IPs").value).toBe("");
    expect(field("Arm after").value).toBe("120");
    expect(field("Presence cooldown").value).toBe("3600");
    expect(field("Wake cooldown").value).toBe("300");
    expect(field("tailscaled socket").value).toBe("/var/run/tailscale/tailscaled.sock");
    // the cadence it is cross-field validated against is the neighbour, which is the whole point
    expect(field("Poll cadence").value).toBe("5");
  });

  it("saves the monitor section as NUMBERS, and leaves untouched sections out of the patch", () => {
    render(<ConfTab active />);
    fireEvent.change(field("Monitor cadence"), { target: { value: "45" } });
    fireEvent.change(field("Down after"), { target: { value: "5" } });
    fireEvent.click(serverGroup().getByLabelText("Fleet monitor"));
    fireEvent.click(saveButton());

    expect(h.save).toHaveBeenCalledTimes(1);
    const patch = patchOf();
    expect(patch.monitor).toEqual({
      enabled: false,
      poll_seconds: 45, // coerced, not the typed "45"
      down_after_checks: 5,
      up_after_checks: 2,
    });
    expect(patch.wake).toBeUndefined(); // per-section diff — the wake block never moved
    expect(patch.server).toBeUndefined();
  });

  it("the device IPs parse to a list on save (comma/space separated), everything else untouched", () => {
    render(<ConfTab active />);
    fireEvent.change(field("My device IPs"), {
      target: { value: "100.64.0.5, 100.64.0.9  100.64.0.12" },
    });
    // the raw text survives a keystroke — a `join(", ")` round-trip would eat the separator
    expect(field("My device IPs").value).toBe("100.64.0.5, 100.64.0.9  100.64.0.12");
    fireEvent.click(saveButton());

    const patch = patchOf();
    expect(patch.wake).toEqual({
      cooldown_s: 300,
      presence_device_ips: ["100.64.0.5", "100.64.0.9", "100.64.0.12"],
      presence_offline_after_s: 120,
      presence_cooldown_s: 3600,
      tailscale_socket_path: "/var/run/tailscale/tailscaled.sock",
    });
    expect(patch.monitor).toBeUndefined();
  });

  it("a success echo re-baselines typed IPs to the normalized list; the next save omits wake", () => {
    // The 15c review's named missing test: the draft holds a raw STRING once edited, the PUT echo
    // holds the normalized ARRAY — the per-call onSuccess must converge the two, or the section
    // reads dirty forever and every later save drags `wake` back into the patch.
    render(<ConfTab active />);
    fireEvent.change(field("My device IPs"), { target: { value: "100.64.0.5 100.64.0.9" } });
    fireEvent.click(saveButton());
    const [patch, opts] = h.save.mock.calls[0] as [
      { wake?: { presence_device_ips?: unknown } },
      { onSuccess: (res: unknown) => void; onSettled: () => void },
    ];
    expect(patch.wake?.presence_device_ips).toEqual(["100.64.0.5", "100.64.0.9"]);
    const echoed = makeSettings();
    echoed.wake.presence_device_ips = ["100.64.0.5", "100.64.0.9"];
    // drive the callbacks the way the real mutation does: success, then the settled release
    act(() => {
      opts.onSuccess({ settings: echoed, providers_rev: "revA" });
      opts.onSettled();
    });
    // the echo is now the baseline: rendered joined, and clean
    expect(field("My device IPs").value).toBe("100.64.0.5, 100.64.0.9");
    fireEvent.change(field("Monitor cadence"), { target: { value: "60" } });
    fireEvent.click(saveButton());
    expect(patchOf(1).monitor?.poll_seconds).toBe(60);
    expect(patchOf(1).wake).toBeUndefined(); // the echoed baseline diffs equal — wake stays home
  });

  it("a CLEARED wake timing saves null (a visible 422), never a silent zero", () => {
    // 15c review MED: Number("") is 0, and 0 is a MEANINGFUL wake value ("no cooldown") the backend
    // accepts — a cleared field must earn the same visible 422 every other cleared numeric earns.
    render(<ConfTab active />);
    fireEvent.change(field("Presence cooldown"), { target: { value: "" } });
    fireEvent.click(saveButton());
    expect(patchOf().wake?.presence_cooldown_s).toBeNull();

    cleanup();
    h.save.mockClear();
    h.settings = makeSettings();
    render(<ConfTab active />);
    fireEvent.change(field("Wake cooldown"), { target: { value: "0" } });
    fireEvent.click(saveButton());
    expect(patchOf().wake?.cooldown_s).toBe(0); // a TYPED zero stays a real zero
  });

  it("clearing the device IPs saves an EMPTY list — the feature's off switch", () => {
    h.settings = {
      ...makeSettings(),
      wake: { ...makeSettings().wake, presence_device_ips: ["100.64.0.5"] },
    };
    render(<ConfTab active />);
    expect(field("My device IPs").value).toBe("100.64.0.5");
    fireEvent.change(field("My device IPs"), { target: { value: "" } });
    fireEvent.click(saveButton());

    expect(patchOf().wake?.presence_device_ips).toEqual([]);
  });

  it("a bad entry is NOT swallowed client-side — it rides to the backend validator verbatim", () => {
    // `WakeCfg._normalize_device_ips` is the single source of truth for what an IP is (a typo must
    // 422, never become a device that is permanently UNKNOWN). The form must not silently drop it.
    render(<ConfTab active />);
    fireEvent.change(field("My device IPs"), { target: { value: "100.64.0.5, phone" } });
    fireEvent.click(saveButton());
    expect(patchOf().wake?.presence_device_ips).toEqual(["100.64.0.5", "phone"]);
  });

  it("raising the poll cadence past the monitor cadence still saves (the 422 comes from the server)", () => {
    // The trap the group placement exists for: `monitor.poll_seconds >= server.poll_seconds` is a
    // cross-field rule, so the FE sends the `server` section and the backend rejects the MERGED doc.
    // Pinned so nobody "helpfully" adds a client-side gate that diverges from `Settings`.
    render(<ConfTab active />);
    fireEvent.change(field("Poll cadence"), { target: { value: "60" } });
    fireEvent.click(saveButton());
    expect(patchOf().server?.poll_seconds).toBe(60);
    expect(patchOf().monitor).toBeUndefined();
  });
});
