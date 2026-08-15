import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../../src/components/AgentsEditor", () => ({ AgentsEditor: () => null }));
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
vi.mock("../../src/hooks/useSections", () => ({ useSections: () => ({ hosted: {} }) }));
vi.mock("../../src/hooks/useAppearance", () => ({
  useSaveAppearance: () => ({ mutate: vi.fn() }),
  currentAppearancePatch: () => ({}),
}));
vi.mock("../../src/hooks/useActions", () => ({
  useActionSpecs: () => ({ data: [] }),
  agentModeOf: () => "enabled",
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

afterEach(cleanup);

/** Every Conf group's `[id, number]`, in document order. */
function groups(container: HTMLElement): [string, string][] {
  return [...container.querySelectorAll<HTMLElement>(".confgroup[id]")].map((el) => [
    el.id,
    el.querySelector(".num")?.textContent ?? "",
  ]);
}

describe("ConfTab · the media groups", () => {
  it("a theme WITH a namespace renders its gallery and the kit one, in that order", () => {
    setUI({ theme: "gacha" });
    const { container } = render(<ConfTab active />);
    const media = groups(container).filter(([id]) => id.startsWith("media-"));
    expect(media.map(([id]) => id)).toEqual(["media-gacha", "media-kit"]);
    expect(container.querySelector("[data-testid=gallery-gacha]")).toBeTruthy();
    expect(container.querySelector("[data-testid=gallery-kit]")).toBeTruthy();
  });

  it("a theme WITHOUT one still renders the kit gallery — the always-on row's whole purpose", () => {
    setUI({ theme: "vapor" });
    const { container } = render(<ConfTab active />);
    expect(groups(container).filter(([id]) => id.startsWith("media-"))).toEqual([
      ["media-kit", expect.any(String)],
    ]);
    expect(container.querySelector("[data-testid=gallery-gacha]")).toBeNull();
  });

  it("numbers the groups consecutively and gives every one a distinct id, under either theme", () => {
    for (const theme of ["gacha", "vapor"] as const) {
      setUI({ theme });
      const { container, unmount } = render(<ConfTab active />);
      const all = groups(container);
      const ids = all.map(([id]) => id);
      expect(new Set(ids).size, theme).toBe(ids.length);
      // The media groups are last, so their numbers continue the tab's own run without a gap or a
      // repeat — the two failure modes of "the previous group's number + i".
      const nums = all.map(([, num]) => Number(num));
      expect(nums, theme).toEqual(nums.map((_, i) => i + 1));
      unmount();
    }
  });
});
