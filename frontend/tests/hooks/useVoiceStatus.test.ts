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
});
