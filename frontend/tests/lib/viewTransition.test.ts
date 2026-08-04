import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runNavTransition,
  runViewTransition,
  skipActiveViewTransition,
} from "../../src/lib/viewTransition";
import { setUI } from "../../src/store/ui";

// `lib/viewTransition.ts#runViewTransition` (D52 / GACHA_PLAN §10.1) — the ONE View-Transition wrapper,
// extracted from switchTheme so the gacha tab transition reuses it instead of hand-rolling a second copy.
// The contract under test is exactly the three things the original inline block did (feature detect ·
// reduced-motion bypass · flushSync-inside-the-snapshot) plus the added `html[data-transition]` stamp.
//
// jsdom has NO `document.startViewTransition`, so the "unsupported" arm is the environment's default and
// the supported arm installs a controllable fake (the same shape switchTheme's own suite assumes).

interface FakeTransition {
  ready: Promise<void>;
  finished: Promise<void>;
  skipTransition: ReturnType<typeof vi.fn>;
  settle: () => void;
  rejectReady: (err: Error) => void;
  rejectFinished: (err: Error) => void;
  /** `html[data-transition]` as it stood WHEN `startViewTransition` was entered — the value the real API
   *  would capture the "old" state under. Asserting on this (not on the attribute after the wrapper
   *  returns) is what proves a retire/stamp landed BEFORE the capture, not merely before the return. */
  stampAtStart: string | undefined;
}

interface FakeVT {
  transitions: FakeTransition[];
  calls: number;
}

/** Install a fake `document.startViewTransition` that records the callback and hands back controllable
 *  ready/finished promises (rejectable INDEPENDENTLY — the real API can settle one and skip the other). */
function installFakeVT(): FakeVT {
  const state: FakeVT = { transitions: [], calls: 0 };
  (document as unknown as { startViewTransition: unknown }).startViewTransition = (
    cb: () => void,
  ) => {
    state.calls += 1;
    let settleReady!: () => void;
    let settleFinished!: () => void;
    let rejectReady!: (e: Error) => void;
    let rejectFinished!: (e: Error) => void;
    const ready = new Promise<void>((res, rej) => {
      settleReady = () => {
        res();
      };
      rejectReady = rej;
    });
    const finished = new Promise<void>((res, rej) => {
      settleFinished = () => {
        res();
      };
      rejectFinished = rej;
    });
    const t: FakeTransition = {
      ready,
      finished,
      skipTransition: vi.fn(),
      settle: () => {
        settleReady();
        settleFinished();
      },
      rejectReady,
      rejectFinished,
      stampAtStart: document.documentElement.dataset.transition,
    };
    state.transitions.push(t);
    cb(); // the real API runs the callback synchronously to capture the "new" state
    return t;
  };
  return state;
}

function removeFakeVT(): void {
  delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
}

/** Drain the microtask queue so promise `.then/.finally` handlers have run. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

beforeEach(() => {
  setUI({ motion: "full" });
  delete document.documentElement.dataset.transition;
});

afterEach(() => {
  removeFakeVT();
  delete document.documentElement.dataset.transition;
});

describe("runViewTransition — the unsupported path (jsdom: no startViewTransition)", () => {
  it("applies the update synchronously", () => {
    const update = vi.fn();
    runViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("does NOT stamp html[data-transition] (nothing is transitioning)", () => {
    runViewTransition(() => {}, "tab");
    expect(document.documentElement.dataset.transition).toBeUndefined();
  });
});

describe("runViewTransition — reduced motion", () => {
  it("bypasses the API entirely even where it exists (the app's motion axis, not the OS query)", () => {
    const vt = installFakeVT();
    setUI({ motion: "reduced" });
    const update = vi.fn();
    runViewTransition(update, "tab");
    expect(update).toHaveBeenCalledTimes(1); // still applied…
    expect(vt.calls).toBe(0); // …but never wrapped
    expect(document.documentElement.dataset.transition).toBeUndefined();
  });
});

describe("runViewTransition — the supported path", () => {
  it("wraps the update in a transition and applies it synchronously", () => {
    const vt = installFakeVT();
    const update = vi.fn();
    runViewTransition(update);
    expect(vt.calls).toBe(1);
    expect(update).toHaveBeenCalledTimes(1); // flushSync ⇒ committed before we return
  });

  it("stamps html[data-transition] for the given type and clears it when the transition settles", async () => {
    const vt = installFakeVT();
    runViewTransition(() => {}, "tab");
    expect(document.documentElement.dataset.transition).toBe("tab");
    vt.transitions[0].settle();
    await flushMicrotasks();
    expect(document.documentElement.dataset.transition).toBeUndefined();
  });

  it("leaves the DOM applied and swallows a skipped transition's `ready` rejection", async () => {
    const vt = installFakeVT();
    const update = vi.fn();
    runViewTransition(update);
    vt.transitions[0].rejectReady(new Error("AbortError"));
    // The callback already ran, so the state is correct regardless of the rejection…
    expect(update).toHaveBeenCalledTimes(1);
    // …and the rejection must not surface as an unhandled rejection (vitest fails the run on one).
    await flushMicrotasks();
    vt.transitions[0].settle();
  });
});

// ── The hardening delta over the extracted block (D52: "catch BOTH `.ready` AND `.finished`, and make the
//    `data-transition` cleanup race-safe"). Both cases are real: starting a second transition SKIPS the
//    running one, which rejects BOTH its promises and settles them AFTER the newer one has stamped. ──
describe("runViewTransition — hardening", () => {
  it("swallows a SKIPPED transition's `finished` rejection and still clears the stamp", async () => {
    const vt = installFakeVT();
    runViewTransition(() => {}, "tab");
    expect(document.documentElement.dataset.transition).toBe("tab");
    // `.finally()` would re-throw here → an unhandled rejection (vitest fails the run on one); `.then(f,f)`
    // is what makes the cleanup total.
    vt.transitions[0].rejectReady(new Error("AbortError"));
    vt.transitions[0].rejectFinished(new Error("AbortError"));
    await flushMicrotasks();
    expect(document.documentElement.dataset.transition).toBeUndefined();
  });

  it("an OLDER transition settling late cannot delete the NEWER one's stamp (the token guard)", async () => {
    const vt = installFakeVT();
    runViewTransition(() => {}, "tab"); // T1 stamps "tab"
    runViewTransition(() => {}, "detail"); // T2 supersedes → stamps "detail"
    expect(document.documentElement.dataset.transition).toBe("detail");

    // T1 is the one the browser skipped; its promises settle now, long after T2 took over.
    vt.transitions[0].rejectReady(new Error("AbortError"));
    vt.transitions[0].rejectFinished(new Error("AbortError"));
    await flushMicrotasks();
    expect(document.documentElement.dataset.transition).toBe("detail"); // T2's stamp survives

    // …and T2's own settle still clears it (the guard doesn't strand the attribute).
    vt.transitions[1].settle();
    await flushMicrotasks();
    expect(document.documentElement.dataset.transition).toBeUndefined();
  });

  it("an UNTYPED transition RETIRES the running typed one's stamp, synchronously (Codex G4 F1)", async () => {
    // The bug: an untyped transition (the theme swap) stamps nothing, so the OLD `tab` attribute used to
    // survive until the superseded transition's `finished` settled — a frame or more later. For that window
    // the theme swap's own root cross-fade ran under M2's `[data-transition="tab"]` keyframes. The retire
    // must land BEFORE `start()`, i.e. before this call returns — a microtask would already be too late.
    const vt = installFakeVT();
    runViewTransition(() => {}, "tab");
    expect(document.documentElement.dataset.transition).toBe("tab");
    expect(vt.transitions[0].stampAtStart).toBe("tab"); // …and the typed stamp PRECEDED its capture
    runViewTransition(() => {}); // no type → owns nothing, but clears what it supersedes
    // The load-bearing assertion is the capture-time one: the fake records the attribute as it stood when
    // `startViewTransition` was ENTERED. Asserting only after the wrapper returned would also pass if the
    // retire happened after start() — exactly the regression this test exists to block (Codex confirm LOW).
    expect(vt.transitions[1].stampAtStart).toBeUndefined();
    expect(document.documentElement.dataset.transition).toBeUndefined();

    // …and the superseded transition settling later cannot resurrect it (its cleanup no-ops on the token).
    vt.transitions[0].rejectReady(new Error("AbortError"));
    vt.transitions[0].rejectFinished(new Error("AbortError"));
    await flushMicrotasks();
    expect(document.documentElement.dataset.transition).toBeUndefined();
    vt.transitions[1].settle();
    await flushMicrotasks();
    expect(document.documentElement.dataset.transition).toBeUndefined();
  });

  it("a TYPED transition started after an untyped one still stamps normally (the retire is not sticky)", async () => {
    const vt = installFakeVT();
    runViewTransition(() => {}); // untyped: nothing stamped, no owner
    runViewTransition(() => {}, "tab");
    expect(document.documentElement.dataset.transition).toBe("tab");
    vt.transitions[1].settle();
    await flushMicrotasks();
    expect(document.documentElement.dataset.transition).toBeUndefined();
  });
});

// ── THE SKIP's OWNERSHIP (G4 S1 — the bug the §10.1 VT probe caught). `skipActiveViewTransition` used to
//    end WHATEVER transition was running, from any caller: a gacha body tearing its own morph down killed
//    the navigation transition started microseconds earlier in the same commit, 100% of the time. The skip
//    is now scoped by the same `type` concept the stamp already rides — a caller may only end a KIND of
//    transition it itself starts. ──
describe("skipActiveViewTransition — the type-scoped ownership fix", () => {
  it("a `tab` transition SURVIVES a `detail`-scoped skip (the probe's kill, in miniature)", () => {
    const vt = installFakeVT();
    runViewTransition(() => {}, "tab");
    skipActiveViewTransition("detail");
    expect(vt.transitions[0].skipTransition).not.toHaveBeenCalled();
  });

  it("…and the OWNER of the kind still ends it", () => {
    const vt = installFakeVT();
    runViewTransition(() => {}, "detail");
    skipActiveViewTransition("detail");
    expect(vt.transitions[0].skipTransition).toHaveBeenCalledTimes(1);
  });

  it("accepts several kinds — one teardown may own more than one (gacha's detail + showcase)", () => {
    const vt = installFakeVT();
    runViewTransition(() => {}, "showcase");
    skipActiveViewTransition("detail", "showcase");
    expect(vt.transitions[0].skipTransition).toHaveBeenCalledTimes(1);
  });

  it("an UNTYPED transition (the theme swap) is owned by nobody and can never be skipped", () => {
    const vt = installFakeVT();
    runViewTransition(() => {});
    skipActiveViewTransition("tab", "detail", "showcase");
    expect(vt.transitions[0].skipTransition).not.toHaveBeenCalled();
  });

  it("only the LATEST transition is skippable — a superseded one is already gone", async () => {
    const vt = installFakeVT();
    runViewTransition(() => {}, "detail"); // T1
    runViewTransition(() => {}, "tab"); // T2 supersedes it (the browser skipped T1 itself)
    skipActiveViewTransition("detail");
    expect(vt.transitions[0].skipTransition).not.toHaveBeenCalled();
    expect(vt.transitions[1].skipTransition).not.toHaveBeenCalled();
  });

  it("forgets a transition once it has settled (no stale handle held forever)", async () => {
    const vt = installFakeVT();
    runViewTransition(() => {}, "detail");
    vt.transitions[0].settle();
    await flushMicrotasks();
    skipActiveViewTransition("detail");
    expect(vt.transitions[0].skipTransition).not.toHaveBeenCalled();
  });
});

// ── The NAVIGATION-TRANSITION DECORATOR (M2 — D52 / GACHA_PLAN §10.1), promoted from the G0 spike once
//    the `::view-transition-new(root)` liveness question was settled. The spike's localStorage flag is
//    gone; what these arms pin is what makes an unflagged wrapper safe in the shared nav chokepoint:
//    every theme but gacha still gets a plain update, gacha gets the `tab`-stamped transition, and the
//    reduced-motion / unsupported bypasses are the wrapper's, not a second copy. ──
describe("runNavTransition — the M2 decorator", () => {
  it("wraps a gacha navigation in a `tab`-stamped transition", async () => {
    const vt = installFakeVT();
    setUI({ theme: "gacha" });
    const update = vi.fn();
    runNavTransition(update);
    expect(vt.calls).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.transition).toBe("tab");
    vt.transitions[0].settle();
    await flushMicrotasks();
    expect(document.documentElement.dataset.transition).toBeUndefined();
  });

  it("leaves every OTHER theme's navigation a plain update (byte-identical to the direct setUI)", () => {
    const vt = installFakeVT();
    for (const theme of ["cosmos", "frontier", "vapor", "minimal"] as const) {
      setUI({ theme });
      const update = vi.fn();
      runNavTransition(update);
      expect(update).toHaveBeenCalledTimes(1);
    }
    expect(vt.calls).toBe(0);
    expect(document.documentElement.dataset.transition).toBeUndefined();
  });

  it("respects reduced motion on gacha too (it delegates, it does not re-implement the gates)", () => {
    const vt = installFakeVT();
    setUI({ theme: "gacha", motion: "reduced" });
    const update = vi.fn();
    runNavTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(vt.calls).toBe(0);
  });

  it("navigates instantly where the engine has no View Transitions at all", () => {
    // jsdom's own default — the progressive-enhancement floor: navigation is never gated on an animation.
    setUI({ theme: "gacha" });
    const update = vi.fn();
    runNavTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.transition).toBeUndefined();
  });
});
