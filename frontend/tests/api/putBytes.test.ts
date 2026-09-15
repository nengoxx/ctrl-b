import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, putBytes } from "../../src/api/client";

// The app's raw-body write helper — every non-JSON write goes through it (D65 the media upload, D68
// the attachment mint, D70 both imports). Two things are worth pinning. ① THE REQUEST SHAPE IS A
// SECURITY PROPERTY (R73 / SECURITY_MODEL §2.7/§2.9): a raw-body PUT is not CORS-safelisted, so a
// hostile page cannot emit it without a preflight this app answers with no ACAO — a regression to
// POST or to `FormData` silently removes that defence, so the method and the body type are asserted.
// ② The error path: these routes' statuses are ones the owner reads verbatim, so they must arrive as
// an `ApiError` carrying the server's own detail rather than a bare status line.

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

/** What an import sends: the owner's picked file, straight in (a `File` IS a `Blob`). */
const card = () => new File([new Blob(["x"])], "lyra.png", { type: "image/png" });

describe("putBytes", () => {
  it("PUTs the RAW bytes — never POST, never FormData (the preflight defence)", async () => {
    const fetchMock = mockFetch({ name: "lyra" });
    await expect(putBytes<{ name: string }>("/api/agents/import", card())).resolves.toEqual({
      name: "lyra",
    });
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/agents/import");
    expect(init.method).toBe("PUT");
    expect(init.body).toBeInstanceOf(Blob);
    expect(init.body).not.toBeInstanceOf(FormData);
    // The blob's own type rides as advisory Content-Type; the server sniffs the magic bytes.
    expect(init.headers).toMatchObject({ "Content-Type": "image/png", Accept: "application/json" });
  });

  it("falls back to application/octet-stream for a typeless body", async () => {
    const fetchMock = mockFetch({ ok: true });
    await putBytes("/api/lorebooks/import", new Blob(["{}"]));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ "Content-Type": "application/octet-stream" });
  });

  it("maps a refusal to ApiError carrying the STATUS and the server's own detail", async () => {
    mockFetch(
      { detail: "the card is larger than roleplay.card_import.max_bytes (15000000 bytes)" },
      413,
    );
    await expect(putBytes("/api/agents/import", card())).rejects.toMatchObject({
      name: "ApiError",
      status: 413,
      message: "the card is larger than roleplay.card_import.max_bytes (15000000 bytes)",
    });
  });

  it("renders a 422 validation list through the SHARED detail renderer", async () => {
    mockFetch(
      { detail: [{ loc: ["body"], msg: "invalid agent: bad slug", type: "value_error" }] },
      422,
    );
    const err = await putBytes("/api/agents/import", card()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("body: invalid agent: bad slug");
  });

  it("falls back to the status line when the error body is not JSON", async () => {
    globalThis.fetch = vi.fn(async () =>
      Promise.resolve(
        new Response("<html>gateway</html>", { status: 502, statusText: "Bad Gateway" }),
      ),
    );
    await expect(putBytes("/api/agents/import", card())).rejects.toMatchObject({
      status: 502,
      message: "502 Bad Gateway",
    });
  });
});
