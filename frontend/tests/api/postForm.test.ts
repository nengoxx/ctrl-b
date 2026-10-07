import { afterEach, describe, expect, it, vi } from "vitest";

import { CSRF_HEADER, CSRF_HEADER_VALUE, postForm } from "../../src/api/client";

// `postForm` — the ONE way the app sends a multipart form (Phase 26 S9; SECURITY_MODEL §2.7). Pinned: it
// carries the CSRF header the backend's `api/csrf.require_csrf_header` demands (a custom header makes a
// cross-origin form send a preflight this app never answers), leaves Content-Type to the browser (the
// multipart boundary), and hands the raw Response back for the caller's own status reading.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("postForm", () => {
  it("POSTs the form with the CSRF header and answers the raw response", async () => {
    const answer = new Response(JSON.stringify({ text: "hi" }), { status: 502 });
    const fetchMock = vi.fn(async () => Promise.resolve(answer));
    globalThis.fetch = fetchMock;
    const form = new FormData();
    form.append("file", new Blob(["clip"], { type: "audio/webm" }), "dictation.webm");
    const res = await postForm("/api/voice/stt", form);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/voice/stt");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(form);
    expect(init.headers).toEqual({ [CSRF_HEADER]: CSRF_HEADER_VALUE });
    expect([CSRF_HEADER, CSRF_HEADER_VALUE]).toEqual(["X-Requested-With", "ctrl-b"]);
    expect(res).toBe(answer); // a 502 is the caller's state to read, never thrown here
  });
});
