import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NowPlaying } from "../../src/hooks/useAppChrome";

const h = vi.hoisted(() => ({ np: null as unknown as NowPlaying }));
vi.mock("../../src/hooks/useAppChrome", () => ({ useNowPlaying: () => h.np }));

import { MiniPlayer } from "../../src/components/MiniPlayer";

// components/MiniPlayer — the TRANSPORT's face (D71 §7-S2b). The controller's own behaviour is pinned
// in `audioController.test.ts`; what is pinned here is the one thing this component decides: which
// question the play/pause button answers.
//
// It used to answer `status`, and `disabled` itself on "loading" — so a mid-reply synthesis gap (an
// honest "loading" that can last as long as the queue is behind) locked the owner out of pausing a
// reply that was still going, even though `togglePlay` has always parked the intent under the latch.
// The face rides INTENT now, and nothing but the player's own self-hide disables it.

const base: NowPlaying = {
  active: true,
  loading: false,
  playing: false,
  wantPlay: false,
  fraction: 0,
  remaining: 30,
  duration: 30,
  estimated: false,
  chunks: null,
  seekDisabled: false,
  togglePlay: vi.fn(),
  seek: vi.fn(),
  dismiss: vi.fn(),
};

const play = () => document.querySelector<HTMLButtonElement>(".mp-play")!;

afterEach(cleanup);

describe("MiniPlayer — the transport rides INTENT, not the element's status", () => {
  it("through a synthesis GAP it still reads pause, and is still tappable", () => {
    // status: loading (nothing is coming out of the element) · intent: play (the reply is not over).
    h.np = { ...base, loading: true, playing: false, wantPlay: true };
    render(<MiniPlayer />);
    expect(play().getAttribute("aria-label")).toBe("pause");
    expect(play().className).toContain("playing");
    expect(play().disabled).toBe(false); // THE regression: a gap must never lock the owner out
    // …and the time label keeps its loading face, because THAT one really is about the element.
    expect(screen.getByText("···")).toBeTruthy();
  });

  it("a pause taken under that gap reads back as pause-intent-off", () => {
    h.np = { ...base, loading: true, playing: false, wantPlay: false };
    render(<MiniPlayer />);
    expect(play().getAttribute("aria-label")).toBe("play");
    expect(play().className).not.toContain("playing");
    expect(play().disabled).toBe(false);
  });

  it("ordinary playback is unchanged — intent and status agree there", () => {
    h.np = { ...base, playing: true, wantPlay: true };
    render(<MiniPlayer />);
    expect(play().getAttribute("aria-label")).toBe("pause");
  });

  it("nothing docked, nothing rendered — the self-hide is the only thing that disables this", () => {
    h.np = { ...base, active: false };
    const { container } = render(<MiniPlayer />);
    expect(container.querySelector(".mini-player")).toBeNull();
  });
});
