import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, postForm } from "../../src/api/client";

// D70 §5.1 — the app's ONE multipart POST (`POST /api/agents/import`: a character card is a FILE the
// owner picks). What is worth pinning is the REQUEST SHAPE and the error path: this route's statuses
// are ones the owner reads verbatim, so they must arrive as `ApiError` carrying the server's detail
// rather than a bare status line.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  globalThis.fetch = fn;
  return fn;
}

const form = () => {
  const f = new FormData();
  f.append("file", new Blob(["x"], { type: "image/png" }), "lyra.png");
  return f;
};

describe("postForm", () => {
  it("POSTs the FormData with NO hand-set Content-Type (the browser writes the boundary)", async () => {
    const fetchMock = mockFetch({ name: "lyra" });
    await expect(postForm<{ name: string }>("/api/agents/import", form())).resolves.toEqual({
      name: "lyra",
    });
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/agents/import");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    // Setting it by hand omits the boundary and produces a body the server cannot parse.
    expect(init.headers).toEqual({ Accept: "application/json" });
  });

  it("maps a refusal to ApiError carrying the STATUS and the server's own detail", async () => {
    mockFetch(
      { detail: "the card is larger than roleplay.card_import.max_bytes (15000000 bytes)" },
      413,
    );
    await expect(postForm("/api/agents/import", form())).rejects.toMatchObject({
      name: "ApiError",
      status: 413,
      message: "the card is larger than roleplay.card_import.max_bytes (15000000 bytes)",
    });
  });

  it("renders a 422 validation list through the SHARED detail renderer", async () => {
    mockFetch(
      { detail: [{ loc: ["file"], msg: "invalid agent: bad slug", type: "value_error" }] },
      422,
    );
    const err = await postForm("/api/agents/import", form()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("file: invalid agent: bad slug");
  });

  it("falls back to the status line when the error body is not JSON", async () => {
    globalThis.fetch = vi.fn(async () =>
      Promise.resolve(
        new Response("<html>gateway</html>", { status: 502, statusText: "Bad Gateway" }),
      ),
    );
    await expect(postForm("/api/agents/import", form())).rejects.toMatchObject({
      status: 502,
      message: "502 Bad Gateway",
    });
  });
});
