import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runViewTransition } from "../../src/lib/viewTransition";
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
  settle: () => void;
  rejectReady: (err: Error) => void;
  rejectFinished: (err: Error) => void;
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
      settle: () => {
        settleReady();
        settleFinished();
      },
      rejectReady,
      rejectFinished,
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

  it("an UNTYPED transition never touches a running typed transition's stamp", async () => {
    const vt = installFakeVT();
    runViewTransition(() => {}, "tab");
    runViewTransition(() => {}); // no type → stamps nothing, owns nothing
    expect(document.documentElement.dataset.transition).toBe("tab");
    vt.transitions[1].settle();
    await flushMicrotasks();
    expect(document.documentElement.dataset.transition).toBe("tab");
    vt.transitions[0].settle();
    await flushMicrotasks();
    expect(document.documentElement.dataset.transition).toBeUndefined();
  });
});
