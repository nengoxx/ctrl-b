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
//
// The agent is TRI-STATE (Codex, round 2): `undefined` untouched · `null` explicitly "the configured
// default" (which beats a sticky `/agent`) · a name. `undefined` vs `null` is the whole point, so these
// assertions read `.agent` explicitly where `toEqual` would treat the two as one.

beforeEach(() => {
  clearComposerScope();
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
  it("`take` returns the arming AND clears it in one step", () => {
    setScopeAgent("ops");
    toggleScopeSkill("deploy");
    expect(takeComposerScope()).toEqual({ agent: "ops", skills: ["deploy"] });
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

describe("composerScope — never persisted", () => {
  it("writes nothing to localStorage (unlike the draft store beside it)", () => {
    setScopeAgent("ops");
    toggleScopeSkill("deploy");
    expect(localStorage.length).toBe(0);
  });
});
