"""Owner media API — the JSON index + the hardened read-only static surface (D52/G5, §10.4).

**Two routes, split on purpose** (§10.4 detail ②):

  * `GET /api/media/{ns}` — the INDEX: per-role file lists in the ruled order, each with the metadata
    the Conf gallery needs, plus the `slots` pins. One query per theme (§5.2's pinned read path).
  * `/api/media/{ns}/files/…` — the MOUNT (`MediaFiles`, registered in `main.create_app`). A single
    shared prefix would invite route-order collisions between a path parameter and a mount.

**Read-only, and deliberately so.** No upload, no delete, no rename — §5.4 ruled option (b): the
tailnet is the only boundary there is (SECURITY_MODEL §1), so a write endpoint here would be
reachable by anything on it. The owner drops files in from another machine; the gallery only orders
and pins, through the ordinary `PUT /api/settings`.

Thin by design: everything mechanical lives in `app.core.media`, which knows nothing about themes.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

from app.core.media import (
    ALLOWED_TYPES,
    MEDIA_NAMESPACES,
    MediaIndex,
    build_index,
)

router = APIRouter(tags=["media"])


class MediaFiles(StaticFiles):
    """StaticFiles under a CLOSED Content-Type allowlist.

    Starlette 1.3.1 already handles path traversal properly (normpath + realpath + `commonpath`
    containment, and `follow_symlink=False` rejects a symlink pointing out of the root), so that is
    not what this subclass is for. **The real hole is Content-Type** (§10.4, verified): `FileResponse`
    GUESSES the type from the extension, so an owner-dropped `evil.html` in a media folder would be
    served as same-origin `text/html` — stored XSS against an app with no auth and full API access
    from the same origin. So:

      * the extension must be in `ALLOWED_TYPES` or the request 404s before anything is opened;
      * the Content-Type is SET from that table, never guessed;
      * `X-Content-Type-Options: nosniff` stops the browser from second-guessing us either way;
      * `Cache-Control: no-cache` = revalidate, because these files are OWNER-MUTABLE under a stable
        name. Starlette still emits ETag/Last-Modified and answers a conditional request with a ~200
        byte 304, so this costs a round trip, not a re-download. `immutable` is reserved for hashed
        names (the build's `/assets`), which these are not.

    Nothing here is namespace-aware: one instance is mounted per namespace in `create_app`.
    """

    def __init__(self, *, directory: Path) -> None:
        # check_dir stays TRUE (the loud failure is the useful one) — `ensure_media_dirs` runs first.
        super().__init__(directory=directory, check_dir=True, follow_symlink=False)

    async def get_response(self, path: str, scope: Scope) -> Response:
        # `path` arrives normalised by `StaticFiles.get_path` (`..` collapsed), so this is a pure
        # extension check on the resolved name. Done BEFORE `super()` so a disallowed file is never
        # stat-ed or opened — the 404 is indistinguishable from "not there", which is the right answer
        # to someone probing what the owner keeps in a folder.
        allowed = ALLOWED_TYPES.get(Path(path).suffix.lower())
        if allowed is None:
            raise StarletteHTTPException(status_code=404)
        response = await super().get_response(path, scope)
        response.headers["x-content-type-options"] = "nosniff"
        response.headers["cache-control"] = "no-cache"
        # A 304 carries no body, so it must carry no Content-Type either (RFC 9110 §15.4.5); the
        # header is set on the 200 path only. Both paths keep the two headers above — Starlette's
        # `NotModifiedResponse` whitelist preserves `cache-control`, and `nosniff` is added here.
        if response.status_code != 304:
            response.headers["content-type"] = allowed[0]
        return response


@router.get("/media/{ns}")
async def media_index(ns: str, request: Request) -> MediaIndex:
    """The namespace's role folders, in the ruled order, with per-file metadata + the `slots` pins.

    The ordering contract is stated on the wire (`collation`) rather than implied: the client resolves
    against this list positionally, so "what does default order mean" has to have exactly one answer
    both ends can name (§5.4's 2026-08-04 ruling).
    """
    if ns not in MEDIA_NAMESPACES:
        raise HTTPException(status_code=404, detail=f"unknown media namespace: {ns}")
    settings = request.app.state.settings
    order, slots = settings.themes.overrides(ns)
    return build_index(settings.home_dir(), ns, order=order, slots=slots)
