import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// THE MIC GESTURE'S WIRING (Phase 24 / S0.5 — LIVE_VOICE_PLAN §6, D71). The pure machine is pinned arm
// by arm in `micGestureMachine.test.ts`; what is pinned HERE is the half a reducer cannot state: that
// each outcome reaches the ONE recorder correctly, through the real `useDictation` driven by the shared
// MediaRecorder fakes — a release uploads, a cancel does not, a `pointercancel` keeps the mic open, the
// keyboard door is open exactly once, and all three composer variants carry the same contract.
//
// Nothing about the mic is mocked below the composer: `useComposer` → `useDictation` → MediaRecorder is
// the real chain, so "the gesture changes capture ergonomics, not send policy" is a property these
// cases can actually observe (the transcript lands in the draft, or routes, exactly as dictation does).

const voice = vi.hoisted(() => ({ live: false, autoSend: false }));

vi.mock("../../src/hooks/useVoiceStatus", () => ({
  useVoiceStatus: () => ({
    data: { stt: true, tts: false, stt_auto_send: voice.autoSend, live: voice.live },
    dataUpdatedAt: 1,
  }),
}));
// Only the ROUTING verb is faked — the module has many other exports the composer subtree reads.
vi.mock("../../src/lib/composer", async (importActual) => {
  const actual = await importActual<typeof import("../../src/lib/composer")>();
  return { ...actual, runComposer: vi.fn(() => true) };
});
vi.mock("../../src/store/chat", async (importActual) => {
  const actual = await importActual<typeof import("../../src/store/chat")>();
  return { ...actual, sendMessage: vi.fn(), stopTurn: vi.fn() };
});

import { KitComposer } from "../../src/theme-engine/kit/composer/Composer";
import { LineComposer } from "../../src/theme-engine/kit/composer/LineComposer";
import { SheetComposer } from "../../src/theme-engine/kit/composer/SheetComposer";
import {
  ACTIVATE_MS,
  CHIP_MS,
  LOCK_HINT_COUNT_MS,
  LOCK_HINT_MAX,
  LOCK_PX,
} from "../../src/theme-engine/kit/composer/useMicGesture";
import { runComposer } from "../../src/lib/composer";
import { clearDraft, getDraft } from "../../src/store/composer";
import { getUI, setUI } from "../../src/store/ui";
import {
  FakeMediaRecorder,
  gateMediaDevices,
  mockStt,
  setMediaDevices,
} from "../hooks/dictationFakes";

const VARIANTS = [
  ["stacked", KitComposer],
  ["sheet", SheetComposer],
  ["line", LineComposer],
] as const;

/** Long enough to clear `useDictation`'s 1000 ms floor — a real recording, not a blip. */
const HELD_MS = 1200;
const PID = 1;
/** The gesture starts wherever; jsdom lays nothing out, so these are just the coordinate origin. */
const X0 = 300;
const Y0 = 700;

const mic = () => screen.getByRole("button", { name: /dictation|microphone|voice call/i });
const cancelBtn = () => document.querySelector<HTMLButtonElement>(".mg-cancel");
const chip = () => document.querySelector<HTMLButtonElement>(".mg-chip");
const hint = () => document.querySelector(".mg-hint")?.textContent ?? null;
const posts = () => vi.mocked(globalThis.fetch).mock.calls.length;

/** Let timers fire and every promise they woke settle (the start path awaits `getUserMedia`). */
async function tick(ms = 0) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** jsdom lays nothing out — a stubbed rect is how a test states where an element sits. */
const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  x: left,
  y: top,
  toJSON: () => ({}),
});

function down(x = X0, y = Y0) {
  fireEvent.pointerDown(mic(), { pointerId: PID, button: 0, clientX: x, clientY: y });
}
function move(x: number, y: number) {
  fireEvent.pointerMove(mic(), { pointerId: PID, clientX: x, clientY: y });
}
function up() {
  fireEvent.pointerUp(mic(), { pointerId: PID });
}

/** Press and hold past the activation window — the recorder is armed and recording on return. */
async function hold() {
  down();
  await tick(ACTIVATE_MS + 10);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  setMediaDevices(true);
  mockStt(200, { text: "hello world" });
  clearDraft();
  voice.live = false;
  voice.autoSend = false;
  setUI({ micLockHintShown: 0, micLockHintRetired: false });
  vi.mocked(runComposer).mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the hold → release leg, against today's dictation pipeline", () => {
  it("a hold that is released uploads the clip and lands the transcript in the draft", async () => {
    render(<KitComposer />);
    await hold();
    expect(mic().className).toContain("rec");
    await tick(HELD_MS);
    up();
    await tick(10);
    expect(posts()).toBe(1);
    expect(getDraft()).toBe("hello world"); // review-then-send, exactly as the tap always did
    expect(runComposer).not.toHaveBeenCalled();
  });

  it("…and with `stt_auto_send` on it routes instead — the gesture changes capture, not send policy", async () => {
    voice.autoSend = true;
    render(<KitComposer />);
    await hold();
    await tick(HELD_MS);
    up();
    await tick(10);
    expect(runComposer).toHaveBeenCalledWith("hello world");
  });

  it("a blip under the 1000 ms floor is discarded with NO POST at all", async () => {
    render(<KitComposer />);
    await hold();
    await tick(300); // released well inside the floor
    up();
    await tick(10);
    expect(posts()).toBe(0);
    expect(getDraft()).toBe("");
  });
});

// The review wave's races: a gesture may only ever close ITSELF out, and only the pointer that owns a
// gesture may touch it. Both are invisible to the pure machine — they live in the async/multi-pointer
// seams of the wiring — so this is the layer that can state them.
describe("one gesture never reaches into another (review wave)", () => {
  it("a stale acquisition's `false` never idles the NEXT gesture (F1)", async () => {
    const gate = gateMediaDevices(); // getUserMedia parks until the test opens it
    render(<KitComposer />);
    await hold(); // A activates and parks inside the acquisition window…
    up(); // …and is released THERE, which aborts the attempt
    await tick(10);
    await hold(); // B: a fresh gesture, its own start()
    await act(async () => {
      gate.open(); // both attempts resolve now — A's first, and A's resolves `false`
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    // A's `false` belongs to a gesture that is already gone. B is recording, and its chrome says so —
    // the failure this pins is a closed chrome over a recorder that keeps recording invisibly.
    expect(document.querySelector(".mg-circle")).not.toBeNull();
    expect(mic().className).toContain("rec");
  });

  it("a FOREIGN finger neither restarts nor kills the owner's activation, nor burns its click guard (F3)", async () => {
    render(<KitComposer />);
    down(); // finger 1 presses
    await tick(100); // 100 ms into the 150 ms activation window
    fireEvent.pointerDown(mic(), { pointerId: 2, button: 0, clientX: X0, clientY: Y0 });
    fireEvent.pointerUp(mic(), { pointerId: 2 });
    await tick(60); // finger 1 is now 160 ms in: its OWN timer must have fired, on its own schedule
    expect(mic().className).toContain("rec");
    expect(document.querySelector(".mg-circle")).not.toBeNull();
    // …and finger 1 still owns the trailing click its release produces: the keyboard door stays shut.
    await tick(HELD_MS);
    up();
    await tick(10); // the upload settles; well inside the 50 ms the guard is armed for
    expect(posts()).toBe(1); // the release uploaded, once…
    fireEvent.click(mic());
    await tick(10);
    expect(mic().className).not.toContain("rec"); // …and the swallowed click started nothing
  });
});

describe("slide-left cancel", () => {
  it("discards the recording — no POST, no draft", async () => {
    render(<KitComposer />);
    await hold();
    await tick(HELD_MS); // a clip long enough to upload, so only the CANCEL can explain the silence
    move(X0 - 400, Y0); // past the full cancel distance → commits during the drag
    up();
    await tick(10);
    expect(posts()).toBe(0);
    expect(getDraft()).toBe("");
    expect(mic().className).not.toContain("rec");
  });

  it("a partial slide released short of 55% still sends", async () => {
    render(<KitComposer />);
    await hold();
    await tick(HELD_MS);
    move(X0 - 20, Y0);
    up();
    await tick(10);
    expect(posts()).toBe(1);
  });
});

describe("swipe-up lock (hands-free)", () => {
  it("latches on crossing, raises the CANCEL tap twin, and the button becomes tap-to-stop", async () => {
    render(<KitComposer />);
    await hold();
    expect(cancelBtn()).toBeNull(); // no tap twin while the hand is on the button
    move(X0, Y0 - LOCK_PX);
    await tick(0);
    expect(cancelBtn()).not.toBeNull(); // the hand is free → a real, focusable CANCEL exists
    up(); // the LOCKING pointer's own release must not stop anything
    await tick(HELD_MS);
    expect(mic().className).toContain("rec");
    // a FRESH tap on the button stops it, through the ordinary upload path
    fireEvent.pointerDown(mic(), { pointerId: 2, button: 0, clientX: X0, clientY: Y0 });
    fireEvent.pointerUp(mic(), { pointerId: 2 });
    await tick(10);
    expect(posts()).toBe(1);
    expect(getDraft()).toBe("hello world");
  });

  it("the CANCEL twin discards instead", async () => {
    render(<KitComposer />);
    await hold();
    move(X0, Y0 - LOCK_PX);
    await tick(HELD_MS);
    fireEvent.click(cancelBtn()!);
    await tick(10);
    expect(posts()).toBe(0);
    expect(getDraft()).toBe("");
  });

  it("a locked recording that ends on its own (silence auto-stop, hidden page) closes the chrome", async () => {
    render(<KitComposer />);
    await hold();
    move(X0, Y0 - LOCK_PX);
    await tick(HELD_MS);
    // the recorder stops from underneath the gesture, exactly as the R51 detector does
    await act(async () => {
      FakeMediaRecorder.last?.stop();
      await Promise.resolve();
    });
    await tick(10);
    expect(cancelBtn()).toBeNull();
    expect(document.querySelector(".mg-circle")).toBeNull();
  });
});

describe("`pointercancel` never loses audio (the iron rule)", () => {
  it("promotes an in-flight recording to LOCKED rather than discarding it", async () => {
    render(<KitComposer />);
    await hold();
    fireEvent.pointerCancel(mic(), { pointerId: PID });
    await tick(HELD_MS);
    expect(mic().className).toContain("rec"); // still recording…
    expect(cancelBtn()).not.toBeNull(); // …hands-free, with its tap twin up
    expect(posts()).toBe(0); // nothing uploaded, nothing discarded — it is still going
    // and it still ends the ordinary way
    fireEvent.pointerDown(mic(), { pointerId: 3, button: 0, clientX: X0, clientY: Y0 });
    fireEvent.pointerUp(mic(), { pointerId: 3 });
    await tick(10);
    expect(getDraft()).toBe("hello world");
  });
});

describe("Esc + the keyboard door (R69 §8.1/risk 5)", () => {
  it("Esc cancels a live recording", async () => {
    render(<KitComposer />);
    await hold();
    await tick(HELD_MS);
    fireEvent.keyDown(document, { key: "Escape" });
    await tick(10);
    expect(posts()).toBe(0);
    expect(mic().className).not.toContain("rec");
  });

  it("a KEYBOARD click starts a hands-free recording; a second one stops it", async () => {
    render(<KitComposer />);
    fireEvent.click(mic()); // no pointer session at all — Enter/Space, or an AT activation
    await tick(10);
    expect(mic().className).toContain("rec");
    expect(cancelBtn()).not.toBeNull(); // hands-free by construction: the twin is there immediately
    await tick(HELD_MS);
    fireEvent.click(mic());
    await tick(10);
    expect(posts()).toBe(1);
  });

  it("the click a POINTER TAP produces is swallowed — the machine owns taps, not onClick", async () => {
    render(<KitComposer />);
    down();
    up(); // a tap: under 150 ms, no travel
    fireEvent.click(mic()); // the trailing click every pointer sequence can still dispatch
    await tick(10);
    expect(mic().className).not.toContain("rec"); // a tap must never start a recording
    expect(posts()).toBe(0);
    expect(hint()).toBe("Hold to record"); // it taught the gesture instead
  });

  it("a keyboard start MEASURES the anchor — the chrome must not paint at the host's 0,0", async () => {
    // A keyboard session never runs `onPointerDown`, the only other place `measure` lives — without
    // this, the locked circle + CANCEL twin of a keyboard-first session land at the host's top-left
    // (main-seat audit F-B).
    render(<KitComposer />);
    const host = document.querySelector<HTMLElement>(".mic-gesture")!;
    mic().getBoundingClientRect = () => rect(340, 690, 32, 32);
    host.getBoundingClientRect = () => rect(0, 400, 393, 452);
    fireEvent.click(mic());
    await tick(10);
    expect(host.style.getPropertyValue("--mg-x")).toBe("356px"); // 340 + 32/2 − 0
    expect(host.style.getPropertyValue("--mg-y")).toBe("306px"); // 690 + 32/2 − 400
  });

  it("…and the swallow expires, so the next keyboard activation still works", async () => {
    render(<KitComposer />);
    down();
    up();
    await tick(200); // past CLICK_GUARD_MS
    fireEvent.click(mic());
    await tick(10);
    expect(mic().className).toContain("rec");
  });
});

describe("the hint budget (R69 §1.7)", () => {
  it("spends a show only once the hint has been fully visible", async () => {
    render(<KitComposer />);
    await hold();
    expect(getUI().micLockHintShown).toBe(0); // armed, not yet seen
    await tick(LOCK_HINT_COUNT_MS + 10);
    expect(getUI().micLockHintShown).toBe(1);
    expect(hint()).toBe("slide up to lock");
    up();
    await tick(10);
  });

  it("stops offering it after three, and RETIRES it forever on the first successful lock", async () => {
    setUI({ micLockHintShown: LOCK_HINT_MAX });
    const first = render(<KitComposer />);
    await hold();
    await tick(LOCK_HINT_COUNT_MS + 10);
    expect(hint()).toBeNull(); // budget spent
    move(X0, Y0 - LOCK_PX);
    await tick(0);
    expect(getUI().micLockHintRetired).toBe(true);
    first.unmount();
    // …and a fresh mount with the counter reset still never shows it again
    setUI({ micLockHintShown: 0 });
    render(<KitComposer />);
    await hold();
    await tick(LOCK_HINT_COUNT_MS + 10);
    expect(hint()).toBeNull();
    expect(getUI().micLockHintShown).toBe(0);
  });
});

describe("call mode is UNREACHABLE until the `live` bit exists (ruling 5)", () => {
  it("with the bit down a tap teaches the hold and never switches mode", async () => {
    render(<KitComposer />);
    down();
    up();
    await tick(10);
    expect(hint()).toBe("Hold to record");
    expect(mic().getAttribute("aria-label")).toBe("start dictation");
  });

  it("with the bit up the same tap flips the mode, and the mode rides the accessible NAME", async () => {
    voice.live = true;
    render(<KitComposer />);
    down();
    up();
    await tick(10);
    expect(mic().getAttribute("aria-label")).toBe("start a voice call");
    expect(hint()).toBe("Hold to call");
  });

  it("a call-mode hold that is released short of the threshold leaves a standing chip", async () => {
    voice.live = true;
    render(<KitComposer />);
    down();
    up(); // tap → call mode
    await tick(10);
    await hold(); // holds in CALL mode: nothing records
    expect(mic().className).not.toContain("rec");
    expect(posts()).toBe(0);
    up();
    await tick(0);
    expect(chip()?.textContent).toBe("Start call");
    await tick(CHIP_MS + 10);
    expect(chip()).toBeNull(); // it expires on its own
  });

  it("while the chip stands the BUTTON is inert — only the chip's own tap remains (§6)", async () => {
    voice.live = true;
    render(<KitComposer />);
    down();
    up(); // tap → call mode
    await tick(10);
    await hold(); // call-mode hold, released short of the threshold → the chip
    up();
    await tick(0);
    expect(chip()).not.toBeNull();
    // §6: "the button inert until the chip expires" — a press on the mic starts nothing and the
    // chip keeps standing (main-seat audit F-A; the pinned machine arm is its reducer twin).
    down();
    await tick(ACTIVATE_MS + 10);
    expect(mic().className).not.toContain("rec");
    expect(chip()).not.toBeNull();
    up();
    await tick(10);
    expect(chip()).not.toBeNull(); // it still ends only by its own tap or expiry
  });

  it("the `live` bit dropping takes the standing chip with it (F5)", async () => {
    // Repainting the mode is not enough: a chip left standing is still tappable, and its tap commits a
    // call the backend has just said it cannot take. The mode and everything call mode had in flight
    // go down together.
    voice.live = true;
    const { rerender } = render(<KitComposer />);
    down();
    up(); // tap → call mode
    await tick(10);
    await hold(); // a call-mode hold…
    up(); // …released short of the threshold → the standing chip
    await tick(0);
    expect(chip()).not.toBeNull();
    voice.live = false; // the bit goes down under us
    rerender(<KitComposer />);
    await tick(0);
    expect(chip()).toBeNull(); // gone with the mode — there is no tap left to commit a call
    expect(mic().getAttribute("aria-label")).toBe("start dictation");
  });

  it("`live` dropping during a call-mode PRESS never re-enters call mode (confirm sweep)", async () => {
    // The press SNAPSHOTS its mode, so escaping only callArm/chip left a hole: the still-armed
    // activation timer would carry a call-mode press straight into `callArm` after the bit fell —
    // and its release could still raise the chip. A call-mode press is closed with the rest.
    voice.live = true;
    const { rerender } = render(<KitComposer />);
    down();
    up(); // tap → call mode
    await tick(10);
    down(); // a call-mode press, inside the 150 ms activation window
    voice.live = false; // the bit falls mid-press
    rerender(<KitComposer />);
    await tick(ACTIVATE_MS + 10); // the timer fires — into an already-escaped machine
    up();
    await tick(10);
    expect(chip()).toBeNull(); // no chip: the release landed on an idle machine
    expect(mic().className).not.toContain("rec"); // and nothing recorded either
  });
});

describe("all three variants carry the same contract", () => {
  it.each(VARIANTS)("%s: the gesture is wired and there is no `aria-pressed`", async (_id, V) => {
    render(<V />);
    const btn = mic();
    // `touch-action: none` is STATIC in CSS on this class (R69 risk 11) — jsdom loads no stylesheet,
    // so what a unit test can pin is the HOOK the rule keys on.
    expect(btn.className).toContain("kit-cbtn");
    expect(btn.className).toContain("mic");
    // the MODE rides the name; `aria-pressed` is gone from every variant (R69 §8.3/§9).
    expect(btn.hasAttribute("aria-pressed")).toBe(false);
    expect(document.querySelector(".mic-gesture")).not.toBeNull();
    await hold();
    expect(btn.className).toContain("rec");
    expect(document.querySelector(".mg-circle")).not.toBeNull();
    await tick(HELD_MS);
    up();
    await tick(10);
    expect(getDraft()).toBe("hello world");
  });

  it.each(VARIANTS)("%s: slide-left cancels without a POST", async (_id, V) => {
    render(<V />);
    await hold();
    await tick(HELD_MS);
    move(X0 - 400, Y0);
    up();
    await tick(10);
    expect(posts()).toBe(0);
  });

  it.each(VARIANTS)("%s: the call gate answers to the `live` bit, both ways", async (_id, V) => {
    const off = render(<V />);
    down();
    up();
    await tick(10);
    expect(mic().getAttribute("aria-label")).toBe("start dictation");
    off.unmount();

    voice.live = true;
    render(<V />);
    down();
    up();
    await tick(10);
    expect(mic().getAttribute("aria-label")).toBe("start a voice call");
  });
});
