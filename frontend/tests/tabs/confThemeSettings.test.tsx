import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ConfTab · the LAYOUT-SCOPED settings row (`showWhen` — GACHA_PLAN §12.6, the E0 engine change, and the
// integration test E0 deferred to E1 because there was nothing real to gate yet).
//
// `settings.test.ts` already pins `settingRowVisible` as a VALUE, and `themeContract.test.ts` pins the
// declaration's shape. Neither of those touches the ONE point the field is honored at: ConfTab's
// auto-render loop. That gap is exactly where the field could be lost — the loop was already the place a
// re-listed `swatch` got silently stripped once — so the claim is made here, against the real tab, the
// real registry and the real store: flip `fleetLayout`, watch the poster's own row appear and disappear,
// and watch its stored value survive the round trip.
//
// The harness is `confMediaGroups.test.tsx`'s: the tab is rendered WHOLE against the live registry with
// its data hooks and heavy sub-editors stubbed, because what is under test is the Appearance loop.

// D70 §8.4/§9 — the agent-side children ConfTab renders are the globals card + the two roleplay
// cards (the per-agent list moved to the gallery). `pickRoleplay` stays real: ConfTab reads the
// Roleplay group's header summary through it.
vi.mock("../../src/components/AgentGlobals", () => ({ AgentGlobals: () => null }));
vi.mock("../../src/components/RoleplayEditor", async (importActual) => {
  const actual = await importActual<typeof import("../../src/components/RoleplayEditor")>();
  return { ...actual, RoleplayEditor: () => null, LorebookGlobals: () => null };
});
vi.mock("../../src/components/MachineEditor", () => ({ MachineEditor: () => null }));
vi.mock("../../src/components/MemoryEditor", () => ({ MemoryEditor: () => null }));
vi.mock("../../src/components/SkillsEditor", () => ({ SkillsEditor: () => null }));
vi.mock("../../src/components/ServerListEditor", () => ({ ServerListEditor: () => null }));
vi.mock("../../src/components/AutomationsPanel", () => ({ AutomationsPanel: () => null }));
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
  useAgentToolGrid: () => ({ toolNames: [], toolModes: {} }),
}));
vi.mock("../../src/hooks/useAgents", async (importActual) => ({
  ...(await importActual<typeof import("../../src/hooks/useAgents")>()),
  useAgentList: () => ({ agents: [], default: "default" }),
}));
vi.mock("../../src/hooks/useDefaultPrompt", () => ({ useDefaultPrompt: () => ({ data: "" }) }));
vi.mock("../../src/hooks/useIntegrations", () => ({
  useIntegrationsStatus: () => ({ data: undefined }),
  useRediscover: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../src/hooks/useSkills", () => ({ useSkills: () => ({ data: [] }) }));

import { getUI, setThemeSetting, setUI } from "../../src/store/ui";
import { ConfTab } from "../../src/tabs/ConfTab";

/** Every Appearance row's LABEL, in render order — the loop's output, read the way the owner sees it. */
function rowLabels(container: HTMLElement): string[] {
  const group = container.querySelector("#appearance")!;
  return [...group.querySelectorAll<HTMLElement>(".confrow .label")].map(
    (el) => el.textContent ?? "",
  );
}

/** The `Seg` for one row, found through its label — the control whose picked value we read back. */
function segValue(container: HTMLElement, label: string): string | null {
  const row = [...container.querySelectorAll<HTMLElement>("#appearance .confrow")].find(
    (r) => r.querySelector(".label")?.textContent === label,
  );
  return row?.querySelector('[aria-checked="true"], [aria-pressed="true"]')?.textContent ?? null;
}

beforeEach(() => {
  setUI({ theme: "gacha", themeSettings: {} });
});
afterEach(() => {
  try {
    cleanup();
  } finally {
    setUI({ theme: "gacha", themeSettings: {} });
  }
});

describe("ConfTab · a layout-scoped settings row (`showWhen`)", () => {
  it("hides `Poster name` while the fleet layout resolves CAPSULE (the shipped default)", () => {
    const { container } = render(<ConfTab active />);
    const labels = rowLabels(container);
    expect(labels).toContain("Fleet layout"); // its controller is unconditional and always there
    expect(labels).not.toContain("Poster name");
  });

  it("…and reveals it IMMEDIATELY BELOW its controller once the layout resolves POSTER", () => {
    const { container } = render(<ConfTab active />);
    act(() => setThemeSetting("gacha", "fleetLayout", "poster"));
    const labels = rowLabels(container);
    expect(labels).toContain("Poster name");
    // ADJACENCY is the owner's ruling ("it pops up right below") and the contract test enforces it in the
    // DECLARATION; this is the same claim in the rendered output, which is what the owner actually sees.
    expect(labels.indexOf("Poster name")).toBe(labels.indexOf("Fleet layout") + 1);
  });

  it("KEEPS the hidden row's stored value — it comes back with the old pick, not the default", () => {
    const { container } = render(<ConfTab active />);
    act(() => setThemeSetting("gacha", "fleetLayout", "poster"));
    expect(segValue(container, "Poster name")).toBe("Blade"); // the declared default
    act(() => setThemeSetting("gacha", "posterName", "plate"));
    expect(segValue(container, "Poster name")).toBe("Plate");

    // …away and back. The §12.6 contract is explicit: a hidden row's value is never pruned, still syncs
    // in the appearance doc, and reappears exactly as the owner left it.
    act(() => setThemeSetting("gacha", "fleetLayout", "capsule"));
    expect(rowLabels(container)).not.toContain("Poster name");
    expect(getUI().themeSettings.gacha?.posterName).toBe("plate");
    act(() => setThemeSetting("gacha", "fleetLayout", "poster"));
    expect(segValue(container, "Poster name")).toBe("Plate");
  });

  it("gates on the RESOLVED sibling, so a corrupt synced value cannot hide a row the app is showing", () => {
    // The reason the predicate goes through `themeRowValue` rather than the raw store: an id this build
    // no longer declares has already been coerced to `capsule` everywhere else, and the row must agree
    // with the app rather than with the bytes.
    const { container } = render(<ConfTab active />);
    act(() => setThemeSetting("gacha", "fleetLayout", "not-a-layout"));
    expect(rowLabels(container)).not.toContain("Poster name");
    expect(segValue(container, "Fleet layout")).toBe("Capsule");
  });

  it("leaves every OTHER theme's rows untouched (no theme declares showWhen but gacha)", () => {
    const { container, rerender } = render(<ConfTab active />);
    act(() => setUI({ theme: "cosmos" }));
    rerender(<ConfTab active />);
    const labels = rowLabels(container);
    expect(labels).not.toContain("Fleet layout");
    expect(labels).not.toContain("Poster name");
    expect(labels.length).toBeGreaterThan(0);
  });
});
