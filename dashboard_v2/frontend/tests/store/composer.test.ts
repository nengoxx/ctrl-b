import { beforeEach, describe, expect, it } from "vitest";

import { appendDraft, clearDraft, getDraft, setDraft } from "../../src/store/composer";

// store/composer — the persistent composer draft (survives tab-switch unmount + reload via
// localStorage). `appendDraft` is the dictation hand-off seam.

beforeEach(() => {
  clearDraft();
  localStorage.clear();
});

describe("composer draft store", () => {
  it("setDraft / getDraft round-trips and persists to localStorage", () => {
    setDraft("wake the vault");
    expect(getDraft()).toBe("wake the vault");
    expect(JSON.parse(localStorage.getItem("ctrlb.composer")!)).toEqual({ draft: "wake the vault" });
  });

  it("clearDraft empties it", () => {
    setDraft("something");
    clearDraft();
    expect(getDraft()).toBe("");
  });

  it("appendDraft fills an empty draft", () => {
    appendDraft("hello world");
    expect(getDraft()).toBe("hello world");
  });

  it("appendDraft space-joins onto existing text (doesn't clobber what was typed)", () => {
    setDraft("already typed");
    appendDraft("dictated bit");
    expect(getDraft()).toBe("already typed dictated bit");
  });

  it("appendDraft ignores empty/whitespace input", () => {
    setDraft("keep");
    appendDraft("   ");
    expect(getDraft()).toBe("keep");
  });
});
