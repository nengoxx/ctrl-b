import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
}));

vi.mock("../src/theme-engine/ThemeProvider", () => ({ useActiveRoot: () => hoisted.root }));
vi.mock("../src/theme-engine/switchTheme", () => ({ switchTheme: hoisted.switchTheme }));
vi.mock("../src/theme-engine/registry", () => ({
  registry: { vapor: { palettes: {} } },
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
vi.mock("../src/hooks/useAgentChat", () => ({ useChatInit: () => undefined }));
vi.mock("../src/hooks/useAutoTts", () => ({ useAutoTts: () => undefined }));
vi.mock("../src/hooks/useEvents", () => ({ useEventStream: () => undefined }));
vi.mock("../src/hooks/useFleet", () => ({ useFleetCycle: () => undefined }));

import App from "../src/App";
import { setUI } from "../src/store/ui";

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
