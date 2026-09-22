import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CallDebug } from "../../src/hooks/useLiveCall";
import type { AwaitingConfirm } from "../../src/store/chat";

const h = vi.hoisted(() => {
  const call: {
    phase: string;
    heard: string;
    note: string | null;
    userSpeechActive: boolean;
    muted: boolean;
    interrupt: ReturnType<typeof vi.fn>;
    toggleMute: ReturnType<typeof vi.fn>;
    route: string;
    inputDevice: string;
    canRoute: boolean;
    setRoute: ReturnType<typeof vi.fn>;
    setInputDevice: ReturnType<typeof vi.fn>;
    vad: number | null;
    setVad: ReturnType<typeof vi.fn>;
    debug: CallDebug | null;
  } = {
    phase: "listening",
    heard: "",
    note: null,
    userSpeechActive: false,
    muted: false,
    interrupt: vi.fn(),
    toggleMute: vi.fn(),
    route: "speaker",
    inputDevice: "",
    canRoute: true,
    setRoute: vi.fn(),
    setInputDevice: vi.fn(),
    vad: 0.9,
    setVad: vi.fn(),
    debug: null,
  };
  return {
    call,
    ring: true,
    /** Whether `/voice/status` has answered yet. */
    knobs: true,
    awaiting: null as { callId: string; tool: string } | null,
    resumeCall: vi.fn(),
    startCall: vi.fn(),
    close: vi.fn(() => true),
  };
});

vi.mock("../../src/hooks/useLiveCall", () => ({ useLiveCall: () => h.call }));
vi.mock("../../src/hooks/useActiveBackdrop", () => ({ useActiveBackdrop: () => undefined }));
vi.mock("../../src/hooks/useVoiceStatus", () => ({
  // `data` is UNDEFINED until the query resolves, exactly as the real hook reports it — kept because
  // the ring's snapshot is taken AT MOUNT, so what that case does is a property worth stating (and the
  // reason it is unreachable is the call door, not this component).
  useVoiceStatus: () => (h.knobs ? { data: { live_call: { ring: h.ring } } } : { data: undefined }),
}));
vi.mock("../../src/store/chat", () => ({
  confirmAwaiting: (): AwaitingConfirm | null => h.awaiting,
  resumeCall: h.resumeCall,
  useChatSlice: <T,>(sel: () => T) => sel(),
}));
vi.mock("../../src/store/liveCall", () => ({ startCall: h.startCall }));

import { CallOverlay } from "../../src/theme-engine/kit/CallOverlay";

// kit/CallOverlay — the call screen's MODAL CONTRACT and its PRESENTATION (D71 §6). The machine itself
// is mocked (its rules live in `useLiveCall.test.ts`), so what is pinned here is everything the owner
// actually looks at and taps:
//
//  · the modal promises `aria-modal` makes — focus in on mount, Tab trapped, focus handed back;
//  · ONE EXIT: the button and Escape both call the shell's `close` — the back guard that owns the call's
//    history entry (its mechanics are pinned in useOverlayBackGuard.test, the trap itself in e2e);
//  · ONE INDICATOR per mode — the ring in ring mode, the transcript dot without it, never both;
//  · MUTE's flipping accessible name and its unmistakable static class;
//  · the in-overlay Allow/Deny row riding `resumeCall` — the same chokepoint and token as the chat card;
//  · the terminal faces, whose "Call again" is the SAME door a call starts from.

/** The app underneath: something focusable for the overlay to take focus FROM and give it back TO. */
function Host({ open }: { open: boolean }) {
  return (
    <div>
      <textarea aria-label="composer" />
      {open && <CallOverlay close={h.close} />}
    </div>
  );
}

const overlay = () => screen.getByRole("dialog");
const hangUp = () => screen.getByRole("button", { name: "Hang up" });

beforeEach(() => {
  cleanup(); // `globals: false` ⇒ RTL's auto-cleanup is not registered (the house pattern)
  h.call = {
    ...h.call,
    phase: "listening",
    heard: "",
    note: null,
    userSpeechActive: false,
    muted: false,
    route: "speaker",
    inputDevice: "",
    canRoute: true,
    vad: 0.9,
    debug: null,
  };
  h.call.interrupt.mockClear();
  h.call.toggleMute.mockClear();
  h.call.setRoute.mockClear();
  h.call.setInputDevice.mockClear();
  h.call.setVad.mockClear();
  h.ring = true;
  h.knobs = true;
  h.awaiting = null;
  h.resumeCall.mockClear();
  h.startCall.mockClear();
  h.close.mockClear();
});

describe("CallOverlay — the focus contract", () => {
  it("takes focus to hang up on mount, and hands it back on unmount", () => {
    const view = render(<Host open={false} />);
    const composer = screen.getByLabelText("composer");
    composer.focus();
    expect(document.activeElement).toBe(composer);

    view.rerender(<Host open={true} />);
    expect(document.activeElement).toBe(hangUp());

    view.rerender(<Host open={false} />);
    expect(document.activeElement).toBe(composer);
  });

  it("Tab cycles INSIDE the overlay — it never walks the app the dialog has hidden", () => {
    render(<Host open={true} />);
    // The browser's own Tab is what would leave the dialog, so the proof is that it is TAKEN OVER:
    // the default is prevented and the cycle lands back on the panel's own focusable set.
    for (const shiftKey of [false, true]) {
      const btn = document.activeElement as HTMLElement;
      const ev = createEvent.keyDown(btn, { key: "Tab", shiftKey });
      fireEvent(btn, ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(overlay().contains(document.activeElement)).toBe(true);
    }
  });

  it("Escape takes the SAME ONE EXIT the Back gesture does", () => {
    render(<Host open={true} />);
    fireEvent.keyDown(hangUp(), { key: "Escape" });
    // The shell's back guard owns the exit (`close`), and its popstate handler is what actually ends
    // the call — which is what keeps exactly one history entry per call, spent exactly once.
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  it("the hang-up BUTTON takes that same exit — never a second closing path", () => {
    render(<Host open={true} />);
    hangUp().click();
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  it("leaves the tap-to-interrupt surface alone (§4.3 trigger B)", () => {
    h.call = { ...h.call, phase: "speaking" };
    render(<Host open={true} />);
    fireEvent.pointerDown(overlay());
    expect(h.call.interrupt).toHaveBeenCalledTimes(1);
    // …and the control cluster still is not one: hanging up must never also be an interrupt.
    h.call.interrupt.mockClear();
    fireEvent.pointerDown(hangUp());
    expect(h.call.interrupt).not.toHaveBeenCalled();
  });
});

describe("CallOverlay — the two ring modes (§6)", () => {
  it("RING mode draws the stroke and drops the phase dot — one indicator, never two", () => {
    render(<Host open={true} />);
    expect(document.querySelector(".kit-call-ring-stroke")).not.toBeNull();
    expect(document.querySelector(".kit-call-dot")).toBeNull();
    expect(overlay().className).toContain("ring");
  });

  it("with no framing point to invert, the ring sets NO inline position — CSS owns the fallback", () => {
    render(<Host open={true} />);
    // The fallback anchor (centred, upper third) lives in `--call-ring-x/y`; an inline `left`/`top`
    // would override it, so the unanchorable case must leave the style attribute empty.
    const ring = document.querySelector<HTMLElement>(".kit-call-ring")!;
    expect(ring.style.left).toBe("");
    expect(ring.style.top).toBe("");
  });

  it("NO-RING mode drops the ring and moves the state onto the transcript line", () => {
    h.ring = false;
    render(<Host open={true} />);
    expect(document.querySelector(".kit-call-ring")).toBeNull();
    expect(document.querySelector(".kit-call-heard .kit-call-dot")).not.toBeNull();
    expect(overlay().className).toContain("no-ring");
  });

  it("the MODE IS SNAPSHOTTED at call start — a mid-call refetch does not flip the indicator", () => {
    // §4.5's rule for every other knob, applied to this one (audit A LOW): settings edited mid-call
    // apply to the NEXT call. Read live off the query, a Conf save or a window refocus mid-call would
    // swap the owner's indicator out from under a call in progress.
    const view = render(<Host open={true} />);
    expect(document.querySelector(".kit-call-ring-stroke")).not.toBeNull();
    h.ring = false;
    view.rerender(<Host open={true} />);
    expect(document.querySelector(".kit-call-ring-stroke")).not.toBeNull();
    // …and in the other direction, from a call that started without one.
    cleanup();
    h.ring = false;
    const off = render(<Host open={true} />);
    expect(document.querySelector(".kit-call-ring")).toBeNull();
    h.ring = true;
    off.rerender(<Host open={true} />);
    expect(document.querySelector(".kit-call-ring")).toBeNull();
  });

  it("…and the snapshot is the MOUNT, because the mount IS the call start", () => {
    // `DefaultRoot` mounts this overlay under `key={callMount}`, and a REDIAL bumps that key rather
    // than reusing the machine — so there is no call whose start is not a mount of this component, and
    // the next call reads the query afresh. That is the other half of the rule above: mid-call the knob
    // is frozen, between calls it is not.
    const first = render(<Host open={true} />);
    expect(document.querySelector(".kit-call-ring")).not.toBeNull();
    first.unmount();
    h.ring = false;
    render(<Host open={true} />);
    expect(document.querySelector(".kit-call-ring")).toBeNull();
  });

  it("a mount with the knobs still absent wears the LiveCfg default — and the door forbids one", () => {
    // Stated rather than defended: `/voice/status` has ALREADY answered by the time this can mount,
    // because call mode is only reachable while `useComposer().liveReady` (that same payload's `live`
    // bit) is up and the mic's mode boots to `mic` with no memory. So the unanswered case is not a race
    // the overlay plays for — it freezes the `LiveCfg` default for that call, and the door does not
    // admit it. If the door ever stops gating on the payload, THIS is the assertion that changes.
    h.knobs = false;
    const view = render(<Host open={true} />);
    expect(document.querySelector(".kit-call-ring")).not.toBeNull(); // the default, `ring: true`
    h.knobs = true;
    h.ring = false;
    view.rerender(<Host open={true} />);
    expect(document.querySelector(".kit-call-ring")).not.toBeNull();
  });

  it("the owner speaking is a state class in BOTH modes — the ring answers, and so does the dot", () => {
    h.call = { ...h.call, userSpeechActive: true };
    for (const ring of [true, false]) {
      cleanup();
      h.ring = ring;
      render(<Host open={true} />);
      expect(overlay().className).toContain("speech");
    }
  });
});

describe("CallOverlay — mute (§6's furniture)", () => {
  it("flips its ACCESSIBLE NAME rather than an aria-pressed, and calls the one toggle", () => {
    render(<Host open={true} />);
    const btn = screen.getByRole("button", { name: "Mute" });
    expect(btn.getAttribute("aria-pressed")).toBeNull();
    btn.click();
    expect(h.call.toggleMute).toHaveBeenCalledTimes(1);
  });

  it("a muted call says so in the name, the class and the phase line", () => {
    h.call = { ...h.call, muted: true };
    render(<Host open={true} />);
    expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy();
    // The class is what the STATIC muted look hangs off — no pulse implies no ear.
    expect(overlay().className).toContain("muted");
    expect(document.querySelector(".kit-call-phase")!.textContent).toBe("Muted");
  });
});

describe("CallOverlay — the in-overlay confirm row (§4.5)", () => {
  it("names the waiting tool and offers Allow and Deny — and nothing else", () => {
    h.awaiting = { callId: "c1", tool: "run_shell" };
    render(<Host open={true} />);
    expect(document.querySelector(".kit-call-confirm-line")!.textContent).toContain("run shell");
    expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deny" })).toBeTruthy();
    // "Always" and "edit" stay chat-card affordances (the coherence sweep) — the full card is still
    // in the thread, and an always-grant deserves that context.
    expect(screen.queryByRole("button", { name: /always/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });

  it("both decisions ride the SAME `resumeCall` chokepoint the chat card uses", () => {
    h.awaiting = { callId: "c1", tool: "run_shell" };
    render(<Host open={true} />);
    screen.getByRole("button", { name: "Allow" }).click();
    expect(h.resumeCall).toHaveBeenLastCalledWith("c1", "execute");
    screen.getByRole("button", { name: "Deny" }).click();
    expect(h.resumeCall).toHaveBeenLastCalledWith("c1", "dismiss");
  });

  it("a confirm tap is never ALSO an interrupt", () => {
    h.awaiting = { callId: "c1", tool: "run_shell" };
    h.call = { ...h.call, phase: "speaking" };
    render(<Host open={true} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Allow" }));
    expect(h.call.interrupt).not.toHaveBeenCalled();
  });

  it("no gate outstanding, no row", () => {
    render(<Host open={true} />);
    expect(document.querySelector(".kit-call-confirm")).toBeNull();
  });
});

describe("CallOverlay — the in-call route controls (D74 S2)", () => {
  const routeBtn = () => screen.getByRole<HTMLButtonElement>("button", { name: /^Use / });

  it("names the ACTION and asks for the other route — never writing config", () => {
    render(<Host open={true} />);
    expect(routeBtn().textContent).toBe("Use headphones");
    routeBtn().click();
    expect(h.call.setRoute).toHaveBeenCalledWith("headphones");

    cleanup();
    h.call = { ...h.call, route: "headphones" };
    render(<Host open={true} />);
    expect(routeBtn().textContent).toBe("Use speaker");
  });

  it("is DISABLED while the route may not move, rather than swallowing the tap", () => {
    h.call = { ...h.call, phase: "connecting", canRoute: false };
    render(<Host open={true} />);
    expect(routeBtn().disabled).toBe(true);
    expect(screen.getByLabelText<HTMLSelectElement>("Input microphone").disabled).toBe(true);
  });

  it("a route tap on the top deck is never ALSO an interrupt", () => {
    // The row moved out of the cluster (owner, 2026-09-22) and so out from under ITS pointer-down
    // stop — the top deck carries its own, and this is the pin that keeps it there.
    h.call = { ...h.call, phase: "speaking" };
    render(<Host open={true} />);
    fireEvent.pointerDown(routeBtn());
    expect(h.call.interrupt).not.toHaveBeenCalled();
  });

  it("keeps a stored device that the list does not contain — shown, disabled, never cleared", () => {
    // A headset merely off its charger keeps the owner's standing choice (the S5 review-F2 rule the
    // Conf row ships under); the capture asks for it as `ideal` and falls back with a note anyway.
    h.call = { ...h.call, inputDevice: "gone" };
    render(<Host open={true} />);
    const ghost = screen.getByRole<HTMLOptionElement>("option", {
      name: "saved device — not available",
    });
    expect(ghost.disabled).toBe(true);
    expect(ghost.value).toBe("gone");
  });

  it("is gone on a terminal — there is no ear to move", () => {
    h.call = { ...h.call, phase: "ended" };
    render(<Host open={true} />);
    expect(screen.queryByRole("button", { name: /^Use / })).toBeNull();
  });
});

describe("CallOverlay — the speech-threshold slider (2026-09-22)", () => {
  // The pill's accessible name CARRIES the value (design sweep ①) — hence the prefix match.
  const pill = () => screen.getByRole<HTMLButtonElement>("button", { name: /^Speech threshold/ });
  const slider = () => screen.getByRole<HTMLInputElement>("slider", { name: "Speech threshold" });

  it("the pill speaks the machine's value; the slider appears on tap and commits ON RELEASE only", () => {
    render(<Host open={true} />);
    expect(pill().textContent).toBe("0.90");
    expect(screen.queryByRole("slider", { name: "Speech threshold" })).toBeNull();
    fireEvent.click(pill());
    // The DRAG is local — a redial per drag-tick would cycle the connection through the gesture.
    fireEvent.change(slider(), { target: { value: "0.5" } });
    expect(h.call.setVad).not.toHaveBeenCalled();
    expect(pill().textContent).toBe("0.50"); // …but the pill follows the finger
    fireEvent.pointerUp(slider());
    expect(h.call.setVad).toHaveBeenCalledWith(0.5);
  });

  it("a release with nothing moved commits nothing — no redial for a tap on the slider", () => {
    render(<Host open={true} />);
    fireEvent.click(pill());
    fireEvent.pointerUp(slider());
    expect(h.call.setVad).not.toHaveBeenCalled();
  });

  it("renders NOTHING against a backend whose status predates the field", () => {
    // A control that cannot say what the threshold IS must not offer to move it.
    h.call = { ...h.call, vad: null };
    render(<Host open={true} />);
    expect(screen.queryByRole("button", { name: /^Speech threshold/ })).toBeNull();
  });

  it("Escape in the popover closes the POPOVER — never the call (design round F3)", () => {
    render(<Host open={true} />);
    fireEvent.click(pill());
    fireEvent.change(slider(), { target: { value: "0.5" } });
    fireEvent.keyDown(slider(), { key: "Escape" });
    // The overlay's own Escape rule is "hang up" (`modalKeyDown`); the popover must swallow it…
    expect(h.close).not.toHaveBeenCalled();
    expect(screen.queryByRole("slider", { name: "Speech threshold" })).toBeNull();
    // …and a cancel DISCARDS the drag: the pill goes back to speaking the machine's truth.
    expect(h.call.setVad).not.toHaveBeenCalled();
    expect(pill().textContent).toBe("0.90");
  });

  it("an outside tap closes the popover and discards the drag (the NavMenu popover contract)", () => {
    render(<Host open={true} />);
    fireEvent.click(pill());
    fireEvent.change(slider(), { target: { value: "0.5" } });
    fireEvent.pointerDown(overlay());
    expect(screen.queryByRole("slider", { name: "Speech threshold" })).toBeNull();
    expect(h.call.setVad).not.toHaveBeenCalled();
    expect(pill().textContent).toBe("0.90");
  });

  it("a slider gesture is never ALSO a tap-to-interrupt — the deck's stop covers the popover", () => {
    h.call = { ...h.call, phase: "speaking" };
    render(<Host open={true} />);
    fireEvent.click(pill());
    fireEvent.pointerDown(slider());
    expect(h.call.interrupt).not.toHaveBeenCalled();
  });
});

describe("CallOverlay — the readback block (D74 S7)", () => {
  const snapshot: CallDebug = {
    ecSettings: true,
    ecCapabilities: [true, "all"],
    route: "headphones",
    echoWorkaround: "auto",
    bargeArmed: true,
    earHoldMode: false,
    earHeld: false,
    mouthLive: false,
    deviceLabel: "Headset earpiece",
    deviceId: "ear-1234567890",
    fellBack: false,
    rms: 0.031,
    rmsPeak2s: 0.184,
    floor: 0.01,
    lastFinal: { accruedMs: 320, peak: 0.21, chars: 14 },
  };

  it("renders NOTHING extra with the knob off", () => {
    render(<Host open={true} />);
    expect(document.querySelector(".kit-call-debug")).toBeNull();
  });

  it('prints the readback PAIR uncoerced — `true` and `"all"` must stay distinguishable', () => {
    // They mean opposite things (R78 §0): a boolean `true` on Android says the platform-AEC bit was
    // ABSENT when the constraint resolved, i.e. software AEC3, which cancels nothing of our own TTS.
    // A block that printed both as "true" would hide the single top split of the diagnosis tree.
    h.call = { ...h.call, debug: snapshot };
    render(<Host open={true} />);
    const text = document.querySelector(".kit-call-debug")!.textContent;
    expect(text).toContain("ec    true");
    expect(text).toContain('caps [true,"all"]');
    expect(text).toContain("floor 0.010"); // …and the levels line up against each other
    expect(text).toContain("peak2s 0.184");
    expect(text).toContain("320ms");
  });

  it("is never also a tap-to-interrupt — it rides the cluster's pointer-down stop", () => {
    h.call = { ...h.call, phase: "speaking", debug: snapshot };
    render(<Host open={true} />);
    fireEvent.pointerDown(document.querySelector(".kit-call-debug")!);
    expect(h.call.interrupt).not.toHaveBeenCalled();
  });
});

describe("CallOverlay — the terminal faces (§6)", () => {
  for (const phase of ["error", "ended"]) {
    it(`\`${phase}\` keeps the overlay up with Call again + Close`, () => {
      h.call = { ...h.call, phase, note: "lost the connection" };
      render(<Host open={true} />);
      expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
      expect(document.querySelector(".kit-call-note")!.textContent).toBe("lost the connection");
      // Mute is gone — there is no ear left to close.
      expect(screen.queryByRole("button", { name: /mute/i })).toBeNull();

      screen.getByRole("button", { name: "Call again" }).click();
      // THE SAME DOOR a call starts from (dismiss → prime → open), not a private restart path.
      expect(h.startCall).toHaveBeenCalledTimes(1);
    });
  }
});
