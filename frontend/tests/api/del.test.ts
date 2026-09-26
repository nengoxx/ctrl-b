import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, del } from "../../src/api/client";

// `del` — D79 / ISS-24 made one DELETE report what it did (`{removed, kept, broken}`), so the helper now
// reads a body back. Pinned: the report arrives parsed; an empty/204 body is `undefined` (every other
// caller ignores the answer); a non-JSON success body is not turned into an error; refusals keep the
// house `ApiError` path.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const answer = (body: BodyInit | null, status = 200, type = "application/json") => {
  const fetchMock = vi.fn(async () =>
    Promise.resolve(new Response(body, { status, headers: { "content-type": type } })),
  );
  globalThis.fetch = fetchMock;
  return fetchMock;
};

describe("del", () => {
  it("DELETEs and returns the route's report", async () => {
    const report = { removed: ["agents/lyra"], kept: { books: ["traits"], art: [] } };
    const fetchMock = answer(JSON.stringify(report));
    await expect(del("/api/agents/lyra")).resolves.toEqual(report);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/agents/lyra");
    expect(init.method).toBe("DELETE");
  });

  it("a 204 / empty body resolves undefined", async () => {
    answer(null, 204);
    await expect(del("/api/skills/x")).resolves.toBeUndefined();
    answer("", 200);
    await expect(del("/api/skills/x")).resolves.toBeUndefined();
  });

  it("a non-JSON success body does not fail a delete that happened", async () => {
    answer("<html>ok</html>", 200, "text/html");
    await expect(del("/api/skills/x")).resolves.toBeUndefined();
  });

  it("a refusal is still an ApiError carrying the detail", async () => {
    answer(JSON.stringify({ detail: "agent not found" }), 404);
    const err = await del("/api/agents/ghost").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe("agent not found");
  });
});
