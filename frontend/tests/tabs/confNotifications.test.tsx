import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// F1 — the Conf → Notifications group. Three things worth pinning: the master switch also asks the
// BROWSER for permission (which is why it must ride a user gesture), the per-class switches are inert
// until the master is on, and the row tells the truth in the two states where nothing can arrive —
// permission `denied`, and an origin with no Notifications API at all (plain http).
//
// Sub-editors + data hooks are stubbed exactly as in confInferenceWindow.test.tsx so only the real
// Notifications group is live.

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
    events: {
      agent_input: true,
      turn_done: true,
      action_failed: true,
      automation_done: true,
      host_up_down: true,
    },
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
// A3 (14c) — ConfTab reads the automations list itself for the group's header summary, so the
// hook is stubbed alongside the panel (this suite renders ConfTab with no QueryClientProvider).
// Partial: the group header calls the REAL `automationsSummary` (a pure function of the envelope), so
// only the query itself is stubbed out.
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

let requestPermission: ReturnType<typeof vi.fn>;

function installNotificationApi(permission: NotificationPermission) {
  requestPermission = vi.fn(() => Promise.resolve(permission));
  Object.defineProperty(window, "Notification", {
    value: { permission, requestPermission },
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  h.settings = makeSettings();
  h.save.mockClear();
  installNotificationApi("granted");
});
afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).Notification;
});

const master = () => screen.getByLabelText("Notifications enabled");
const perClass = () => [
  screen.getByLabelText("Notify on agent input"),
  screen.getByLabelText("Notify on turn done"),
  screen.getByLabelText("Notify on action failed"),
  // A3 14d — the fourth class, wired exactly like the other three (one more key on the ONE events
  // object, never a sibling map): inert while the master is off, and saved with the same setter.
  screen.getByLabelText("Notify on automation done"),
  // D50 M5 — the fifth class, ONE toggle for both directions of a host transition.
  screen.getByLabelText("Notify on host up or down"),
];
const saveButton = () =>
  screen.getAllByRole<HTMLButtonElement>("button", { name: /Save changes|Saved|Saving/ })[0];

describe("ConfTab · Notifications (F1)", () => {
  it("per-class switches are inert while the master is off, and live once it's on", () => {
    render(<ConfTab active />);
    expect(master().getAttribute("aria-checked")).toBe("false");
    for (const s of perClass()) expect(s.getAttribute("aria-disabled")).toBe("true");

    // an inert switch really does nothing (not just a visual state)
    fireEvent.click(perClass()[0]);
    expect(perClass()[0].getAttribute("aria-checked")).toBe("true"); // unchanged from the seed

    fireEvent.click(master());
    for (const s of perClass()) expect(s.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(perClass()[1]);
    expect(perClass()[1].getAttribute("aria-checked")).toBe("false");
  });

  it("enabling asks the browser for permission (it needs the user gesture) and saves the preference", async () => {
    render(<ConfTab active />);
    fireEvent.click(master());
    await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));

    fireEvent.click(saveButton());
    expect(h.save).toHaveBeenCalledTimes(1);
    const patch = h.save.mock.calls[0][0] as { notifications?: { enabled: boolean } };
    expect(patch.notifications?.enabled).toBe(true);
  });

  it("DISABLING never re-prompts (the request rides the enable gesture only)", async () => {
    h.settings = {
      ...makeSettings(),
      notifications: {
        enabled: true,
        events: {
          agent_input: true,
          turn_done: true,
          action_failed: true,
          automation_done: true,
          host_up_down: true,
        },
      },
    };
    render(<ConfTab active />);
    fireEvent.click(master());
    await waitFor(() => expect(master().getAttribute("aria-checked")).toBe("false"));
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("a DENIED grant says so, and still lets the preference be set", async () => {
    installNotificationApi("denied");
    render(<ConfTab active />);
    expect(screen.getByText(/blocked in the browser/)).toBeTruthy();
    fireEvent.click(master());
    await waitFor(() => expect(master().getAttribute("aria-checked")).toBe("true"));
  });

  it("no Notifications API (plain-HTTP origin) → the row explains and the master is inert", () => {
    delete (window as unknown as Record<string, unknown>).Notification;
    render(<ConfTab active />);
    expect(screen.getByText(/needs HTTPS \(Tailscale Serve\)/)).toBeTruthy();
    expect(master().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(master());
    expect(master().getAttribute("aria-checked")).toBe("false");
  });

  it("a GRANTED origin shows the honest best-effort copy, not a delivery promise", () => {
    render(<ConfTab active />);
    expect(screen.getByText(/push to a closed app is a future feature/)).toBeTruthy();
  });

  it("the automation class saves through the SAME nested events setter as its siblings", () => {
    render(<ConfTab active />);
    fireEvent.click(master()); // arm the per-class switches
    fireEvent.click(screen.getByLabelText("Notify on automation done"));
    fireEvent.click(saveButton());

    const patch = h.save.mock.calls[0][0] as {
      notifications?: { events: Record<string, boolean> };
    };
    // ONE events object, with the other four untouched — not a sibling map, not a partial overwrite.
    expect(patch.notifications?.events).toEqual({
      agent_input: true,
      turn_done: true,
      action_failed: true,
      automation_done: false,
      host_up_down: true,
    });
  });

  it("a settings doc that predates a class still renders its row CHECKED (the field-merge)", () => {
    // The draft is picked from the fetched doc, so a payload written by a build without the key would
    // otherwise render the row off — and SAVE it off on the owner's next unrelated edit.
    const s = makeSettings();
    // Destructured away rather than set to `undefined`: an older backend OMITS the key, and only a
    // genuinely absent one exercises the merge (a present `undefined` would override the default).
    const { host_up_down: _absent, ...older } = s.notifications.events;
    h.settings = {
      ...s,
      notifications: { enabled: true, events: older as typeof s.notifications.events },
    };
    render(<ConfTab active />);
    expect(screen.getByLabelText("Notify on host up or down").getAttribute("aria-checked")).toBe(
      "true",
    );
  });
});
