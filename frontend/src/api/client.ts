// Thin fetch wrapper. Dev: Vite proxies /api → uvicorn (single origin, no CORS).

/** An error carrying the HTTP status alongside FastAPI's `detail` message. Callers that need to
 *  branch on the status (A11/D48 C2 — the providers-base 409 gets a distinct toast + refresh) read
 *  `.status`; everyone else keeps treating it as a plain `Error` (the message is unchanged). */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new ApiError(`${path} → ${res.status} ${res.statusText}`, res.status);
  return (await res.json()) as T;
}

/** Like `getJSON` but also returns a named response header alongside the parsed body — one request,
 *  both values. A11/D48 FR2-1: `GET /api/settings` carries the providers fingerprint in
 *  `X-Providers-Rev`, captured atomically with the doc so the Conf draft's concurrency base binds to
 *  the exact snapshot it seeds from (never a stale rev from a separate `/api/providers` read). */
export async function getJSONWithHeader<T>(
  path: string,
  header: string,
): Promise<{ data: T; header: string | null }> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new ApiError(`${path} → ${res.status} ${res.statusText}`, res.status);
  return { data: (await res.json()) as T, header: res.headers.get(header) };
}

/** Send JSON with `method`, surfacing FastAPI's `detail` (string or validation list) on error. */
async function sendJSON<T>(method: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (j?.detail) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as T;
}

/** POST JSON. On error, surfaces FastAPI's `detail` (string or validation list) as the message. */
export function postJSON<T>(path: string, body: unknown): Promise<T> {
  return sendJSON<T>("POST", path, body);
}

/** PUT JSON (settings + CRUD updates). Same error-surfacing as `postJSON`. */
export function putJSON<T>(path: string, body: unknown): Promise<T> {
  return sendJSON<T>("PUT", path, body);
}

/** DELETE a resource. Surfaces FastAPI `detail` on error; tolerates an empty 204 body. */
export async function del(path: string): Promise<void> {
  const res = await fetch(path, { method: "DELETE", headers: { Accept: "application/json" } });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (j?.detail) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* 204 / non-JSON — keep the status line */
    }
    throw new ApiError(detail, res.status);
  }
}
