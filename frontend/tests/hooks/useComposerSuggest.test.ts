import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { createElement, useState, type KeyboardEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useComposerSuggest } from "../../src/hooks/useComposerSuggest";
import { loadSkills } from "../../src/lib/composer";
import { clearDraft, getDraft } from "../../src/store/composer";
import { getComposerOverlay, setComposerOverlay } from "../../src/store/composerOverlay";
import { setPlanSheetOpen, usePlanSheetOpen } from "../../src/store/planSheet";
import { setUI } from "../../src/store/ui";
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
  const { result, unmount } = renderHook(() => {
    const [draft, setDraft] = useState(initialDraft);
    const suggest = useComposerSuggest({ draft, setDraft, onKeyDown: base });
    return { draft, suggest, planOpen: usePlanSheetOpen() };
  });
  return { result, base, unmount };
}

/** Install a skills set through the REAL loader — the verb sets are private module state, so the only way
 *  in is the fetch the loader makes. `[]` hands the next describe an empty one back. */
async function loadSkillSet(names: string[]) {
  globalThis.fetch = vi.fn((url: RequestInfo | URL) =>
    String(url).includes("/api/skills")
      ? Promise.resolve({
          ok: true,
          json: () => Promise.resolve(names.map((name) => ({ name }))),
        } as Response)
      : Promise.resolve({ ok: false } as Response),
  );
  await loadSkills();
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

  // Codex, verify round — the claim used to key off the WANT transition alone, so a displacement was
  // permanent: the menu takes the slot, `wantOpen` never changes (still armed, still a `/verb`), and no
  // amount of typing brought the popover back for the rest of the composer's life.
  it("a displacement keeps the popover down — and the NEXT keystroke re-claims the slot", () => {
    const { result } = harness();
    act(() => result.current.suggest.onDraftChange("/c"));
    expect(result.current.suggest.open).toBe(true);

    act(() => setComposerOverlay("menu")); // the tools menu (or the plan sheet) takes the slot
    expect(result.current.suggest.open).toBe(false);
    expect(getComposerOverlay()).toBe("menu"); // …and the popover does NOT fight back on the next render

    act(() => result.current.suggest.onDraftChange("/cl"));
    expect(result.current.suggest.open).toBe(true);
    expect(getComposerOverlay()).toBe("suggest");
  });

  it("hands the slot back on unmount (the release now lives in its own effect)", () => {
    const { result, unmount } = harness();
    act(() => result.current.suggest.onDraftChange("/c"));
    expect(getComposerOverlay()).toBe("suggest");
    unmount();
    expect(getComposerOverlay()).toBe(null);
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

// Codex, verify round — "fully typed" is CASE-SENSITIVE for skills only. Skill names are free-form
// server-side, so `Ops` and `OPS` are two real, separately-routable skills (lib/composer's bucket map);
// a typed `/ops` matches NEITHER by exact name, and `resolveSkill` refuses to guess between them.
describe("useComposerSuggest — case-only skill siblings", () => {
  beforeEach(async () => {
    await loadSkillSet(["Ops", "OPS"]);
  });
  afterEach(async () => {
    await loadSkillSet([]);
  });

  it("a typed FOLD is not the canonical row: Enter accepts it instead of sending an ambiguous verb", () => {
    const { result, base } = harness();
    act(() => result.current.suggest.onDraftChange("/ops"));
    expect(result.current.suggest.items.map((i) => i.value)).toEqual(["Ops", "OPS"]);
    act(() => result.current.suggest.onKeyDown(key("Enter")));
    expect(result.current.draft).toBe("/Ops "); // sending `/ops` would have been "unknown command"
    expect(base).not.toHaveBeenCalled();
  });

  it("arrowing onto the sibling accepts THAT canonical", () => {
    const { result } = harness();
    act(() => result.current.suggest.onDraftChange("/ops"));
    act(() => result.current.suggest.onKeyDown(key("ArrowDown")));
    act(() => result.current.suggest.onKeyDown(key("Enter")));
    expect(result.current.draft).toBe("/OPS ");
  });

  it("the EXACT canonical is fully typed and falls through to send (the router matches it by name)", () => {
    const { result, base } = harness();
    act(() => result.current.suggest.onDraftChange("/Ops"));
    act(() => result.current.suggest.onKeyDown(key("Enter")));
    expect(result.current.draft).toBe("/Ops");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("the other kinds stay case-INSENSITIVE: `/CLEAR` is a fully-typed built-in and sends", () => {
    const { result, base } = harness();
    act(() => result.current.suggest.onDraftChange("/CLEAR"));
    expect(result.current.suggest.items.map((i) => i.value)).toEqual(["clear"]);
    act(() => result.current.suggest.onKeyDown(key("Enter")));
    expect(result.current.draft).toBe("/CLEAR"); // routing lowercases the verb — nothing to complete
    expect(base).toHaveBeenCalledTimes(1);
  });
});

describe("SuggestPopover in a real Kit composer", () => {
  beforeEach(() => {
    clearDraft();
    localStorage.clear();
    setComposerOverlay(null);
    setUI({ motion: "full" }); // the retention path depends on it — one case flips it to `reduced`
  });
  afterEach(cleanup); // globals:false → register RTL cleanup explicitly

  /** The VALUES the popover currently renders — identity, not just a count: the retained set must be the
   *  rows that were there, and a reopen must show the new query's rows rather than the stale ones. */
  const rowValues = (c: HTMLElement) =>
    Array.from(c.querySelectorAll("#composer-suggest [role=option] .sg-val")).map(
      (n) => n.textContent,
    );

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

  // 2026-07-30 — the popover STAYS MOUNTED and toggles `.open` so its CLOSE animates (the plan-sheet
  // idiom); `inert` is what keeps the closed shell out of tab order + the a11y tree. Accepting a row
  // empties the completion list in the same frame, so the closing render RETAINS the last row set —
  // otherwise the exit slide would play on a bare 8px shell.
  it("closing leaves it mounted-but-inert, with the last rows retained for the exit slide", () => {
    const { container } = renderComposer();
    const ta = container.querySelector<HTMLTextAreaElement>("#cmd-input")!;
    const list = () => container.querySelector<HTMLElement>("ul#composer-suggest")!;

    expect(list()).not.toBe(null); // mounted from the first render…
    expect(list().classList.contains("open")).toBe(false); // …but closed
    expect(list().hasAttribute("inert")).toBe(true);
    expect(list().getAttribute("aria-hidden")).toBe(null); // inert ALONE — never both

    fireEvent.change(ta, { target: { value: "/cle" } });
    expect(list().classList.contains("open")).toBe(true);
    expect(list().hasAttribute("inert")).toBe(false);
    const rows = rowValues(container);
    expect(rows).toEqual(["clear"]);

    fireEvent.keyDown(ta, { key: "Escape" }); // dismiss — the popover closes, the draft stays
    expect(list().classList.contains("open")).toBe(false);
    expect(list().hasAttribute("inert")).toBe(true);
    expect(rowValues(container)).toEqual(rows); // the SAME rows, by value — not just the same count
    // …and the textarea drops its combobox wiring the moment it closes (nothing points at an inert list)
    expect(ta.getAttribute("aria-controls")).toBeNull();
    expect(ta.getAttribute("aria-activedescendant")).toBeNull();
  });

  // Codex, LOW — retained rows must not outlive the exit, or every later composer render reconciles them
  // (a per-keystroke cost on Fennec with a big discovered registry). The shell's own opacity `transitionend`
  // is the release.
  it("releases the retained rows when the exit transition ends", () => {
    const { container } = renderComposer();
    const ta = container.querySelector<HTMLTextAreaElement>("#cmd-input")!;
    fireEvent.change(ta, { target: { value: "/cle" } });
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(rowValues(container)).toEqual(["clear"]); // retained through the slide

    const list = container.querySelector<HTMLElement>("ul#composer-suggest")!;
    fireEvent.transitionEnd(list, { propertyName: "transform" }); // the other leg releases NOTHING
    expect(rowValues(container)).toEqual(["clear"]);
    fireEvent.transitionEnd(list, { propertyName: "opacity" });
    expect(rowValues(container)).toEqual([]); // …and the closed shell now reconciles zero rows
  });

  // Codex verify round, LOW — the LATE displacement: the popover closes normally (a slide IS running, so
  // the close edge deliberately retained), and only THEN does another overlay open. kit.css's handoff snap
  // flips this shell to `transition: none`, which KILLS the running fade — `transitionend` never arrives
  // and the close-edge release was already spent, so the rows used to live forever. `transitioncancel` is
  // the platform's signal for exactly that kill, and it releases through the same handler.
  it("releases them when a LATE displacement cancels the running exit transition", () => {
    const { container } = renderComposer();
    const ta = container.querySelector<HTMLTextAreaElement>("#cmd-input")!;
    fireEvent.change(ta, { target: { value: "/cle" } });
    fireEvent.keyDown(ta, { key: "Escape" }); // a normal close — the slide starts, rows retained
    expect(rowValues(container)).toEqual(["clear"]);

    const list = container.querySelector<HTMLElement>("ul#composer-suggest")!;
    act(() => setComposerOverlay("menu")); // …and INSIDE the exit window, another overlay opens
    expect(rowValues(container)).toEqual(["clear"]); // still retained — no event has fired yet
    fireEvent.transitionCancel(list, { propertyName: "transform" }); // the other leg releases NOTHING
    expect(rowValues(container)).toEqual(["clear"]);
    fireEvent.transitionCancel(list, { propertyName: "opacity" }); // the snap killed the fade
    expect(rowValues(container)).toEqual([]);
    // a stray trailing event on the already-released shell is a no-op, not a crash or a re-render loop
    fireEvent.transitionEnd(list, { propertyName: "opacity" });
    expect(rowValues(container)).toEqual([]);
  });

  // …and where there is NO transition to wait for, the release is synchronous: `transitionend` never fires
  // under `transition: none`, so keying the release on it alone would leak the rows for the session.
  it("releases them synchronously under reduced motion (no transition, no transitionend)", () => {
    setUI({ motion: "reduced" });
    const { container } = renderComposer();
    const ta = container.querySelector<HTMLTextAreaElement>("#cmd-input")!;
    fireEvent.change(ta, { target: { value: "/cle" } });
    expect(rowValues(container)).toEqual(["clear"]);
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(rowValues(container)).toEqual([]); // released at the close edge, no transitionend needed
  });

  // The same synchronous path when ANOTHER overlay displaces us: kit.css snaps a displaced overlay out
  // (it must not ghost over the incoming panel), so again there is no transitionend coming.
  it("releases them synchronously when another composer overlay takes the slot", () => {
    const { container } = renderComposer();
    const ta = container.querySelector<HTMLTextAreaElement>("#cmd-input")!;
    fireEvent.change(ta, { target: { value: "/cle" } });
    expect(rowValues(container)).toEqual(["clear"]);
    act(() => setComposerOverlay("plan")); // the plan sheet claims the space
    expect(container.querySelector("ul#composer-suggest")!.classList.contains("open")).toBe(false);
    expect(rowValues(container)).toEqual([]);
  });

  // Reopening must show the NEW query's rows immediately — the retained set is a closing artifact only.
  it("a reopen renders the new query's rows, never the retained ones", () => {
    const { container } = renderComposer();
    const ta = container.querySelector<HTMLTextAreaElement>("#cmd-input")!;
    fireEvent.change(ta, { target: { value: "/cle" } });
    expect(rowValues(container)).toEqual(["clear"]);
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(rowValues(container)).toEqual(["clear"]); // retained while closing

    fireEvent.change(ta, { target: { value: "/comp" } }); // typing re-arms the popover
    expect(container.querySelector("ul#composer-suggest")!.classList.contains("open")).toBe(true);
    expect(rowValues(container)).toEqual(["compact"]);
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
