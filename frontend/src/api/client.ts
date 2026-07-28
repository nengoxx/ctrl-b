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

// GETs throw the bare status line: they carry no validation `detail` worth rendering. If that ever
// changes, route it through `formatDetail` below — do NOT grow a second renderer here.
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

/** Render FastAPI's `detail` for display — from a WHITELIST of fields, never the raw object.
 *
 *  A 422 `detail` is a list of error objects, and a pydantic one used to carry `input`: the value that
 *  failed validation, i.e. the whole submitted document. `JSON.stringify(detail)` therefore printed the
 *  real `api_key` into a toast (A11 pre-release audit, HIGH — canary-confirmed). The backend now
 *  renders `{loc, msg, type}` only, and this is the other half of that fix: even if a body ever carries
 *  a value again, nothing outside these fields is displayed.
 *
 *  Two shapes are understood — the strict-resolve envelope `{path, message}` and pydantic's
 *  `{loc, msg}` — and anything unrecognised degrades to the status line rather than being stringified.
 *  Returns `null` when there is nothing renderable, so the caller keeps its own fallback. */
export function formatDetail(detail: unknown): string | null {
  if (typeof detail === "string") return detail.trim() || null;
  if (!Array.isArray(detail)) return null;
  const lines = detail
    .map((item): string | null => {
      if (typeof item === "string") return item.trim() || null;
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const what =
        typeof o.message === "string" ? o.message : typeof o.msg === "string" ? o.msg : "";
      if (!what) return null;
      const where =
        typeof o.path === "string"
          ? o.path
          : Array.isArray(o.loc)
            ? o.loc.filter((p) => typeof p === "string" || typeof p === "number").join(".")
            : "";
      return where ? `${where}: ${what}` : what;
    })
    .filter((l): l is string => l !== null);
  return lines.length ? lines.join(" · ") : null;
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
      detail = formatDetail(j?.detail) ?? detail;
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
      detail = formatDetail(j?.detail) ?? detail;
    } catch {
      /* 204 / non-JSON — keep the status line */
    }
    throw new ApiError(detail, res.status);
  }
}
