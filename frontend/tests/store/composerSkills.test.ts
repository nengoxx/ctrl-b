import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearComposerSkills,
  takeComposerSkills,
  toggleComposerSkill,
  useComposerSkills,
} from "../../src/store/composerSkills";

// A6 — the composer menu's ONE-SHOT skills store. Two invariants beyond plain get/set: it is SPENT on
// dispatch (`take` = read + clear, so no send can leave stale ticks showing), and it is NOT PERSISTED
// (a ticked skill must never survive a reload — see the store header). The menu's agent section is not
// here at all: it is sticky, and writes the sticky pin (D75 ruling, 2026-09-24).

beforeEach(() => {
  clearComposerSkills();
  localStorage.clear();
});

describe("composerSkills — ticking", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useComposerSkills());
    expect(result.current).toEqual([]);
  });

  it("ticks skills on and off, preserving the others — and notifies subscribers per change", () => {
    const { result } = renderHook(() => useComposerSkills());
    act(() => toggleComposerSkill("deploy"));
    act(() => toggleComposerSkill("backups"));
    expect(result.current).toEqual(["deploy", "backups"]);
    act(() => toggleComposerSkill("deploy"));
    expect(result.current).toEqual(["backups"]);
  });
});

describe("composerSkills — spent on dispatch", () => {
  it("`take` returns the ticks AND clears them in one step", () => {
    const { result } = renderHook(() => useComposerSkills());
    act(() => toggleComposerSkill("deploy"));
    let taken: string[] = [];
    act(() => {
      taken = takeComposerSkills();
    });
    expect(taken).toEqual(["deploy"]);
    expect(result.current).toEqual([]);
    expect(takeComposerSkills()).toEqual([]); // spent: a second take finds nothing
  });

  it("`clear` drops the ticks without handing them to anyone", () => {
    toggleComposerSkill("deploy");
    clearComposerSkills();
    expect(takeComposerSkills()).toEqual([]);
  });
});

describe("composerSkills — never persisted", () => {
  it("writes nothing to localStorage (unlike the draft store beside it)", () => {
    toggleComposerSkill("deploy");
    expect(localStorage.length).toBe(0);
  });
});
