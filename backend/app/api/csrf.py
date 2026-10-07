"""The CSRF header gate for a MULTIPART write (Phase 26 S9; SECURITY_MODEL §2.7, §2.12).

The app has no application-layer auth, so the attacker worth designing against is the owner's own
browser on another origin (§2.7). Every write route is shaped so that a cross-origin send needs a
CORS PREFLIGHT, which this app never answers (no CORS middleware — pinned): JSON bodies by their content
type, owner files by raw-body `PUT`. A multipart FORM cannot be shaped that way — `multipart/form-data` is
a CORS-safelisted content type, so a hostile page can SEND one with no preflight (it only cannot read the
answer). The clip door (`POST /api/voice/stt`) is such a route, and since S9 it writes (the debug trail +
capture). The house answer is a REQUIRED custom header. Its value is the DENIED PREFLIGHT: a request
carrying a custom header is never "simple", so a hostile page that adds it gets a preflight this app never
answers, and its send never leaves the browser; a page that omits it sends a simple request that DOES
arrive — FastAPI parses (spools) its multipart body before any dependency runs, as for every form route,
the body-parse order is unchanged — and is refused 403 before any handler code runs (no decode, no ASR, no
trail, no capture). A page that gets the header through is same-origin by construction. Same-origin `fetch`
sets it for free (`frontend/src/api/client.ts::postForm` — the ONE place the app sends a form).

The value is fixed only to keep it greppable; the header's PRESENCE is what forces the preflight. This
gate is THE pattern for any future multipart write: `dependencies=[Depends(require_csrf_header)]`, and
`test_media_write_d65.py` refuses an allowlisted form route without it.
"""

from __future__ import annotations

from fastapi import HTTPException, Request

#: The header + value the FE's `postForm` sends (`CSRF_HEADER` / `CSRF_HEADER_VALUE` there).
CSRF_HEADER = "X-Requested-With"
CSRF_HEADER_VALUE = "ctrl-b"


def require_csrf_header(request: Request) -> None:
    """403 unless the request carries `X-Requested-With: ctrl-b` — run as a route dependency, so a
    refused send reaches no handler code (no decode, no trail, no capture, no upstream call). It runs after
    FastAPI's form parse; what it buys is the module docstring's denied preflight."""
    if request.headers.get(CSRF_HEADER) != CSRF_HEADER_VALUE:
        raise HTTPException(status_code=403, detail=f"missing the {CSRF_HEADER} header")
