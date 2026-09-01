"""Owner media API — the JSON index, the hardened static surface, and (per **D65**) the typed write
path (D52/G5, §10.4).

**Two routes, split on purpose** (§10.4 detail ②):

  * `GET /api/media/{ns}` — the INDEX: per-role file lists in the ruled order, each with the metadata
    the Conf gallery needs, plus the `slots` pins. One query per theme (§5.2's pinned read path).
  * `/api/media/{ns}/files/…` — the MOUNT (`MediaFiles`, registered in `main.create_app`). A single
    shared prefix would invite route-order collisions between a path parameter and a mount.

**Writes are RULED, and the VERB is the security control (D65 — superseding §5.4's "read-only, and
deliberately so"; the routes are BUILT as of MEDIA_MANAGER_PLAN's S1, and this is the contract they
satisfy).** The app has no application-layer auth (SECURITY_MODEL §1), so the attacker worth
designing against is the owner's own browser on another origin — and the only cross-origin request a
page can fire without a preflight is a CORS-SAFELISTED one (`GET`/`HEAD`/`POST`, `multipart/form-data`
included). So the write path is **raw-body `PUT`/`DELETE` on `/api/media/{ns}/files/{role}/{filename}`,
never multipart and never POST**: the non-safelisted verb forces an `OPTIONS` preflight, this app
mounts no CORS middleware and answers no ACAO, and the write dies unsent. **Adding CORS middleware, or
accepting a multipart/POST upload, silently removes that defence** — `test_media_write_d65.py` pins
both with an architecture guard over the live app, and neither
may land without revisiting D65 (SECURITY_MODEL §2.7). Ordering/pinning still rides the ordinary
`PUT /api/settings`; only FILE bytes come through here.

**The write routes and the read MOUNT share a URL prefix, and that is safe by Starlette's routing
rather than by luck** (§3): the router is registered BEFORE the mounts, and a `GET` on a write path
matches the route by PATH but not by METHOD — `Match.PARTIAL` — which Starlette remembers and only
falls back to once no FULL match is found anywhere. The mount is that FULL match, so reads keep
reaching it. Pinned by a test, because the day that ordering silently changes every media image 405s.

Thin by design: everything mechanical lives in `app.core.media`, which knows nothing about themes.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Collection, Iterable
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

from app.core.media import (
    ALLOWED_TYPES,
    MEDIA_NAMESPACES,
    MediaFile,
    MediaIndex,
    StoreWriteError,
    UploadPart,
    admission_reason,
    build_index,
    delete_file,
    disabled_index,
    is_served_file,
    role_dir,
)

router = APIRouter(tags=["media"])

#: The files path's LAST rung, registered by `main.create_app` AFTER the per-namespace mounts (S4
#: rider, ruled 2026-08-25). See `media_file_absent` for what it is for and why it cannot live on the
#: router above.
absent_router = APIRouter(tags=["media"], include_in_schema=False)


@absent_router.api_route("/media/{ns}/files/{role}/{filename:path}", methods=["GET", "HEAD"])
async def media_file_absent() -> Response:
    """`404` for a READ of a file path whose namespace is not mounted — a disabled tree, or one the
    registry never had.

    **Without it that read is a `405`**, and the 405 is the whole problem: it carries an `Allow: PUT,
    DELETE` and so tells an unauthenticated prober that a write API exists at this exact URL, on a
    namespace the server has already refused to serve. `media_upload`'s own docstring states the rule
    this closes — *one URL space, one answer for "there is nothing there"* — and a namespace that is
    not mounted is the case it did not reach. The 404 is indistinguishable from "not there", which is
    what a probe must learn.

    Two mechanics are load-bearing:

    · **It is registered AFTER the mounts, which is why it is its own router.** Route matching is by
      registration order for a FULL match, and `include_router` runs before `app.mount` — so a GET
      handler on the main router above would shadow every namespace's `StaticFiles` mount and no owner
      file would ever be served again. Its whole job is to be the rung below them.
    · **It is unconditional, not part of the prod-only SPA branch.** The 405 was reachable in DEV
      only: with `frontend/dist` present, SYS-5's `/api/{rest:path}` GET catch-all full-matches and
      answers 404, and a FULL match beats the write route's PARTIAL wherever it sits in the table. So
      the answer depended on whether a frontend build existed on disk — prod said 404, the profile the
      owner develops in said 405, and a backend test's outcome moved with a frontend artifact. One
      placement, both profiles, one answer.

    **HEAD is declared, because FastAPI's `APIRoute` does not add it** the way a plain Starlette
    `Route` does — left implicit, a HEAD kept answering the 405 with its `Allow`, which is the same
    leak with no body. SYS-5's opposite ruling (its `/api/{rest:path}` catch-all is GET-only precisely
    so a HEAD on a real GET endpoint stays an honest 405) does not reach here: this path has no
    GET-only endpoint to shadow — only the write verbs, and the mounts, which match first and serve
    HEAD themselves.

    **No OPTIONS**, deliberately: inventing one would answer a preflight this server must not answer
    (D65's no-CORS posture is the whole reason a non-safelisted verb is a control).
    """
    raise HTTPException(status_code=404, detail="not found")


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

    def __init__(self, *, directory: Path, roles: Iterable[str]) -> None:
        # `Iterable`, not `Sequence`: the registry row's `roles` is an order-preserving MAP since D65
        # (`MediaNamespace.roles: dict[str, MediaRole]`), and the mount wants exactly its KEYS — which
        # is what iterating it yields. Nothing here cares about order; the shape gate below is a set.
        # check_dir stays TRUE (the loud failure is the useful one) — a namespace whose tree is not
        # servable is never mounted at all (`ensure_media_dirs` health, W2), so reaching here means the
        # directory exists.
        super().__init__(directory=directory, check_dir=True, follow_symlink=False)
        self.roles = frozenset(roles)

    def lookup_path(self, path: str) -> tuple[str, os.stat_result | None]:
        """The FILE gate (Codex W1): the final component must be a REGULAR FILE.

        `follow_symlink=False` only rejects a link that leaves the root, so
        `characters/x.png -> ../private/secret.png` passed it AND the shape gate — the target is inside
        the namespace, just somewhere nothing lists.

        Placed HERE rather than in `get_response` on purpose: Starlette already runs this method in a
        worker thread, so the extra `lstat` costs no event-loop time. Returning the miss tuple routes
        into the ordinary 404 — a probe learns "not there" and nothing else.

        The predicate is `core.media.is_served_file`, the same one the INDEX filters its listing with —
        one rule, so what is advertised and what is served cannot drift (Codex R2).
        """
        if not is_served_file(Path(str(self.directory), path)):
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
    files, slots = settings.media_overrides(ns)
    # OFF the event loop (Codex F8): building the index walks directories, stats every entry and reads
    # each file's header — all blocking, and the JPEG scan is bounded but not free on a malformed drop.
    # `asyncio.to_thread` is the house hop for sync work in an async route (app/api/agent.py's skill and
    # agent readers). The whole build goes in one hop rather than per-file, so a role with twenty files
    # costs one context switch, not twenty.
    return await asyncio.to_thread(build_index, settings.home_dir(), ns, files=files, slots=slots)


# ── the write path (D65) ──────────────────────────────────────────────────────────────────────────


def _role_directory(request: Request, ns: str, role: str) -> Path:
    """The directory a write may land in, or a 404 that says which registry fact refused it.

    Containment is by REGISTRY, not by string handling (SECURITY_MODEL §2.7): the namespace and the
    role must be rows here, the namespace's tree must have passed the boot shape check (a disabled
    one is not mounted, so writing into it would create files nothing can serve), and only then is a
    path built at all. A namespace/role the registry does not know is a plain 404 — the same answer
    a probe gets for anything else that is not there.
    """
    row = MEDIA_NAMESPACES.get(ns)
    if row is None or role not in row.roles:
        raise HTTPException(status_code=404, detail=f"unknown media role: {ns}/{role}")
    health = request.app.state.media_health.get(ns)
    if health is not None and not health.ok:
        raise HTTPException(status_code=404, detail=f"media namespace {ns!r} is disabled: {health.reason}")
    return role_dir(request.app.state.settings.home_dir(), ns, role)


def admit_filename(filename: str, *, allowed_suffixes: Collection[str] | None = None) -> None:
    """Refuse a filename this surface may not CREATE — with the reason, never a sanitised name (§3).

    Two statuses, because they are two different facts: a name carrying a path separator (a traversal
    attempt, or `%2F` after the server decoded it) addresses nothing inside this role, so it is a
    **404** like any other path that is not there; every other refusal is about the NAME the client
    chose, which is a **422** it can act on by minting the next one.

    Public and parameterised since D68: the attachment staging PUT is the same shape of route with
    the same two answers, and `allowed_suffixes` is the one thing that differs (its own kinds vs the
    media image allowlist). Sharing the status MAPPING as well as `admission_reason` itself is what
    keeps "a path-shaped name is a 404 everywhere" a rule rather than a coincidence.
    """
    if "/" in filename or filename in ("", ".", ".."):
        raise HTTPException(status_code=404, detail="not found")
    reason = admission_reason(filename, allowed_suffixes=allowed_suffixes)
    if reason is not None:
        raise HTTPException(status_code=422, detail=reason)


@router.put("/media/{ns}/files/{role}/{filename:path}", status_code=201)
async def media_upload(ns: str, role: str, filename: str, request: Request, response: Response) -> MediaFile:
    """Store one owner image — a NEW file, or a REPLACEMENT of one the client says it is holding.
    **Raw body — never multipart, never POST** (D65; the verb IS the CORS control, SECURITY_MODEL §2.7).

    `201` with the new file's index row · `200` with the fresh row when it REPLACED one · `404` unknown
    ns/role or a path-shaped name · `409` the name already exists (the client's race guard: it retries
    with its next suffix, never a dialog) · `412` a conditional replace whose target is gone or has
    changed · `413` past `media.write.max_bytes` · `415` bytes and extension disagree · `422` a name
    this surface may not create, or an empty body.

    **`X-Expected-Revision` is what makes it a REPLACE** (the edit-in-place arm, "W10"). Its value is
    the `revision` the client read off the index row it is editing; the write lands only if the file
    still answers to it. Three decisions are pinned here:

    · **A REQUEST HEADER, not `If-Match`.** The media MOUNT already serves Starlette's own `ETag` on
      GETs of this same URL space, and that is a DIFFERENT validator (a content hash of a static file,
      not this index token). Reusing `If-Match` would promise HTTP semantics we do not implement —
      a client, a proxy or a future `HEAD` reader would be entitled to compare our token against
      Starlette's. A private header makes the two validators visibly different things. Precedent:
      `X-Providers-Rev` (D48), the app's other precondition.
    · **412, not 409.** A `409` on this route already means "that NAME is taken" and the client answers
      it by minting the next suffix — silently, by design (§2.5). A stale precondition answered 409
      would therefore be walked into a SECOND COPY of the picture under a new name, which is precisely
      the outcome the precondition exists to prevent.
    · **No header ⇒ byte-identical create.** The absent case is not "replace whatever is there": it is
      today's create-only PUT, unchanged, because a client that did not state a precondition has not
      told us which bytes it believes it is overwriting.

    The ladder lives in `core.media.UploadPart` — this route only feeds it the stream and translates
    its refusals. The `finally` is the zero-bytes guarantee: whatever happened, the `.part` is gone
    when the response is written (a crash instead of a return is what the boot sweep is for).

    The chunk writes are NOT hopped onto a thread and the durable steps are: a `write` into a buffered
    file object is a memcpy, while `fsync` + `probe_image` + `link` are real syscalls on a phone-sized
    file — `asyncio.to_thread` around the ladder's ends is where the event loop actually benefits
    (the same reasoning as the index build above, which hops once rather than per file).

    `{filename:path}` rather than `{filename}` so that a name carrying a separator REACHES this
    handler and gets the 404 above, instead of falling through to the static mount and being answered
    405 by `StaticFiles` — one URL space, one answer for "there is nothing there".
    """
    directory = _role_directory(request, ns, role)
    admit_filename(filename)
    # Case-insensitive by Starlette's own header mapping. An EMPTY value is a present precondition
    # that matches nothing — a 412 — rather than an absent one: a client that sent the header meant to
    # state a precondition, and guessing it meant "create" is how a replace becomes a second copy.
    expected_revision = request.headers.get("x-expected-revision")
    max_bytes = request.app.state.settings.media.write.max_bytes
    # `UploadPart.open` is INSIDE the try: it refuses a `.parts` that is a symlink or a file (a tree
    # only an operator can repair), and that refusal has to reach the client as the same translated
    # detail as every other one rather than as an unhandled 500 with a traceback.
    part: UploadPart | None = None
    try:
        part = await asyncio.to_thread(UploadPart.open, directory, max_bytes=max_bytes)
        async for chunk in request.stream():
            part.write(chunk)
        if part.received == 0:
            raise StoreWriteError(422, "the request body is empty")
        row = await asyncio.to_thread(part.finish, directory / filename, ns, role, expected_revision)
        # The route's declared status is the CREATE's. A replace reached here only by satisfying its
        # precondition, so nothing was created and `201` would be a lie about a name that already
        # existed — 200 with the fresh row, whose new `revision` is what the client edits next.
        if expected_revision is not None:
            response.status_code = 200
        return row
    except StoreWriteError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    finally:
        if part is not None:
            await asyncio.to_thread(part.discard)


@router.delete("/media/{ns}/files/{role}/{filename:path}", status_code=204)
async def media_delete(ns: str, role: str, filename: str, request: Request) -> Response:
    """Remove one owner image. `204` when it is gone, `404` when there was nothing here to remove —
    and a second DELETE of the same file is therefore a 404, not a lie.

    **Touches no config** (§3). Promoting the next entry after deleting the active one is the
    client's composition — DELETE first, then one config write — and a cleanup that never happens
    leaves a dangling `files` entry which the collation drops on the next listing.
    """
    directory = _role_directory(request, ns, role)
    if not await asyncio.to_thread(delete_file, directory, filename):
        raise HTTPException(status_code=404, detail="not found")
    return Response(status_code=204)
