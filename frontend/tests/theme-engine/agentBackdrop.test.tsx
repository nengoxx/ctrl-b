import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { cssRules } from "../themes/cssRules";

// THE AGENT BACKDROP (D70 §8.3, narrowed by §8.3a) — one appearance mode, three states, one layer.
//
// Written to `kitBackground.test.tsx`'s template, because the claim has the same shape: an art layer whose
// whole contract is WHEN IT EXISTS. So every arm below runs POPULATED — a real background bound to the
// resolved default agent, served by a real media index — and asks whether a layer appears:
//
//   · the MODE × ART matrix          — `AgentTab` (the body cosmos, vapor and minimal all render);
//   · the five shipped themes        — every Root, rendered for real: the three kit themes take the shared
//                                      layer, gacha paints through its own oracle (its body's own suite
//                                      owns that ladder), frontier is untouched by ruling 18;
//   · the `full` DRIVER              — mounted in a modelled `#app-scroll`, the gachaAgent.test harness.
//
// What is NOT here, deliberately: the z-index LIFT and the perf/motion gates are pure CSS keyed on
// `:has(> .kit-backdrop-pin)` / `body[data-*]`, and jsdom resolves no stylesheets — those are pinned in
// `e2e/agent-backdrop.spec.ts`, in the real built app where the cascade exists.

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
Element.prototype.scrollTo = vi.fn();
Element.prototype.scrollIntoView = vi.fn();

// The media index, per NAMESPACE — the backdrop joins the `agents` index while a themed Root also reads its
// own (gacha's oracle pool). One mock, keyed, so an arm can populate both and prove which one WON.
const media = vi.hoisted((): { by: Record<string, unknown> } => ({ by: {} }));
vi.mock("../../src/hooks/useMedia", () => ({
  useMediaIndex: (ns: string) => ({ data: media.by[ns] }),
}));
// ChatThread's action specs are a query of their own and say nothing about art (the gachaAgent/frontierAgent
// convention). PARTIAL, because the theme Roots below mount the whole shell — the Fleet reads
// `useFleetActions` from this same module, and stubbing it away would be mocking a seam this suite is not
// about.
vi.mock("../../src/hooks/useActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/hooks/useActions")>()),
  useActionSpecs: () => ({ data: [] }),
}));
const chat = vi.hoisted(() => {
  const view = {} as import("../../src/hooks/useAgentChat").AgentChat;
  return { view };
});
vi.mock("../../src/hooks/useAgentChat", () => ({ useAgentChat: () => chat.view }));

import { useActiveBackdrop } from "../../src/hooks/useActiveBackdrop";
import type { MediaFile } from "../../src/hooks/useMedia";
import { openThread, setSessionAgent, startNewThread } from "../../src/store/chat";
import { setUI } from "../../src/store/ui";
import { AgentTab } from "../../src/tabs/AgentTab";
import { DefaultRoot } from "../../src/theme-engine/kit/DefaultRoot";
import { resolveAgentBackdrop } from "../../src/theme-engine/kit/agentBackdrop";
import { CosmosRoot } from "../../src/themes/cosmos/CosmosRoot";
import { FrontierRoot } from "../../src/themes/frontier/FrontierRoot";
import { GachaRoot } from "../../src/themes/gacha/GachaRoot";
import { MinimalRoot } from "../../src/themes/minimal/MinimalRoot";
import { VaporRoot } from "../../src/themes/vapor/VaporRoot";
import type { AgentBackdropMode } from "../../src/theme-engine/types";

const file = (name: string, over: Partial<MediaFile> = {}): MediaFile => ({
  name,
  file: `${name}.webp`,
  url: `/api/media/agents/files/backgrounds/${name}.webp`,
  format: "webp",
  size_bytes: 90_000,
  revision: `1:90000:${name}`,
  width: 1200,
  height: 1600,
  unusable: false,
  unusable_reason: null,
  ...over,
});

/** The roster as `GET /api/agents` publishes it — seeded into the query CACHE rather than mocked, so the
 *  real `useAgentRoster` → `useAgentArt` → `useActiveBackdrop` chain runs end to end (the binding, the
 *  library join and the hidden/unusable filters all included). A binding names the library ENTRY, which
 *  for an owner file is its `file` (name WITH extension) — `useAgentArt`'s own suite pins that spelling. */
function roster(background: string, over: Record<string, unknown> = {}) {
  return {
    agents: ["lynette"],
    default: "default",
    summaries: {
      default: { title: "default", description: "", avatar: "", background, voice: "" },
      lynette: {
        title: "Lynette",
        description: "",
        avatar: "",
        background: "lynette.webp",
        voice: "",
      },
    },
    ...over,
  };
}

let qc: QueryClient;
function draw(ui: ReactElement) {
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const strips = (c: HTMLElement) => c.querySelectorAll(".kit-backdrop-strip");
const pins = (c: HTMLElement) => c.querySelectorAll(".kit-backdrop-pin");
const layers = (c: HTMLElement) => c.querySelectorAll(".kit-backdrop-strip, .kit-backdrop-pin");

/** What the layer must paint for `file(name)` — the mount URL plus the `?rev=` stamp `useAgentArt` puts on
 *  every owner file, so replacing the picture in place actually repaints. */
const painted = (name: string) =>
  `/api/media/agents/files/backgrounds/${name}.webp?rev=${encodeURIComponent(`1:90000:${name}`)}`;

beforeAll(() => {
  chat.view = {
    messages: [],
    status: "idle",
    streamingId: null,
    resultByCall: {},
    currentPlan: null,
    resolvedDefault: undefined,
    ttsOn: false,
  } as unknown as import("../../src/hooks/useAgentChat").AgentChat;
});

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["agents"], roster("hall.webp"));
  media.by = {
    agents: { ns: "agents", collation: "library-v1", roles: { backgrounds: [file("hall")] } },
  };
  setSessionAgent(null);
  setUI({ theme: "cosmos", tab: "agent", agentBackdrop: "operator", motion: "full" });
});
afterEach(() => {
  setSessionAgent(null);
  startNewThread(); // …and the THREAD pin with it: both rungs of the ladder start each arm empty
  setUI({ agentBackdrop: "operator" });
  cleanup();
});

describe("resolveAgentBackdrop — the heal", () => {
  it("passes the three known modes through", () => {
    for (const m of ["operator", "full", "off"] as AgentBackdropMode[]) {
      expect(resolveAgentBackdrop(m)).toBe(m);
    }
  });

  it("heals anything else to `operator` — never to a state that hides the art", () => {
    // A rolled-back vocabulary, a hand-edited blob, a doc written by a newer build. The failure this
    // guards is not a crash: it is a corrupt value silently reading as "the owner turned it off".
    for (const v of [undefined, null, "", "sideways", 3, {}, ["full"]]) {
      expect(resolveAgentBackdrop(v)).toBe("operator");
    }
  });
});

describe("AgentTab — the mode × art matrix", () => {
  it("operator: ONE in-flow strip, painting the resolved default agent's background", () => {
    const { container } = draw(<AgentTab active />);
    expect(strips(container)).toHaveLength(1);
    expect(pins(container)).toHaveLength(0);
    expect(
      container.querySelector<HTMLImageElement>(".kit-backdrop-art")!.getAttribute("src"),
    ).toBe(painted("hall"));
    // Decorative: never announced, and the picture carries no alt text of its own.
    expect(container.querySelector(".kit-backdrop-strip")!.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(container.querySelector(".kit-backdrop-art")!.getAttribute("alt")).toBe("");
  });

  it("operator: the strip sits AFTER the pinned plan panel and BEFORE the `.sec` head", () => {
    // The panel's first-in-flow rule is about TRAVEL: 240px of flow above it would make the sticky panel
    // travel by exactly that between scroll-top and stuck. Order is the rule honored, so it is asserted.
    chat.view = { ...chat.view, currentPlan: { steps: [{ text: "a", status: "active" }] } };
    setUI({ themeSettings: { cosmos: { plan: "pinned" } } });
    const { container } = draw(<AgentTab active />);
    const kids = [...container.querySelector("#tab-agent")!.children].map((e) => e.className);
    expect(kids.indexOf("kit-backdrop-strip")).toBeGreaterThan(-1);
    expect(kids.indexOf("kit-backdrop-strip")).toBeLessThan(kids.indexOf("sec"));
    chat.view = { ...chat.view, currentPlan: null };
    setUI({ themeSettings: {} });
  });

  it("full: the zero-height sticky pin + the sharp layer + a SEPARATE veil (no blurred copy anywhere)", () => {
    setUI({ agentBackdrop: "full" });
    const { container } = draw(<AgentTab active />);
    expect(pins(container)).toHaveLength(1);
    expect(strips(container)).toHaveLength(0);
    const pin = container.querySelector(".kit-backdrop-pin")!;
    expect(pin.getAttribute("aria-hidden")).toBe("true");
    const full = pin.querySelector(".kit-backdrop-full")!;
    // ONE picture and ONE veil — the whole difference from the oracle's two-face crossfade.
    expect(full.querySelectorAll(".kit-backdrop-art")).toHaveLength(1);
    expect(full.querySelectorAll(".kit-backdrop-veil")).toHaveLength(1);
    expect(full.querySelector<HTMLImageElement>(".kit-backdrop-art")!.getAttribute("src")).toBe(
      painted("hall"),
    );
    // The transcript is a LATER sibling of the pin — what the `:has()` z-lift in kit.css then raises.
    const kids = [...container.querySelector("#tab-agent")!.children].map((e) => e.className);
    expect(kids.indexOf("kit-backdrop-pin")).toBeLessThan(kids.indexOf("chat-log"));
  });

  it("off: no layer at all, with the picture still bound and servable", () => {
    setUI({ agentBackdrop: "off" });
    expect(layers(draw(<AgentTab active />).container)).toHaveLength(0);
  });

  it("renders NOTHING when the active agent has no background — in operator AND full", () => {
    // The agentless / fresh-install state: the default's binding is empty, so the tab is byte-identical
    // to the one that shipped before this slice. The kit has no fallback art of its own to fall back TO.
    qc.setQueryData(["agents"], roster(""));
    expect(layers(draw(<AgentTab active />).container)).toHaveLength(0);
    cleanup();
    setUI({ agentBackdrop: "full" });
    expect(layers(draw(<AgentTab active />).container)).toHaveLength(0);
  });

  it("renders nothing when the binding names a HIDDEN, UNUSABLE or missing entry", () => {
    media.by = {
      agents: {
        ns: "agents",
        collation: "library-v1",
        roles: { backgrounds: [file("hall", { unusable: true, unusable_reason: "unreadable" })] },
      },
    };
    expect(layers(draw(<AgentTab active />).container)).toHaveLength(0);
    cleanup();
    media.by = { agents: { ns: "agents", collation: "library-v1", roles: { backgrounds: [] } } };
    expect(layers(draw(<AgentTab active />).container)).toHaveLength(0);
    cleanup();
    media.by = {}; // the index is unreachable
    expect(layers(draw(<AgentTab active />).container)).toHaveLength(0);
  });
});

describe("which agent the backdrop belongs to (§8.3a item 2)", () => {
  beforeEach(() => {
    media.by = {
      agents: {
        ns: "agents",
        collation: "library-v1",
        roles: { backgrounds: [file("hall"), file("lynette")] },
      },
    };
  });

  it("the sticky session pin WINS while it names a configured agent", () => {
    setSessionAgent("lynette");
    const { container } = draw(<AgentTab active />);
    expect(
      container.querySelector<HTMLImageElement>(".kit-backdrop-art")!.getAttribute("src"),
    ).toBe(painted("lynette"));
  });

  it("a sticky name that is NOT configured falls back to the default's art, not to nothing", () => {
    // `/agent typo` stays sticky on purpose (the backend resolves it to the default) — the surface has to
    // agree with where the message actually goes. The shared `validSessionAgent` fold is what makes it.
    setSessionAgent("typo");
    const { container } = draw(<AgentTab active />);
    expect(
      container.querySelector<HTMLImageElement>(".kit-backdrop-art")!.getAttribute("src"),
    ).toBe(painted("hall"));
  });

  it("REPAINTS when the owner switches character mid-session (the pin is reactive now)", () => {
    const view = draw(<AgentTab active />);
    const src = () =>
      view.container.querySelector<HTMLImageElement>(".kit-backdrop-art")!.getAttribute("src");
    expect(src()).toBe(painted("hall"));
    act(() => {
      setSessionAgent("lynette"); // what the `/agent` verb and the gallery's Talk button both call
    });
    expect(src()).toBe(painted("lynette"));
  });
});

describe("WHICH picture of that agent's: its background, else its avatar (owner ruling 2026-09-08)", () => {
  // The owner round on S6: Lynette was imported from a character card, which binds an AVATAR and no
  // background — and the theme's own default painted instead of her. The rule is now "the active agent's
  // OWN art wins", with the avatar standing in when no background is bound. It lives in
  // `useActiveBackdrop` and nowhere lower: `AgentArt.background` stays the truthful binding, because the
  // picker and the who-line read the two fields apart.

  /** The `agents` index with BOTH pools populated, so an arm proves which role was chosen rather than
   *  which one happened to exist. `file()` builds a `backgrounds/` row; this is its `avatars/` twin. */
  const avatarFile = (name: string, over: Partial<MediaFile> = {}): MediaFile => ({
    ...file(name, over),
    url: `/api/media/agents/files/avatars/${name}.webp`,
  });
  const paintedAvatar = (name: string) =>
    `/api/media/agents/files/avatars/${name}.webp?rev=${encodeURIComponent(`1:90000:${name}`)}`;

  /** The default agent binding one, both or neither pool — the whole matrix this rule decides. */
  function bind(background: string, avatar: string) {
    qc.setQueryData(["agents"], {
      agents: [],
      default: "default",
      summaries: { default: { title: "default", description: "", avatar, background, voice: "" } },
    });
  }

  beforeEach(() => {
    media.by = {
      agents: {
        ns: "agents",
        collation: "library-v1",
        roles: { avatars: [avatarFile("face")], backgrounds: [file("hall")] },
      },
    };
  });

  const src = (c: HTMLElement) =>
    c.querySelector<HTMLImageElement>(".kit-backdrop-art")!.getAttribute("src");

  it("the BOUND BACKGROUND wins whenever the agent has one, avatar or no avatar", () => {
    bind("hall.webp", "face.webp");
    expect(src(draw(<AgentTab active />).container)).toBe(painted("hall"));
  });

  it("the AVATAR paints when no background is bound — in operator AND in full", () => {
    bind("", "face.webp");
    expect(src(draw(<AgentTab active />).container)).toBe(paintedAvatar("face"));
    cleanup();
    setUI({ agentBackdrop: "full" });
    expect(src(draw(<AgentTab active />).container)).toBe(paintedAvatar("face"));
  });

  it("neither bound ⇒ still NOTHING mounts (the fallback added no picture of its own)", () => {
    bind("", "");
    expect(layers(draw(<AgentTab active />).container)).toHaveLength(0);
  });

  it("an avatar the library cannot serve is no fallback either — hidden, unusable or missing", () => {
    for (const rows of [
      [avatarFile("face", { hidden: true })],
      [avatarFile("face", { unusable: true, unusable_reason: "unreadable" })],
      [] as MediaFile[],
    ]) {
      bind("", "face.webp");
      media.by = {
        agents: {
          ns: "agents",
          collation: "library-v1",
          roles: { avatars: rows, backgrounds: [] },
        },
      };
      expect(layers(draw(<AgentTab active />).container)).toHaveLength(0);
      cleanup();
    }
  });

  it("the gallery's outranked REPORT reads the very same value the layer paints", () => {
    // `useMediaLibrary` asks `useActiveBackdrop() !== undefined` for `hasAgentArt`, which is what
    // `backdropOutrank` turns into the "the active character's own art is used" word on the
    // cards. One statement, two readers (the S6 invariant): an avatar standing in as the backdrop has
    // to be REPORTED live, or the gallery would claim a picture the tab is not showing.
    bind("", "face.webp");
    const { result } = renderHook(() => useActiveBackdrop(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    expect(result.current?.url).toBe(paintedAvatar("face"));
  });
});

describe("the OPEN THREAD's pin is the ladder's second rung (wave 1c)", () => {
  // The owner's glance: a thread pinned to Lynette (D11 `Thread.agent`) replies as Lynette — the server
  // routes `agent_name or thread.agent` — while this surface painted the default, because the FE never
  // read the field. These arms drive the REAL loader (`openThread`), so the store write and the paint are
  // proved end to end rather than by poking a setter the app does not have.

  /** The two routes an open touches, plus the D39 re-attach probe. The LIST is where the pin lives.
   *  Assigned rather than `vi.stubGlobal`'d: this suite stubs `ResizeObserver` globally at module scope,
   *  and `unstubAllGlobals` would take that with it (every themed Root mounts a ChatThread that observes). */
  const realFetch = globalThis.fetch;
  function serve(agent: string | null) {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const body: unknown = url.endsWith("/messages")
        ? []
        : url.includes("/api/agent/turns/")
          ? { active: false }
          : [{ id: "t1", title: null, agent, created_at: "", updated_at: "", archived: false }];
      return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
    });
  }
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Open the pinned thread and let the LATE pin write land (it deliberately does not gate the swap). */
  async function openPinned(agent: string | null) {
    serve(agent);
    await act(async () => {
      await openThread("t1");
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    media.by = {
      agents: {
        ns: "agents",
        collation: "library-v1",
        roles: { backgrounds: [file("hall"), file("lynette")] },
      },
    };
  });

  const src = (c: HTMLElement) =>
    c.querySelector<HTMLImageElement>(".kit-backdrop-art")!.getAttribute("src");

  it("paints the THREAD's character when nothing is sticky", async () => {
    await openPinned("lynette");
    expect(src(draw(<AgentTab active />).container)).toBe(painted("lynette"));
  });

  it("the sticky pick still wins — a `/agent` switch is the owner speaking last", async () => {
    await openPinned("lynette");
    setSessionAgent("default"); // …not a specialist name: the default agent, explicitly picked
    expect(src(draw(<AgentTab active />).container)).toBe(painted("hall"));
  });

  it('an EMPTY sticky pick yields to the thread — the server reads "" as unset too', async () => {
    // `pinSessionAgent("")` is what Talk on the DEFAULT agent stores; the server sees a falsy
    // `body.agent` and routes by `thread.agent`. Mirroring that is the rule, not a gap.
    await openPinned("lynette");
    setSessionAgent("");
    expect(src(draw(<AgentTab active />).container)).toBe(painted("lynette"));
  });

  it("a pin naming an agent the roster no longer has falls to the default's art", async () => {
    await openPinned("ghost");
    expect(src(draw(<AgentTab active />).container)).toBe(painted("hall"));
  });

  it("REPAINTS when the owner opens another conversation (the thread pin is reactive)", async () => {
    const view = draw(<AgentTab active />);
    expect(src(view.container)).toBe(painted("hall")); // no thread open yet: the resolved default
    await openPinned("lynette");
    expect(src(view.container)).toBe(painted("lynette"));
  });
});

describe("the five shipped themes, POPULATED and enabled", () => {
  // Rendered for real — a Root is the only place "does this theme mount the shared agent body at all" is
  // answered, and a theme added later lands in this table by being added to it.
  const MOUNTS: [name: string, Root: () => ReactElement, operator: number, full: number][] = [
    // No bespoke agent body: they all render the shared AgentTab, so ONE mount covers all three.
    ["minimal", MinimalRoot, 1, 1],
    ["vapor", VaporRoot, 1, 1],
    ["cosmos", CosmosRoot, 1, 1],
    // gacha's own body paints `operator` through its ORACLE (its suite owns that ladder) and takes the
    // SHARED arrangement for `full` — which is the whole point of `full` being one component.
    ["gacha", GachaRoot, 0, 1],
    // frontier is untouched by ruling 18: the setting has no effect on its bespoke agent surface.
    ["frontier", FrontierRoot, 0, 0],
  ];

  for (const [name, Root, operator, full] of MOUNTS) {
    it(`${name} mounts ${operator} kit layer(s) in operator and ${full} in full`, () => {
      setUI({ theme: name as never });
      expect(layers(draw(<Root />).container)).toHaveLength(operator);
      cleanup();
      setUI({ agentBackdrop: "full" });
      expect(layers(draw(<Root />).container)).toHaveLength(full);
    });
  }

  it("gacha's `data-oracle` stamp follows the MODE, not the sticky setting alone (S6 fix wave)", () => {
    // `body[data-oracle="fade"]` is what makes the oracle block STICKY and scroll-fading in CSS, and it
    // used to be stamped from the "Sticky operator art" setting alone — so under `off`/`full` the empty
    // plate kept the operator-mode scroll behavior the setting is only allowed to govern (§8.3a item 5).
    // ONE derivation, two readers: the body stamp and the body's own `oracleFade` gate.
    setUI({ theme: "gacha", themeSettings: { gacha: { oracle: true } } });
    draw(<GachaRoot />);
    expect(document.body.dataset.oracle).toBe("fade"); // operator + the setting on: unchanged
    for (const mode of ["full", "off"] as const) {
      cleanup();
      setUI({ agentBackdrop: mode });
      draw(<GachaRoot />);
      expect(document.body.dataset.oracle, mode).toBe("scroll");
    }
    setUI({ themeSettings: {} });
  });

  it("the layer lives INSIDE the agent tab — it is hidden with it, never loose in the shell", () => {
    // Section bodies are keep-mounted (DefaultRoot), so the node still exists while another section shows
    // — hidden by `.kit .tab { display: none }` with the rest of the tab. What matters is that it is a
    // CHILD of that tab rather than a shell-level layer that would paint over the fleet.
    setUI({ tab: "fleet" });
    const { container } = draw(<DefaultRoot />);
    const layer = container.querySelector(".kit-backdrop-strip")!;
    expect(layer).not.toBeNull();
    expect(layer.closest("#tab-agent")).not.toBeNull();
    expect(container.querySelector("#tab-agent")!.classList.contains("active")).toBe(false);
  });
});

describe("the `full` pin's pinned-plan pull (the S6 fix wave)", () => {
  // The GEOMETRY of this claim is pinned in `e2e/agent-backdrop.spec.ts`, where a real engine lays the
  // tab out — jsdom resolves no stylesheets and builds no boxes, so nothing here could measure it. What
  // this arm holds is the RULE's own shape, because the defect was a rule that could not be right: a
  // negative margin on a ZERO-HEIGHT box advances every following sibling by exactly that much, so the
  // pull that lets the art reach up under the plan panel dragged `.sec` and `.chat-log` under it too.
  // The compensation is what makes the pair net-zero for the flow, and it must read the SAME token.
  const css = readFileSync(resolve(process.cwd(), "src/theme-engine/kit/kit.css"), "utf8");

  it("compensates its own pull, so a zero-height pin moves no flow sibling", () => {
    const rule = cssRules(css).find(
      (r) => r.selector === ".kit .tab > .plan-pin-panel + .kit-backdrop-pin",
    );
    expect(rule, "the pinned-plan pull rule is gone — has the pin's seat moved?").toBeDefined();
    const decls = rule!.declarations.replace(/\s+/g, " ");
    expect(decls).toContain("margin-top: calc(-1 * var(--plan-head-h, 31px))");
    expect(decls).toContain("margin-bottom: var(--plan-head-h, 31px)");
  });
});

// ── the `full` walk driver (the DOM half; the arithmetic lives in scrollProgress.test.ts) ───────────────
// Mounted inside a stand-in `#app-scroll` for the reason the gacha suite models one: the layer reaches the
// shell's single content pane by id, and everything the driver does hangs off finding it. jsdom resolves no
// stylesheets, so the ramp token is handed over the same way.

function makeScroller() {
  const scroller = document.createElement("div");
  scroller.id = "app-scroll";
  let pos = 0;
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => pos,
    set: () => {}, // an ESM strict-mode assignment must not throw — it just has no effect
  });
  document.body.appendChild(scroller);
  return { scroller, setPos: (v: number) => (pos = v) };
}

function stubRamp(ramp: string) {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pe?: string | null) => {
    const decl = real(el, pe ?? undefined);
    return {
      ...decl,
      getPropertyValue: (p: string) =>
        p === "--kit-backdrop-ramp" ? ramp : decl.getPropertyValue(p),
    };
  });
}

async function scrollTo(scroller: HTMLElement, setPos: (v: number) => void, top: number) {
  setPos(top);
  await act(async () => {
    scroller.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

describe("the `full` walk — one property, one frame per burst", () => {
  const P = "--kit-backdrop-p";
  afterEach(() => {
    vi.restoreAllMocks();
    document.getElementById("app-scroll")?.remove();
  });

  function mount(ramp = "240px") {
    const { scroller, setPos } = makeScroller();
    stubRamp(ramp);
    setUI({ agentBackdrop: "full" });
    const view = render(
      <QueryClientProvider client={qc}>
        <AgentTab active />
      </QueryClientProvider>,
      { container: scroller },
    );
    return { ...view, scroller, setPos };
  }

  it("walks 0 → 1 over the ramp token, pinned at both ends, from the tab's own top", () => {
    const { container, scroller, setPos } = mount();
    const pin = container.querySelector<HTMLElement>(".kit-backdrop-pin")!;
    // published at mount — the walk starts DEFINED, so entering a scrolled thread never flashes sharp
    expect(pin.style.getPropertyValue(P)).toBe("0.000");
    return (async () => {
      await scrollTo(scroller, setPos, 120);
      expect(pin.style.getPropertyValue(P)).toBe("0.500");
      await scrollTo(scroller, setPos, 240);
      expect(pin.style.getPropertyValue(P)).toBe("1.000");
      await scrollTo(scroller, setPos, 4000);
      expect(pin.style.getPropertyValue(P)).toBe("1.000");
      await scrollTo(scroller, setPos, -50); // overscroll bounce
      expect(pin.style.getPropertyValue(P)).toBe("0.000");
    })();
  });

  it("unhooks AND un-writes on unmount (nothing is left behind on the node)", async () => {
    const { container, scroller, setPos, unmount } = mount();
    const pin = container.querySelector<HTMLElement>(".kit-backdrop-pin")!;
    await scrollTo(scroller, setPos, 240);
    expect(pin.style.getPropertyValue(P)).toBe("1.000");
    const spy = vi.spyOn(scroller, "removeEventListener");
    unmount();
    expect(spy).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(pin.style.getPropertyValue(P)).toBe("");
  });

  it("writes NOTHING when the ramp token is absent — no ramp, no walk (never a hardcoded fallback)", async () => {
    const { container, scroller, setPos } = mount(""); // the stylesheet has not landed / a variant dropped it
    const pin = container.querySelector<HTMLElement>(".kit-backdrop-pin")!;
    expect(pin.style.getPropertyValue(P)).toBe("");
    await scrollTo(scroller, setPos, 240);
    expect(pin.style.getPropertyValue(P)).toBe("");
  });

  it("does not run under reduced motion — the CSS parks the layer at the floor instead", async () => {
    setUI({ motion: "reduced" });
    const { container, scroller, setPos } = mount();
    const pin = container.querySelector<HTMLElement>(".kit-backdrop-pin")!;
    await scrollTo(scroller, setPos, 240);
    expect(pin.style.getPropertyValue(P)).toBe("");
    setUI({ motion: "full" });
  });
});
