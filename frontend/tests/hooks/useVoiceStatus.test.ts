import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// D63 — the chunk policy's DELIVERY path. `GET /voice/status` is the always-on probe the PWA already
// polls, and the playback singleton is not a component, so the policy is published to it right where
// the response lands. That hand-off is the one place a wire rename (`min_words` → `minChars`, …) would
// silently mis-size every chunk, so it gets driven for real here rather than mocked.

const h = vi.hoisted(() => ({ setChunkPolicy: vi.fn() }));
vi.mock("../../src/lib/audioController", () => ({ setChunkPolicy: h.setChunkPolicy }));

import { useVoiceStatus } from "../../src/hooks/useVoiceStatus";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("useVoiceStatus · the D63 chunk policy reaches the playback controller", () => {
  let qc: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  function mockStatus(body: unknown) {
    globalThis.fetch = vi.fn(async () =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
    );
  }

  it("maps every wire field onto the controller's policy", async () => {
    mockStatus({
      stt: true,
      tts: true,
      stt_auto_send: false,
      tts_chunking: {
        mode: "paragraph",
        min_words: 3,
        min_chars: 40,
        max_chars: 300,
        lookahead: 2,
        max_text_chars: 2048,
        format: "wav",
      },
    });
    const { result } = renderHook(() => useVoiceStatus(), { wrapper });
    await waitFor(() => expect(result.current.data?.tts).toBe(true));
    expect(h.setChunkPolicy).toHaveBeenCalledWith({
      mode: "paragraph",
      minWords: 3,
      minChars: 40,
      maxChars: 300,
      maxTextChars: 2048,
      lookahead: 2,
      format: "wav",
    });
  });

  it("a payload without the block leaves the controller on its whole-message default", async () => {
    mockStatus({ stt: true, tts: true, stt_auto_send: false });
    const { result } = renderHook(() => useVoiceStatus(), { wrapper });
    await waitFor(() => expect(result.current.data?.tts).toBe(true));
    expect(h.setChunkPolicy).not.toHaveBeenCalled();
  });

  // R51 Tier 0 — the mic's auto-stop policy rides the SAME probe, but its consumer is a React hook
  // (`useDictation`, via `useComposer`), so it stays on `data` instead of being published to a
  // singleton. Absent → undefined → the mic's own default, plain push-to-talk (LOW-4).
  it("carries the auto-stop policy on `data`, and reads absent as undefined", async () => {
    const auto_stop = { enabled: true, silence_s: 2.5, threshold: 0.02 };
    mockStatus({ stt: true, tts: false, stt_auto_send: false, stt_auto_stop: auto_stop });
    const { result } = renderHook(() => useVoiceStatus(), { wrapper });
    await waitFor(() => expect(result.current.data?.stt).toBe(true));
    expect(result.current.data?.stt_auto_stop).toEqual(auto_stop);

    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockStatus({ stt: true, tts: false, stt_auto_send: false });
    const older = renderHook(() => useVoiceStatus(), { wrapper });
    await waitFor(() => expect(older.result.current.data?.stt).toBe(true));
    expect(older.result.current.data?.stt_auto_stop).toBeUndefined();
  });
});
