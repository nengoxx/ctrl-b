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
vi.mock("../../src/hooks/useAgentArt", () => ({
  // D70 §8.5/§8.4 — the agent-art resolver is a QUERY PAIR (roster + media index), so it is mocked to the
  // NO-ART answer here (which is the state every assertion in this file is about) rather than dragging a
  // QueryClient in — the same reason `useActionSpecs` is mocked in these suites.
  useAgentArt: () => (name: string | null) => ({
    name: name ?? "default",
    title: name ?? "default",
  }),
}));
// D70 §8.3a — "which picture does the ACTIVE agent bring", mocked for the same reason and to the same
// default: it is a THIRD query (the roster names, joined with that resolver), and the no-agent-art answer
// is the state every pre-S6 assertion in this file is about. `agentArt.bg = …` drives the one arm that is
// about an agent HAVING art, and it returns what the real hook returns — a `BoundArt`, or undefined.
const agentArt = vi.hoisted(() => ({ bg: undefined as { url: string } | undefined }));
vi.mock("../../src/hooks/useActiveBackdrop", () => ({ useActiveBackdrop: () => agentArt.bg }));

// G5 — the theme's art now comes from `GET /api/media/gacha`. The index hook is mocked rather than wrapped
// in a QueryClientProvider (the `useFleet` precedent above): these cases are about the BODY's wiring, and
// the default — no owner files — is also the assertion that G1–G4 behavior is byte-identical on a fresh
// install. `media.data = …` drives the owner-supplied cases.
const media = vi.hoisted(() => ({ data: undefined as MediaIndex | undefined }));
vi.mock("../../src/hooks/useMedia", () => ({ useMediaIndex: () => media }));
vi.mock("../../src/theme-engine/kit/composer/plan/PinnedPlanPanel", () => ({
  PinnedPlanPanel: () => <div data-testid="pinned-panel" />,
}));

import { GachaAgent } from "../../src/themes/gacha/GachaAgent";
import { ART } from "../../src/themes/gacha/art";
import { GACHA_COPY } from "../../src/themes/gacha/copy";
import { getDraft, setDraft } from "../../src/store/composer";
import { setThemeSetting, setUI } from "../../src/store/ui";
import type { AgentChat } from "../../src/hooks/useAgentChat";
import type { MediaIndex } from "../../src/hooks/useMedia";
import type { ChatMessage } from "../../src/types";

// The ResizeObserver stub FIRES (Codex G3 L2): a stub whose callback is never invoked cannot exercise the
// one thing M7's observer is for — re-measuring the oracle's offset when a box above it changes size without
// any scroll happening. It also records its targets, so "the app bar is observed" is an assertion rather
// than a claim in a comment.
interface StubbedObserver {
  cb: ResizeObserverCallback;
  targets: Set<Element>;
}
const observers: StubbedObserver[] = [];
/** Fire every live observer's callback (entries are unused by the driver — it re-measures from scratch). */
function fireResizeObservers(): void {
  for (const o of [...observers]) o.cb([], {} as ResizeObserver);
}
/** Every element any live observer is watching. */
function observedTargets(): Element[] {
  return observers.flatMap((o) => [...o.targets]);
}

beforeAll(() => {
  class ResizeObserverStub {
    private entry: StubbedObserver;
    constructor(cb: ResizeObserverCallback) {
      this.entry = { cb, targets: new Set() };
      observers.push(this.entry);
    }
    observe(target: Element): void {
      this.entry.targets.add(target);
    }
    unobserve(target: Element): void {
      this.entry.targets.delete(target);
    }
    disconnect(): void {
      this.entry.targets.clear();
      const i = observers.indexOf(this.entry);
      if (i >= 0) observers.splice(i, 1);
    }
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
  setUI({ theme: "gacha", themeSettings: {}, agentBackdrop: "operator" });
  setDraft("");
  chat.view = view([]);
  observers.length = 0; // a previous arm's unmounted observers must never fire into this one
  media.data = undefined; // no owner files ⇒ the bundled oracle art, exactly as G3 shipped it
  agentArt.bg = undefined; // no agent picture ⇒ the theme's own ladder answers, exactly as G3 shipped it
});
afterEach(() => {
  setUI({ themeSettings: {}, agentBackdrop: "operator" });
  setDraft("");
  cleanup();
});

describe("GachaAgent — the oracle block", () => {
  // G5 — the backdrop resolves through §5.3's ONE resolver now (it used to reach into the bundled manifest
  // directly, which was the last surface bypassing it). Both stacked copies must take the SAME art: they
  // are one surface rendered twice, and a mismatch would crossfade between two different pictures.
  it("paints the owner's oracle/ drop on BOTH faces when there is one", () => {
    media.data = {
      ns: "gacha",
      collation: "library-v1",
      roles: {
        oracle: [
          {
            name: "eye",
            file: "eye.webp",
            url: "/api/media/gacha/files/oracle/eye.webp",
            format: "webp",
            size_bytes: 1,
            revision: "1:1",
            width: 1,
            height: 1,
            unusable: false,
            unusable_reason: null,
          },
        ],
      },
      slots: {},
    };
    setUI({ themeSettings: { gacha: { oracle: true } } });
    const { container } = render(<GachaAgent active />);
    const arts = [...container.querySelectorAll<HTMLImageElement>(".gc-oracle-art")];
    expect(arts).toHaveLength(2); // sharp + the soft ghost (the fade mode is on)
    for (const img of arts) {
      // PAINT-READY (D65 defect #1) — the `?rev=` rides the resolver, not the call site.
      expect(img.getAttribute("src")).toBe("/api/media/gacha/files/oracle/eye.webp?rev=1%3A1");
    }
  });

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

  it("renders the shared chat chrome in the KIT's own `.sec` header, not a bespoke strip", () => {
    // Owner ruling, G3 round 2. The privilege chip (A1/D16) is a shared CONTROL: it lives in the same
    // header slot under gacha as under AgentTab and FrontierAgent, so it renders, positions and stacks
    // consistently. A theme-invented row is what displaced it and trapped its dropdown.
    const { container } = render(<GachaAgent active />);
    const sec = container.querySelector("#tab-agent > .sec");
    expect(sec).not.toBeNull();
    expect(sec!.querySelector(".right .priv-chip")).not.toBeNull();
    expect(container.querySelector(".gc-agent-bar")).toBeNull(); // the bespoke strip is gone for good
    // …and never inside the art, which the M7 ghost fades to 28%
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

// ── M7 · the fade-on-scroll driver (the DOM half; the arithmetic lives in theme-engine/scrollProgress.test.ts) ──────────
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

/** Mount the body in a modelled pane: the anchor sits `base` px down and RIDES THE SCROLL, exactly as a
 *  real one does. `setBase` models a POSITION-only move of the flow above the oracle — a pinned plan panel
 *  mounting, the app bar re-laying-out — which is the class of change a ResizeObserver cannot report and
 *  which a scroll frame alone therefore cannot correct. Returns after the mount re-sync frame, so the driver
 *  has measured the modelled geometry. */
async function mountAgent(ui: React.ReactElement, ramp = "240px") {
  const { scroller, setPos } = makeScroller();
  stubRamp(ramp);
  let base = BASE;
  const view = render(ui, { container: scroller });
  const anchor = view.container.querySelector<HTMLElement>(".gc-oracle-anchor");
  if (anchor) anchor.getBoundingClientRect = () => ({ top: base - scroller.scrollTop }) as DOMRect;
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
  return { ...view, scroller, setPos, setBase: (v: number) => (base = v) };
}

/** Let one scheduled frame land (the driver's coalescing remeasure rAF). */
async function frame(): Promise<void> {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
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

  it("survives an active → inactive → active cycle: the body stays MOUNTED, the wiring is rebuilt", async () => {
    // The kit keep-mounts every section body and gates it on `active` (never conditional-renders it), so
    // leaving and re-entering the tab is the COMMON path — unmount is the rare one. Leaving must un-write
    // and unhook (a `display: none` body measures all-zero, so anything it wrote would be a lie); returning
    // must re-measure and re-publish at the CURRENT position, with no scroll event to prompt it.
    const { container, scroller, setPos, rerender } = await mountAgent(<GachaAgent active />);
    const oracle = container.querySelector<HTMLElement>(".gc-oracle")!;
    const remove = vi.spyOn(scroller, "removeEventListener");
    await scrollTo(scroller, setPos, BASE + 240);
    expect(oracle.style.getPropertyValue(P)).toBe("1.000");

    await act(async () => rerender(<GachaAgent active={false} />));
    expect(oracle.style.getPropertyValue(P)).toBe(""); // the §10.5 ledger holds on deactivation too
    expect(remove.mock.calls.filter((c) => c[0] === "scroll").length).toBeGreaterThan(0);
    await scrollTo(scroller, setPos, BASE + 100); // scrolling while away writes nothing
    expect(oracle.style.getPropertyValue(P)).toBe("");

    await act(async () => rerender(<GachaAgent active />));
    // republished from the position the pane is ACTUALLY at (100 of the 240px ramp), synchronously on
    // re-activation — not left blank until the user happens to scroll again
    expect(oracle.style.getPropertyValue(P)).toBe("0.417");
    await scrollTo(scroller, setPos, BASE + 240);
    expect(oracle.style.getPropertyValue(P)).toBe("1.000"); // …and the listener is live again
  });

  it("REMEASURES when an observed box resizes — and the APP BAR is one of them", async () => {
    // Codex G3 M3, half one: the bar sits above the tab bodies inside the same scroller, so its height is
    // part of the oracle's offset — and it changes on its own (a TTS toggle appearing, a display font
    // landing). Neither the pane nor the block resizes when it does, so it has to be observed itself.
    const bar = document.createElement("div");
    bar.className = "kit-appbar";
    document.body.appendChild(bar);
    const { container, scroller, setPos, setBase } = await mountAgent(<GachaAgent active />);
    const oracle = container.querySelector<HTMLElement>(".gc-oracle")!;
    expect(observedTargets()).toContain(bar);
    expect(observedTargets()).toContain(scroller);
    expect(observedTargets()).toContain(oracle);

    await scrollTo(scroller, setPos, BASE + 240);
    expect(oracle.style.getPropertyValue(P)).toBe("1.000");
    // the bar grows by 120px: the oracle moves DOWN the flow while the pane stays exactly where it is, so
    // only a re-measurement can correct the ramp — a scroll-frame write would keep publishing 1.000
    setBase(BASE + 120);
    await act(async () => {
      fireResizeObservers();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(oracle.style.getPropertyValue(P)).toBe("0.500");
    bar.remove();
  });

  it("REMEASURES when a PINNED PLAN mounts above it — with the thread length unchanged", async () => {
    // Codex G3 M3, half two, and the reason `hasPinnedPlan` is its own dependency: `task_plan` can land
    // inside the assistant message that is already streaming, so `messages.length` — what the bottom-pin
    // re-sync keys on — never moves. The panel still displaces the entire flow below it by its height.
    setThemeSetting("gacha", "planPlacement", "pinned");
    chat.view = view([userMsg("go")]);
    const { container, scroller, setPos, setBase, rerender } = await mountAgent(
      <GachaAgent active />,
    );
    const oracle = container.querySelector<HTMLElement>(".gc-oracle")!;
    await scrollTo(scroller, setPos, BASE + 240);
    expect(oracle.style.getPropertyValue(P)).toBe("1.000");
    expect(screen.queryByTestId("pinned-panel")).toBeNull();

    chat.view = view([userMsg("go")], { steps: [{ text: "wake pegasus", status: "pending" }] });
    setBase(BASE + 120); // the panel's height, pushing the oracle down
    await act(async () => rerender(<GachaAgent active />));
    await frame();
    expect(screen.getByTestId("pinned-panel")).toBeTruthy();
    expect(oracle.style.getPropertyValue(P)).toBe("0.500");
  });
});

describe("GachaAgent — the three-state backdrop (D70 §8.3a item 5)", () => {
  /** The theme's OWN oracle drop — the fallback tier the agent's picture has to beat. */
  const themeOracle = {
    ns: "gacha",
    collation: "library-v1",
    roles: {
      oracle: [
        {
          name: "eye",
          file: "eye.webp",
          url: "/api/media/gacha/files/oracle/eye.webp",
          format: "webp",
          size_bytes: 1,
          revision: "1:1",
          width: 1,
          height: 1,
          unusable: false,
          unusable_reason: null,
        },
      ],
    },
    slots: {},
  } as unknown as MediaIndex;

  it("operator: the ACTIVE AGENT's background WINS the ladder over the theme's own oracle art", () => {
    media.data = themeOracle;
    agentArt.bg = { url: "/api/media/agents/files/backgrounds/lynette.webp?rev=3%3A9" };
    const { container } = render(<GachaAgent active />);
    // The oracle SURFACE is unchanged — plate, scanline, the lot; only the picture in it changed.
    expect(container.querySelector(".gc-oracle")).not.toBeNull();
    expect(
      container.querySelector<HTMLImageElement>(".gc-oracle-face.sharp .gc-oracle-art")?.src,
    ).toContain("/api/media/agents/files/backgrounds/lynette.webp");
    expect(container.querySelector(".kit-backdrop-pin")).toBeNull(); // no kit layer in this mode
  });

  it("operator: with no agent picture the theme's own drop still answers (today's ladder, unchanged)", () => {
    media.data = themeOracle;
    const { container } = render(<GachaAgent active />);
    expect(
      container.querySelector<HTMLImageElement>(".gc-oracle-face.sharp .gc-oracle-art")?.src,
    ).toContain("/api/media/gacha/files/oracle/eye.webp");
  });

  it("full: the ORACLE does not mount at all — the shared kit arrangement paints the same art", () => {
    media.data = themeOracle;
    agentArt.bg = { url: "/api/media/agents/files/backgrounds/lynette.webp?rev=3%3A9" };
    setUI({ agentBackdrop: "full" });
    const { container } = render(<GachaAgent active />);
    // The plate + scanline are ABSENT while `full` is active (owner-accepted, §8.3a item 4).
    expect(container.querySelector(".gc-oracle")).toBeNull();
    expect(container.querySelector(".gc-oracle-scan")).toBeNull();
    const layer = container.querySelector(".kit-backdrop-pin");
    expect(layer).not.toBeNull();
    expect(layer!.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector<HTMLImageElement>(".kit-backdrop-art")?.src).toContain(
      "/api/media/agents/files/backgrounds/lynette.webp",
    );
  });

  it("full: with no agent picture the THEME's fallback paints full-bleed (§8.3a item 5)", () => {
    media.data = themeOracle;
    setUI({ agentBackdrop: "full" });
    const { container } = render(<GachaAgent active />);
    expect(container.querySelector<HTMLImageElement>(".kit-backdrop-art")?.src).toContain(
      "/api/media/gacha/files/oracle/eye.webp",
    );
  });

  it("full: the oracle FADE DRIVER does not run — no ghost copy, and nothing to write on", async () => {
    // The driver writes `--gc-oracle-p` on an element that isn't in the DOM in this mode; the gate is the
    // same boolean the ghost copy keys on, so proving the surface is gone proves both.
    media.data = themeOracle;
    setUI({ themeSettings: { gacha: { oracle: true } }, agentBackdrop: "full" });
    const { container } = render(<GachaAgent active />);
    await act(async () => {});
    expect(container.querySelector(".gc-oracle-face.soft")).toBeNull();
    expect(container.querySelector(".gc-oracle-anchor")).toBeNull();
  });

  it("off: the oracle KEEPS its plate + scanline and paints NO picture, agent art and drop alike", () => {
    // `off` beats the whole ladder (§8.3's F14 correction) — including an agent that HAS a background —
    // and it reuses the shipped art-resolved-null presentation rather than inventing chrome removal.
    media.data = themeOracle;
    agentArt.bg = { url: "/api/media/agents/files/backgrounds/lynette.webp?rev=3%3A9" };
    setUI({ agentBackdrop: "off" });
    const { container } = render(<GachaAgent active />);
    expect(container.querySelector(".gc-oracle")).not.toBeNull();
    expect(container.querySelector(".gc-oracle-scan")).not.toBeNull();
    expect(screen.getByRole("heading", { name: /Lucky Relay/ })).toBeTruthy();
    expect(container.querySelectorAll(".gc-oracle-art")).toHaveLength(0);
    expect(container.querySelector(".kit-backdrop-pin")).toBeNull();
  });

  it("an unknown persisted mode HEALS to operator rather than hiding the art", () => {
    media.data = themeOracle;
    setUI({ agentBackdrop: "sideways" as never });
    const { container } = render(<GachaAgent active />);
    expect(container.querySelector(".gc-oracle-face.sharp .gc-oracle-art")).not.toBeNull();
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
