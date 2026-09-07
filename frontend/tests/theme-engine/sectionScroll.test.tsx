import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PER-SECTION SCROLL RESTORATION (owner ask, 2026-08-06) — DefaultRoot's section-switch effect.
//
// The shell has ONE scroller for every section body, so "where you were" is only meaningful together with
// the section it was measured in. What must hold, and why each claim is load-bearing:
//  · a section you return to lands where you left it — the whole feature;
//  · a section you have not visited lands at the TOP — the previous behaviour, and what a fresh boot gets;
//  · the AGENT section is never scrolled by the Root — it sticks its own thread to the bottom, and a Root
//    that positioned it would fight ChatThread;
//  · a pending scroll-to-group handoff still WINS — the deep-link path (`openConfGroup`, the coerced
//    hosted navigate) is a child effect that runs BEFORE this parent one, so an unguarded restore would
//    cancel it exactly as the old unguarded reset-to-top did;
//  · a LAYOUT switch drops every stored offset — the presets re-shape the page under the same section ids
//    (utils becomes a group inside Conf), so the offsets are into a document that no longer exists.
//
// jsdom shims, per the house convention: ResizeObserver (the shell measures with it) and `scrollTo`, which
// jsdom does not implement — here it RECORDS the call and applies it, so both "what did the Root ask for"
// and "where did the scroller end up" are observable. jsdom fires no scroll events of its own (it has no
// layout), so the passive listener is driven with an explicit `fireEvent.scroll`.

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
const scrollCalls: [number, number][] = [];
Element.prototype.scrollTo = function (this: Element, x: number, y: number) {
  scrollCalls.push([x, y]);
  (this as HTMLElement).scrollTop = y;
} as typeof Element.prototype.scrollTo;
Element.prototype.scrollIntoView = vi.fn();

import { clearGroupScrollTarget, setGroupScrollTarget } from "../../src/store/groupScroll";
import { setUI } from "../../src/store/ui";
import { DefaultRoot } from "../../src/theme-engine/kit/DefaultRoot";

/** Mount the kit shell and hand back its scroller. `minimal` is the theme so the resolved section layout is
 *  the plain 4-tab preset: fleet + utils are both on-bar, unhosted and EAGER, which keeps every arm below
 *  off the lazy Conf chunk (Conf's own restoration is driven for real in `e2e/layout.spec.ts`). */
function draw(): HTMLElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <DefaultRoot />
    </QueryClientProvider>,
  );
  const scroller = container.querySelector<HTMLElement>("#app-scroll")!;
  // `useScrollKeep` is a MODULE slot: the previous test's unmount saved its scroller position into it, and
  // this mount just restored it (consuming the one-run skip). Normalise to a known 0 so each arm below
  // starts from the same place — and record it, which is what a real scroll would have done.
  act(() => {
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
  });
  scrollCalls.length = 0;
  return scroller;
}

/** Scroll the pane like a finger would: move it, then let the passive listener see it. */
function scrollTo(el: HTMLElement, y: number): void {
  act(() => {
    el.scrollTop = y;
    fireEvent.scroll(el);
  });
}

const go = (tab: string) => act(() => setUI({ tab: tab as never }));

beforeEach(() => {
  clearGroupScrollTarget();
  setUI({
    theme: "minimal",
    tab: "fleet",
    layout: "auto",
    appbarMode: "visible",
    sectionPlacement: {},
  });
});
afterEach(() => {
  cleanup();
  clearGroupScrollTarget();
});

describe("DefaultRoot — per-section scroll restoration", () => {
  it("returns each section to where it was left, and opens an unvisited one at the top", () => {
    const scroller = draw();
    scrollTo(scroller, 240);

    go("utils"); // never visited → the top, exactly as the old reset-to-top gave
    expect(scroller.scrollTop).toBe(0);
    scrollTo(scroller, 90);

    go("fleet"); // …and back to where fleet was left, not to the top
    expect(scroller.scrollTop).toBe(240);

    go("utils");
    expect(scroller.scrollTop).toBe(90);
  });

  it("keeps a stored offset per SECTION, not per switch (the map is not a single last-position)", () => {
    const scroller = draw();
    scrollTo(scroller, 300);
    go("utils");
    scrollTo(scroller, 45);
    go("agent");
    go("fleet");
    expect(scroller.scrollTop).toBe(300); // fleet's own, not utils's 45 and not agent's whatever
    go("utils");
    expect(scroller.scrollTop).toBe(45);
  });

  it("never positions the AGENT section — it owns its own thread scroll", () => {
    const scroller = draw();
    scrollTo(scroller, 300);
    scrollCalls.length = 0;
    go("agent");
    expect(scrollCalls).toEqual([]); // no scrollTo at all: not a restore, not a reset
    // …and the pane still MOVES, because ChatThread pins its thread to the bottom the moment the section
    // goes active (`el.scrollTop = el.scrollHeight`, an empty thread in jsdom → 0). That is the whole
    // reason the Root keeps its hands off this one.
  });

  it("yields to a pending scroll-to-group handoff (the deep-link path still lands)", () => {
    const scroller = draw();
    scrollTo(scroller, 180);
    // Armed by `useSections.navigate`/`openConfGroup` in the real flow; the guard is what stops this
    // parent effect — which runs AFTER the host body's child effect — from cancelling that scroll.
    act(() => setGroupScrollTarget("utils-hosted"));
    scrollCalls.length = 0;
    go("utils");
    expect(scrollCalls).toEqual([]);
  });

  it("drops every stored offset when the section LAYOUT changes", () => {
    const scroller = draw();
    scrollTo(scroller, 260);
    go("agent"); // park somewhere unaffected by the preset change (fleet + agent are on-bar in both)
    act(() => setUI({ layout: "3-tab" })); // utils leaves the bar → the page it was measured on is gone
    go("fleet");
    expect(scroller.scrollTop).toBe(0); // the stored 260 was dropped, so the switch lands at the top
    expect(scrollCalls.at(-1)).toEqual([0, 0]);
  });

  // D70 §8.4a MED-1 — a SATELLITE PLACEMENT flip reshapes both documents under an UNCHANGED preset id
  // (the gallery becomes a group inside Conf, which lengthens Conf and empties the gallery's own page),
  // so the clear has to key on the placement as well as on `sectionLayout`. Before the fold it did not,
  // and every stored offset survived into a page that no longer had those pixels.
  it("drops every stored offset when a SATELLITE PLACEMENT changes (the preset id never moves)", () => {
    setUI({ sectionPlacement: { agents: "button" } });
    const scroller = draw();
    scrollTo(scroller, 260);
    go("agent"); // park on a section neither placement touches
    act(() => setUI({ sectionPlacement: { agents: "conf" } }));
    go("fleet");
    expect(scroller.scrollTop).toBe(0);
    expect(scrollCalls.at(-1)).toEqual([0, 0]);
  });

  it("…and the clear key is STABLE: an unrelated re-render does NOT wipe the map (the rider)", () => {
    // The confirm-round rider: keying the clear on a freshly-allocated composition OBJECT would fire it
    // every commit and silently retire per-section restoration altogether. `agent` is not a satellite, so
    // toggling an unrelated lever must leave fleet's stored offset intact.
    const scroller = draw();
    scrollTo(scroller, 260);
    go("agent");
    act(() => setUI({ ttsAuto: false })); // any unrelated store change → an extra commit
    go("fleet");
    expect(scroller.scrollTop).toBe(260);
  });
});
