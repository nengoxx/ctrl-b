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

import asyncio
import os
import stat
from collections.abc import Sequence
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
    disabled_index,
)

router = APIRouter(tags=["media"])


class MediaFiles(StaticFiles):
    """StaticFiles narrowed to exactly what the index advertises: `<role>/<allowlisted image>`.

    Starlette 1.3.1 already handles path traversal properly (normpath + realpath + `commonpath`
    containment, and `follow_symlink=False` rejects a symlink pointing out of the root), so that is
    not what this subclass is for. It closes three holes that containment does not:

    **The SHAPE** (Codex F1). Containment only says the path stayed under the namespace root — it says
    nothing about WHERE under it. A file the owner parked beside the role folders (a root-level
    `x.png`, a `private/` directory of their own) was therefore served to the whole tailnet while
    appearing in no listing. The path must now be exactly `<registered role>/<file>`.

    **The Content-Type** (§10.4, verified): `FileResponse` GUESSES the type from the extension, so an
    owner-dropped `evil.html` in a media folder would be served as same-origin `text/html` — stored XSS
    against an app with no auth and full API access from the same origin. So:

      * the extension must be in `ALLOWED_TYPES` or the request 404s before anything is opened;
      * the Content-Type is SET from that table, never guessed;
      * `X-Content-Type-Options: nosniff` stops the browser from second-guessing us either way;
      * `Cache-Control: no-cache` = revalidate, because these files are OWNER-MUTABLE under a stable
        name. Starlette still emits ETag/Last-Modified and answers a conditional request with a ~200
        byte 304, so this costs a round trip, not a re-download. `immutable` is reserved for hashed
        names (the build's `/assets`), which these are not.

    **The FILE ITSELF** (Codex W1). `follow_symlink=False` only rejects a link that leaves the root, so
    `characters/x.png -> ../private/secret.png` passed both it and the shape gate: the target is under
    the namespace, just somewhere nothing lists. Owner drops are real files, and a symlink is not a
    supported feature at any level of this tree — so the final component must be a REGULAR FILE, which
    also disposes of directories and fifos in the same line. The index applies the same rule, so what
    is listed and what is served cannot disagree.

    Nothing here is theme-aware: one instance is mounted per namespace in `create_app`, with that
    namespace's role list.
    """

    def __init__(self, *, directory: Path, roles: Sequence[str]) -> None:
        # check_dir stays TRUE (the loud failure is the useful one) — a namespace whose tree is not
        # servable is never mounted at all (`ensure_media_dirs` health, W2), so reaching here means the
        # directory exists.
        super().__init__(directory=directory, check_dir=True, follow_symlink=False)
        self.roles = frozenset(roles)

    def lookup_path(self, path: str) -> tuple[str, os.stat_result | None]:
        """The FILE gate (Codex W1): the final component must be a REGULAR FILE.

        `follow_symlink=False` only rejects a link that leaves the root, so
        `characters/x.png -> ../private/secret.png` passed it AND the shape gate — the target is inside
        the namespace, just somewhere nothing lists. `lstat` asks what the component IS rather than what
        it points at, and rejecting non-regular files disposes of directories and fifos in the same
        line. The index applies the same rule, so listed and served cannot disagree.

        Placed HERE rather than in `get_response` on purpose: Starlette already runs this method in a
        worker thread, so the extra `lstat` costs no event-loop time. Returning the miss tuple routes
        into the ordinary 404 — a probe learns "not there" and nothing else.
        """
        try:
            if not stat.S_ISREG(os.lstat(os.path.join(str(self.directory), path)).st_mode):
                return "", None
        except OSError:
            return "", None
        return super().lookup_path(path)

    async def get_response(self, path: str, scope: Scope) -> Response:
        # `path` arrives normalised by `StaticFiles.get_path` (`..` collapsed), so both checks below are
        # pure inspections of the RESOLVED name. Done BEFORE `super()` so a rejected request is never
        # stat-ed or opened — the 404 is indistinguishable from "not there", which is the right answer
        # to someone probing what the owner keeps in a folder.
        #
        # ① The SHAPE gate (Codex F1). Containment alone is not enough: it only says the path stays
        # under the namespace root, so a file the owner parked BESIDE the role folders — a root-level
        # `x.png`, or anything inside a `private/` they made themselves — was servable to the whole
        # tailnet while appearing in no listing. The mount now serves exactly what the index advertises:
        # `<registered role>/<file>`, two segments, no deeper nesting.
        parts = Path(path).parts
        if len(parts) != 2 or parts[0] not in self.roles:
            raise StarletteHTTPException(status_code=404)
        # ② The TYPE gate.
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
    # A namespace whose tree could not be prepared is not mounted (W2), so there is nothing to list and
    # nothing to serve. It answers 200 with the REASON rather than 404 or an empty grid: the client must
    # be able to tell "you have dropped nothing in yet" from "the app cannot read your folder", and only
    # one of those is something the owner can fix.
    health = request.app.state.media_health.get(ns)
    if health is not None and not health.ok:
        return disabled_index(ns, health.reason)
    settings = request.app.state.settings
    order, slots = settings.themes.overrides(ns)
    # OFF the event loop (Codex F8): building the index walks directories, stats every entry and reads
    # each file's header — all blocking, and the JPEG scan is bounded but not free on a malformed drop.
    # `asyncio.to_thread` is the house hop for sync work in an async route (app/api/agent.py's skill and
    # agent readers). The whole build goes in one hop rather than per-file, so a role with twenty files
    # costs one context switch, not twenty.
    return await asyncio.to_thread(build_index, settings.home_dir(), ns, order=order, slots=slots)
