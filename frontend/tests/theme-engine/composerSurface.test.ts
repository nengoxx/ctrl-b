import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { createElement, type KeyboardEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setThemeSetting, setUI } from "../../src/store/ui";
import { KitComposer } from "../../src/theme-engine/kit/composer/Composer";
import { GhostComposer } from "../../src/theme-engine/kit/composer/GhostComposer";
import { SheetComposer } from "../../src/theme-engine/kit/composer/SheetComposer";
import { composerLayoutSetting } from "../../src/theme-engine/kit/composer/setting";
import { useComposerLayout } from "../../src/theme-engine/kit/composer/ThemedComposer";
import { useComposerChrome } from "../../src/theme-engine/kit/composer/useComposerChrome";
import {
  composerVariants,
  DEFAULT_COMPOSER_LAYOUT,
} from "../../src/theme-engine/kit/composer/variants";
import type { ComposerSlots } from "../../src/theme-engine/kit/composer/types";
import { registeredThemes } from "../../src/theme-engine/registry";

// COMPOSER_SURFACE_PLAN §7 — composer Surface characterization tests. §A1 locked the mechanism (registry
// identity, the layout resolver's per-theme default + fallbacks, the shared setting spec). §A2 makes `sheet`
// a REAL docked variant (SheetComposer) reusing the shared `useComposerChrome` hook; §A2b adds the `ghost`
// sleek variant (GhostComposer — a thin `.kit-composer.ghost` wrapper over KitComposer, pure CSS, no fork).
// The registry identities (`composerVariants.{sheet,ghost}`) hold, and NO theme declares the `composer`
// setting yet (A3 does) so every theme still resolves to `stacked`. This file also covers the extracted
// `useComposerChrome` (the pure presentational chrome) and SheetComposer/GhostComposer's structural render.

beforeEach(() => {
  setUI({ themeSettings: {} }); // clear overrides (module state persists between tests)
});
afterEach(() => {
  cleanup();
  setUI({ themeSettings: {} });
});

describe("composerVariants registry", () => {
  it("maps stacked→KitComposer, ghost→GhostComposer and sheet→SheetComposer (stable module refs)", () => {
    expect(composerVariants.stacked).toBe(KitComposer);
    expect(composerVariants.ghost).toBe(GhostComposer);
    expect(composerVariants.sheet).toBe(SheetComposer);
  });

  it("DEFAULT_COMPOSER_LAYOUT is stacked", () => {
    expect(DEFAULT_COMPOSER_LAYOUT).toBe("stacked");
  });

  it("falls back to KitComposer for an unknown variant id (the resolver's ?? net)", () => {
    expect("nope" in composerVariants).toBe(false);
    expect(composerVariants["nope"] ?? KitComposer).toBe(KitComposer);
  });
});

describe("useComposerLayout", () => {
  it.each(registeredThemes().map((d) => [d.id] as const))(
    "resolves to stacked (the fallback) when %s declares no composer setting → KitComposer",
    (id) => {
      setUI({ theme: id, themeSettings: {} });
      const { result } = renderHook(() => useComposerLayout());
      expect(result.current).toBe("stacked");
      expect(composerVariants[result.current]).toBe(KitComposer);
    },
  );

  it("keeps falling back to stacked when a value is stored for an undeclared setting", () => {
    // No theme declares `composer` yet (A3 wires it), so even a synced/stale override does not resolve —
    // `resolveThemeSetting` returns undefined for the unknown key → the hook's `?? stacked` fallback holds.
    setUI({ theme: "cosmos", themeSettings: {} });
    setThemeSetting("cosmos", "composer", "sheet");
    const { result } = renderHook(() => useComposerLayout());
    expect(result.current).toBe("stacked");
  });
});

describe("composerLayoutSetting", () => {
  it("builds the shared seg spec (options Stacked/Sleek/Docked, default from the arg)", () => {
    const spec = composerLayoutSetting();
    expect(spec).toMatchObject({
      type: "seg",
      label: "Composer",
      desc: "input bar layout",
      default: "stacked",
      options: [
        { val: "stacked", label: "Stacked" },
        { val: "ghost", label: "Sleek" },
        { val: "sheet", label: "Docked" },
      ],
    });
    expect(composerLayoutSetting("ghost").default).toBe("ghost");
    expect(composerLayoutSetting("sheet").default).toBe("sheet");
  });
});

describe("useComposerChrome", () => {
  // The hook takes a plain `{ current }` ref + a send fn as args (no store), so it unit-tests in isolation.
  // `preventDefault` is passed in as a spy variable (not asserted off the event object) to keep the
  // unbound-method lint happy.
  const key = (over: Partial<KeyboardEvent<HTMLTextAreaElement>>, preventDefault = vi.fn()) =>
    ({ preventDefault, ...over }) as unknown as KeyboardEvent<HTMLTextAreaElement>;

  it("Enter without shift sends + preventDefault", () => {
    const send = vi.fn();
    const preventDefault = vi.fn();
    const ref = { current: null };
    const { result } = renderHook(() => useComposerChrome(ref, "", send));
    result.current.onKeyDown(key({ key: "Enter", shiftKey: false }, preventDefault));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });

  it("Shift+Enter does NOT send (newline passes through)", () => {
    const send = vi.fn();
    const preventDefault = vi.fn();
    const ref = { current: null };
    const { result } = renderHook(() => useComposerChrome(ref, "", send));
    result.current.onKeyDown(key({ key: "Enter", shiftKey: true }, preventDefault));
    expect(preventDefault).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("pressMic sets micPressed, releaseMic clears it", () => {
    const ref = { current: null };
    const { result } = renderHook(() => useComposerChrome(ref, "", vi.fn()));
    expect(result.current.micPressed).toBe(false);
    act(() => result.current.pressMic());
    expect(result.current.micPressed).toBe(true);
    act(() => result.current.releaseMic());
    expect(result.current.micPressed).toBe(false);
  });

  it("the 200ms safety timeout clears micPressed", () => {
    vi.useFakeTimers();
    try {
      const ref = { current: null };
      const { result } = renderHook(() => useComposerChrome(ref, "", vi.fn()));
      act(() => result.current.pressMic());
      expect(result.current.micPressed).toBe(true);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(result.current.micPressed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-grows the textarea (capped at 96px) and clears height for an empty draft", () => {
    const ta = document.createElement("textarea");
    Object.defineProperty(ta, "scrollHeight", { value: 200, configurable: true });
    const ref = { current: ta };
    ta.value = "multi\nline\ndraft";
    const { rerender } = renderHook(({ draft }) => useComposerChrome(ref, draft, vi.fn()), {
      initialProps: { draft: "multi\nline\ndraft" },
    });
    expect(ta.style.height).toBe("96px"); // min(96, 200)

    ta.value = "";
    rerender({ draft: "" });
    expect(ta.style.height).toBe(""); // empty draft → height reset, no measurement
  });
});

describe("SheetComposer render (structural)", () => {
  // SheetComposer calls useComposer() (draft store + the voice-status query + dictation). A bare
  // QueryClientProvider is enough: the voice query has no seeded data → `sttReady` is false → the mic button
  // simply doesn't render, which the structural assertions below don't rely on. No new mocks invented.
  function renderSheet(slots: ComposerSlots) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement<ComposerSlots>(SheetComposer, slots),
      ),
    );
  }

  it("root is `.kit-composer.sheet#composer` (edge #5 — --composer-h querySelector still matches)", () => {
    const { container } = renderSheet({});
    const root = container.querySelector("#composer");
    expect(root).not.toBeNull();
    expect(root?.classList.contains("kit-composer")).toBe(true);
    expect(root?.classList.contains("sheet")).toBe(true);
  });

  it("renders `overlay` as a SIBLING BEFORE the composer bar (edge #7 tuck order)", () => {
    const { container } = renderSheet({
      overlay: createElement("div", { "data-testid": "ov" }),
    });
    const kids = Array.from(container.childNodes);
    const ovIdx = kids.findIndex((n) => (n as Element).getAttribute?.("data-testid") === "ov");
    const barIdx = kids.findIndex((n) => (n as Element).id === "composer");
    expect(ovIdx).toBeGreaterThanOrEqual(0);
    expect(barIdx).toBeGreaterThan(ovIdx);
  });

  it("renders `controlsStart` inside `.sheet-controls`; omits the strip when the slot is absent", () => {
    const { container } = renderSheet({
      controlsStart: createElement("span", { "data-testid": "pill" }, "plan"),
    });
    const strip = container.querySelector(".sheet-controls");
    expect(strip).not.toBeNull();
    expect(strip?.querySelector("[data-testid=pill]")).not.toBeNull();

    cleanup();
    const bare = renderSheet({});
    expect(bare.container.querySelector(".sheet-controls")).toBeNull();
  });
});

describe("GhostComposer render (structural)", () => {
  // GhostComposer (A2b) is a thin wrapper that renders KitComposer's EXACT DOM + the `.kit-composer.ghost`
  // root class (`.kit-composer.ghost` in kit.css restyles it — pure CSS, no fork). Same QueryClientProvider
  // harness as SheetComposer: the voice query has no seeded data → `sttReady` is false, which the structural
  // assertions below don't rely on. No new mocks invented.
  function renderGhost(slots: ComposerSlots) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement<ComposerSlots>(GhostComposer, slots),
      ),
    );
  }

  it("root is `.kit-composer.ghost#composer` (edge #5 — --composer-h querySelector still matches)", () => {
    const { container } = renderGhost({});
    const root = container.querySelector("#composer");
    expect(root).not.toBeNull();
    expect(root?.classList.contains("kit-composer")).toBe(true);
    expect(root?.classList.contains("ghost")).toBe(true);
  });

  it("renders KitComposer's DOM — the #cmd-input textarea inside `.field` (parity, no fork)", () => {
    const { container } = renderGhost({});
    const field = container.querySelector(".field");
    expect(field).not.toBeNull();
    expect(field?.querySelector("textarea#cmd-input")).not.toBeNull();
  });

  it("the default (no rootClass) KitComposer root className is EXACTLY `kit-composer` (no trailing garbage)", () => {
    // Pins the rootClass append's falsy branch — a regression like `"kit-composer " + rootClass` would
    // render `class="kit-composer undefined"` on every stacked theme yet still pass a `contains` check.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      createElement(QueryClientProvider, { client: qc }, createElement(KitComposer)),
    );
    expect(container.querySelector("#composer")?.className).toBe("kit-composer");
  });
});
