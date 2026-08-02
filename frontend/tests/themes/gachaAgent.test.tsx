import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// GachaAgent (D52 G3) — the bespoke Agent body. It COMPOSES the shared <ChatThread/> (never forks it), so
// this suite exercises only the bespoke composition: the ORACLE art block, the privilege row that the
// prototype's headerless design has no slot for, the empty state (hint + chips that FILL the composer), and
// the planPlacement gate mounting the kit PinnedPlanPanel. The mocking shape is frontierAgent.test.tsx's,
// because the obligations are the same: `useAgentChat` mocked to control messages/plan without a
// QueryClient, `useActions` mocked so ChatThread's `useActionSpecs()` needs none, `PinnedPlanPanel` stubbed
// to a marker so we assert the MOUNT decision, and a ResizeObserver stub for ChatThread's scroll-stick.

const chat = vi.hoisted(() => {
  const view = {} as import("../../src/hooks/useAgentChat").AgentChat; // seeded in beforeEach
  return { view };
});
vi.mock("../../src/hooks/useAgentChat", () => ({ useAgentChat: () => chat.view }));
vi.mock("../../src/hooks/useActions", () => ({ useActionSpecs: () => ({ data: [] }) }));
vi.mock("../../src/theme-engine/kit/composer/plan/PinnedPlanPanel", () => ({
  PinnedPlanPanel: () => <div data-testid="pinned-panel" />,
}));

import { GachaAgent } from "../../src/themes/gacha/GachaAgent";
import { ART } from "../../src/themes/gacha/art";
import { GACHA_COPY } from "../../src/themes/gacha/copy";
import { getDraft, setDraft } from "../../src/store/composer";
import { setThemeSetting, setUI } from "../../src/store/ui";
import type { AgentChat } from "../../src/hooks/useAgentChat";
import type { ChatMessage } from "../../src/types";

beforeAll(() => {
  class ResizeObserverStub {
    constructor(_cb: ResizeObserverCallback) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
});

/** A minimal AgentChat with a controllable message list + plan (all other fields inert). */
function view(messages: ChatMessage[], currentPlan: AgentChat["currentPlan"] = null): AgentChat {
  return {
    messages,
    status: "idle",
    streamingId: null,
    resultByCall: {},
    currentPlan,
    resolvedDefault: undefined,
    ttsOn: false,
  };
}

const userMsg = (text: string): ChatMessage => ({
  id: "m1",
  thread_id: "t1",
  role: "user",
  parts: [{ type: "text", text }],
  actor: "user",
  ts: "2026-01-01T00:00:00Z",
  tokens: null,
  compacted: false,
});

beforeEach(() => {
  setUI({ theme: "gacha", themeSettings: {} });
  setDraft("");
  chat.view = view([]);
});
afterEach(() => {
  setUI({ themeSettings: {} });
  setDraft("");
  cleanup();
});

describe("GachaAgent — the oracle block", () => {
  it("renders the ORACLE art (the partitioned scene slot, never a roster character) + its name plate", () => {
    const { container } = render(<GachaAgent active />);
    const art = container.querySelector<HTMLImageElement>(".gc-oracle-face.sharp .gc-oracle-art");
    expect(art?.getAttribute("src")).toBe(ART.oracle);
    // the partition is the point: the oracle must not be one of the per-host cycle's characters
    expect(ART.characters).not.toContain(ART.oracle);
    expect(art?.getAttribute("alt")).toBe(""); // decorative
    expect(screen.getByRole("heading", { name: /Lucky Relay/ })).toBeTruthy();
    expect(container.querySelector(".gc-oracle-face.sharp .gc-oracle-name em")?.textContent).toBe(
      GACHA_COPY.oracleName,
    );
    // M6's scanline layer exists and is decorative (its gates are CSS — see e2e/layout.spec.ts)
    expect(container.querySelector(".gc-oracle-scan")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the privilege chip OUTSIDE the oracle (the M7 ghost must never fade a live control)", () => {
    const { container } = render(<GachaAgent active />);
    const chip = container.querySelector(".priv-chip");
    expect(chip).not.toBeNull();
    expect(container.querySelector(".gc-agent-bar .priv-chip")).not.toBeNull();
    expect(container.querySelector(".gc-oracle .priv-chip")).toBeNull();
  });

  it("composes the SHARED thread (the log tree is the kit's, not a fork)", () => {
    chat.view = view([userMsg("wake rook")]);
    const { container } = render(<GachaAgent active />);
    // #chatlog + role=log are ChatThread's own markup — proof the shared component mounted
    const log = container.querySelector("#chatlog");
    expect(log?.getAttribute("role")).toBe("log");
    expect(log?.classList.contains("chat-log")).toBe(true);
    expect(screen.getByText("wake rook")).toBeTruthy();
    // …and the tab wrapper keeps the kit's contract (tabpanel wired to its bar button)
    const tab = container.querySelector("#tab-agent");
    expect(tab?.getAttribute("role")).toBe("tabpanel");
    expect(tab?.getAttribute("aria-labelledby")).toBe("tabbtn-agent");
    expect(tab?.classList.contains("active")).toBe(true);
  });
});

describe("GachaAgent — the empty state", () => {
  it("renders the hint + two chips at zero messages, and NO second heading beside the oracle's", () => {
    const { container } = render(<GachaAgent active />);
    expect(container.querySelectorAll(".gc-empty .gc-chip")).toHaveLength(2);
    expect(container.querySelector(".gc-empty-hint")).not.toBeNull();
    // the oracle's h1 is the tab's ONE heading — the empty state deliberately adds none, and the M7 ghost
    // face's duplicate is aria-hidden, so the accessibility tree still sees exactly one
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("a chip click FILLS the composer draft (never sends)", () => {
    const { container } = render(<GachaAgent active />);
    const chips = container.querySelectorAll<HTMLButtonElement>(".gc-empty .gc-chip");
    fireEvent.click(chips[0]);
    expect(getDraft()).toBe(chips[0].textContent);
    expect(getDraft().length).toBeGreaterThan(0);
  });

  it("disappears once the thread has messages (the oracle stays)", () => {
    chat.view = view([userMsg("hello")]);
    const { container } = render(<GachaAgent active />);
    expect(container.querySelector(".gc-empty")).toBeNull();
    expect(container.querySelector(".gc-oracle")).not.toBeNull();
  });
});

// ── M7 · the fade-on-scroll driver (the DOM half; the arithmetic lives in gachaOracle.test.ts) ──────────
// Mounted INSIDE a stand-in `#app-scroll`, because that is the seam: the body reaches the shell's one
// content pane by id, and everything the driver does hangs off finding it.
//
// jsdom builds no layout boxes, so the browser facts the driver relies on have to be MODELLED rather than
// stubbed away — and modelling them is what makes these arms mean something:
//   · `scrollTop` — the native setter is a documented no-op here, and `scrollHeight` is 0, so ChatThread's
//     bottom-pin (`el.scrollTop = el.scrollHeight`) would yank any position back to zero. The stand-in
//     accepts writes and ignores them (as a real pane ignores a pin it is already at) and the test drives
//     the position directly.
//   · the RECTS — a real anchor's viewport-relative top FALLS as the pane scrolls, which is precisely what
//     makes `rect.top − scrollerRect.top + scrollTop` a scroll-invariant offset. Modelled below, so a
//     regression that measured the base from a moving target would fail here instead of shipping.

const P = "--gc-oracle-p";
/** The oracle's modelled offset inside the pane (below an appbar, say) — the number the ramp measures FROM. */
const BASE = 120;

/** A stand-in `#app-scroll` with a drivable scrollTop and a fixed rect. */
function makeScroller() {
  const scroller = document.createElement("div");
  scroller.id = "app-scroll";
  let pos = 0;
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => pos,
    set: () => {}, // an ESM strict-mode assignment must not throw — it just has no effect
  });
  scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  document.body.appendChild(scroller);
  return { scroller, setPos: (v: number) => (pos = v) };
}

/** Answer `--gc-oracle-ramp` for the driver — jsdom resolves no stylesheets, so the token has to be
 *  handed over; everything else falls through to the real computed style. */
function stubRamp(ramp = "240px") {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pe?: string | null) => {
    const decl = real(el, pe ?? undefined);
    return {
      ...decl,
      getPropertyValue: (p: string) => (p === "--gc-oracle-ramp" ? ramp : decl.getPropertyValue(p)),
    };
  });
}

/** Mount the body in a modelled pane: the anchor sits `BASE` px down and RIDES THE SCROLL, exactly as a
 *  real one does. Returns after the mount re-sync frame, so the driver has measured the modelled geometry. */
async function mountAgent(ui: React.ReactElement, ramp = "240px") {
  const { scroller, setPos } = makeScroller();
  stubRamp(ramp);
  const view = render(ui, { container: scroller });
  const anchor = view.container.querySelector<HTMLElement>(".gc-oracle-anchor");
  if (anchor) anchor.getBoundingClientRect = () => ({ top: BASE - scroller.scrollTop }) as DOMRect;
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
  return { ...view, scroller, setPos };
}

/** Scroll the pane and let the driver's single rAF land. */
async function scrollTo(scroller: HTMLElement, setPos: (v: number) => void, top: number) {
  setPos(top);
  await act(async () => {
    scroller.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

describe("GachaAgent — M7, the oracle fade driver", () => {
  beforeEach(() => {
    setThemeSetting("gacha", "oracle", true); // the shipping default (R6), stated so the arm is explicit
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.getElementById("app-scroll")?.remove();
  });

  it("walks the ramp FROM THE ORACLE'S OWN OFFSET, and pins at both ends", async () => {
    const { container, scroller, setPos } = await mountAgent(<GachaAgent active />);
    const oracle = container.querySelector<HTMLElement>(".gc-oracle")!;
    // published at mount — the ramp starts defined, never undefined-until-first-scroll
    expect(oracle.style.getPropertyValue(P)).toBe("0.000");
    // scrolled to exactly the oracle's offset = the moment the prototype's own scrollTop would read 0
    await scrollTo(scroller, setPos, BASE);
    expect(oracle.style.getPropertyValue(P)).toBe("0.000");
    await scrollTo(scroller, setPos, BASE + 120);
    expect(oracle.style.getPropertyValue(P)).toBe("0.500");
    await scrollTo(scroller, setPos, BASE + 240);
    expect(oracle.style.getPropertyValue(P)).toBe("1.000");
    await scrollTo(scroller, setPos, BASE + 2400); // past the ramp — pinned, never over-driven
    expect(oracle.style.getPropertyValue(P)).toBe("1.000");
  });

  it("listens PASSIVELY on the shared scroller, and unhooks + un-writes on unmount", async () => {
    const { scroller } = makeScroller();
    stubRamp();
    const add = vi.spyOn(scroller, "addEventListener");
    const remove = vi.spyOn(scroller, "removeEventListener");

    const { container, unmount } = render(<GachaAgent active />, { container: scroller });
    const oracle = container.querySelector<HTMLElement>(".gc-oracle")!;
    // React registers its own delegated CAPTURE listeners on the container root (a bare boolean), so the
    // ones passing an OPTIONS OBJECT are the app's: ChatThread's stick-to-bottom and the M7 driver's,
    // exactly two, both passive (§14.11 — a scroll listener that can block scrolling is a jank source).
    const scrollArgs = add.mock.calls.filter((c) => c[0] === "scroll" && typeof c[2] === "object");
    expect(scrollArgs).toHaveLength(2);
    for (const c of scrollArgs) expect(c[2]).toEqual({ passive: true });

    unmount();
    expect(remove.mock.calls.filter((c) => c[0] === "scroll")).toHaveLength(2);
    // the §10.5 switch-out ledger: nothing of gacha's is left on a node another skin might inherit
    expect(oracle.style.getPropertyValue(P)).toBe("");
  });

  it("does nothing at all when the sticky-art setting is OFF (no ghost copy, no property)", async () => {
    setThemeSetting("gacha", "oracle", false);
    const { container, scroller, setPos } = await mountAgent(<GachaAgent active />);
    expect(container.querySelector(".gc-oracle-face.soft")).toBeNull();
    const oracle = container.querySelector<HTMLElement>(".gc-oracle")!;
    expect(oracle.style.getPropertyValue(P)).toBe("");
    await scrollTo(scroller, setPos, BASE + 200);
    expect(oracle.style.getPropertyValue(P)).toBe("");
  });

  it("ghosts the WHOLE FACE — art AND copy — not just the art (the owner's G3 ruling)", async () => {
    const { container } = await mountAgent(<GachaAgent active />);
    const faces = container.querySelectorAll<HTMLElement>(".gc-oracle-face");
    expect(faces).toHaveLength(2);
    expect(faces[0].className).toContain("sharp");
    expect(faces[1].className).toContain("soft");
    // the ghost carries the same SURFACE: the picture and the words, so the two degrade together
    for (const face of faces) {
      expect(face.querySelector(".gc-oracle-art")).not.toBeNull();
      expect(face.querySelector(".gc-oracle-name h1")).not.toBeNull();
    }
    // one asset, two layers — the ghost is never a second download
    expect(faces[1].querySelector("img")!.getAttribute("src")).toBe(
      faces[0].querySelector("img")!.getAttribute("src"),
    );
    // …and the duplicated copy never reaches the accessibility tree
    expect(faces[1].getAttribute("aria-hidden")).toBe("true");
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("RE-SYNCS after the thread's programmatic bottom-pin (entering a populated thread lands ghosted)", async () => {
    const { container, rerender, setPos } = await mountAgent(<GachaAgent active />);
    const oracle = container.querySelector<HTMLElement>(".gc-oracle")!;
    expect(oracle.style.getPropertyValue(P)).toBe("0.000");
    // A new message arrives and ChatThread pins the pane to the bottom — NO scroll event of our own here.
    // Land the pin, then re-render with the longer thread: the re-sync frame is the only thing that can
    // republish the progress, so this arm fails the moment it is dropped.
    setPos(BASE + 240);
    chat.view = view([userMsg("wake rook")]);
    await act(async () => {
      rerender(<GachaAgent active />);
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(oracle.style.getPropertyValue(P)).toBe("1.000");
  });

  it("stays inert while the tab is INACTIVE (a display:none body measures all-zero)", async () => {
    const { container, scroller, setPos } = await mountAgent(<GachaAgent active={false} />);
    const oracle = container.querySelector<HTMLElement>(".gc-oracle")!;
    expect(oracle.style.getPropertyValue(P)).toBe("");
    await scrollTo(scroller, setPos, BASE + 200);
    expect(oracle.style.getPropertyValue(P)).toBe("");
  });
});

describe("GachaAgent — plan placement", () => {
  const plan = { steps: [{ text: "wake pegasus", status: "pending" as const }] };

  it("planPlacement='pinned' mounts PinnedPlanPanel in the bespoke body", () => {
    setThemeSetting("gacha", "planPlacement", "pinned");
    chat.view = view([userMsg("go")], plan);
    render(<GachaAgent active />);
    expect(screen.getByTestId("pinned-panel")).toBeTruthy();
  });

  it("planPlacement='inline' (gacha's declared default) mounts no panel — the composer owns the pill", () => {
    chat.view = view([userMsg("go")], plan);
    render(<GachaAgent active />);
    expect(screen.queryByTestId("pinned-panel")).toBeNull();
  });
});
