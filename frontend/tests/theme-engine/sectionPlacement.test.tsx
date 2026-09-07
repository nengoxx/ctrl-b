import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SATELLITE PLACEMENT — the owner's EXCLUSIVITY constraint, driven end to end (D70 §8.4a, the folded
// Emma LOW): "never in two places". One parameterized guard rather than a case per surface, because the
// claim is a property of every state and not of any one of them:
//
//   for each of `conf` | `button` | `tab`, plus a MALFORMED persisted value, `minimal` + `tab`, a deep
//   boot standing on the gallery, and one LIVE flip while standing on it —
//     · EXACTLY ONE gallery marker exists in the document, and
//     · the nav affordance is the one that state implies.
//
// It mounts the REAL kit shell (DefaultRoot) with Conf ALREADY LATCHED, so both possible homes are
// mounted at once: the standalone `#tab-agents` panel the shell renders, and the `#agents-hosted`
// ConfGroup ConfTab renders. Nothing here mocks `useSections`, `layout.ts` or either tab — the whole
// point is that the composition, the partition, the body mount and Conf's hosting decision agree.
//
// jsdom shims, per the house convention: the shell measures with ResizeObserver and positions the
// scroller; jsdom implements neither. `fetch` is refused so every TanStack query resolves to its error
// state (data `undefined`) — the fresh-install shape each surface already renders.

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
vi.stubGlobal(
  "fetch",
  vi.fn(() => Promise.reject(new Error("offline"))),
);
Element.prototype.scrollTo = vi.fn();
Element.prototype.scrollIntoView = vi.fn();

import { getUI, setUI, type AppbarMode } from "../../src/store/ui";
import { clearGroupScrollTarget } from "../../src/store/groupScroll";
import { DefaultRoot } from "../../src/theme-engine/kit/DefaultRoot";
import type { SectionPlacement } from "../../src/theme-engine/types";

/** The gallery's own marker — the card grid `AgentsContent` renders, which is the ONE body both homes
 *  mount (the standalone tab and the hosted ConfGroup share it, exactly as UtilsContent is shared). */
const GRID = ".agal-grid";

/** Mount the shell with Conf latched: Conf is a `lazy` section, so it only mounts after first becoming
 *  active — and the guard needs it mounted in EVERY state, or "not in two places" would be trivially
 *  true wherever Conf simply is not on screen. Boot on conf, wait for its chunk, then move to `tab`. */
async function draw(tab: string, appbarMode: AppbarMode = "visible"): Promise<HTMLElement> {
  setUI({ tab: "conf" });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      {/* The chrome mode is a PROP the theme's own Root reads off the store and hands down — the store
          value alone drives only the partition, so both halves have to be set together here. */}
      <DefaultRoot appbarMode={appbarMode} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(container.querySelector("#appearance")).not.toBeNull());
  if (tab !== "conf") await act(async () => setUI({ tab: tab as never }));
  return container;
}

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
afterEach(cleanup);

describe("satellite placement — exactly one home, in every state", () => {
  // The parameterized core. `lever` is what is PERSISTED (including a value this build doesn't know);
  // `home` is where the one marker must be; `bar`/`menu` are the nav affordances that state implies.
  const CASES: {
    name: string;
    lever: SectionPlacement | undefined;
    ui?: { appbarMode?: "visible" | "minimal" };
    tab: string;
    home: "#agents-hosted" | "#tab-agents";
    onBar: boolean;
    affordance: "none" | "docked" | "floating";
  }[] = [
    {
      name: "conf (the DEFAULT — hidden by default, like the tools tab)",
      lever: undefined,
      tab: "conf",
      home: "#agents-hosted",
      onBar: false,
      affordance: "none",
    },
    {
      name: "a MALFORMED persisted value heals to the default",
      lever: "sidebar" as never,
      tab: "conf",
      home: "#agents-hosted",
      onBar: false,
      affordance: "none",
    },
    {
      name: "button (the S4 as-built state) — off-bar, the affordance docks into the app bar",
      lever: "button",
      tab: "agents",
      home: "#tab-agents",
      onBar: false,
      affordance: "docked",
    },
    {
      name: "tab — promoted onto the bar, out of both other buckets",
      lever: "tab",
      tab: "agents",
      home: "#tab-agents",
      onBar: true,
      affordance: "none",
    },
    {
      name: "minimal + tab — the effective bar is [], so the promotion degrades to the menu",
      lever: "tab",
      ui: { appbarMode: "minimal" },
      tab: "agents",
      home: "#tab-agents",
      onBar: false,
      affordance: "floating",
    },
  ];

  for (const c of CASES) {
    it(c.name, async () => {
      setUI({ sectionPlacement: { agents: c.lever }, ...c.ui });
      const container = await draw(c.tab, c.ui?.appbarMode);

      // ① EXACTLY ONE gallery, and it is in the home this placement names.
      const grids = container.querySelectorAll(GRID);
      expect(grids).toHaveLength(1);
      expect(container.querySelector(c.home)?.contains(grids[0])).toBe(true);
      // …and the other home is not merely empty, it is not mounted (a hosted section renders inside its
      // host, never standalone; an unhosted one has no ConfGroup).
      const other = c.home === "#tab-agents" ? "#agents-hosted" : "#tab-agents";
      expect(container.querySelector(other)).toBeNull();

      // ② the nav affordances this state implies.
      expect(container.querySelector("#tabbtn-agents") !== null).toBe(c.onBar);
      expect(container.querySelectorAll(".navmenu .navmenu-launch")).toHaveLength(
        c.affordance === "none" ? 0 : 1,
      );
      if (c.affordance !== "none") {
        expect(container.querySelector(".navmenu.docked") !== null).toBe(c.affordance === "docked");
      }
    });
  }

  it("a MALFORMED persisted MAP (`sectionPlacement: null`) still renders Conf", async () => {
    // The value-level half of that story heals in `resolvePlacement` (the case above); the MAP itself is
    // the other half — the persist loader's field-fill merge passes a stored `null` straight through, and
    // `composeLayout` already guards it with one typeof check. Conf reads the raw map too (its Appearance
    // row shows the RESOLVED value), so it needs the same posture or the DEFAULT gallery home crashes on
    // the deref before a pixel paints — on the one tab the owner would go to in order to fix it.
    setUI({ sectionPlacement: null as never });
    const container = await draw("conf");
    expect(container.querySelectorAll(GRID)).toHaveLength(1);
    expect(container.querySelector("#agents-hosted")?.querySelector(GRID)).not.toBeNull();
  });

  it("the Appearance row is the CONTROL: picking Tab promotes the gallery, live", async () => {
    // The row sits directly under Layout (the two together are the one "where do my sections live"
    // control) and writes the device-local lever. Driven through the real seg, so what is pinned is
    // the whole path: click → `setUI` → `composeLayout` → the partition → the rendered bar.
    const container = await draw("conf");
    const seg = container.querySelector<HTMLElement>("[role='group'][aria-label='Agents']")!;
    const opt = (name: string) =>
      [...seg.querySelectorAll("button")].find((b) => b.textContent === name)!;
    // It opens on the RESOLVED value, not on the raw (absent) lever.
    expect(opt("Conf").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("#agents-hosted")).not.toBeNull();

    await act(async () => opt("Tab").click());
    expect(getUI().sectionPlacement).toEqual({ agents: "tab" });
    await waitFor(() => expect(container.querySelector("#tabbtn-agents")).not.toBeNull());
    expect(container.querySelector("#agents-hosted")).toBeNull(); // out of Conf, in one move
    // …and NOWHERE yet: the section is `lazy`, so its standalone body mounts on first activation (the
    // generalized latch), which is the tab button's job. One tap, one gallery.
    expect(container.querySelectorAll(GRID)).toHaveLength(0);
    await act(async () => container.querySelector<HTMLElement>("#tabbtn-agents")!.click());
    await waitFor(() => expect(container.querySelectorAll(GRID)).toHaveLength(1));
    expect(container.querySelector("#tab-agents")?.querySelector(GRID)).not.toBeNull();
  });

  it("a DEEP BOOT standing on a conf-placed gallery coerces to Conf at the same chokepoint", async () => {
    // The persisted tab is the gallery, but its placement hosts it — DefaultRoot's coercion effect routes
    // through `navigate`, which lands on the host. Exactly the existing stale-tab behaviour, now also
    // driven by a placement rather than only by a preset.
    setUI({ sectionPlacement: {}, tab: "agents" });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <DefaultRoot />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(getUI().tab).toBe("conf"));
    await waitFor(() => expect(container.querySelector("#agents-hosted")).not.toBeNull());
    expect(container.querySelectorAll(GRID)).toHaveLength(1);
    expect(container.querySelector("#tab-agents")).toBeNull();
  });

  it("a LIVE flip to conf while standing on the gallery lands in Conf, still with one gallery", async () => {
    setUI({ sectionPlacement: { agents: "button" } });
    const container = await draw("agents");
    expect(container.querySelector("#tab-agents")).not.toBeNull();

    await act(async () => setUI({ sectionPlacement: { agents: "conf" } }));
    await waitFor(() => expect(getUI().tab).toBe("conf")); // the coercion effect, keyed on the placement
    expect(container.querySelectorAll(GRID)).toHaveLength(1);
    expect(container.querySelector("#agents-hosted")?.querySelector(GRID)).not.toBeNull();
    expect(container.querySelector("#tab-agents")).toBeNull();
  });
});
