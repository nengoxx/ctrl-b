import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startCall } from "../../src/store/liveCall";
import { KitComposer } from "../../src/theme-engine/kit/composer/Composer";
import { LineComposer } from "../../src/theme-engine/kit/composer/LineComposer";
import { SheetComposer } from "../../src/theme-engine/kit/composer/SheetComposer";
import {
  ACTIVATE_MS,
  CLICK_GUARD_MS,
  HINT_MS,
} from "../../src/theme-engine/kit/composer/useMicGesture";

// The transcribing spinner (owner ask 2026-07-30): while a recorded clip awaits its transcript
// (`useDictation` status `sending`) every composer's mic button swaps its glyph for the shared 8-bar
// SpinnerIcon and gains `.sending` (the CSS hook that rolls it). Lives in its OWN file because the
// pin needs BOTH mocks the other harnesses deliberately avoid: sttReady=true (so the mic mounts at
// all) AND a dictation hook frozen at `sending` (unreachable without driving MediaRecorder).
//
// D51 V4 phase 2: the fourth row — the bespoke `components/Composer` ("vapor: the CSS-masked button…") —
// was DELETED with the component it pinned. Vapor renders the `sheet` variant now, already covered above.
// ISS-83 widened the harness by two observable knobs, both HOISTED so a case can move them under a
// mounted composer: the `live` bit (the call door needs a second mode to reach) and the dictation
// status (a case taps into call mode while idle, THEN freezes at `sending`). The verbs are spies the
// mock hands out on every render, so "the press reached the recorder" is assertable at all.
const voice = vi.hoisted(() => ({ live: false }));
const dict = vi.hoisted(() => ({
  status: "sending", // a case may move it to "idle" and back
  toggle: vi.fn(),
  start: vi.fn(async () => true),
  stop: vi.fn(),
  cancel: vi.fn(),
  // ONE set of seam refs for the file: the gesture hook registers on them at mount, and a fresh
  // literal per render would hand it a different object every time.
  meter: { current: null },
  onTooShort: { current: null },
  onPending: { current: null },
  handsFree: { current: false },
  onLive: { current: null }, // S11 — the go seam
}));

vi.mock("../../src/hooks/useVoiceStatus", () => ({
  useVoiceStatus: () => ({ data: { stt: true, tts: false, live: voice.live }, dataUpdatedAt: 1 }),
}));
// The controller WIDENED at S0.5 (start/stop/cancel beside toggle) and again at its feel round (the two
// assignable seams, `meter`/`onTooShort`, which the gesture hook REGISTERS on mount) — the mic button's
// pointer wiring drives all of it, so a two-field stub would render a composer whose gesture hook
// explodes before the first press. Partial-mocked so the module's real constants still resolve; frozen
// at `sending` exactly as before unless a case moves `dict.status`, and every verb is an inert spy.
vi.mock("../../src/hooks/useDictation", async (importActual) => {
  const actual = await importActual<typeof import("../../src/hooks/useDictation")>();
  return { ...actual, useDictation: () => ({ ...dict }) };
});
// Real behaviour, observable: a hold-to-CALL that slipped through the door ends here (ISS-83).
vi.mock("../../src/store/liveCall", async (importActual) => {
  const actual = await importActual<typeof import("../../src/store/liveCall")>();
  return { ...actual, startCall: vi.fn() };
});

function renderWith(Comp: ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => createElement(QueryClientProvider, { client: qc }, createElement(Comp));
  const r = render(tree());
  // Re-render the SAME mounted tree (the gesture's mode lives in its state, and boots `mic` on mount),
  // so a moved `dict.status` reaches the composer without resetting what the case already set up.
  return { ...r, refresh: () => r.rerender(tree()) };
}

const PID = 1;
const micBtn = (c: HTMLElement) => c.querySelector<HTMLButtonElement>(".kit-cbtn.mic")!;
const gestureHost = (c: HTMLElement) => c.querySelector<HTMLElement>(".mic-gesture")!;
const press = (btn: HTMLButtonElement) =>
  fireEvent.pointerDown(btn, { pointerId: PID, button: 0, clientX: 300, clientY: 700 });
const lift = (btn: HTMLButtonElement) => fireEvent.pointerUp(btn, { pointerId: PID });
async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}
/** Nothing of a gesture is up: no stage left idle, no press styling, no chip, no hint bubble. */
function expectNoGesture(c: HTMLElement) {
  expect(gestureHost(c).dataset.stage).toBe("idle");
  expect(micBtn(c).classList.contains("pressing")).toBe(false);
  expect(c.querySelector(".mg-chip")).toBeNull();
  expect(c.querySelector(".mg-hint")).toBeNull();
}

beforeEach(() => {
  vi.useFakeTimers();
  voice.live = false;
  dict.status = "sending";
  for (const f of [dict.toggle, dict.start, dict.stop, dict.cancel]) f.mockClear();
  vi.mocked(startCall).mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("mic button while transcribing (status `sending`)", () => {
  it.each([
    ["stacked", KitComposer],
    ["sheet", SheetComposer],
    ["line", LineComposer],
  ] as const)(
    "%s: `.sending` + disabled + the 8-bar spinner replaces the mic glyph",
    (_id, Comp) => {
      const { container } = renderWith(Comp);
      const btn = container.querySelector<HTMLButtonElement>(".kit-cbtn.mic");
      expect(btn).not.toBeNull();
      expect(btn!.classList.contains("sending")).toBe(true);
      expect(btn!.disabled).toBe(true);
      // SpinnerIcon = exactly 8 bar paths, no <rect>; both mic glyphs carry a rect or a single path.
      expect(btn!.querySelectorAll("svg path")).toHaveLength(8);
      expect(btn!.querySelector("svg rect")).toBeNull();
    },
  );

  // ISS-83: `disabled` refuses `click` only — Chrome still dispatches POINTER events to a disabled
  // form control, and the gesture is a pointer machine, so the spinning button armed a press.
  it.each([
    ["stacked", KitComposer],
    ["sheet", SheetComposer],
    ["line", LineComposer],
  ] as const)(
    "%s: a press held past activation and released starts NO recording and paints NO chrome",
    async (_id, Comp) => {
      const { container } = renderWith(Comp);
      const btn = micBtn(container);
      press(btn);
      expectNoGesture(container); // refused at the door: not even the `press` stage
      await tick(ACTIVATE_MS + 10);
      expect(dict.start).not.toHaveBeenCalled();
      expectNoGesture(container);
      lift(btn);
      await tick(10);
      expect(dict.start).not.toHaveBeenCalled();
      expect(dict.stop).not.toHaveBeenCalled();
      expectNoGesture(container); // …and the release taught nothing either (a tap would flash a hint)
    },
  );

  it.each([
    ["stacked", KitComposer],
    ["sheet", SheetComposer],
    ["line", LineComposer],
  ] as const)(
    "%s: in CALL mode the same press reaches no call — no arm, no standing chip, no `startCall`",
    async (_id, Comp) => {
      voice.live = true;
      dict.status = "idle";
      const { container, refresh } = renderWith(Comp);
      press(micBtn(container));
      lift(micBtn(container)); // a tap while idle → call mode
      await tick(10);
      expect(micBtn(container).getAttribute("aria-label")).toBe("start a voice call");
      await tick(HINT_MS + 10); // the mode's hint expires on its own
      dict.status = "sending"; // the previous clip's POST is now in flight
      refresh();
      const btn = micBtn(container);
      expect(btn.disabled).toBe(true);
      press(btn);
      await tick(ACTIVATE_MS + 10);
      expectNoGesture(container);
      lift(btn);
      await tick(10);
      expectNoGesture(container); // a released call arm would have left the standing chip
      expect(startCall).not.toHaveBeenCalled();
      expect(dict.start).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["stacked", KitComposer],
    ["sheet", SheetComposer],
    ["line", LineComposer],
  ] as const)(
    "%s: in CALL mode a refused press that OUTLASTS the POST has its trailing click swallowed",
    async (_id, Comp) => {
      // The call-mode keyboard door is `startCall()` itself, so a trailing click that reached it would
      // dial — one step after the press the door refused. The release's click guard swallows it.
      voice.live = true;
      dict.status = "idle";
      const { container, refresh } = renderWith(Comp);
      press(micBtn(container));
      lift(micBtn(container)); // a tap while idle → call mode
      await tick(HINT_MS + 10); // past the tap's own guard and the mode's hint
      dict.status = "sending";
      refresh();
      press(micBtn(container)); // refused at the door
      dict.status = "idle"; // the POST lands WHILE the finger is still down
      refresh();
      const btn = micBtn(container);
      expect(btn.disabled).toBe(false);
      lift(btn);
      fireEvent.click(btn); // the trailing click, on a button that is enabled again
      await tick(0);
      expect(startCall).not.toHaveBeenCalled(); // swallowed
      expect(dict.start).not.toHaveBeenCalled();
      await tick(CLICK_GUARD_MS + 10);
      fireEvent.click(btn); // Enter/Space, past the guard
      expect(startCall).toHaveBeenCalledTimes(1); // the keyboard door works again
    },
  );

  it.each([
    ["stacked", KitComposer],
    ["sheet", SheetComposer],
    ["line", LineComposer],
  ] as const)("%s: the keyboard door (`click`) stays refused, as before", async (_id, Comp) => {
    const { container } = renderWith(Comp);
    fireEvent.click(micBtn(container)); // Enter/Space or an AT activation: no pointer session at all
    await tick(10);
    expect(dict.toggle).not.toHaveBeenCalled();
    expect(dict.start).not.toHaveBeenCalled();
    expectNoGesture(container);
  });
});
