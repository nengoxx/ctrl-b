import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setUI } from "../../src/store/ui";
import { useCeremony, type CeremonyBeat } from "../../src/themes/gacha/ceremony";

// THE CEREMONY RUNNER (GACHA_PLAN §12.6 ruling 10 / R24 §B.3). Three properties, and each of them is a bug
// that has bitten this repo or the lab before: the motion gate must be the APP's preference and not the
// OS's, a skip must COMPLETE the sequence rather than abandon it half-applied, and no timer may outlive the
// component (a wake ceremony's beats close over a host id that can leave the fleet).
//
// Driven through a tiny host component rather than `renderHook`, because two of the three properties are
// about listeners and unmount.

/** A probe that starts one ceremony on demand and records the order its beats fire in. */
function Harness({ beats, total = 900 }: { beats: readonly CeremonyBeat[]; total?: number }) {
  const c = useCeremony();
  return (
    <div>
      <button type="button" data-testid="go" onClick={() => c.start(beats, total)}>
        go
      </button>
      <button type="button" data-testid="skip" onClick={() => c.skip()}>
        skip
      </button>
      <span data-testid="running">{String(c.running)}</span>
    </div>
  );
}

/** `[beats, log]` — four beats on the poster's own schedule, each pushing its name. */
function fourBeats(): [CeremonyBeat[], string[]] {
  const log: string[] = [];
  return [
    [
      [0, () => log.push("part")],
      [180, () => log.push("flash-on")],
      [700, () => log.push("part-off")],
      [880, () => log.push("flash-off")],
    ],
    log,
  ];
}

beforeEach(() => {
  setUI({ motion: "full" });
  vi.useFakeTimers();
});
afterEach(() => {
  try {
    cleanup();
  } finally {
    vi.useRealTimers();
    setUI({ motion: "full" });
  }
});

describe("useCeremony — the beats", () => {
  it("fires each beat at its own offset and drops `running` at the budget", () => {
    const [beats, log] = fourBeats();
    const { getByTestId } = render(<Harness beats={beats} />);
    fireEvent.click(getByTestId("go"));
    expect(getByTestId("running").textContent).toBe("true");

    act(() => void vi.advanceTimersByTime(0));
    expect(log).toEqual(["part"]);
    act(() => void vi.advanceTimersByTime(180));
    expect(log).toEqual(["part", "flash-on"]);
    act(() => void vi.advanceTimersByTime(700));
    expect(log).toEqual(["part", "flash-on", "part-off", "flash-off"]);
    // still in flight until the budget — the last beat is not the end of the ceremony
    expect(getByTestId("running").textContent).toBe("true");
    act(() => void vi.advanceTimersByTime(20));
    expect(getByTestId("running").textContent).toBe("false");
  });

  it("REFUSES a second ceremony while one is in flight (two on one stack read as a glitch)", () => {
    const [beats, log] = fourBeats();
    const { getByTestId } = render(<Harness beats={beats} />);
    fireEvent.click(getByTestId("go"));
    act(() => void vi.advanceTimersByTime(200));
    fireEvent.click(getByTestId("go")); // ignored
    act(() => void vi.advanceTimersByTime(900));
    expect(log).toEqual(["part", "flash-on", "part-off", "flash-off"]);
  });
});

describe("useCeremony — tap-anywhere-skip (R24 §B.3)", () => {
  it("COMPLETES every remaining beat, in order, and ends immediately", () => {
    const [beats, log] = fourBeats();
    const { getByTestId } = render(<Harness beats={beats} />);
    fireEvent.click(getByTestId("go"));
    act(() => void vi.advanceTimersByTime(200)); // two beats in
    expect(log).toEqual(["part", "flash-on"]);

    act(() => void fireEvent.pointerDown(document.body));
    // the remaining two ran — a skip must never leave half the state applied
    expect(log).toEqual(["part", "flash-on", "part-off", "flash-off"]);
    expect(getByTestId("running").textContent).toBe("false");

    // …and nothing fires twice once the timers are gone
    act(() => void vi.advanceTimersByTime(2000));
    expect(log).toEqual(["part", "flash-on", "part-off", "flash-off"]);
  });

  it("only listens WHILE running — a tap before or after is nothing", () => {
    const [beats, log] = fourBeats();
    const { getByTestId } = render(<Harness beats={beats} />);
    act(() => void fireEvent.pointerDown(document.body));
    expect(log).toEqual([]);
    fireEvent.click(getByTestId("go"));
    act(() => void vi.advanceTimersByTime(900));
    expect(log).toHaveLength(4);
    act(() => void fireEvent.pointerDown(document.body));
    expect(log).toHaveLength(4);
  });

  it("`skip()` is idempotent and safe with nothing in flight", () => {
    const [beats, log] = fourBeats();
    const { getByTestId } = render(<Harness beats={beats} />);
    fireEvent.click(getByTestId("skip"));
    expect(log).toEqual([]);
    fireEvent.click(getByTestId("go"));
    fireEvent.click(getByTestId("skip"));
    fireEvent.click(getByTestId("skip"));
    expect(log).toHaveLength(4);
  });
});

describe("useCeremony — the motion gate is the APP's, not the OS's", () => {
  it("under `reduced` the beats COLLAPSE to the end state instantly, announcements included", () => {
    setUI({ motion: "reduced" });
    const [beats, log] = fourBeats();
    const { getByTestId } = render(<Harness beats={beats} />);
    const before = vi.getTimerCount(); // React/jsdom keep their own; the DELTA is the claim
    fireEvent.click(getByTestId("go"));
    // every beat has already run, no timer was scheduled, and nothing is "in flight" to skip
    expect(log).toEqual(["part", "flash-on", "part-off", "flash-off"]);
    expect(getByTestId("running").textContent).toBe("false");
    expect(vi.getTimerCount()).toBe(before);
  });
});

describe("useCeremony — no timer outlives the component", () => {
  it("unmount clears the sequence rather than firing it into a dead tree", () => {
    const [beats, log] = fourBeats();
    const { getByTestId, unmount } = render(<Harness beats={beats} />);
    fireEvent.click(getByTestId("go"));
    act(() => void vi.advanceTimersByTime(100));
    expect(log).toEqual(["part"]);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => void vi.advanceTimersByTime(2000));
    expect(log).toEqual(["part"]);
  });
});
