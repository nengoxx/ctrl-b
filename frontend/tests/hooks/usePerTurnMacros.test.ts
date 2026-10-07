import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ISS-28 — the editors' per-turn hint hook. The client knows NO macro: the server's `per_turn_in`
// answers (vocabulary AND grammar), so what is pinned here is the CLIENT's half — when it asks (only
// for a head-landing text that can hold a macro at all), what it sends, and the one line it words.

const h = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("../../src/api/client", async (importActual) => {
  const actual = await importActual<typeof import("../../src/api/client")>();
  return { ...actual, postJSON: h.post };
});

import { perTurnHint, usePerTurnHint } from "../../src/hooks/usePerTurnMacros";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

/** A client with TanStack's DEFAULT retry (3, backoff) — what production has unless the hook says
 *  otherwise; the suite's own `wrapper` turns retry off globally, which would hide the finding. */
function noRetryOff({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: new QueryClient() }, children);
}

afterEach(() => h.post.mockReset());

describe("usePerTurnHint", () => {
  it("asks the server for a head-landing text and words its answer as the report's line", async () => {
    h.post.mockResolvedValue({ per_turn: ["random", "time"] });
    const { result } = renderHook(
      () => usePerTurnHint("x {{Random:a,b}} {{time}}", true, "entry"),
      {
        wrapper,
      },
    );
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(h.post).toHaveBeenCalledWith("/api/macros/per-turn", {
      text: "x {{Random:a,b}} {{time}}",
    });
    expect(result.current[0]).toBe(
      "this entry uses a per-turn macro ({{random}}, {{time}}) — the prompt cache re-prefills every turn it is active",
    );
  });

  it("an empty server answer (e.g. a commented macro) is no hint", async () => {
    h.post.mockResolvedValue({ per_turn: [] });
    const { result } = renderHook(() => usePerTurnHint("{{// {{time}} }}", true, "field"), {
      wrapper,
    });
    await waitFor(() => expect(h.post).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("never asks for a tail text, or for one with no `{{`", async () => {
    renderHook(() => usePerTurnHint("{{time}}", false, "entry"), { wrapper });
    renderHook(() => usePerTurnHint("plain text", true, "field"), { wrapper });
    await new Promise((r) => setTimeout(r, 400)); // past the debounce
    expect(h.post).not.toHaveBeenCalled();
  });

  it("A → B: while B is in flight, A's answer never shows for B", async () => {
    let releaseB: (v: { per_turn: string[] }) => void = () => undefined;
    h.post.mockImplementation((_path: string, body: { text: string }) =>
      body.text === "A {{time}}"
        ? Promise.resolve({ per_turn: ["time"] })
        : new Promise((r) => {
            releaseB = r;
          }),
    );
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => usePerTurnHint(text, true, "field"),
      { wrapper, initialProps: { text: "A {{time}}" } },
    );
    await waitFor(() => expect(result.current[0]).toContain("{{time}}"));
    rerender({ text: "B {{random:x,y}}" });
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(2)); // B asked, still pending
    expect(result.current).toEqual([]); // no stale {{time}} for B
    releaseB({ per_turn: ["random"] });
    await waitFor(() => expect(result.current[0]).toContain("{{random}}"));
    expect(result.current[0]).not.toContain("{{time}}");
  });

  it("a refused request is ONE call and no hint — never a retry, never a throw", async () => {
    h.post.mockRejectedValue(new Error("422"));
    const { result } = renderHook(() => usePerTurnHint("{{time}}", true, "field"), {
      wrapper: noRetryOff,
    });
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 1500)); // past TanStack's default first retry delay (1 s)
    expect(h.post).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual([]);
  });

  it("perTurnHint names the field or the entry", () => {
    expect(perTurnHint(["date"], "field")).toBe(
      "this field uses a per-turn macro ({{date}}) — the prompt cache re-prefills every turn it is active",
    );
  });
});
