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
  init?: { signal?: AbortSignal },
): Promise<{ data: T; header: string | null }> {
  // Thread TanStack's per-query AbortSignal into the fetch so a cancelled query (e.g. a save's
  // `cancelQueries(["settings"])`) actually ABORTS the in-flight read. Without it the fetch runs to
  // completion and the queryFn's side effect (`setQueryData(providers-rev)`) still fires — overwriting
  // a fresh post-save rev with the stale one (Codex, review of the fix wave). An abort rejects with a
  // DOMException AbortError, which TanStack treats as a cancelled fetch — do NOT catch it here.
  const res = await fetch(path, { headers: { Accept: "application/json" }, signal: init?.signal });
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
      const raw =
        typeof o.message === "string" ? o.message : typeof o.msg === "string" ? o.msg : "";
      const what = raw.trim(); // whitespace-only would render a blank toast — worse than the status line
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

/** A refused response, as the ONE `ApiError` every write path throws — FastAPI's `detail` when the body
 *  carries one, the status line when it does not (a 204, a proxy's HTML page). It was three identical
 *  copies of this block; the fourth (D70's card import, whose 413/415/422/409 the owner reads verbatim)
 *  is what made it a function. `getJSON` keeps its bare status line deliberately — a GET carries no
 *  validation detail worth rendering. */
async function refuse(res: Response): Promise<never> {
  let detail = `${res.status} ${res.statusText}`;
  try {
    const j = (await res.json()) as { detail?: unknown };
    detail = formatDetail(j?.detail) ?? detail;
  } catch {
    /* non-JSON / empty error body — keep the status line */
  }
  throw new ApiError(detail, res.status);
}

/** The one per-request option a JSON write may carry (D77): `keepalive`, so a request fired as the page
 *  goes away (`pagehide`, a hidden tab) outlives it. Deliberately NOT a general `RequestInit` — the
 *  method, the headers and the body shape are this module's to decide, because the `application/json`
 *  content type is the CSRF control (the `putBytes` comment below, SECURITY_MODEL §2.7): a caller that
 *  could swap it for a safelisted one would re-open the preflight-free cross-origin write. */
export interface SendOpts {
  keepalive?: boolean;
}

/** Send JSON with `method`, surfacing FastAPI's `detail` (string or validation list) on error. A `204`
 *  resolves `undefined` — there is no body to parse (the `del` precedent). */
async function sendJSON<T>(
  method: string,
  path: string,
  body: unknown,
  opts?: SendOpts,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    ...(opts?.keepalive ? { keepalive: true } : {}),
  });
  if (!res.ok) await refuse(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** POST JSON. On error, surfaces FastAPI's `detail` (string or validation list) as the message. */
export function postJSON<T>(path: string, body: unknown, opts?: SendOpts): Promise<T> {
  return sendJSON<T>("POST", path, body, opts);
}

/** PUT JSON (settings + CRUD updates). Same error-surfacing as `postJSON`. */
export function putJSON<T>(path: string, body: unknown): Promise<T> {
  return sendJSON<T>("PUT", path, body);
}

/** PUT RAW BYTES — EVERY write in this app that is not JSON (D65 / MEDIA_MANAGER_PLAN §3: the media
 *  upload · D68: the attachment mint · D70: both character-card / lorebook imports).
 *
 *  **The verb and the body shape ARE the security control**, which is why this is its own function
 *  rather than an option on `sendJSON`: the app has no application-layer auth (the tailnet is the
 *  boundary), so the realistic attacker is the owner's own browser on another origin — and the only
 *  cross-origin requests a page can fire without a preflight are the CORS-SAFELISTED ones, which
 *  include `multipart/form-data` POSTs. A raw-body `PUT` is not safelisted: it forces an `OPTIONS`
 *  preflight that this app answers with no ACAO, so a cross-origin write dies unsent. Never turn this
 *  into a POST, and never send `FormData` from it (SECURITY_MODEL §2.7/§2.9). The import routes were
 *  multipart POSTs until R73 (2026-09-15) and are here now for exactly this reason — CORS withholds
 *  the RESPONSE, never the send, so "it answers with the created object" was never a defence.
 *
 *  The `Content-Type` is the body's own and is advisory only — the server reads the MAGIC BYTES (the
 *  media write answers 415 if they disagree with the extension in the URL; an import sniffs the card
 *  container the same way). A `File` is a `Blob`, so an import passes the owner's pick straight in.
 *
 *  Errors keep their STATUS (`ApiError.status`), because the callers branch on it: a `409` is the
 *  media name-race guard and is retried with the next suffix rather than shown to anyone, a `412` is
 *  the edit path's stale precondition, and an import's 413/415/422/409 are rendered verbatim.
 *
 *  `headers` carries the PRECONDITION an edit states (`X-Expected-Revision`, "W10") — the one header
 *  a caller adds, and the reason it is a parameter rather than an option object: a custom header keeps
 *  the request non-safelisted, which is the very property the paragraph above rests on. */
export async function putBytes<T>(
  path: string,
  body: Blob,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(path, {
    method: "PUT",
    headers: {
      "Content-Type": body.type || "application/octet-stream",
      Accept: "application/json",
      ...headers,
    },
    body,
  });
  if (!res.ok) await refuse(res);
  return (await res.json()) as T;
}

/** DELETE a resource. Surfaces FastAPI `detail` on error; tolerates an empty 204 body. */
export async function del(path: string): Promise<void> {
  const res = await fetch(path, { method: "DELETE", headers: { Accept: "application/json" } });
  if (!res.ok) await refuse(res);
}
