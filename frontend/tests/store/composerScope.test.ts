import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearComposerScope,
  getComposerScope,
  previewAgent,
  releaseSpent,
  setScopeAgent,
  takeComposerScope,
  toggleScopeSkill,
  useComposerScope,
} from "../../src/store/composerScope";

// A6 — the composer menu's ONE-SHOT arming store. Two invariants beyond plain get/set: it is SPENT on
// dispatch (`take` = read + clear, so no send can leave a stale arming showing), and it is NOT PERSISTED
// (an armed one-shot must never survive a reload — see the store header).
//
// The agent is TRI-STATE (Codex, round 2): `undefined` untouched · `null` explicitly "the configured
// default" (which beats a sticky `/agent`) · a name. `undefined` vs `null` is the whole point, so these
// assertions read `.agent` explicitly where `toEqual` would treat the two as one.

beforeEach(() => {
  clearComposerScope();
  // A hand-clear no longer touches a hold (arch F3), so the reset drops one through the store's own
  // doors: stash a throwaway (the take replaces whatever was held) and release it.
  setScopeAgent("__reset");
  releaseSpent(takeComposerScope(true).hold ?? 0);
  localStorage.clear();
});

describe("composerScope — arming", () => {
  it("starts UNTOUCHED — `undefined`, not `null` (which is a real 'use the default' pick)", () => {
    expect(getComposerScope().agent).toBe(undefined);
    expect(getComposerScope().skills).toEqual([]);
  });

  it("arms a specialist, or `null` for an explicit 'the configured default'", () => {
    setScopeAgent("ops");
    expect(getComposerScope().agent).toBe("ops");
    setScopeAgent(null);
    expect(getComposerScope().agent).toBe(null); // armed at the default, NOT un-armed
  });

  it("`clear` is what un-arms the agent — back to untouched", () => {
    setScopeAgent(null);
    clearComposerScope();
    expect(getComposerScope().agent).toBe(undefined);
  });

  it("ticks skills on and off, preserving the others", () => {
    toggleScopeSkill("deploy");
    toggleScopeSkill("backups");
    expect(getComposerScope().skills).toEqual(["deploy", "backups"]);
    toggleScopeSkill("deploy");
    expect(getComposerScope().skills).toEqual(["backups"]);
  });

  it("notifies subscribers with a fresh snapshot per change", () => {
    const { result } = renderHook(() => useComposerScope());
    expect(result.current.agent).toBe(undefined);
    act(() => setScopeAgent("ops"));
    expect(result.current.agent).toBe("ops");
    act(() => toggleScopeSkill("deploy"));
    expect(result.current.skills).toEqual(["deploy"]);
  });
});

describe("composerScope — spent on dispatch", () => {
  it("`take` returns the arming AND clears it in one step (and never someone's live hold)", () => {
    setScopeAgent("ops");
    toggleScopeSkill("deploy");
    // The return is the TakenScope shape: the arming plus this take's own hold token — no `spent`
    // field, because by the time a caller could read it it may be another send's live hold.
    const taken = takeComposerScope(true);
    expect(taken.agent).toBe("ops");
    expect(taken.skills).toEqual(["deploy"]);
    expect(taken.hold).not.toBeNull();
    expect("spent" in taken).toBe(false);
    expect(getComposerScope().agent).toBe(undefined);
    expect(getComposerScope().skills).toEqual([]);
  });

  it("`clear` drops the arming without handing it to anyone", () => {
    setScopeAgent("ops");
    clearComposerScope();
    expect(getComposerScope().agent).toBe(undefined);
    expect(getComposerScope().skills).toEqual([]);
  });
});

describe("composerScope — the spent pick is HELD for its own message (review round C2)", () => {
  // The take MOVES the agent pick rather than dropping it: the backdrop paints whoever the message in
  // flight runs as, and dropping at dispatch put the ladder's face up for exactly that turn. Nothing
  // else reads `spent` — it arms no send and reaches no wire. The hold is TOKEN-owned (fix-wave round
  // 2): every stash bumps a generation, and a release naming an older token is a stale send settling.
  it("`take` stashes the agent it spent, in the same step", () => {
    setScopeAgent("ops");
    toggleScopeSkill("deploy");
    takeComposerScope(true);
    expect(getComposerScope().agent).toBe(undefined);
    expect(getComposerScope().spent).toBe("ops");
    expect(getComposerScope().skills).toEqual([]); // the skills are NOT held: nothing reads them after
  });

  it("an explicit 'the configured default' is held as the `null` it is, not as 'nothing'", () => {
    setScopeAgent(null);
    takeComposerScope(true);
    expect(getComposerScope().spent).toBe(null);
  });

  it("`releaseSpent(hold)` releases it — the send settled", () => {
    setScopeAgent("ops");
    const { hold } = takeComposerScope(true);
    releaseSpent(hold!);
    expect(getComposerScope().spent).toBe(undefined);
  });

  it("a STEER's take (`stash: false`) holds nothing and returns no token", () => {
    // Arch F1: a steer's POST settles at the 202, before the steered reply exists — a stash there
    // would release within one round-trip, so the steer never holds at all.
    setScopeAgent("ops");
    const taken = takeComposerScope(false);
    expect(taken.agent).toBe("ops"); // still consumed for routing
    expect(taken.hold).toBeNull();
    expect(getComposerScope().spent).toBe(undefined);
  });

  it("a take that spends NOTHING preserves a live hold — an unarmed steer cannot repaint the turn", () => {
    setScopeAgent("lynette");
    takeComposerScope(true); // the armed send, in flight
    const steer = takeComposerScope(true); // a later unarmed send/steer
    expect(steer.hold).toBeNull();
    expect(getComposerScope().spent).toBe("lynette"); // the armed turn keeps its face
  });

  it("a STALE hold token is a no-op — same-name overlapping sends cannot release each other", () => {
    // The value-equality guard's named failure: two sends both armed at "lynette"; the FIRST one
    // settling must not take the SECOND one's hold down.
    setScopeAgent("lynette");
    const first = takeComposerScope(true);
    setScopeAgent("lynette");
    takeComposerScope(true);
    releaseSpent(first.hold!); // the older send settles late
    expect(getComposerScope().spent).toBe("lynette"); // the newer hold stands
  });

  it("`clear` leaves the held pick STANDING — a hold belongs to the send in flight, not the gesture", () => {
    // Fix-wave round 2 (arch F3), inverting this arm's first shape: the menu's clear row means
    // "un-arm the NEXT message"; stealing the hold repainted the surface under an unrelated turn.
    setScopeAgent("ops");
    takeComposerScope(true);
    setScopeAgent("lynette"); // a fresh arming, then cleared by hand
    clearComposerScope();
    expect(getComposerScope().agent).toBe(undefined);
    expect(getComposerScope().spent).toBe("ops"); // the in-flight send's hold survives
  });

  it("`previewAgent` answers armed first, then held, then nobody", () => {
    expect(previewAgent(getComposerScope())).toBe(undefined);
    setScopeAgent("ops");
    expect(previewAgent(getComposerScope())).toBe("ops");
    const { hold } = takeComposerScope(true);
    expect(previewAgent(getComposerScope())).toBe("ops"); // held now, same answer
    setScopeAgent("lynette"); // arming outranks a hold
    expect(previewAgent(getComposerScope())).toBe("lynette");
    clearComposerScope();
    expect(previewAgent(getComposerScope())).toBe("ops"); // back to the hold
    releaseSpent(hold!);
    expect(previewAgent(getComposerScope())).toBe(undefined);
  });

  it("subscribers see both stages — the hold is a real snapshot change", () => {
    const { result } = renderHook(() => useComposerScope());
    act(() => setScopeAgent("ops"));
    expect(result.current.agent).toBe("ops");
    let hold: number | null = null;
    act(() => {
      hold = takeComposerScope(true).hold;
    });
    expect(result.current.agent).toBe(undefined);
    expect(result.current.spent).toBe("ops");
    act(() => releaseSpent(hold!));
    expect(result.current.spent).toBe(undefined);
  });
});

describe("composerScope — never persisted", () => {
  it("writes nothing to localStorage (unlike the draft store beside it)", () => {
    setScopeAgent("ops");
    toggleScopeSkill("deploy");
    expect(localStorage.length).toBe(0);
  });
});
