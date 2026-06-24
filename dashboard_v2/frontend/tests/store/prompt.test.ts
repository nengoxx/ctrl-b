import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { requestPrompt, resolvePrompt, usePrompt } from "../../src/store/prompt";

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
    expect(result.current?.value).toBe("before");
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
