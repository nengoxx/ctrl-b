import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Item ② (§14.15.1) — the theme-fault boundary + Reset-as-pick, wired in App.tsx. App is otherwise a thin
// host of headless engines (event stream, appearance sync, chat init, auto-TTS, fleet cycle) that each need
// a QueryClient/SSE; those are mocked to no-ops so this file exercises ONLY the boundary + the fallback's two
// actions. `useActiveRoot` is mocked to a controllable Root (throws / renders on demand); `switchTheme` and
// the appearance mutation are spies. `resolve` stays REAL so DEFAULT_THEME is the genuine "vapor" literal and
// the Reset target is the real `defaultSwitchTarget` (its `registry` read is the only registry dep → mocked
// minimally, keeping cosmos's canvas imports out of jsdom).

import type { ReactNode } from "react";

const hoisted = vi.hoisted(() => ({
  mutate: vi.fn(),
  switchTheme: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  root: null as null | (() => ReactNode),
  // A4 wiring probe: the mocked useAgentChat reads this so a test can drive currentPlan open→null and assert
  // AppEngines' usePlanOpenAutoClose reset the shared plan-open flag.
  chat: { currentPlan: null as Record<string, unknown> | null },
}));

vi.mock("../src/theme-engine/ThemeProvider", () => ({ useActiveRoot: () => hoisted.root }));
vi.mock("../src/theme-engine/switchTheme", () => ({ switchTheme: hoisted.switchTheme }));
vi.mock("../src/theme-engine/registry", () => ({
  // vapor stays minimal (its palettes drive the real `defaultSwitchTarget` in the Reset tests). frontier +
  // cosmos carry the `outlines` + `composerSkin` axis settings so AppEngines' D37 stamps resolve against their
  // real defaults (frontier outlines OFF / skin `bezel`, cosmos outlines ON / skin `outline`) without dragging
  // the theme modules' canvas imports into jsdom.
  registry: {
    vapor: { palettes: {} },
    frontier: {
      palettes: {},
      settings: {
        outlines: { type: "switch", label: "Outlines", default: false },
        composerSkin: {
          type: "seg",
          label: "Composer skin",
          options: [{ val: "outline" }, { val: "glass" }, { val: "bezel" }, { val: "sleek" }],
          default: "bezel",
        },
      },
    },
    cosmos: {
      palettes: {},
      settings: {
        outlines: { type: "switch", label: "Outlines", default: true },
        composerSkin: {
          type: "seg",
          label: "Composer skin",
          options: [{ val: "outline" }, { val: "glass" }, { val: "bezel" }, { val: "sleek" }],
          default: "outline",
        },
      },
    },
  },
  registeredThemes: () => [],
}));
vi.mock("../src/hooks/useAppearance", () => ({
  useAppearanceSync: () => undefined,
  useSaveAppearance: () => ({ mutate: hoisted.mutate }),
  currentAppearancePatch: () => ({
    theme: "seed",
    mode: "seed",
    accent: "seed",
    motion: "full",
    perf: "high",
    themeSettings: {},
  }),
}));
vi.mock("../src/hooks/useAgentChat", () => ({
  useChatInit: () => undefined,
  useAgentChat: () => hoisted.chat, // AppEngines reads currentPlan for the A4 auto-close (§14.5)
}));
vi.mock("../src/hooks/useAutoTts", () => ({ useAutoTts: () => undefined }));
vi.mock("../src/hooks/useEvents", () => ({ useEventStream: () => undefined }));
vi.mock("../src/hooks/useFleet", () => ({ useFleetCycle: () => undefined }));

import App from "../src/App";
import { setThemeSetting, setUI } from "../src/store/ui";
import { setPlanSheetOpen, usePlanSheetOpen } from "../src/store/planSheet";

// A tiny probe reading the SHARED plan-open flag (module singleton store) — re-renders when it changes.
function PlanProbe(): ReactNode {
  return <span data-testid="plan-open">{String(usePlanSheetOpen())}</span>;
}

// A Root whose throwing is toggleable at runtime, so a remount (Reset's epoch bump) can render cleanly.
const flaky = { throw: true };
function FlakyRoot(): ReactNode {
  if (flaky.throw) throw new Error("theme boom");
  return <div data-testid="root-ok">ok</div>;
}
function ThrowingRoot(): ReactNode {
  throw new Error("theme boom");
}

beforeEach(() => {
  setUI({ theme: "vapor" }); // default skin; individual cases override
  hoisted.root = null;
  hoisted.chat.currentPlan = null; // reset the A4 probe
  setPlanSheetOpen(false); // reset the shared flag (module singleton persists across tests)
  flaky.throw = true;
  vi.spyOn(console, "error").mockImplementation(() => undefined); // silence React's caught-error noise
});
afterEach(cleanup); // globals:false → register RTL cleanup explicitly

describe("App theme-fault boundary (item ②)", () => {
  it("a Root that throws on render shows the fault fallback (not a blank screen)", () => {
    hoisted.root = ThrowingRoot;
    render(<App />);
    expect(document.querySelector('[data-fault="theme"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset theme to default" })).toBeTruthy();
  });

  it("Reload = primary → calls the boundary's window.location.reload", () => {
    // jsdom's `location.reload` is non-configurable, so swap the whole `window.location` for this case
    // (nothing in the render path reads other Location fields). Restored below.
    const reloadSpy = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { reload: reloadSpy },
    });
    try {
      hoisted.root = ThrowingRoot;
      render(<App />);
      fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: orig });
    }
  });

  it("Reset = a genuine DEFAULT_THEME pick (switchTheme + appearance PUT) and remounts the Root", () => {
    setUI({ theme: "minimal" }); // faulty skin differs from DEFAULT_THEME
    hoisted.root = FlakyRoot;
    render(<App />);
    expect(document.querySelector('[data-fault="theme"]')).not.toBeNull();

    flaky.throw = false; // the skin will render cleanly after the remount
    fireEvent.click(screen.getByRole("button", { name: "Reset theme to default" }));

    // Reset reconstructs pickTheme's two-step toward the real DEFAULT_THEME + its default axes.
    expect(hoisted.switchTheme).toHaveBeenCalledWith("vapor", { mode: "dark", accent: "dark" });
    // Write-through (§14.15.2): the optimistic appearance PUT carries the DEFAULT_THEME target.
    expect(hoisted.mutate).toHaveBeenCalledTimes(1);
    expect(hoisted.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "vapor", mode: "dark", accent: "dark" }),
    );
    // The epoch bump remounts the boundary → the (now-healthy) Root renders; the fallback clears.
    expect(screen.getByTestId("root-ok")).toBeTruthy();
    expect(document.querySelector('[data-fault="theme"]')).toBeNull();
  });

  it("Reset still remounts when the faulty skin already IS DEFAULT_THEME (epoch, not id)", () => {
    // theme stays "vapor" (== DEFAULT_THEME): the key's id part can't change, so only the epoch forces the
    // remount — the M4 no-op trap the resetEpoch counter exists to defeat.
    hoisted.root = FlakyRoot;
    render(<App />);
    expect(document.querySelector('[data-fault="theme"]')).not.toBeNull();

    flaky.throw = false;
    fireEvent.click(screen.getByRole("button", { name: "Reset theme to default" }));

    expect(screen.getByTestId("root-ok")).toBeTruthy();
    expect(document.querySelector('[data-fault="theme"]')).toBeNull();
  });
});

describe("App A4 wiring — AppEngines resets the shared plan-open flag on plan→null (§14.5)", () => {
  it("clears usePlanSheetOpen() when currentPlan clears — fails if usePlanOpenAutoClose is dropped from App", () => {
    hoisted.root = () => null; // a valid (renderable) Root — this test is about AppEngines, not the theme tree
    hoisted.chat.currentPlan = { steps: [] }; // a live plan
    const tree = (
      <>
        <App />
        <PlanProbe />
      </>
    );
    const { rerender } = render(tree);

    // the user opened the composer plan sheet while the plan was live
    act(() => setPlanSheetOpen(true));
    expect(screen.getByTestId("plan-open").textContent).toBe("true");

    // the plan clears → the real usePlanOpenAutoClose(currentPlan) mounted in AppEngines must reset the flag
    hoisted.chat.currentPlan = null;
    rerender(
      <>
        <App />
        <PlanProbe />
      </>,
    );
    expect(screen.getByTestId("plan-open").textContent).toBe("false");
  });
});

describe("App presentation axes — AppEngines stamps body[data-outlines] + body[data-composer-skin] (D37)", () => {
  beforeEach(() => setUI({ themeSettings: {} })); // clear per-theme overrides (module singleton persists)

  it("frontier defaults: outlines OFF + skin `bezel` → both attrs stamped", () => {
    setUI({ theme: "frontier" });
    hoisted.root = () => null; // a valid Root; this asserts AppEngines' stamp, not the theme tree
    render(<App />);
    expect(document.body.dataset.outlines).toBe("off");
    expect(document.body.dataset.composerSkin).toBe("bezel");
  });

  it("a user override flips frontier outlines to ON + skin to sleek", () => {
    setUI({ theme: "frontier" });
    setThemeSetting("frontier", "outlines", true);
    setThemeSetting("frontier", "composerSkin", "sleek");
    hoisted.root = () => null;
    render(<App />);
    expect(document.body.dataset.outlines).toBe("on");
    expect(document.body.dataset.composerSkin).toBe("sleek");
  });

  it("cosmos defaults: outlines ON + skin `outline`", () => {
    setUI({ theme: "cosmos" });
    hoisted.root = () => null;
    render(<App />);
    expect(document.body.dataset.outlines).toBe("on");
    expect(document.body.dataset.composerSkin).toBe("outline");
  });

  it("cleanup removes BOTH axis attrs on unmount", () => {
    setUI({ theme: "cosmos" });
    hoisted.root = () => null;
    const { unmount } = render(<App />);
    expect(document.body.dataset.outlines).toBe("on");
    expect(document.body.dataset.composerSkin).toBe("outline");
    unmount();
    expect(document.body.dataset.outlines).toBeUndefined();
    expect(document.body.dataset.composerSkin).toBeUndefined();
  });
});
