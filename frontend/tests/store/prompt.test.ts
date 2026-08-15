import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  requestPrompt,
  requestPromptPair,
  resolvePrompt,
  resolvePromptPair,
  usePrompt,
} from "../../src/store/prompt";

// store/prompt — the imperative fullscreen text editor (D23 binding): `await requestPrompt({...})`
// resolves with the edited string (Save) or null (Cancel). Single request at a time. beforeEach clears
// any leftover active request.

beforeEach(() => resolvePrompt(null));

describe("prompt store", () => {
  it("requestPrompt exposes the active request and resolves the edited text", async () => {
    const { result } = renderHook(() => usePrompt());
    let out: string | null | undefined;
    act(() => {
      void requestPrompt({ title: "Persona", value: "before" }).then((r) => (out = r));
    });
    expect(result.current).toMatchObject({ kind: "text", value: "before" });
    await act(async () => {
      resolvePrompt("after");
    });
    expect(out).toBe("after");
    expect(result.current).toBeNull();
  });

  it("resolvePrompt(null) cancels (resolves null)", async () => {
    let out: string | null | undefined;
    act(() => {
      void requestPrompt({ title: "Edit", value: "" }).then((r) => (out = r));
    });
    await act(async () => {
      resolvePrompt(null);
    });
    expect(out).toBeNull();
  });

  it("a second request cancels the one already open (null)", async () => {
    let first: string | null | undefined;
    act(() => {
      void requestPrompt({ title: "A", value: "" }).then((r) => (first = r));
    });
    await act(async () => {
      void requestPrompt({ title: "B", value: "" });
    });
    expect(first).toBeNull();
  });
});

// Phase 18 / D56 — pair mode: the SECOND entry point on the same one-at-a-time store. A registry
// prompt's override + append are edited, cancelled and staged together.

const pairReq = { title: "Memory Intro", override: "o", append: "a", defaultText: "shipped" };

describe("prompt store · pair mode", () => {
  it("requestPromptPair exposes the pair request and resolves the edited pair", async () => {
    const { result } = renderHook(() => usePrompt());
    let out: { override: string; append: string } | null | undefined;
    act(() => {
      void requestPromptPair(pairReq).then((r) => (out = r));
    });
    expect(result.current?.kind).toBe("pair");
    await act(async () => {
      resolvePromptPair({ override: "next", append: "" });
    });
    expect(out).toEqual({ override: "next", append: "" });
    expect(result.current).toBeNull();
  });

  it("resolvePromptPair(null) cancels", async () => {
    let out: { override: string; append: string } | null | undefined;
    act(() => {
      void requestPromptPair(pairReq).then((r) => (out = r));
    });
    await act(async () => {
      resolvePromptPair(null);
    });
    expect(out).toBeNull();
  });

  it("resolvePrompt cancels a pair request — it can never settle it as text", async () => {
    // The shared Escape/backdrop/✕ path calls `resolvePrompt(null)` in both modes.
    let out: { override: string; append: string } | null | undefined;
    act(() => {
      void requestPromptPair(pairReq).then((r) => (out = r));
    });
    await act(async () => {
      resolvePrompt("stray text");
    });
    expect(out).toBeNull();
  });

  it("a second request cancels the one already open, across kinds", async () => {
    let pair: { override: string; append: string } | null | undefined;
    let text: string | null | undefined;
    act(() => {
      void requestPromptPair(pairReq).then((r) => (pair = r));
    });
    await act(async () => {
      void requestPrompt({ title: "text", value: "" }).then((r) => (text = r));
    });
    expect(pair).toBeNull();
    await act(async () => {
      void requestPromptPair(pairReq);
    });
    expect(text).toBeNull();
  });
});
