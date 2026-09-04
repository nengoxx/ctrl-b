import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// D2-A / D50 (15c) + D2-C (L2) — the monitor + presence-wake knobs live INSIDE the Server group
// (owner ruling: no new section). Four things worth pinning: they really render in that group (the
// placement is the ruling, and `monitor.poll_seconds` is cross-field validated against
// `server.poll_seconds` right above it), the numeric fields coerce like their Server-group siblings,
// the watched-device LIST saves as wire OBJECTS (trimmed, empty rows dropped, and never the retired
// `presence_device_ips`) without dragging untouched sections into the patch, and quiet hours save
// `null` when the window is empty / are blocked when start equals end.
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
    presence_devices: [] as { name: string; tailnet_ip?: string | null; lan_ip?: string | null }[],
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
const addDeviceButton = () => serverGroup().getByRole("button", { name: "+ add device" });
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
    expect(field("Arm after").value).toBe("120");
    expect(field("Presence cooldown").value).toBe("3600");
    expect(field("Wake cooldown").value).toBe("300");
    expect(field("tailscaled socket").value).toBe("/var/run/tailscale/tailscaled.sock");
    // D2-C — the LAN source's rows sit beside them, and an empty device list renders NO row (the
    // add foot is the only affordance) with quiet hours off.
    expect(field("LAN health IP").value).toBe("");
    expect(field("LAN probe echoes").value).toBe("3");
    expect(field("LAN probe timeout").value).toBe("1");
    expect(serverGroup().queryByLabelText("Device 1 name")).toBeNull();
    expect(addDeviceButton()).toBeTruthy();
    expect(serverGroup().getByLabelText("Quiet hours").getAttribute("aria-checked")).toBe("false");
    expect(serverGroup().queryByLabelText("Quiet from")).toBeNull();
    // the cadence it is cross-field validated against is the neighbour, which is the whole point
    expect(field("Poll cadence").value).toBe("5");
  });

  it("renders one editable row per configured device", () => {
    h.settings = {
      ...makeSettings(),
      wake: {
        ...makeSettings().wake,
        presence_devices: [{ name: "phone", tailnet_ip: "100.64.0.5", lan_ip: "192.168.1.143" }],
      },
    };
    render(<ConfTab active />);
    expect(field("Device 1 name").value).toBe("phone");
    expect(field("Device 1 tailnet IP").value).toBe("100.64.0.5");
    expect(field("Device 1 LAN IP").value).toBe("192.168.1.143");
    expect(field("Device 1 LAN arm after").value).toBe(""); // unset → the model's own 900 s default
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

  it("the device rows save as wire OBJECTS — trimmed, empty rows dropped, never the retired key", () => {
    render(<ConfTab active />);
    fireEvent.click(addDeviceButton());
    fireEvent.change(field("Device 1 name"), { target: { value: "  phone  " } });
    fireEvent.change(field("Device 1 tailnet IP"), { target: { value: "100.64.0.5" } });
    fireEvent.change(field("Device 1 LAN IP"), { target: { value: "192.168.1.143" } });
    fireEvent.change(field("Device 1 LAN arm after"), { target: { value: "1800" } });
    // a second row the owner opened and never filled in: not a device, and sending it would 422
    fireEvent.click(addDeviceButton());
    fireEvent.click(saveButton());

    const patch = patchOf();
    expect(patch.wake).toEqual({
      cooldown_s: 300,
      presence_devices: [
        {
          name: "phone", // trimmed — a trailing space keys a DIFFERENT device server-side
          tailnet_ip: "100.64.0.5",
          lan_ip: "192.168.1.143",
          lan_offline_after_s: 1800, // coerced, not the typed "1800"
        },
      ],
      presence_offline_after_s: 120,
      presence_cooldown_s: 3600,
      tailscale_socket_path: "/var/run/tailscale/tailscaled.sock",
      lan_probe_count: 3,
      lan_probe_timeout_s: 1,
      lan_health_ip: null,
      quiet_hours: null,
    });
    expect(patch.wake).not.toHaveProperty("presence_device_ips"); // the D2-C fold retired it
    expect(patch.monitor).toBeUndefined();
  });

  it("a blank arm-after OMITS the key (the model's own default), and a removed row leaves", () => {
    // `lan_offline_after_s` is optional WITH a default — `null` would 422 on an int field, and a
    // silent 0 would arm the device on its first missed ping. Absent is the only correct wire shape.
    h.settings = {
      ...makeSettings(),
      wake: {
        ...makeSettings().wake,
        presence_devices: [
          { name: "phone", lan_ip: "192.168.1.143" },
          { name: "tablet", lan_ip: "192.168.1.144" },
        ],
      },
    };
    render(<ConfTab active />);
    fireEvent.click(serverGroup().getByLabelText("remove device 2"));
    fireEvent.click(saveButton());
    expect(patchOf().wake?.presence_devices).toEqual([
      { name: "phone", tailnet_ip: null, lan_ip: "192.168.1.143" },
    ]);
  });

  it("a success echo re-baselines the typed device row; the next save omits wake", () => {
    // The 15c review's named missing test, carried to the object shape: the draft holds the TYPED
    // damping override (a string) once edited, the PUT echo holds the coerced number — the per-call
    // onSuccess must converge the two, or the section reads dirty forever and every later save drags
    // `wake` back into the patch.
    render(<ConfTab active />);
    fireEvent.click(addDeviceButton());
    fireEvent.change(field("Device 1 name"), { target: { value: "phone" } });
    fireEvent.change(field("Device 1 LAN IP"), { target: { value: "192.168.1.143" } });
    fireEvent.change(field("Device 1 LAN arm after"), { target: { value: "1800" } });
    fireEvent.click(saveButton());
    const [patch, opts] = h.save.mock.calls[0] as [
      { wake?: { presence_devices?: unknown } },
      { onSuccess: (res: unknown) => void; onSettled: () => void },
    ];
    expect(patch.wake?.presence_devices).toEqual([
      { name: "phone", tailnet_ip: null, lan_ip: "192.168.1.143", lan_offline_after_s: 1800 },
    ]);
    const echoed = makeSettings();
    echoed.wake.presence_devices = patch.wake
      ?.presence_devices as typeof echoed.wake.presence_devices;
    // drive the callbacks the way the real mutation does: success, then the settled release
    act(() => {
      opts.onSuccess({ settings: echoed, providers_rev: "revA" });
      opts.onSettled();
    });
    expect(field("Device 1 LAN arm after").value).toBe("1800"); // the echoed number, rendered back
    fireEvent.change(field("Monitor cadence"), { target: { value: "60" } });
    fireEvent.click(saveButton());
    expect(patchOf(1).monitor?.poll_seconds).toBe(60);
    expect(patchOf(1).wake).toBeUndefined(); // the echoed baseline diffs equal — wake stays home
  });

  it("quiet hours: the switch seeds a window, and an emptied window saves null", () => {
    render(<ConfTab active />);
    fireEvent.click(serverGroup().getByLabelText("Quiet hours"));
    expect(field("Quiet from").value).toBe("23:00");
    expect(field("Quiet until").value).toBe("08:00");
    fireEvent.click(saveButton());
    expect(patchOf().wake?.quiet_hours).toEqual({ start: "23:00", end: "08:00" });

    // both times cleared means what the switch's OFF position means — `null`, not a `{"", ""}` 422
    cleanup();
    h.save.mockClear();
    h.settings = {
      ...makeSettings(),
      wake: { ...makeSettings().wake, quiet_hours: { start: "23:00", end: "08:00" } },
    };
    render(<ConfTab active />);
    fireEvent.change(field("Quiet from"), { target: { value: "" } });
    fireEvent.change(field("Quiet until"), { target: { value: "" } });
    fireEvent.click(saveButton());
    expect(patchOf().wake?.quiet_hours).toBeNull();
  });

  it("quiet hours with start === end BLOCKS the save (all-day suppression, refused server-side)", () => {
    h.settings = {
      ...makeSettings(),
      wake: { ...makeSettings().wake, quiet_hours: { start: "23:00", end: "08:00" } },
    };
    render(<ConfTab active />);
    fireEvent.change(field("Quiet until"), { target: { value: "23:00" } });
    expect(saveButton().disabled).toBe(true);
    expect(serverGroup().getByText(/suppress every LAN wake, all day/)).toBeTruthy();
    fireEvent.click(saveButton());
    expect(h.save).not.toHaveBeenCalled();

    // fixing the window releases the block
    fireEvent.change(field("Quiet until"), { target: { value: "08:30" } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    expect(patchOf().wake?.quiet_hours).toEqual({ start: "23:00", end: "08:30" });
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

  it("removing the last device saves an EMPTY list — the feature's off switch", () => {
    h.settings = {
      ...makeSettings(),
      wake: {
        ...makeSettings().wake,
        presence_devices: [{ name: "phone", tailnet_ip: "100.64.0.5" }],
      },
    };
    render(<ConfTab active />);
    expect(field("Device 1 name").value).toBe("phone");
    fireEvent.click(serverGroup().getByLabelText("remove device 1"));
    fireEvent.click(saveButton());

    expect(patchOf().wake?.presence_devices).toEqual([]);
  });

  it("a bad address is NOT swallowed client-side — it rides to the backend validator verbatim", () => {
    // `PresenceDeviceCfg` is the single source of truth for what an address is (a typo must 422,
    // never become a device that is permanently UNKNOWN). The form must not silently drop it.
    render(<ConfTab active />);
    fireEvent.click(addDeviceButton());
    fireEvent.change(field("Device 1 name"), { target: { value: "phone" } });
    fireEvent.change(field("Device 1 tailnet IP"), { target: { value: "phone.local" } });
    fireEvent.click(saveButton());
    expect(patchOf().wake?.presence_devices).toEqual([
      { name: "phone", tailnet_ip: "phone.local", lan_ip: null },
    ]);
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
