import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearComposerScope,
  getComposerScope,
  setScopeAgent,
  takeComposerScope,
  toggleScopeSkill,
  useComposerScope,
} from "../../src/store/composerScope";

// A6 — the composer menu's ONE-SHOT arming store. Two invariants beyond plain get/set: it is SPENT on
// dispatch (`take` = read + clear, so no send can leave a stale arming showing), and it is NOT PERSISTED
// (an armed one-shot must never survive a reload — see the store header).

beforeEach(() => {
  clearComposerScope();
  localStorage.clear();
});

describe("composerScope — arming", () => {
  it("starts empty; `null` agent means the configured default", () => {
    expect(getComposerScope()).toEqual({ agent: null, skills: [] });
  });

  it("arms and un-arms the one-shot agent", () => {
    setScopeAgent("ops");
    expect(getComposerScope().agent).toBe("ops");
    setScopeAgent(null);
    expect(getComposerScope().agent).toBe(null);
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
    expect(result.current.agent).toBe(null);
    act(() => setScopeAgent("ops"));
    expect(result.current.agent).toBe("ops");
    act(() => toggleScopeSkill("deploy"));
    expect(result.current.skills).toEqual(["deploy"]);
  });
});

describe("composerScope — spent on dispatch", () => {
  it("`take` returns the arming AND clears it in one step", () => {
    setScopeAgent("ops");
    toggleScopeSkill("deploy");
    expect(takeComposerScope()).toEqual({ agent: "ops", skills: ["deploy"] });
    expect(getComposerScope()).toEqual({ agent: null, skills: [] });
  });

  it("`clear` drops the arming without handing it to anyone", () => {
    setScopeAgent("ops");
    clearComposerScope();
    expect(getComposerScope()).toEqual({ agent: null, skills: [] });
  });
});

describe("composerScope — never persisted", () => {
  it("writes nothing to localStorage (unlike the draft store beside it)", () => {
    setScopeAgent("ops");
    toggleScopeSkill("deploy");
    expect(localStorage.length).toBe(0);
  });
});
