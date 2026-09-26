import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, postBlob } from "../../src/api/client";

// `postBlob` — the ONE non-JSON POST (D79 / §15.3): a side-effect-free derivation (the card export's
// carrier PNG in, the card PNG out). Pinned: the request shape (POST, the raw bytes, the body's own
// type as advisory Content-Type), a Blob answer, and the house error path (ApiError + status + detail).

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("postBlob", () => {
  it("POSTs the raw bytes and answers with the response's own bytes", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn(async () =>
      Promise.resolve(new Response(png, { status: 200, headers: { "content-type": "image/png" } })),
    );
    globalThis.fetch = fetchMock;
    const carrier = new Blob(["carrier"], { type: "image/png" });
    const out = await postBlob("/api/agents/lynette/card.png", carrier);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/agents/lynette/card.png");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(carrier);
    expect(init.body).not.toBeInstanceOf(FormData);
    expect(init.headers).toMatchObject({ "Content-Type": "image/png" });
    expect(out).toBeInstanceOf(Blob);
    expect(new Uint8Array(await out.arrayBuffer())).toEqual(png);
  });

  it("labels a bare ArrayBuffer application/octet-stream", async () => {
    const fetchMock = vi.fn(async () => Promise.resolve(new Response(new Uint8Array([1]))));
    globalThis.fetch = fetchMock;
    await postBlob("/api/x", new Uint8Array([1, 2]).buffer);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ "Content-Type": "application/octet-stream" });
  });

  it("maps a refusal to ApiError carrying the status and the server's detail", async () => {
    globalThis.fetch = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "the carrier is not a PNG" }), {
          status: 415,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const err = await postBlob("/api/agents/x/card.png", new Blob(["gif"])).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(415);
    expect((err as ApiError).message).toBe("the carrier is not a PNG");
  });
});
