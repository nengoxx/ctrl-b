import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ConfTab · the MEDIA groups (D53 — deferred from M1b to M3, when the second row landed for real).
//
// `applicableNs` decides which galleries the tab renders: the active theme's own namespace plus every
// always-on row. Two things could go wrong once there are two rows, and neither is visible in the unit
// test of `applicableNs` itself — it answers with a LIST, while this tab has to turn that list into
// consecutively numbered, uniquely identified groups:
//
//   · a theme WITHOUT a media link must still render the kit gallery (the draft bug, Opus H2: gating on
//     `ThemeDef.media` hid it under vapor/cosmos/minimal while their service rows painted icons from it);
//   · the numbering and the `media-<ns>` ids must stay consecutive and distinct, because the collapse
//     store and the scroll-to-group target are keyed on those ids.
//
// The tab is rendered whole against the LIVE registry (the confInferenceWindow harness): its data hooks
// and heavy sub-editors are stubbed, the media registry is not — a group that only the real rows produce
// is exactly what is under test.

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
// The galleries themselves are stubbed: their content has its own suite, and what this one is about is
// which GROUPS exist. The stub echoes its namespace so the group's identity is readable from the DOM.
vi.mock("../../src/components/MediaGallery", () => ({
  MediaGallery: ({ ns }: { ns: string }) => <div data-testid={`gallery-${ns}`} />,
}));
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
vi.mock("../../src/tabs/UtilsTab", () => ({ UtilsContent: () => null, UtilsTab: () => null }));
// Same posture for the gallery's hostable body: which GROUPS exist is what this suite is about, and the
// gallery's own content has its own suite. The stub echoes itself so the group is readable from the DOM.
vi.mock("../../src/tabs/AgentsTab", () => ({
  AgentsContent: () => <div data-testid="gallery-hosted" />,
  AgentsTab: () => null,
}));
vi.mock("../../src/hooks/useSettings", () => ({
  useSettings: () => ({ data: undefined }),
  useSettingsProvidersRev: () => "revA",
  useProviders: () => ({ data: undefined, dataUpdatedAt: 0 }),
  useSaveSettings: () => ({ mutate: vi.fn(), isPending: false }),
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
// The hosting map is what decides Conf's TAIL (D35 §F0 for utils, D70 §8.4a for the agents gallery), so
// it is the knob these cases turn — the real controller's own resolution is covered in useSections.test.
const hosted = vi.hoisted((): { map: Record<string, string> } => ({ map: {} }));
vi.mock("../../src/hooks/useSections", () => ({ useSections: () => ({ hosted: hosted.map }) }));
vi.mock("../../src/hooks/useAppearance", () => ({
  useSaveAppearance: () => ({ mutate: vi.fn() }),
  currentAppearancePatch: () => ({}),
}));
vi.mock("../../src/hooks/useActions", () => ({
  useActionSpecs: () => ({ data: [] }),
  agentModeOf: () => "enabled",
  useAgentToolGrid: () => ({ toolNames: [], toolModes: {} }),
}));
vi.mock("../../src/hooks/useAgents", async (importActual) => ({
  ...(await importActual<typeof import("../../src/hooks/useAgents")>()),
  useAgentList: () => ({ data: { agents: [], default: "default" } }),
}));
vi.mock("../../src/hooks/useDefaultPrompt", () => ({ useDefaultPrompt: () => ({ data: "" }) }));
vi.mock("../../src/hooks/useIntegrations", () => ({
  useIntegrationsStatus: () => ({ data: undefined }),
  useRediscover: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../src/hooks/useSkills", () => ({ useSkills: () => ({ data: [] }) }));

import { setUI } from "../../src/store/ui";
import { ConfTab } from "../../src/tabs/ConfTab";

beforeEach(() => {
  hosted.map = {};
});
afterEach(cleanup);

/** Every Conf group's `[id, number]`, in document order. */
function groups(container: HTMLElement): [string, string][] {
  return [...container.querySelectorAll<HTMLElement>(".confgroup[id]")].map((el) => [
    el.id,
    el.querySelector(".num")?.textContent ?? "",
  ]);
}

describe("ConfTab · the media groups", () => {
  it("a theme WITH a namespace renders its gallery and the always-on ones, in that order", () => {
    setUI({ theme: "gacha" });
    const { container } = render(<ConfTab active />);
    const media = groups(container).filter(([id]) => id.startsWith("media-"));
    // `agents` joined `kit` as an always-on row at D70 §8.1 — an agent's avatar/backdrop libraries
    // belong to the agent, not to whichever skin paints them.
    expect(media.map(([id]) => id)).toEqual(["media-gacha", "media-kit", "media-agents"]);
    expect(container.querySelector("[data-testid=gallery-gacha]")).toBeTruthy();
    expect(container.querySelector("[data-testid=gallery-kit]")).toBeTruthy();
    expect(container.querySelector("[data-testid=gallery-agents]")).toBeTruthy();
  });

  it("a theme WITHOUT one still renders the always-on galleries — that row's whole purpose", () => {
    setUI({ theme: "vapor" });
    const { container } = render(<ConfTab active />);
    expect(groups(container).filter(([id]) => id.startsWith("media-"))).toEqual([
      ["media-kit", expect.any(String)],
      ["media-agents", expect.any(String)],
    ]);
    expect(container.querySelector("[data-testid=gallery-gacha]")).toBeNull();
  });

  // D70 §8.4a MED-2 — the TAIL. Its numbers used to be ternary arithmetic over the single hosted-utils
  // flag (`hostsUtils ? 22 : 21`, media `+ i`), a shape that cannot take a SECOND hosted group; it is now
  // derived from one ordered list of the hosted groups actually present. So the consecutive/unique
  // assertion has to run across every combination of hosted groups, not just the two it used to.
  const TAILS: Record<string, string>[] = [
    {},
    { utils: "conf" },
    { agents: "conf" },
    { utils: "conf", agents: "conf" },
  ];

  it("numbers the groups consecutively and gives every one a distinct id, under every hosted tail", () => {
    for (const theme of ["gacha", "vapor"] as const) {
      for (const map of TAILS) {
        hosted.map = map;
        setUI({ theme });
        const { container, unmount } = render(<ConfTab active />);
        const label = `${theme} · hosted=${JSON.stringify(map)}`;
        const all = groups(container);
        const ids = all.map(([id]) => id);
        expect(new Set(ids).size, label).toBe(ids.length);
        // The media groups are last, so their numbers continue the tab's own run without a gap or a
        // repeat — the two failure modes of "the previous group's number + i".
        const nums = all.map(([, num]) => Number(num));
        expect(nums, label).toEqual(nums.map((_, i) => i + 1));
        // …and each hosted group is actually THERE, with its body, exactly when the map says so.
        expect(ids.includes("utils-hosted"), label).toBe("utils" in map);
        expect(ids.includes("agents-hosted"), label).toBe("agents" in map);
        expect(container.querySelector("[data-testid=gallery-hosted]") !== null, label).toBe(
          "agents" in map,
        );
        unmount();
      }
    }
  });
});
