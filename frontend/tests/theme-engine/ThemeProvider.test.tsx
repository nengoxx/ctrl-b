import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ThemeProvider's cold-load catch — item ④'s severity-keyed SINGLE signal (§14.15.1-A ④+). A `root`-source
// ThemeLoadError is FATAL and stays SILENT to the user (item ②'s boundary owns the blocking signal); a
// `styles`/`fonts` failure degrades survivably and raises exactly ONE toast. switchTheme keeps module-level
// state (the `loaded` Map), so each case resets the module graph (`vi.resetModules()` + a fresh dynamic
// import) — ThemeProvider, the ui store, and the mocked registry must come from the SAME reset cycle so the
// effect reads the store it also flips (the switchTheme.test idiom). The registry is mocked with
// controllable loaders; the toast store is mocked to spy on pushToast.

type FakeDef = {
  loadStyles: () => Promise<void>;
  loadFonts?: () => Promise<void>;
  loadRoot?: () => Promise<void>;
};

const { mockRegistry, pushToast } = vi.hoisted(() => {
  const mockRegistry: Record<string, FakeDef | undefined> = {};
  const pushToast = vi.fn<(text: string, kind?: string) => void>();
  return { mockRegistry, pushToast };
});

vi.mock("../../src/theme-engine/registry", () => ({
  registry: mockRegistry,
  registeredThemes: () => [],
}));
vi.mock("../../src/store/toast", () => ({ pushToast }));

const rejecting = (): (() => Promise<void>) =>
  vi.fn<() => Promise<void>>(() => Promise.reject(new Error("load failed")));
const resolving = (): (() => Promise<void>) => vi.fn<() => Promise<void>>(() => Promise.resolve());

/** Fresh module graph per case: mount ThemeProvider on the persisted "minimal" theme so its cold-load
 *  effect runs `ensureThemeLoaded("minimal")` against the mocked loaders. */
async function mountMinimal(def: FakeDef) {
  mockRegistry.minimal = def;
  const { ThemeProvider } = await import("../../src/theme-engine/ThemeProvider");
  const { setUI } = await import("../../src/store/ui");
  setUI({ theme: "minimal" });
  render(<ThemeProvider>x</ThemeProvider>);
}

beforeEach(() => {
  for (const k of Object.keys(mockRegistry)) delete mockRegistry[k];
  pushToast.mockClear();
  vi.resetModules(); // reset switchTheme's `loaded` Map + a fresh ui store
});
afterEach(cleanup); // globals:false → register RTL cleanup explicitly

describe("ThemeProvider cold-load — ④ severity-keyed single signal", () => {
  it("root-source failure stays silent to the user (no toast) but logs", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await mountMinimal({ loadStyles: resolving(), loadRoot: rejecting() });

    await vi.waitFor(() => {
      expect(errSpy).toHaveBeenCalled(); // the catch logged the fatal error
    });
    expect(pushToast).not.toHaveBeenCalled(); // ② owns the blocking signal — no double-signal here
  });

  it("styles-source failure raises exactly one toast", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await mountMinimal({ loadStyles: rejecting() });

    await vi.waitFor(() => {
      expect(pushToast).toHaveBeenCalledTimes(1);
    });
    expect(pushToast).toHaveBeenCalledWith("theme failed to load", "err");
  });
});
