import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CallDebug } from "../../src/hooks/useLiveCall";
import { ROUTE_MEDIA } from "../../src/lib/pcmCapture";
import type { AwaitingConfirm } from "../../src/store/chat";

const h = vi.hoisted(() => {
  const call: {
    phase: string;
    heard: string;
    note: string | null;
    userSpeechActive: boolean;
    waitingFinal: boolean;
    muted: boolean;
    interrupt: ReturnType<typeof vi.fn>;
    toggleMute: ReturnType<typeof vi.fn>;
    route: string;
    inputDevice: string;
    canRoute: boolean;
    setRoute: ReturnType<typeof vi.fn>;
    setInputDevice: ReturnType<typeof vi.fn>;
    debug: CallDebug | null;
    readLevel: ReturnType<typeof vi.fn>;
    floorAuto: boolean;
    setFloorPin: ReturnType<typeof vi.fn>;
  } = {
    phase: "listening",
    heard: "",
    note: null,
    userSpeechActive: false,
    waitingFinal: false,
    muted: false,
    interrupt: vi.fn(),
    toggleMute: vi.fn(),
    route: "call",
    inputDevice: "",
    canRoute: true,
    setRoute: vi.fn(),
    setInputDevice: vi.fn(),
    debug: null,
    // The Sensitivity meter's sampler (D76 §C.7) — a READER the meter polls, never a field.
    readLevel: vi.fn(() => ({ level: null as number | null, floor: null as number | null })),
    floorAuto: true,
    setFloorPin: vi.fn(),
  };
  return {
    call,
    ring: true,
    /** Whether `/voice/status` has answered yet. */
    knobs: true,
    /** The captions knob, snapshotted at mount exactly as `ring` is. */
    captions: true,
    awaiting: null as { callId: string; tool: string } | null,
    resumeCall: vi.fn(),
    startCall: vi.fn(),
    close: vi.fn(() => true),
    /** The chat store, as the captions read it: is a turn live, and what is the last reply. */
    turnLive: false,
    reply: null as { id: string; text: string } | null,
    /** The backdrop hook, as a SPY: what this surface asks it for is a claim of its own. */
    backdrop: vi.fn((): { url: string } | undefined => undefined),
  };
});

vi.mock("../../src/hooks/useLiveCall", () => ({ useLiveCall: () => h.call }));
vi.mock("../../src/hooks/useActiveBackdrop", () => ({ useActiveBackdrop: h.backdrop }));
vi.mock("../../src/hooks/useVoiceStatus", () => ({
  // `data` is UNDEFINED until the query resolves, exactly as the real hook reports it — kept because
  // the ring's snapshot is taken AT MOUNT, so what that case does is a property worth stating (and the
  // reason it is unreachable is the call door, not this component).
  useVoiceStatus: () =>
    h.knobs
      ? {
          data: {
            live_call: { ring: h.ring, captions: h.captions, min_dbfs: -60, max_dbfs: -20 },
          },
        }
      : { data: undefined },
}));
vi.mock("../../src/store/chat", () => ({
  confirmAwaiting: (): AwaitingConfirm | null => h.awaiting,
  resumeCall: h.resumeCall,
  useChatSlice: <T,>(sel: () => T) => sel(),
  // The two readers the captions take (both non-reactive in the real store too — the block subscribes
  // by calling them inside a slice selector, so a stub returning the current fixture is faithful).
  getLiveTurn: () =>
    h.turnLive ? { threadId: "t1", turnId: null, assistantMessageId: null } : null,
  lastReply: () => h.reply,
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
    waitingFinal: false,
    muted: false,
    route: "call",
    inputDevice: "",
    canRoute: true,
    debug: null,
    floorAuto: true,
  };
  h.call.readLevel.mockReset();
  h.call.readLevel.mockImplementation(() => ({ level: null, floor: null }));
  h.call.setFloorPin.mockClear();
  h.call.interrupt.mockClear();
  h.call.toggleMute.mockClear();
  h.call.setRoute.mockClear();
  h.call.setInputDevice.mockClear();
  h.ring = true;
  h.captions = true;
  h.knobs = true;
  h.turnLive = false;
  h.reply = null;
  h.awaiting = null;
  h.resumeCall.mockClear();
  h.startCall.mockClear();
  h.close.mockClear();
  h.backdrop.mockClear();
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

  it("wears the ACTIVE agent's backdrop — the same ladder the call's turns route by (D75 ruling)", () => {
    // A call's turns go out through `sendCallTranscript`, and `sendMessage` reads the sticky pin the
    // tools menu writes, so the face on this screen is the agent the menu shows. No opt-out, no argument:
    // the hook-level ladder claim lives in agentBackdrop's suite.
    h.backdrop.mockReturnValue({ url: "/api/media/agents/files/backgrounds/lynette.webp" });
    try {
      render(<Host open={true} />);
      expect(h.backdrop).toHaveBeenCalledWith();
      expect(document.querySelector(".kit-call-art img")!.getAttribute("src")).toContain(
        "lynette.webp",
      );
      // …and nothing about the pick is "parked" any more: the note slot carries only the machine's news.
      expect(document.querySelector(".kit-call-note")).toBeNull();
    } finally {
      h.backdrop.mockReturnValue(undefined);
    }
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

  it("the heard line holds its `…` through waitingFinal — the previous final never surfaces during the STT round-trip (owner, 2026-09-23)", () => {
    const heard = () => document.querySelector(".kit-call-heard")!.textContent;
    h.call = { ...h.call, heard: "wake the vault" };
    const view = render(<Host open={true} />);
    expect(heard()).toBe("wake the vault");
    h.call = { ...h.call, userSpeechActive: true };
    view.rerender(<Host open={true} />);
    expect(heard()).toBe("…");
    // The segment closed; the transcript is still in flight. The OLD final must not pop back in here.
    h.call = { ...h.call, userSpeechActive: false, waitingFinal: true };
    view.rerender(<Host open={true} />);
    expect(heard()).toBe("…");
    h.call = { ...h.call, waitingFinal: false, heard: "lock the vault" };
    view.rerender(<Host open={true} />);
    expect(heard()).toBe("lock the vault");
  });
});

describe("CallOverlay — the captions (owner ask 2026-09-22)", () => {
  const said = () => document.querySelector(".kit-call-said");

  /** A call reply arrives THROUGH a live turn — the real store's timeline, which the floor belt (F5)
   *  keys on: flip the turn on and off around the reply's appearance. */
  const turn = (view: ReturnType<typeof render>): void => {
    h.turnLive = true;
    view.rerender(<Host open={true} />);
    h.turnLive = false;
  };

  it("shows the reply that arrives DURING the call, above the state line", () => {
    const view = render(<Host open={true} />);
    expect(said()).toBeNull(); // nothing answered yet — no empty box
    turn(view);
    h.reply = { id: "m1", text: "Waking corsair now." };
    view.rerender(<Host open={true} />);
    expect(said()!.textContent).toBe("Waking corsair now.");
    // ABOVE the phase line and the heard line both: the answer reads down into what you said.
    const body = [...document.querySelector(".kit-call-body")!.children].map((e) => e.className);
    expect(body.indexOf("kit-call-said")).toBeLessThan(body.indexOf("kit-call-phase"));
  });

  it("never shows the PREVIOUS conversation's last reply — the call starts with a clean screen", () => {
    // The floor is latched at mount: whatever was the last reply then is the last one this block may
    // not show. The owner dialling into a thread must not be read its own history back. The call's
    // own reply arrives THROUGH a live turn — the real timeline, and what the floor belt keys on.
    h.reply = { id: "old", text: "that was before the call" };
    const view = render(<Host open={true} />);
    expect(said()).toBeNull();
    h.reply = { id: "old", text: "that was before the call, edited by a reload" };
    view.rerender(<Host open={true} />);
    expect(said()).toBeNull();
    turn(view);
    h.reply = { id: "new", text: "and this is the call's own" };
    view.rerender(<Host open={true} />);
    expect(said()!.textContent).toBe("and this is the call's own");
  });

  it("a floor whose message VANISHES re-latches — a reload must not resurrect pre-call history (F5)", () => {
    // The latched id can be a client-only placeholder (a failed pre-call send) that a `reloadChat`
    // drops: `lastReply` then answers an OLDER durable message, and an id-only floor would paint it.
    // Until the call's first turn has run, the floor follows the last settled reply instead.
    h.reply = { id: "ghost", text: "" }; // the placeholder: an error part, no prose
    const view = render(<Host open={true} />);
    expect(said()).toBeNull();
    h.reply = { id: "older", text: "a pre-call reply from history" }; // the reload dropped "ghost"
    view.rerender(<Host open={true} />);
    expect(said()).toBeNull(); // re-latched, not resurrected
    // …and the call's own reply, through a real turn, still shows.
    turn(view);
    h.reply = { id: "mine", text: "the call's own answer" };
    view.rerender(<Host open={true} />);
    expect(said()!.textContent).toBe("the call's own answer");
  });

  it("a reply ALREADY STREAMING at mount stays off the screen until its turn settles (§4.5)", () => {
    // The mouth's own exclusion, applied to the eye: a reply half-read to an owner who was not yet in
    // a call is not picked up mid-sentence. The gate is on the STATUS TIMELINE, never on the message's
    // id — a fresh turn's placeholder is renamed mid-stream, so an id captured here would stop matching.
    h.turnLive = true;
    h.reply = { id: "pre", text: "half a repl" };
    const view = render(<Host open={true} />);
    expect(said()).toBeNull();
    h.reply = { id: "pre", text: "half a reply, now whole" };
    view.rerender(<Host open={true} />);
    expect(said()).toBeNull();
    // …the turn settles: the floor latches on THAT message, and the next one is the call's.
    h.turnLive = false;
    view.rerender(<Host open={true} />);
    expect(said()).toBeNull();
    h.reply = { id: "mine", text: "hello" };
    view.rerender(<Host open={true} />);
    expect(said()!.textContent).toBe("hello");
  });

  it("a text-less turn renders NOTHING — no empty box for a tool-only step", () => {
    const view = render(<Host open={true} />);
    h.reply = { id: "m1", text: "" };
    view.rerender(<Host open={true} />);
    expect(said()).toBeNull();
  });

  it("the knob is snapshotted at mount like the ring's — off means nothing, ever", () => {
    h.captions = false;
    const view = render(<Host open={true} />);
    h.reply = { id: "m1", text: "you would not see this" };
    view.rerender(<Host open={true} />);
    expect(said()).toBeNull();
    // …and a mid-call flip of the knob does not turn them on (§4.5: the NEXT call reads it).
    h.captions = true;
    view.rerender(<Host open={true} />);
    expect(said()).toBeNull();
  });

  it("a SHORT reply stays a live interrupt target (review round B1)", () => {
    // The stop used to be unconditional, which put a dead zone over the text the owner is most likely
    // to be looking at when they want to interrupt — directly above the line telling them to tap.
    h.call = { ...h.call, phase: "speaking" };
    const view = render(<Host open={true} />);
    turn(view);
    h.reply = { id: "m1", text: "on it" };
    view.rerender(<Host open={true} />);
    expect(said()!.className).toBe("kit-call-said"); // neither edge hiding anything
    fireEvent.pointerDown(said()!);
    expect(h.call.interrupt).toHaveBeenCalledTimes(1);
  });

  it("…and a SCROLLING one is a reading surface: the drag is never an interrupt", () => {
    // The other side of the same bargain. jsdom builds no boxes, so the two reads the component's own
    // measure takes are stubbed — which is precisely the pair the fade and the follow rule read too,
    // so this arm exercises the real branch rather than a parallel one.
    const tall = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200);
    const short = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(60);
    try {
      h.call = { ...h.call, phase: "speaking" };
      const view = render(<Host open={true} />);
      turn(view);
      h.reply = { id: "m1", text: "a long reply the owner wants to scroll back through" };
      view.rerender(<Host open={true} />);
      // The follow rule pins growth to the BOTTOM, so the hidden edge of a streaming overflow is
      // ABOVE — which is enough: the stop's gate is `above || below`, one hidden edge either side.
      expect(said()!.className).toContain("more-above");
      fireEvent.pointerDown(said()!);
      expect(h.call.interrupt).not.toHaveBeenCalled();
    } finally {
      tall.mockRestore();
      short.mockRestore();
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

describe("CallOverlay — the in-call route controls (D74 S2 · the D75 picker)", () => {
  /** The Sound pill, found by the thing it now says: the STATE (D75 ④ · review round A5). */
  const outputPill = () => screen.getByRole<HTMLButtonElement>("button", { name: /^Sound:/ });
  /** A `menu` of `menuitemradio`s since the review round (A6) — the `PrivilegeChip` shape. */
  const routeRows = () => screen.getAllByRole("menuitemradio");
  const rowCount = () => screen.queryAllByRole("menuitemradio").length;

  it("SHOWS the current route and offers both — state-first, never the action (D75 ④ · D76 §A)", () => {
    // The control it replaced named the ACTION ("Use headphones" while on speaker), and the owner
    // read that as the STATE: their whole crackle report arrived inverted (ISS-16). The pill's
    // accessible name is now where they are, because the pill itself is only a glyph — plus the
    // "tap to change" tail that carries the affordance no chevron draws.
    render(<Host open={true} />);
    expect(outputPill().getAttribute("aria-label")).toBe("Sound: Call — tap to change");
    expect(rowCount()).toBe(0); // closed until asked
    fireEvent.click(outputPill());
    // Media first (the default), then Call — and the checked row is the one the machine is on.
    expect(routeRows().map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true"]);

    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Media/ }));
    expect(h.call.setRoute).toHaveBeenCalledWith(ROUTE_MEDIA);
    expect(rowCount()).toBe(0); // …and the picker closes on the pick

    // …and the pill then speaks the route the machine came back with.
    cleanup();
    h.call = { ...h.call, route: ROUTE_MEDIA };
    render(<Host open={true} />);
    expect(outputPill().getAttribute("aria-label")).toBe("Sound: Media — tap to change");
  });

  it("each row carries the bargain it strikes, and the footer stays (D76 §A)", () => {
    render(<Host open={true} />);
    fireEvent.click(outputPill());
    const [media, call] = routeRows();
    expect(media.textContent).toContain("follows Bluetooth like music, phone speaker otherwise");
    expect(call.textContent).toContain("phone-call mode · echo-cancelled · hands-free mic");
    expect(document.querySelector(".kit-call-routefoot")?.textContent).toBe(
      "a change mid-reply starts with the next reply",
    );
  });

  it("an UNKNOWN route checks the media row — never a card with no answer at all", () => {
    // The capture resolves anything that is not `call` as the media case (`wantsAec`), so the card
    // says the same thing. A card with nothing checked would claim the sound is going nowhere, and
    // this pill is the one the owner reads to check their own report (ISS-16).
    h.call = { ...h.call, route: "from-a-newer-build" };
    render(<Host open={true} />);
    expect(outputPill().getAttribute("aria-label")).toBe("Sound: Media — tap to change");
    fireEvent.click(outputPill());
    expect(routeRows().map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  });

  it("writes NO config — the pick is this call's, the Conf row stays the next one's default", () => {
    render(<Host open={true} />);
    fireEvent.click(outputPill());
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Media/ }));
    expect(h.call.setRoute).toHaveBeenCalledTimes(1);
    expect(h.call.setRoute).toHaveBeenCalledWith(ROUTE_MEDIA);
  });

  it("the deck is Sound · Mic · Sensitivity — the Speech slider is gone (D76 §C.7 · §D)", () => {
    render(<Host open={true} />);
    expect(screen.queryByRole("button", { name: /^Speech threshold/ })).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull(); // the meter's range exists only while it is open
    const captions = Array.from(document.querySelectorAll(".kit-call-top .kit-call-iolabel")).map(
      (e) => e.textContent,
    );
    expect(captions).toEqual(["Sound", "Mic", "Sensitivity"]);
  });

  it("Escape closes the PICKER with focus ON THE PILL — the call stands (review round A1)", () => {
    // THE ARM THAT MATTERS, and the one the first cut did not have: opening the picker leaves focus
    // on the PILL, a SIBLING of the popover — so a swallow hung on the popover node never saw the
    // keydown, it bubbled to `modalKeyDown` and HUNG UP THE CALL. The swallow lives on the control's
    // root now. (The row-level arm below still runs; it is simply a focus state the UI never reaches.)
    render(<Host open={true} />);
    const pill = outputPill();
    pill.focus();
    fireEvent.click(pill);
    fireEvent.keyDown(pill, { key: "Escape" });
    expect(h.close).not.toHaveBeenCalled();
    expect(rowCount()).toBe(0);
    expect(h.call.setRoute).not.toHaveBeenCalled();
  });

  it("…and from a ROW too (the deck popover's rule, shared)", () => {
    render(<Host open={true} />);
    fireEvent.click(outputPill());
    fireEvent.keyDown(routeRows()[0], { key: "Escape" });
    expect(h.close).not.toHaveBeenCalled();
    expect(rowCount()).toBe(0);
    expect(h.call.setRoute).not.toHaveBeenCalled();
  });

  it("with the picker CLOSED, Escape on the pill still hangs up — the deck is no sanctuary", () => {
    // The other half of the gate: the swallow sits on an element that is mounted for the whole call,
    // so it must be inert whenever there is nothing to dismiss.
    render(<Host open={true} />);
    fireEvent.keyDown(outputPill(), { key: "Escape" });
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  it("an outside tap closes it, on the CAPTURE phase (the deck's own stop makes bubbling deaf)", () => {
    render(<Host open={true} />);
    fireEvent.click(outputPill());
    fireEvent.pointerDown(overlay());
    expect(rowCount()).toBe(0);
    expect(h.call.setRoute).not.toHaveBeenCalled();
    // …and it closes through `dismiss` like every other close (L3), so focus lands back on the pill
    // rather than on a node that has just unmounted.
    expect(document.activeElement).toBe(outputPill());
  });

  it("is DISABLED while the route may not move, rather than swallowing the tap", () => {
    h.call = { ...h.call, phase: "connecting", canRoute: false };
    render(<Host open={true} />);
    expect(outputPill().disabled).toBe(true);
    expect(screen.getByLabelText<HTMLSelectElement>("Input microphone").disabled).toBe(true);
    // …and the third control on the same rule: no capture, no numbers, no meter.
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /^Sensitivity:/ }).disabled).toBe(
      true,
    );
  });

  it("a route tap on the top deck is never ALSO an interrupt", () => {
    // The row moved out of the cluster (owner, 2026-09-22) and so out from under ITS pointer-down
    // stop — the top deck carries its own, and this is the pin that keeps it there.
    h.call = { ...h.call, phase: "speaking" };
    render(<Host open={true} />);
    fireEvent.pointerDown(outputPill());
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
    expect(screen.queryByRole("button", { name: /^Sound:/ })).toBeNull();
  });
});

describe("CallOverlay — the Sensitivity meter (D76 §C.7)", () => {
  const pill = () => screen.getByRole<HTMLButtonElement>("button", { name: /^Sensitivity:/ });
  const range = () => screen.getByRole<HTMLInputElement>("slider", { name: "Sensitivity floor" });
  const fill = () => document.querySelector<HTMLElement>(".kit-call-meterfill")!;
  const mark = () => document.querySelector<HTMLElement>(".kit-call-metermark")!;
  /** The fixture's bounds (`min_dbfs` −60 · `max_dbfs` −20): the meter's whole axis. */
  const MIN = -60;
  const MAX = -20;

  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it("names the floor's STATE — auto, or the owner's pin — and opens a dialog, not a menu", () => {
    render(<Host open={true} />);
    expect(pill().getAttribute("aria-label")).toBe("Sensitivity: auto");
    expect(pill().getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.queryByRole("dialog", { name: "Sensitivity" })).toBeNull(); // closed until asked
    fireEvent.click(pill());
    expect(screen.getByRole("dialog", { name: "Sensitivity" })).toBeTruthy();
    // Auto is plain WORDS, not a button: there is nothing to release.
    expect(screen.queryByRole("button", { name: /^Back to auto/ })).toBeNull();
    // …the mode, then what a touch does (both states are two lines — the column must not move).
    expect(document.querySelector(".kit-call-sensmode")!.textContent).toBe("Autodrag to pin");
  });

  it("the BAR follows the sampled level over [min_dbfs, max_dbfs] — at the tick, never per frame", () => {
    h.call.readLevel.mockImplementation(() => ({ level: -40, floor: -45 }));
    render(<Host open={true} />);
    fireEvent.click(pill());
    // Read once on open: −40 is halfway up −60…−20; the floor −45 is 15/40 of the way.
    expect(fill().style.transform).toBe("scaleY(0.5)");
    expect(mark().style.getPropertyValue("--f")).toBe("0.375");
    expect(mark().style.opacity).toBe("1");
    // A new level is not painted until the next tick…
    h.call.readLevel.mockImplementation(() => ({ level: -30, floor: -45 }));
    vi.advanceTimersByTime(99);
    expect(fill().style.transform).toBe("scaleY(0.5)");
    vi.advanceTimersByTime(1);
    expect(fill().style.transform).toBe("scaleY(0.75)");
    // …and past either end the bar is empty / full, never out of its column.
    h.call.readLevel.mockImplementation(() => ({ level: -90, floor: -45 }));
    vi.advanceTimersByTime(100);
    expect(fill().style.transform).toBe("scaleY(0)");
    h.call.readLevel.mockImplementation(() => ({ level: -3, floor: -45 }));
    vi.advanceTimersByTime(100);
    expect(fill().style.transform).toBe("scaleY(1)");
  });

  it("no frame yet → an empty bar and NO line (nothing measured is nothing drawn)", () => {
    render(<Host open={true} />);
    fireEvent.click(pill());
    expect(fill().style.transform).toBe("scaleY(0)");
    expect(mark().style.opacity).toBe("0");
  });

  it("POLARITY: bottom = min_dbfs = MORE sensitive, top = max_dbfs = less", () => {
    // The Speech slider's own comment once had this backwards; the axis is pinned here from three
    // sides — the range's bounds, the end words in reading order, and where the line sits at `min`.
    h.call.readLevel.mockImplementation(() => ({ level: -50, floor: MIN }));
    render(<Host open={true} />);
    fireEvent.click(pill());
    expect(range().min).toBe(String(MIN));
    expect(range().max).toBe(String(MAX));
    const ends = Array.from(document.querySelectorAll(".kit-call-senspop > .kit-call-sensend")).map(
      (e) => e.textContent,
    );
    expect(ends).toEqual(["less", "more sensitive"]); // top first, bottom last
    expect(mark().style.getPropertyValue("--f")).toBe("0"); // the floor at `min` sits at the BOTTOM
    // …and the range reads the floor in the owner's words.
    expect(range().value).toBe(String(MIN));
    expect(range().getAttribute("aria-valuetext")).toBe("\u221260 dB");
  });

  it("a DRAG pins at the tick cadence — never per pointer move — and the lift hands over the last value", () => {
    h.call.readLevel.mockImplementation(() => ({ level: -40, floor: -45 }));
    render(<Host open={true} />);
    fireEvent.click(pill());
    fireEvent.pointerDown(range());
    fireEvent.change(range(), { target: { value: "-50" } });
    fireEvent.change(range(), { target: { value: "-52" } });
    // The line is under the finger at once (a style write)…
    expect(mark().style.getPropertyValue("--f")).toBe(String((-52 - MIN) / (MAX - MIN)));
    // …but the machine has heard nothing yet.
    expect(h.call.setFloorPin).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(h.call.setFloorPin).toHaveBeenCalledTimes(1);
    expect(h.call.setFloorPin).toHaveBeenLastCalledWith(-52);
    // A move after the tick, then the LIFT: the last value lands on the lift, not a tick later.
    fireEvent.change(range(), { target: { value: "-38" } });
    fireEvent.pointerUp(range());
    expect(h.call.setFloorPin).toHaveBeenCalledTimes(2);
    expect(h.call.setFloorPin).toHaveBeenLastCalledWith(-38);
    // Every value is inside the bounds, whole dB.
    for (const [v] of h.call.setFloorPin.mock.calls as [number][]) {
      expect(Number.isInteger(v) && v >= MIN && v <= MAX).toBe(true);
    }
  });

  it("a KEYBOARD step pins at once — there is no drag to batch", () => {
    render(<Host open={true} />);
    fireEvent.click(pill());
    fireEvent.change(range(), { target: { value: "-41" } });
    expect(h.call.setFloorPin).toHaveBeenCalledWith(-41);
  });

  it("a PINNED floor names its value, and the caption becomes the button that gives it back", () => {
    const view = render(<Host open={true} />);
    fireEvent.click(pill());
    fireEvent.change(range(), { target: { value: "-38" } });
    // The machine answers the pin (the real hook flips `floorAuto` through its own state).
    h.call = { ...h.call, floorAuto: false };
    view.rerender(<Host open={true} />);
    expect(pill().getAttribute("aria-label")).toBe("Sensitivity: \u221238 dB");
    const back = screen.getByRole("button", { name: "Back to auto \u2014 pinned at \u221238 dB" });
    fireEvent.click(back);
    expect(h.call.setFloorPin).toHaveBeenLastCalledWith(null);
    // The button unmounts; focus lands on the column, never on <body> outside the dialog.
    expect(document.activeElement).toBe(range());
    h.call = { ...h.call, floorAuto: true };
    view.rerender(<Host open={true} />);
    expect(pill().getAttribute("aria-label")).toBe("Sensitivity: auto");
    expect(screen.queryByRole("button", { name: /^Back to auto/ })).toBeNull();
  });

  it("the tick runs ONLY while the popover is open — closed, the ear is not read at all", () => {
    render(<Host open={true} />);
    expect(h.call.readLevel).not.toHaveBeenCalled(); // closed from the start: no interval
    fireEvent.click(pill());
    vi.advanceTimersByTime(300);
    const reads = h.call.readLevel.mock.calls.length;
    expect(reads).toBe(4); // the read on open + three ticks
    fireEvent.click(pill()); // close
    vi.advanceTimersByTime(1000);
    expect(h.call.readLevel).toHaveBeenCalledTimes(reads);
  });

  it("…and hanging up with it open clears the interval too", () => {
    const view = render(<Host open={true} />);
    fireEvent.click(pill());
    const reads = h.call.readLevel.mock.calls.length;
    view.rerender(<Host open={false} />);
    vi.advanceTimersByTime(1000);
    expect(h.call.readLevel).toHaveBeenCalledTimes(reads);
  });

  it("Escape closes the METER, not the call — the deck popover's rule, shared", () => {
    render(<Host open={true} />);
    const p = pill();
    p.focus();
    fireEvent.click(p);
    fireEvent.keyDown(p, { key: "Escape" });
    expect(h.close).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Sensitivity" })).toBeNull();
    expect(document.activeElement).toBe(pill());
  });

  it("dragging the column is never ALSO a tap-to-interrupt", () => {
    h.call = { ...h.call, phase: "speaking" };
    render(<Host open={true} />);
    fireEvent.click(pill());
    fireEvent.pointerDown(range());
    expect(h.call.interrupt).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Sensitivity" })).toBeTruthy(); // not an outside tap
  });

  it("with no bounds to draw against there is no meter at all (the call door forbids that state)", () => {
    h.knobs = false;
    render(<Host open={true} />);
    expect(screen.queryByRole("button", { name: /^Sensitivity:/ })).toBeNull();
  });
});

describe("CallOverlay — the readback block (D74 S7)", () => {
  const snapshot: CallDebug = {
    ecSettings: true,
    ecCapabilities: [true, "all"],
    route: "media",
    micHold: "auto",
    bargeArmed: true,
    earHeld: false,
    mouthLive: false,
    deviceLabel: "Headset earpiece",
    deviceId: "ear-1234567890",
    fellBack: false,
    level: -30.2,
    levelPeak2s: -14.7,
    floor: -45,
    floorPinned: false,
    noise: null,
    noiseSettled: false,
    voiceLevel: -22.46,
    lastFinal: { accruedMs: 320, peakDb: -13.6, chars: 14 },
    probe: null,
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
    // …and the levels line up against each other, in dBFS (D76 §C.1), with what the floor is made of.
    expect(text).toContain("dBFS  -30.2   peak2s -14.7   floor -45.0 (auto)");
    expect(text).toContain("noise — (provisional)   voice -22.5");
    expect(text).toContain("320ms   peak -13.6");
  });

  it("names a PINNED floor and a SETTLED noise estimate (D76 §C.2/§C.7)", () => {
    h.call = {
      ...h.call,
      debug: { ...snapshot, floor: -52, floorPinned: true, noise: -61.04, noiseSettled: true },
    };
    render(<Host open={true} />);
    const text = document.querySelector(".kit-call-debug")!.textContent;
    expect(text).toContain("floor -52.0 (pinned)");
    expect(text).toContain("noise -61.0 (settled)");
  });

  it("prints the leak probe's last verdict — S3's per-chunk evidence line (D76 §B.3)", () => {
    h.call = { ...h.call, debug: snapshot };
    const { unmount } = render(<Host open={true} />);
    expect(document.querySelector(".kit-call-debug")!.textContent).toContain("probe —");
    unmount();
    h.call = {
      ...h.call,
      debug: { ...snapshot, probe: { idx: 2, maxDb: -57.34, floor: -45, released: true } },
    };
    render(<Host open={true} />);
    expect(document.querySelector(".kit-call-debug")!.textContent).toContain(
      "probe #2   max -57.3   floor -45.0   released",
    );
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
