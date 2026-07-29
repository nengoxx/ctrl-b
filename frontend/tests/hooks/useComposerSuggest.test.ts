import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { createElement, useState, type KeyboardEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useComposerSuggest } from "../../src/hooks/useComposerSuggest";
import { loadSkills } from "../../src/lib/composer";
import { clearDraft, getDraft } from "../../src/store/composer";
import { setPlanSheetOpen, usePlanSheetOpen } from "../../src/store/planSheet";
import { KitComposer } from "../../src/theme-engine/kit/composer/Composer";

// A2 — the composer autocomplete BEHAVIOUR (hooks/useComposerSuggest) + its popover wiring in a real Kit
// composer. The GRAMMAR lives in lib/composer (`getCompletions`, covered in tests/lib/composer.test.ts);
// here we pin the open/close policy, the keyboard priority over send, and the touch accept path.
//
// No loaders are stubbed: the verb sets stay empty, so every case rides the BUILT-IN table alone (`/c` →
// compact + clear) — which is exactly the surface that must work before any fetch lands.

/** A React-shaped keydown stub — the hook only reads key/shiftKey/keyCode/nativeEvent.isComposing. */
function key(k: string, extra: { shiftKey?: boolean; composing?: boolean } = {}) {
  return {
    key: k,
    shiftKey: extra.shiftKey ?? false,
    keyCode: 0,
    nativeEvent: { isComposing: extra.composing ?? false },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as KeyboardEvent<HTMLTextAreaElement> & {
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
  };
}

/** Drive the hook against a locally-held draft (the variants hold theirs in store/composer). */
function harness(initialDraft = "") {
  const base = vi.fn();
  const { result } = renderHook(() => {
    const [draft, setDraft] = useState(initialDraft);
    const suggest = useComposerSuggest({ draft, setDraft, onKeyDown: base });
    return { draft, suggest, planOpen: usePlanSheetOpen() };
  });
  return { result, base };
}

describe("useComposerSuggest — open policy", () => {
  it("never opens on mount, even with a `/…` draft restored from localStorage", () => {
    const { result } = harness("/c");
    expect(result.current.suggest.open).toBe(false);
    expect(result.current.suggest.items.length).toBeGreaterThan(0); // the items are there — we just don't show them
  });

  it("arms on focus, and on typing", () => {
    const { result } = harness("/c");
    act(() => result.current.suggest.onFocus());
    expect(result.current.suggest.open).toBe(true);

    const fresh = harness();
    act(() => fresh.result.current.suggest.onDraftChange("/c"));
    expect(fresh.result.current.suggest.open).toBe(true);
  });

  it("closes as soon as the draft stops being a slash line", () => {
    const { result } = harness();
    act(() => result.current.suggest.onDraftChange("/c"));
    act(() => result.current.suggest.onDraftChange("hello"));
    expect(result.current.suggest.open).toBe(false);
  });

  it("leaving the field disarms it; coming back re-arms", () => {
    const { result } = harness();
    act(() => result.current.suggest.onDraftChange("/c"));
    act(() => result.current.suggest.onBlur());
    expect(result.current.suggest.open).toBe(false);
    act(() => result.current.suggest.onFocus());
    expect(result.current.suggest.open).toBe(true);
  });

  it("opening the popover collapses the plan sheet (one-way overlay rule)", () => {
    const { result } = harness();
    act(() => setPlanSheetOpen(true));
    expect(result.current.planOpen).toBe(true);
    act(() => result.current.suggest.onDraftChange("/c"));
    expect(result.current.suggest.open).toBe(true);
    expect(result.current.planOpen).toBe(false);
  });
});

describe("useComposerSuggest — keyboard", () => {
  it("ArrowDown/ArrowUp move the active row and wrap", () => {
    const { result } = harness();
    act(() => result.current.suggest.onDraftChange("/c"));
    const n = result.current.suggest.items.length;
    expect(n).toBeGreaterThan(1);
    expect(result.current.suggest.activeIndex).toBe(0);

    act(() => result.current.suggest.onKeyDown(key("ArrowDown")));
    expect(result.current.suggest.activeIndex).toBe(1);
    act(() => result.current.suggest.onKeyDown(key("ArrowUp")));
    act(() => result.current.suggest.onKeyDown(key("ArrowUp")));
    expect(result.current.suggest.activeIndex).toBe(n - 1); // wrapped past the top
  });

  it("Enter accepts the active row: the token is replaced and a trailing space appended", () => {
    const { result, base } = harness();
    act(() => result.current.suggest.onDraftChange("/cle"));
    act(() => result.current.suggest.onKeyDown(key("Enter")));
    expect(result.current.draft).toBe("/clear ");
    expect(base).not.toHaveBeenCalled(); // the popover beat the send handler
  });

  it("Tab accepts too; Shift+Tab falls through (focus must still leave the field)", () => {
    const { result, base } = harness();
    act(() => result.current.suggest.onDraftChange("/cle"));
    act(() => result.current.suggest.onKeyDown(key("Tab")));
    expect(result.current.draft).toBe("/clear ");

    act(() => result.current.suggest.onDraftChange("/cle"));
    act(() => result.current.suggest.onKeyDown(key("Tab", { shiftKey: true })));
    expect(result.current.draft).toBe("/cle");
    expect(base).toHaveBeenCalled();
  });

  it("accepting a verb that takes a second token chains straight into its list", () => {
    const { result } = harness();
    act(() => result.current.suggest.onDraftChange("/pri"));
    act(() => result.current.suggest.onKeyDown(key("Enter")));
    expect(result.current.draft).toBe("/privilege ");
    expect(result.current.suggest.open).toBe(true);
    expect(result.current.suggest.items.map((i) => i.kind)).toEqual([
      "privilege",
      "privilege",
      "privilege",
      "privilege",
    ]);
  });

  it("Esc dismisses (preventDefault + stopPropagation — the cooperative-dismiss contract) and typing re-opens", () => {
    const { result, base } = harness();
    act(() => result.current.suggest.onDraftChange("/c"));
    const esc = key("Escape");
    act(() => result.current.suggest.onKeyDown(esc));
    expect(result.current.suggest.open).toBe(false);
    expect(esc.preventDefault).toHaveBeenCalled();
    expect(esc.stopPropagation).toHaveBeenCalled();
    expect(base).not.toHaveBeenCalled();

    act(() => result.current.suggest.onDraftChange("/cl"));
    expect(result.current.suggest.open).toBe(true);
  });

  // Codex, v1.3.2 fix wave — the latch is scoped to the VISIT it was pressed in. Leaving the field and
  // coming back is the same gesture as focusing a fresh composer, and that opens.
  it("the Esc latch clears on refocus: Esc → blur → focus reopens", () => {
    const { result } = harness();
    act(() => result.current.suggest.onDraftChange("/c"));
    act(() => result.current.suggest.onKeyDown(key("Escape")));
    expect(result.current.suggest.open).toBe(false);

    act(() => result.current.suggest.onBlur());
    act(() => result.current.suggest.onFocus());
    expect(result.current.suggest.open).toBe(true);
  });

  it("Enter with the popover closed falls through to the send handler", () => {
    const { result, base } = harness();
    act(() => result.current.suggest.onKeyDown(key("Enter")));
    expect(base).toHaveBeenCalledTimes(1);

    act(() => result.current.suggest.onDraftChange("wake the vault"));
    act(() => result.current.suggest.onKeyDown(key("Enter")));
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("Enter mid-IME-composition neither accepts nor sends", () => {
    const { result, base } = harness();
    act(() => result.current.suggest.onDraftChange("/cle"));
    const enter = key("Enter", { composing: true });
    act(() => result.current.suggest.onKeyDown(enter));
    expect(result.current.draft).toBe("/cle"); // not accepted
    expect(base).not.toHaveBeenCalled(); // and not sent
    expect(enter.preventDefault).not.toHaveBeenCalled(); // the input method keeps the keystroke
  });
});

// Codex, v1.3.2 fix wave — a fully typed verb that SHARES its prefix with a longer candidate (built-in
// `clear` + skill `clear-cache`) used to be accepted by Enter instead of sent. The rule is about the
// ACTIVE row, so it also covers the sole-candidate case the grammar used to special-case.
describe("useComposerSuggest — Enter on an already-complete verb", () => {
  const loadSkillSet = async (names: string[]) => {
    globalThis.fetch = vi.fn((url: RequestInfo | URL) =>
      String(url).includes("/api/skills")
        ? Promise.resolve({
            ok: true,
            json: () => Promise.resolve(names.map((name) => ({ name }))),
          } as Response)
        : Promise.resolve({ ok: false } as Response),
    );
    await loadSkills();
  };
  beforeEach(async () => {
    await loadSkillSet(["clear-cache"]);
  });
  afterEach(async () => {
    await loadSkillSet([]); // the verb sets are module state — hand the next describe an empty one
  });

  it("Enter falls through to send when the active row is exactly what's typed; Tab still accepts", () => {
    const { result, base } = harness();
    act(() => result.current.suggest.onDraftChange("/clear"));
    expect(result.current.suggest.items.map((i) => i.value)).toEqual(["clear", "clear-cache"]);
    expect(result.current.suggest.open).toBe(true); // the exact row is still LISTED — `clear-cache` needs it

    act(() => result.current.suggest.onKeyDown(key("Enter")));
    expect(result.current.draft).toBe("/clear"); // not re-inserted
    expect(base).toHaveBeenCalledTimes(1); // the send handler got the keystroke

    act(() => result.current.suggest.onKeyDown(key("Tab")));
    expect(result.current.draft).toBe("/clear "); // Tab is the explicit completion key
  });

  it("arrow-selecting the longer row makes it non-exact again → Enter accepts", () => {
    const { result, base } = harness();
    act(() => result.current.suggest.onDraftChange("/clear"));
    act(() => result.current.suggest.onKeyDown(key("ArrowDown")));
    act(() => result.current.suggest.onKeyDown(key("Enter")));
    expect(result.current.draft).toBe("/clear-cache ");
    expect(base).not.toHaveBeenCalled();
  });

  it("a SOLE fully-typed candidate falls through the same way (one rule, no special case)", () => {
    const { result, base } = harness();
    act(() => result.current.suggest.onDraftChange("/compact"));
    expect(result.current.suggest.items.map((i) => i.value)).toEqual(["compact"]);
    act(() => result.current.suggest.onKeyDown(key("Enter")));
    expect(result.current.draft).toBe("/compact");
    expect(base).toHaveBeenCalledTimes(1);
  });
});

describe("SuggestPopover in a real Kit composer", () => {
  beforeEach(() => {
    clearDraft();
    localStorage.clear();
  });
  afterEach(cleanup); // globals:false → register RTL cleanup explicitly

  const renderComposer = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(createElement(QueryClientProvider, { client: qc }, createElement(KitComposer)));
  };

  it("typing a `/verb` opens a listbox above the composer with the APG combobox wiring", () => {
    const { container } = renderComposer();
    const ta = container.querySelector<HTMLTextAreaElement>("#cmd-input")!;
    // ARIA-in-HTML allows NO role override on `<textarea>` (implicit `textbox`), and `aria-expanded` is
    // not supported on `textbox` — so neither is emitted (Codex, v1.3.2 fix wave). The three attributes
    // that ARE valid on a textbox carry the pattern, and only while the popover is open.
    expect(ta.getAttribute("role")).toBeNull();
    expect(ta.getAttribute("aria-expanded")).toBeNull();
    expect(ta.getAttribute("aria-autocomplete")).toBe("list");
    expect(ta.getAttribute("aria-controls")).toBeNull();
    expect(ta.getAttribute("aria-activedescendant")).toBeNull();

    fireEvent.change(ta, { target: { value: "/c" } });
    const list = container.querySelector("ul#composer-suggest");
    expect(list?.getAttribute("role")).toBe("listbox");
    const opts = container.querySelectorAll("#composer-suggest [role=option]");
    expect(opts.length).toBeGreaterThan(1);
    expect(ta.getAttribute("role")).toBeNull();
    expect(ta.getAttribute("aria-expanded")).toBeNull();
    expect(ta.getAttribute("aria-controls")).toBe("composer-suggest");
    expect(ta.getAttribute("aria-activedescendant")).toBe(opts[0]?.id);
    expect(opts[0]?.getAttribute("aria-selected")).toBe("true");

    // the popover is a SIBLING rendered BEFORE the bar (kit.css floats it above the composer's top edge)
    const kids = Array.from(container.childNodes);
    const listIdx = kids.findIndex((n) => (n as Element).id === "composer-suggest");
    const barIdx = kids.findIndex((n) => (n as Element).id === "composer");
    expect(listIdx).toBeGreaterThanOrEqual(0);
    expect(barIdx).toBeGreaterThan(listIdx);
  });

  it("tapping a row accepts it (pointerdown, before the field can blur) and writes the draft store", () => {
    const { container } = renderComposer();
    const ta = container.querySelector<HTMLTextAreaElement>("#cmd-input")!;
    fireEvent.change(ta, { target: { value: "/cle" } });
    const opt = container.querySelector<HTMLElement>("#composer-suggest [role=option]")!;
    fireEvent.pointerDown(opt);
    expect(getDraft()).toBe("/clear ");
    expect(ta.value).toBe("/clear ");
  });
});
