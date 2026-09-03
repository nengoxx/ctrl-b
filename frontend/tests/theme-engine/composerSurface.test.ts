import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { createElement, type KeyboardEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setThemeSetting, setUI } from "../../src/store/ui";
import { KitComposer } from "../../src/theme-engine/kit/composer/Composer";
import { LineComposer } from "../../src/theme-engine/kit/composer/LineComposer";
import { SheetComposer } from "../../src/theme-engine/kit/composer/SheetComposer";
import { composerLayoutSetting } from "../../src/theme-engine/kit/composer/setting";
import { useComposerLayout } from "../../src/theme-engine/kit/composer/ThemedComposer";
import { useComposerChrome } from "../../src/theme-engine/kit/composer/useComposerChrome";
import {
  composerVariants,
  DEFAULT_COMPOSER_LAYOUT,
} from "../../src/theme-engine/kit/composer/variants";
import type { ComposerSlots, ComposerVariant } from "../../src/theme-engine/kit/composer/types";
import { registeredThemes } from "../../src/theme-engine/registry";

// COMPOSER_SURFACE_PLAN §7 — composer Surface characterization tests, grown slice by slice: A1 locked the
// mechanism (registry identity, the layout resolver's per-theme default + fallbacks, the shared setting
// spec); A2 made `sheet` a REAL docked variant (SheetComposer, shared `useComposerChrome`); A3 declared the
// setting on minimal+cosmos (default stacked; vapor declared `sheet` at D51 V4); Phase E added `line` (its
// mic/send morph is covered in lineMorph.test.ts — it needs an sttReady mock this file's shared harness
// deliberately avoids). F5 slice B SPLIT the old CSS-only `borderless`/`ghost` LAYOUT variants out into the
// `composerSkin` axis (glass/sleek skins; the axis + its resolver are pinned in axes.test.ts), so the LAYOUT
// registry is now three REAL components (stacked/sheet/line) and KitComposer stamps `.stacked` + picks its
// send glyph by skin. Registry identities, resolver fallbacks (incl. stale legacy values), the 3-option spec
// shape, the extracted `useComposerChrome`, and each variant's structural render are all pinned here.

beforeEach(() => {
  setUI({ themeSettings: {} }); // clear overrides (module state persists between tests)
});
afterEach(() => {
  cleanup();
  setUI({ themeSettings: {} });
});

describe("composerVariants registry", () => {
  it("maps stacked→Kit, sheet→Sheet, line→Line (stable module refs); borderless/ghost gone after the F5 split", () => {
    expect(composerVariants.stacked).toBe(KitComposer);
    expect(composerVariants.sheet).toBe(SheetComposer);
    expect(composerVariants.line).toBe(LineComposer);
    // the CSS-only wrappers became `composerSkin` skins (glass/sleek) — no longer LAYOUT registry entries
    expect("borderless" in composerVariants).toBe(false);
    expect("ghost" in composerVariants).toBe(false);
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
  // Each theme resolves ITS OWN declared default out of the box. minimal/cosmos/frontier declare `stacked`;
  // vapor declares `sheet` since D51 V4 (the DefaultRoot pivot — its rounded dock IS the sheet variant), so
  // this is a per-theme expectation now rather than one shared "stacked" constant.
  const DECLARED_DEFAULT: Record<string, string> = { vapor: "sheet" };
  it.each(registeredThemes().map((d) => [d.id] as const))(
    "%s resolves its DECLARED default out of the box (and maps to the right variant component)",
    (id) => {
      setUI({ theme: id, themeSettings: {} });
      const expected = DECLARED_DEFAULT[id] ?? "stacked";
      const { result } = renderHook(() => useComposerLayout());
      expect(result.current).toBe(expected);
      expect(composerVariants[result.current]).toBe(
        expected === "sheet" ? SheetComposer : KitComposer,
      );
    },
  );

  it("keeps falling back to stacked when a value is stored for an UNDECLARED setting", () => {
    // A theme with no registry row declares nothing — a synced/stale override must not resolve:
    // `resolveThemeSetting` returns undefined for the unknown key → the hook's fallback holds. (This arm
    // used to be vapor, the permanently-undeclared theme; D51 V4 made it declare `sheet`, so it moved to
    // `phosphor` — a valid ThemeId with no registry row.)
    setUI({ theme: "phosphor", themeSettings: {} });
    setThemeSetting("phosphor", "composer", "sheet");
    const { result } = renderHook(() => useComposerLayout());
    expect(result.current).toBe("stacked");
  });

  it("A3: a stored variant id resolves on a DECLARING theme (cosmos → sheet)", () => {
    setUI({ theme: "cosmos", themeSettings: {} });
    setThemeSetting("cosmos", "composer", "sheet");
    const { result } = renderHook(() => useComposerLayout());
    expect(result.current).toBe("sheet");
  });

  it("A3: an unknown stored value coerces to the declared default (validation via the option list)", () => {
    // D31 capability enforcement for free (plan §5 #14): `resolveThemeSetting` only accepts values in the
    // theme's declared `options`, so a corrupt/stale id lands on the default, never an off-catalog variant.
    setUI({ theme: "cosmos", themeSettings: {} });
    setThemeSetting("cosmos", "composer", "not-a-variant");
    const { result } = renderHook(() => useComposerLayout());
    expect(result.current).toBe("stacked");
  });

  it("F5: a stale composer LAYOUT value from before the skin split (borderless/ghost) degrades to stacked", () => {
    // `borderless`/`ghost` were composer variants until F5 slice B split them into the `composerSkin` axis;
    // they're no longer declared `composer` options, so a synced legacy value validates away to the default
    // (never renders an off-catalog variant). No migration code needed — `resolveThemeSetting` handles it.
    setUI({ theme: "cosmos", themeSettings: {} });
    setThemeSetting("cosmos", "composer", "borderless");
    expect(renderHook(() => useComposerLayout()).result.current).toBe("stacked");
    setThemeSetting("cosmos", "composer", "ghost");
    expect(renderHook(() => useComposerLayout()).result.current).toBe("stacked");
  });
});

describe("composerLayoutSetting", () => {
  it("builds the shared seg spec (options Stacked/Docked/Line, default from the arg)", () => {
    const spec = composerLayoutSetting();
    expect(spec).toMatchObject({
      type: "seg",
      label: "Composer",
      desc: "input bar layout",
      default: "stacked",
      options: [
        { val: "stacked", label: "Stacked" },
        { val: "sheet", label: "Docked" },
        { val: "line", label: "Line" },
      ],
    });
    expect(spec.type === "seg" && spec.options).toHaveLength(3);
    expect(composerLayoutSetting("sheet").default).toBe("sheet");
    expect(composerLayoutSetting("line").default).toBe("line");
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

  it("auto-grows the textarea (capped at the 112px resting ceiling) and clears height when empty", () => {
    const ta = document.createElement("textarea");
    Object.defineProperty(ta, "scrollHeight", { value: 200, configurable: true });
    const ref = { current: ta };
    ta.value = "multi\nline\ndraft";
    const { rerender } = renderHook(({ draft }) => useComposerChrome(ref, draft, vi.fn()), {
      initialProps: { draft: "multi\nline\ndraft" },
    });
    expect(ta.style.height).toBe("112px"); // min(112, 200) — the S6 №3 ceiling (= the control column)

    ta.value = "";
    rerender({ draft: "" });
    expect(ta.style.height).toBe(""); // empty draft → height reset, no measurement
  });
});

// The ONE structural-render harness for every composer variant: variants call useComposer() (draft store +
// the voice-status query + dictation), and a bare QueryClientProvider suffices — the voice query has no
// seeded data → `sttReady` is false → the mic button simply doesn't render, which no structural assertion
// below relies on. No new mocks invented.
function renderComposer(Comp: ComposerVariant, slots: ComposerSlots = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client: qc }, createElement(Comp, slots)));
}

describe("SheetComposer render (structural)", () => {
  const renderSheet = (slots: ComposerSlots = {}) => renderComposer(SheetComposer, slots);

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

describe("KitComposer render (structural + skin glyph)", () => {
  it("the default (stacked) KitComposer root className is EXACTLY `kit-composer stacked`", () => {
    // Pins the `.stacked` stamp (the skin axis keys stacked-only chrome off it) + the rootClass append's falsy
    // branch — a regression appending `undefined` would render `class="kit-composer stacked undefined"` yet
    // still pass a `contains` check.
    const { container } = renderComposer(KitComposer);
    expect(container.querySelector("#composer")?.className).toBe("kit-composer stacked");
  });

  it("renders the #cmd-input textarea inside `.field` (the shared DOM every layout/skin reuses)", () => {
    const { container } = renderComposer(KitComposer);
    const field = container.querySelector(".field");
    expect(field).not.toBeNull();
    expect(field?.querySelector("textarea#cmd-input")).not.toBeNull();
  });

  it("skin-aware send glyph: the `glass` skin defaults to the shared arrowhead; other skins keep the arrow", () => {
    // KitComposer reads the resolved composerSkin (store theme + registry default/override). minimal declares
    // the axis: default `outline` → the stroke arrow (`path`); a `glass` override swaps in the arrowhead
    // (`polygon`), reproducing the old BorderlessComposer's `sendIcon` behaviour without a wrapper component.
    setUI({ theme: "minimal", themeSettings: {} });
    const outline = renderComposer(KitComposer);
    expect(outline.container.querySelector(".kit-send path")).not.toBeNull();
    expect(outline.container.querySelector(".kit-send polygon")).toBeNull();
    cleanup();
    setThemeSetting("minimal", "composerSkin", "glass");
    const glass = renderComposer(KitComposer);
    expect(glass.container.querySelector(".kit-send polygon")).not.toBeNull();
    expect(glass.container.querySelector(".kit-send path")).toBeNull();
  });
});

describe("LineComposer render (structural)", () => {
  // LineComposer (Phase E) is a REAL variant: the Telegram single row reusing useComposer + useComposerChrome.
  // The shared `renderComposer` harness seeds NO voice data → `sttReady` is false → the morph is ALWAYS on its
  // send branch here (exactly the `!sttReady` always-send case), so the mic button never mounts.
  const renderLine = (slots: ComposerSlots = {}) => renderComposer(LineComposer, slots);

  it("root is `.kit-composer.line#composer` (edge #5 — --composer-h querySelector still matches)", () => {
    const { container } = renderLine({});
    const root = container.querySelector("#composer");
    expect(root).not.toBeNull();
    expect(root?.classList.contains("kit-composer")).toBe(true);
    expect(root?.classList.contains("line")).toBe(true);
  });

  it("renders `overlay` as a SIBLING BEFORE the composer bar (edge #7 tuck order)", () => {
    const { container } = renderLine({
      overlay: createElement("div", { "data-testid": "ov" }),
    });
    const kids = Array.from(container.childNodes);
    const ovIdx = kids.findIndex((n) => (n as Element).getAttribute?.("data-testid") === "ov");
    const barIdx = kids.findIndex((n) => (n as Element).id === "composer");
    expect(ovIdx).toBeGreaterThanOrEqual(0);
    expect(barIdx).toBeGreaterThan(ovIdx);
  });

  it("renders `controlsStart` inside `.line-controls`; omits the wrapper when the slot is absent", () => {
    const { container } = renderLine({
      controlsStart: createElement("span", { "data-testid": "pill" }, "plan"),
    });
    const controls = container.querySelector(".line-controls");
    expect(controls).not.toBeNull();
    expect(controls?.querySelector("[data-testid=pill]")).not.toBeNull();

    cleanup();
    const bare = renderLine({});
    expect(bare.container.querySelector(".line-controls")).toBeNull();
  });

  it("the textarea is `#cmd-input` with the short 'Message' placeholder (the reference's copy)", () => {
    const { container } = renderLine({});
    const ta = container.querySelector("textarea#cmd-input");
    expect(ta).not.toBeNull();
    expect(ta?.getAttribute("placeholder")).toBe("Message");
  });

  it("the morph's !sttReady branch: the SEND button (arrowhead polygon) renders and NO mic mounts", () => {
    // The harness has no voice data → sttReady false → `showMic` is false → always-send. The send button
    // carries the shared arrowhead (`polygon`), and the mic button is absent entirely (clean aria, no
    // label-flipping single button).
    const { container } = renderLine({});
    const send = container.querySelector("button#cmd-send.kit-send.line-btn");
    expect(send).not.toBeNull();
    expect(send?.querySelector("polygon")).not.toBeNull();
    expect(container.querySelector(".kit-cbtn.mic")).toBeNull();
  });
});
