# R55 — Media UPLOAD + DELETE: the hardened FastAPI pattern, and what the field actually does

**Date: 2026-08-24** · **Status: DRAFT dossier, no D-entry yet** · Author: Opus 5 research subagent
(single bounded pass, no nested subagents).

**The one question.** What is the correct, hardened FastAPI implementation pattern for image UPLOAD and
DELETE endpoints in ctrl-b, and how do peer projects implement/validate theirs?

**Pinned versions this pass measured against** (all VERIFIED from the installed venv, 2026-08-24):
FastAPI `0.138.1` · Starlette `1.3.1` · python-multipart `0.0.31` · uvicorn `0.48.0` · CPython `3.14.4`
· workbox-build (frontend `node_modules`) · host = emma (Linux, ext4, `/tmp` = 16 G tmpfs).

**Scope already ruled (not relitigated here).** The read side (`backend/app/core/media.py`,
`backend/app/api/media.py`) is hardened and stays as-is; no Pillow / no server-side decode — validation
stays magic-byte + header-dimension probing (`probe_image`); the write API is a NEW owner-ruled reversal
of the "there must never be one here" posture; reorder/pins keep riding `PUT /api/settings`; the
crop/picker client is R54 and gallery UX is R56.

**Reads it depends on:** `docs/MEDIA_PLAN.md` · `docs/SECURITY_MODEL.md` §1/§2.1 ·
`backend/app/core/fsutil.py` · `backend/app/config.py` `_write_replace_0600` · `frontend/src/lib/media.ts`
· `frontend/vite.config.ts` · `backend/tests/test_media_g5.py`.

---

## 0. Answer in one paragraph

Do **not** use `multipart/form-data`. Take the bytes as the **raw body of a `PUT`** at the same URL the
mount already serves, count them as they stream, write them into a `.part` temp file **in the
destination role directory**, probe the finished temp file with the existing `probe_image`, then
`os.link` (no-clobber) or `os.replace` (overwrite) it into place and fsync the directory. `DELETE` the
same URL, guarded by the existing `is_served_file` predicate, and touch **no config**. Three
independent reasons pick `PUT`-with-raw-body over `POST`-with-multipart, and each is verified below:
(a) a cross-origin `POST` of `multipart/form-data` is a CORS-**safelisted** request that ships without a
preflight — on an app with no auth that is a drive-by write from any website the owner opens, while a
`PUT`/`DELETE` is preflighted and dies for want of an `Access-Control-Allow-Origin` we do not send;
(b) FastAPI's `UploadFile` parameter means Starlette has already buffered the whole part **before your
handler runs**, and on this host that buffer spills into `/tmp`, which is RAM; (c) the raw stream is the
only place a byte cap can be enforced that a lying or absent `Content-Length` cannot bypass.

---

## 1. Multipart mechanics, verified from source (Q1)

### 1.1 Where the bytes go, and when

`MultiPartParser` spools **each file part** into a `SpooledTemporaryFile`:

> `starlette/formparsers.py:147-150`
> ```python
> class MultiPartParser:
>     spool_max_size = 1024 * 1024  # 1MB
>     """The maximum size of the spooled temporary file used to store file data."""
>     max_part_size = 1024 * 1024  # 1MB
>     """The maximum size of a part in the multipart request."""
> ```
> `starlette/formparsers.py:230` — `tempfile = SpooledTemporaryFile(max_size=self.spool_max_size)`

**VERIFIED (source):** `spool_max_size` is a **class attribute only**. `Request.form()` exposes
`max_files`, `max_fields`, `max_part_size` — and nothing else (`starlette/requests.py:313-322`). FastAPI
calls it with **no arguments at all** (`fastapi/routing.py:422` — `body = await request.form()`), so an
app using `file: UploadFile` gets the defaults and cannot raise the spool threshold without subclassing
or monkey-patching.

**MEASURED (this host, 2026-08-24):** the rollover target is `tempfile.gettempdir()`, and on emma that is
`/tmp`:

```
gettempdir default: /tmp
spill st_dev: 43   size: 2097152
/tmp   st_dev: 43   → same device
/home  st_dev: 66306
with TMPDIR=/home/emma/.cache/tmp → st_dev 66306 (== /home)
```

`/tmp` is `tmpfs 16G` on a 30 G box (`findmnt`: `tmpfs 15,3G`). **`TMPDIR` is honoured** — but the prod
unit does not set it: `systemctl --user show ctrl-b-dashboard` gives
`Environment=CTRLB_HOME=/home/emma/.ctrl-b` and `PrivateTmp=no`, and
`deploy/linux/systemd/ctrl-b-dashboard.service` has no `TMPDIR`. So **every multipart upload over 1 MB
lands in RAM today**, and the memory is charged before the endpoint body executes. (Python 3.12+ uses an
`O_TMPFILE`-style unnamed file — the spill has no directory entry, which is why it is invisible to `ls`
but still occupies tmpfs.) This is a live fact about the box, not a hypothetical: see also the
`emma-tmp-is-tmpfs-ram` memory.

### 1.2 A file part has NO size limit

**VERIFIED (source):** `max_part_size` guards only the **non-file** branch —

> `starlette/formparsers.py:181-189`
> ```python
> def on_part_data(self, data: bytes, start: int, end: int) -> None:
>     message_bytes = data[start:end]
>     if self._current_part.file is None:
>         if len(self._current_part.data) + len(message_bytes) > self.max_part_size:
>             raise MultiPartException(f"Part exceeded maximum size of {int(self.max_part_size / 1024)}KB.")
>         self._current_part.data.extend(message_bytes)
>     else:
>         self._file_parts_to_write.append((self._current_part, message_bytes))
> ```

**MEASURED (live FastAPI TestClient probe, this venv):**

| probe | result |
|---|---|
| 5 MB file part | `200 {'n': 5242880}` — **no cap, no error** |
| 2 MB *non-file* field | `400 {"detail":"Part exceeded maximum size of 1024KB."}` |
| 20 part headers on one part | `400 {"detail":"There was an error parsing the body"}` |
| `Content-Type: multipart/form-data` with no boundary | `400 {"detail":"Missing boundary in multipart."}` |
| filename `../../etc/pw\x00n.png` | `200`, `file.filename == '../../etc/pw%00n.png'` |

The last row is the one to internalise: **Starlette does not sanitize `filename` at all.** Whatever the
client puts in `Content-Disposition` arrives verbatim (the `%00` is httpx's encoding of the NUL I sent).
That is also true for the raw-`PUT` shape — the difference is only where the name comes from.

### 1.3 The error contract you get for free

* `MultiPartException` → Starlette converts to `HTTPException(400, detail=exc.message)` **only when
  `"app" in scope`** (`starlette/requests.py:292-294`, `:305-307`).
* python-multipart's own `MultipartParseError` / `FormParserError` are **not** subclasses of
  `MultiPartException` and are **not** caught there. Under bare Starlette they are a 500. Under FastAPI
  they are a 400, because FastAPI wraps the whole body read in a bare `except Exception`:
  `fastapi/routing.py:461-463` → `HTTPException(status_code=400, detail="There was an error parsing the body")`.
  **VERIFIED by the "20 part headers" probe above.**
* FastAPI's own validation failures (missing part, wrong field name) are the ordinary `422`.

### 1.4 python-multipart 0.0.31 — CVE posture and hard limits

**VERIFIED (installed source, `python_multipart/multipart.py:144-155`):**

```python
DEFAULT_MAX_HEADER_COUNT = 8
"""Default maximum number of headers allowed per multipart part."""
DEFAULT_MAX_HEADER_SIZE = 4096 + 128
"""Default maximum size of a single multipart header line, including syntax overhead."""
MAX_BOUNDARY_LENGTH = 256
```

Enforced at `:1094` (`MultipartParseError("Maximum header size exceeded")`), `:1220`
(`"Maximum header count exceeded"`) and `:1036` (boundary length → `FormParserError`).

Advisory history (**REPORTED**, from the GitHub Advisory Database, fetched 2026-08-24):

| Advisory | Package | Affected | Patched | Note |
|---|---|---|---|---|
| **CVE-2026-42561** (GHSA-pp6c-gr5w-3c5g, High 7.5) | python-multipart | `< 0.0.27` | **0.0.27** | *"MultipartParser previously had no limit on the number of part headers or the size of an individual part header"* → CPU exhaustion. Our 0.0.31 is patched, and ships **tighter** defaults (8 / 4224) than the advisory's first cut. |
| CVE-2024-53981 | python-multipart | `< 0.0.18` | 0.0.18 | logging/CPU DoS on malformed boundary. |
| CVE-2024-24762 | python-multipart | `< 0.0.7` | 0.0.7 | ReDoS in `Content-Type` parsing. |
| CVE-2024-47874 (GHSA-f96h-pmfr-66vw, High) | starlette | `< 0.40.0` | 0.40.0 | unbounded buffering of **non-file** parts → added `max_part_size`. |
| CVE-2025-54121 (GHSA-2c2j-9gv5-cj73, Mod 5.3) | starlette | `< 0.47.2` | 0.47.2 | *"will block the main thread to roll the file over to disk"* → rollover moved to the threadpool. |
| **CVE-2026-54283** (GHSA-82w8-qh3p-5jfq, High 7.5) | starlette | `>= 0.4.1, < 1.3.1` | **1.3.1** | `request.form()` limits **silently ignored** for `application/x-www-form-urlencoded`. |

**Load-bearing pin note:** our Starlette pin `1.3.1` is *exactly* the patch floor for CVE-2026-54283.
`pyproject.toml:12` reaches it only transitively (`fastapi==0.138.1  # 0.137+ raises the Starlette floor
to >=1.3.1`). Anything that lowers the FastAPI pin re-opens a High. Worth a comment on that line; the
fix is already visible in our tree at `starlette/requests.py:296-303`, where `FormParser` now receives
`max_fields`/`max_part_size`.

---

## 2. The verb decides the browser threat surface (the finding that picks the shape)

**VERIFIED (spec + our own tree).**

* Fetch Standard: **CORS-safelisted methods** are `GET`, `HEAD`, `POST`; a `Content-Type` avoids
  preflight only if its essence is `application/x-www-form-urlencoded`, **`multipart/form-data`**, or
  `text/plain`.
* `grep -rn "CORSMiddleware\|allow_origins\|add_middleware" backend/app/` → **zero hits.** ctrl-b runs no
  CORS middleware at all.

Consequences on an app with **no application-layer auth** (SECURITY_MODEL §1):

* A `POST` of `multipart/form-data` from *any* page the owner has open in the same browser is a **simple
  request**: no preflight, the request is sent, the side effect happens. The attacker cannot read the
  response — they do not need to, the write already landed.
* A `PUT`, a `DELETE`, or a `POST` with `Content-Type: image/png` or `application/json` is **not**
  safelisted → the browser sends an `OPTIONS` preflight → we answer without
  `Access-Control-Allow-Origin` → the real request is never sent.

`docs/SECURITY_MODEL.md:34-36` rules classic CSRF out of scope because *"there is no session to steal and
no privilege to escalate to."* That reasoning is correct for **reads** and for the existing JSON writes
(`PUT /api/settings` is `application/json`, hence preflighted, hence already unreachable cross-origin by
accident rather than by design). It does **not** carry to a multipart write endpoint, where no session is
needed for the write to succeed. This is a **premise correction the plan should record**, not a
relitigation of the auth model: the tailnet is still the boundary; the point is that the owner's own
browser is inside it and executes other people's JavaScript all day.

Precedent already in the tree: `POST /api/voice/stt` takes `file: UploadFile`
(`backend/app/api/voice.py:67`) and is therefore already drive-by reachable today. Its worst case is one
unwanted STT call against the owner's own endpoint — small, and out of this dossier's scope, but it is
the existing instance of the class and belongs in the Phase 19 register.

**Recommendation:** raw-body `PUT`. If the design nevertheless wants multipart (a bare
`<input type=file>` form post with extra fields), the mitigation is a `Sec-Fetch-Site` / `Origin` check
in the route — but that is a new bespoke guard to maintain, where the verb choice is free.

---

## 3. The size cap: only a streamed counter is a cap (Q1)

`Content-Length` is not a gate:

* it is **absent** under `Transfer-Encoding: chunked` (any `fetch()` with a `ReadableStream` body, and
  `curl -H "Transfer-Encoding: chunked"`);
* on a multipart body it describes the **envelope**, not the part;
* it is client-asserted. Uvicorn will not deliver more bytes than a declared `Content-Length`, so a
  *lying-high* value cannot smuggle extra data — but a *missing* one is the ordinary case, so a
  `Content-Length`-only check is a check that a normal client skips.

Uvicorn ships no body-size limit of its own (there is no such setting), and no reverse proxy sits in
front on the LAN bind — Tailscale Serve fronts only the HTTPS path.

**The canonical pattern (MEASURED against a real uvicorn on this venv, port 5599, 2026-08-24):**

```python
@router.put("/media/{ns}/files/{role}/{filename}")
async def upload(ns: str, role: str, filename: str, request: Request) -> MediaFile:
    ...                                   # ns/role/filename validation FIRST — see §5
    fd, tmp = tempfile.mkstemp(dir=dest_dir, prefix=".upload-", suffix=".part")
    n = 0
    try:
        with os.fdopen(fd, "wb") as f:
            async for chunk in request.stream():          # ← the only honest counter
                n += len(chunk)
                if n > max_bytes:
                    raise HTTPException(413, f"image too large (limit {max_bytes} bytes)")
                f.write(chunk)
            f.flush()
            os.fsync(f.fileno())
        ...                                # probe, then link/replace — §4
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise
```

Probe results (20 MB body, 1 MiB cap):

| body | result |
|---|---|
| 512 KB, chunked | `200 {"bytes":524288}` |
| 20 MB, `Content-Length` | `HTTP 413` after **`size_upload=2818048`** — the client stopped uploading |
| 20 MB, chunked | `HTTP 413` after **`size_upload=3342132`** |
| temp files after the two 413s | **none** — the destination dir held only the successful file |

Two things this proves that are easy to get wrong: responding 413 **mid-body** reaches the client cleanly
on HTTP/1.1 (curl got the JSON body and the status, and stopped uploading after ~3 MB of 20), and the
`except BaseException: unlink(tmp)` arm actually fires on the `HTTPException` path.

**The cap belongs in config, not in the code** (the no-hardcoding rule). Exact house precedent:

> `backend/app/config.py:567`
> ```python
> max_upload_bytes: int = Field(default=25 * 1024 * 1024, gt=0)
> ```
> …consumed at `backend/app/api/voice.py:73-84` with a `413` whose detail names the limit and
> deliberately **does not report the true size**.

Mirror that verbatim, including the `gt=0` (a blanked Conf field cannot disable the cap) and the
"don't echo the real size" habit. **Where** it lives is a real open fork, see §9 ①.

### The error contract to publish

| code | when |
|---|---|
| `404` | unknown `ns`, unknown `role`, or the namespace is not mounted (`media_health[ns].ok is False`) |
| `409` | the name exists and `overwrite` was not asked for (§5.3) |
| `413` | streamed bytes exceeded `max_bytes` |
| `415` | extension not in `ALLOWED_TYPES`, **or** the finished bytes probe to a different format / to nothing |
| `422` | filename not representable (§5.1), or a zero-byte body |
| `503` | *(optional)* the write API is disabled by config toggle |

`415` for both extension and byte failures is the honest split: 413/415/409 are all *"your bytes/name are
wrong"*, while 422 is *"your address is wrong"*. Note that FastAPI will emit `400 "There was an error
parsing the body"` for anything the body reader itself throws — with a raw stream there is no body reader,
so that class disappears entirely, which is a second small argument for the raw shape.

---

## 4. The atomic persist: what fsutil gives, what it lacks (Q2)

### 4.1 The house inventory, read

**`backend/app/core/fsutil.py`** (68 lines, three functions):

* `write_text_eol(p, text)` — EOL-preserving, temp sibling + `os.replace`. **No fsync, no dir fsync.**
* `atomic_write_text(path, content)` — *"temp file in the **same dir** → flush → `os.fsync` →
  `os.replace`, then best-effort parent-dir fsync (POSIX)"*. **This is the right recipe, wrong
  signature**: it takes a `str`, opens in text mode with `newline="\n"`, hardcodes `suffix=".md"`, and
  buffers the whole content in memory as a Python string.
* `_fsync_dir(d)` — private, POSIX-only with an `os.name == "nt"` no-op. **This is the one piece upload
  reuses verbatim.** It is also one of the four allowlisted server-OS branches
  (`ARCHITECTURE.md` §6, pinned by `test_arch_invariants_qh9.py`) — reusing it keeps the branch count
  unchanged; re-deriving a dir-fsync elsewhere would add a fifth and fail that test.

**`backend/app/config.py:1796-1812`** `_write_replace_0600` — the secret-bearing writer:
`unlink` a stale `.tmp` → `os.open(tmp, O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW, 0o600)` → write **through the
fd** → `os.replace`. Its docstring states the rule to carry over: *"never `Path.write_bytes` (which lands
at the process umask… and `os.replace` would then transfer that onto the config)"*. Media has **no
secret** and needs the *opposite* mode (§4.3), but the same "own the mode on the fd, never write-then-
chmod" discipline.

**Verdict:** reusable = `_fsync_dir` (promote to public `fsync_dir`) + the *recipe* + the 0600 writer's
fd discipline. Not reusable = `atomic_write_text` itself (text/str/`.md`/whole-buffer) and
`write_text_eol` (no fsync). The deviation to state in the design: **upload writes bytes incrementally
from a stream**, which no existing writer does — everything the repo owns takes the full content up
front. That is a genuine new shape, not a duplicate; put it in `core/media.py` beside the reader
(namespace-generic, theme-blind, matching the module's existing charter) and have it call
`fsutil.fsync_dir`.

### 4.2 The `.part` suffix is load-bearing — a trap found in the read side

`list_role` filters the directory on **extension only**, before any other gate:

> `backend/app/core/media.py:580`
> ```python
> entries = [p for p in directory.iterdir() if p.suffix.lower() in ALLOWED_TYPES]
> ```

So a temp file named `.tmp-abc.png` **would be listed by a concurrent `GET /api/media/{ns}`** — a
half-written file, probing as `unreadable`, appearing in the owner's gallery mid-upload, and (worse)
taking a position in a pool role. The `.tmp-`/dot prefix does not save you; `Path(".tmp-a.png").suffix ==
".png"`.

**Rule: the temp file must not carry an allowlisted extension.** `prefix=".upload-", suffix=".part"` is
invisible to `list_role` (extension gate), invisible to the mount (`MediaFiles.get_response` re-checks
`ALLOWED_TYPES` at `backend/app/api/media.py:118-120`), and self-identifying in an `ls` if a crash ever
leaves one behind.

### 4.3 File mode

**MEASURED:** `tempfile.mkstemp` creates at `0600`, and `os.replace` carries that inode's mode to the
final name — the probe left `a.png` at `0o600`. The owner's SSH/SMB drops land at the shell umask
(`umask` on emma = `0002` → `0664`). Two homes for the same kind of file with different modes is exactly
the drift the read side spent effort avoiding. **`os.fchmod(fd, 0o644)` before writing** (or
`0o666 & ~umask`) keeps an uploaded file indistinguishable from a dropped one — which matters the first
time the owner rsyncs the media tree to another machine as a different user.

### 4.4 Order of operations

1. validate `ns` / `role` / `filename` / extension → 404 / 422 / 415 **before touching the filesystem**;
2. `mkstemp(dir=role_dir, prefix=".upload-", suffix=".part")`, `fchmod 0o644`;
3. stream + count → 413 on excess;
4. `flush` + `os.fsync(fd)`;
5. **`probe_image(tmp)` on the finished temp file** → `Probe().fmt is None` → 415; `fmt != ALLOWED_TYPES[ext][1]`
   → 415 (`format-mismatch` is fatal on the read side already: the mount serves the *extension's*
   Content-Type under `nosniff`, so a JPEG named `.png` is a guaranteed broken image —
   `core/media.py:549-555`);
6. `os.link(tmp, dest)` (no-clobber) **or** `os.replace(tmp, dest)` (overwrite) — §5.3;
7. `os.unlink(tmp)` (after `link`; `replace` consumes it);
8. `fsync_dir(role_dir)`;
9. return `describe_file(dest, ns, role)` — the **existing** `MediaFile` wire model, so the client gets
   `url`, `revision`, `width`/`height`, `unusable_reason` from the one code path that already computes
   them. No second describe-a-file implementation.

Step 5 must run **after** the whole file is on disk: `probe_image` on a partial file is exactly the
"truncated header ⇒ `Probe()`" case the reader already handles, so probing early would reject good
uploads.

---

## 5. Filenames (Q3)

### 5.1 The server rule

Existing seams, both of which the new validator must not fork from:

* **Client:** `frontend/src/lib/media.ts:128-165` — `UNNAMEABLE = /[<>:"/\\|?*\u0000-\u001f]/` (the
  **Windows** set, deliberately: *"a Windows server is a supported deployment profile"*), the DOS device
  names (`con`, `prn`, `aux`, `nul`, `com1-9`, `lpt1-9`), and `!/[. ]$/` (trailing dot or space, which
  Windows silently strips). Applied to the **normalized key** (`normalizeMediaKey` = `NFC` +
  `toLowerCase`).
* **Server, today:** `backend/app/config.py:1365-1366` — the `order`-list predicate:
  ```python
  if not name.strip() or name in (".", "..") or "/" in name or "\\" in name:
      raise ValueError(f"media.{ns}.roles.{role}.order: {name!r} is not a bare filename")
  ```

These are two different strictnesses for the same concept ("a bare media filename"). The upload
validator makes it three unless it is extracted. **Recommendation: one public predicate in
`core/media.py`** — call it from the config validator *and* from the upload route. That satisfies the
no-duplication rule and makes the config validator strictly stronger for free.

The rule, at least as strict as the client's:

1. `filename.strip() == filename` and non-empty;
2. NFC-normalize, and **reject** anything that changes under NFC rather than silently rewriting it — the
   client's `normalizeMediaKey` NFC-folds when *matching*, so accepting a decomposed name would create a
   file whose stem matches a key but whose bytes on disk differ from what the gallery shows;
3. no `/`, no `\`, not `.` or `..`, no leading `.` (a dotfile is invisible to the owner and adjacent to
   our own `.upload-` temps);
4. no character in `[<>:"|?*\u0000-\u001f]` (client's set + DEL);
5. no trailing `.` or space;
6. stem (case-folded) not a DOS device name;
7. `len(filename.encode("utf-8")) <= 255`;
8. extension (lowercased) in `ALLOWED_TYPES`.

Rule 7 is a byte limit, not a character limit — **MEASURED on this ext4 volume:**

| name | result |
|---|---|
| 255 × `a` | OK |
| 256 × `a` | `OSError 36 ENAMETOOLONG` |
| 127 × `é` (254 bytes) | OK |
| 128 × `é` (256 bytes) | `ENAMETOOLONG` |

So `NAME_MAX` is **255 bytes** and a plausible emoji-bearing name hits it four times sooner than a
character count suggests. LibreChat reached the same conclusion independently — see §7.2.

Also worth pinning as a **rejection, not a repair**: the client (R54) should validate before uploading so
the owner is told in the picker, not by a 422. Because for *named* roles the stem **is** the binding key,
a server-side "sanitize into something legal" would silently produce a file that binds to nothing —
`resolveNamed` would leave it in `unmatched` and the owner would be left renaming a file that can never
match, which is precisely the failure `isStemRepresentable` exists to prevent
(`frontend/src/lib/media.ts:147-155`). **Reject, name the reason, never rewrite.**

### 5.2 Extension policy: require agreement, derive nothing

Three options and why the middle one wins:

* *trust the extension* — the read side already proves this is wrong (the whole reason `probe_image`
  exists);
* **require ext ∈ allowlist AND probed format == the allowlist's expected format** ← recommended;
* *derive the name's extension from the probed bytes* — tempting (it makes a mismatch unrepresentable),
  but it silently renames the owner's file, and for named roles the **filename is the contract**; a
  `.jpg` that lands as `.png` is a surprise in the very place surprises cost most. It also cannot express
  `.jpg` vs `.jpeg`, both of which map to `jpeg`.

Agreement-checking costs one dict lookup and reuses `ALLOWED_TYPES` and `probe_image` unchanged. The
error message should say both facts ("named `.png`, bytes are `jpeg`") because that is actionable.

### 5.3 Collision policy

**What the field does (all VERIFIED, §7):** *nobody* has this problem, because nobody lets the client
name the file on disk — open-webui stores `{uuid4}_{basename}`, Immich stores `{uuid}{ext}`, LibreChat
stores `{file_id}__{sanitized}`. The caller-chosen name is metadata in a database row. ctrl-b cannot copy
this: the drop-in **filename is the assignment** (`core/media.py` module docstring; named roles bind by
stem). So this is a place where the peer answer does not transfer and we choose deliberately.

The closest field signal is Immich's: a colliding upload is **not an error**. It returns
`{status: "duplicate", id: <existing>}` with a success code
(`server/src/services/asset-media.service.ts:203-217`).

**Recommendation: `409` by default, `?overwrite=1` for the deliberate replace.** Reasons: replacing art
under a stable name is a *real and common* owner action (the read side is built around it — `revision`
carries `ino` + `ctime_ns` precisely so an in-place replacement is detectable), so it must be reachable;
but a silent overwrite from a crop UI is data loss with no undo on a box with no versioning. Auto-suffix
(`lyra-2.png`) is the worst of the three here: for a named role it creates a file that binds to nothing,
and for a pool role it silently changes the deal order.

Both branches have an **atomic** primitive, which is the part usually got wrong — **MEASURED:**

```
os.link(tmp, existing)  ->  FileExistsError        # atomic create-if-absent, no TOCTOU
os.link(tmp, fresh)     ->  OK
os.replace(tmp, dest)   ->  atomic overwrite
```

`os.link` is available on Windows (NTFS hard links) as well as POSIX, so this stays OS-agnostic — no new
branch. A `dest.exists()` check followed by a write is the racy version and should not be written.

---

## 6. DELETE semantics (Q4)

**Guards** — reuse, do not re-derive:

* `ns in MEDIA_NAMESPACES` and `role in MEDIA_NAMESPACES[ns].roles` → else 404 (same gate the mount
  applies at `api/media.py:114-116`);
* the namespace must be healthy (`request.app.state.media_health[ns].ok`) → else 404;
* the filename must pass §5.1 and be in `ALLOWED_TYPES` → else 404 (not 422: for a *delete*, "not there"
  is the only thing a probe should learn — the mount's own posture, `api/media.py:103-107`);
* **`is_served_file(path)`** (`core/media.py:285-312`) — `lstat` + `S_ISREG`, which is the one predicate
  that rejects a symlink *inside* the namespace, a directory, and a non-UTF-8 name. Using it here makes
  three consumers of one rule (mount, index, delete) instead of two, which is the stated reason it exists.

**Containment** comes free from the route shape and is worth stating so nobody adds a redundant
`commonpath` check: the path parameter `{filename}` is a **single segment** — FastAPI/Starlette's default
converter does not match `/`, and uvicorn percent-decodes the path *before* routing
(`uvicorn/protocols/http/h11_impl.py:201` — `path = unquote(raw_path.decode("ascii"))`), so `%2F` becomes
a real separator and simply fails to match the route (404) rather than smuggling a separator into the
parameter. The path is then built by `role_dir(home, ns, role) / filename`, never from client text.
LibreChat's explicit `path.relative` guard (§7.2) is the right pattern where a stored path is
reconstructed; here the name never leaves one directory.

**Idempotency.** Field split: open-webui `404`s on a missing record
(`backend/open_webui/routers/files.py:1006-1010`) while its *storage* layer swallows the missing file
(`storage/provider.py:81-82` — logs a warning); LibreChat swallows the unlink error entirely
(`Local/crud.js:210-216`). **Recommendation: `204 No Content` on success, `404` when the file is not
there.** The gallery is a live listing that the owner refetches on mount and focus
(`MediaGallery.tsx:107-110` — `staleTime: 0, refetchOnMount: "always"`), so a `404` is *information*
("someone else already removed it, your list is stale") rather than noise, and the client's own retry
after a network blip is answered by the same 404, which the UI can treat as success. Use
`contextlib.suppress`-free explicit handling: `FileNotFoundError` → 404, other `OSError` → 500.
Follow with `fsync_dir(role_dir)` for the same durability reason the write path does.

**What DELETE should touch in config: nothing. VERIFIED from code, and the claim in the brief is right
with one correction about *where* "(missing)" appears.**

* `media.<ns>.roles.<role>.order` — a dangling name is **dropped silently and safely**:
  `core/media.py:584` — `pinned = [files.pop(name) for name in (order or []) if name in files]`. The
  stale entry costs nothing.
* It is also **self-healing**: the gallery's reorder writes the WHOLE role order computed from the
  current listing (`MediaGallery.tsx:137-144`, and the comment at `:134-136` says exactly this), so the
  first drag after a delete removes the dangling name from config on its own.
* `media.<ns>.slots.<slot>` — a dangling **pin** is echoed verbatim on the wire (`core/media.py:200-202`
  — *"a dangling pin is the client resolver's problem to degrade from, not something to silently drop
  here (it would hide the owner's typo)"*), the client falls through (`lib/media.ts:66-73`
  `firstUsable`), and the gallery shows the value with the `(missing)` marker so the owner can clear it:
  > `frontend/src/components/MediaGallery.tsx:206-208`
  > ```tsx
  > {current != null && !options.includes(current) && (
  >   <option value={current}>{current} (missing)</option>
  > )}
  > ```
  **Correction to the brief's phrasing:** `(missing)` is a **pins** affordance only. A deleted file that
  was merely *ordered* produces no marker anywhere — it just vanishes from the list, which is the correct
  and desired behaviour.

A delete endpoint that also edited config would have to take the settings write lock, invent a partial-
failure story (file gone, config write failed), and duplicate a self-healing mechanism that already
works. **Recommendation: the delete endpoint is filesystem-only.** Pin all three facts in tests.

**Test pins worth adding** (matching `tests/test_media_g5.py` conventions — header-byte fixtures, temp
`CTRLB_CONFIG`/`CTRLB_DB`):

1. delete a file named in `order` → index still 200, order silently shorter, config untouched;
2. delete a file named by a `slots` pin → index still echoes the pin, `firstUsable` degrades, gallery
   would render `(missing)`;
3. delete a symlink planted inside a role dir → 404, link still on disk;
4. delete twice → 204 then 404;
5. delete with `..`/`%2F`/a control char in the name → 404, nothing removed;
6. upload a `.part`-named file directly into a role dir → invisible to the index and 404 from the mount.

---

## 7. Peers, verified from source (Q5)

### 7.1 open-webui — `01f4282` (HEAD 2026-07-27), `backend/open_webui/routers/files.py`

* **Sanitization is one line:** `:338-339`
  ```python
  unsanitized_filename = file.filename
  filename = os.path.basename(unsanitized_filename)
  ```
  Nothing else — no character filtering, no length cap, no NFC. It is safe only because the stored name
  is `f'{id}_{filename}'` with `id = str(uuid.uuid4())` (`:355-357`).
* **Extension allowlist is config-driven and conditional:** `:345-352`, guarded by
  `if process and allowed_file_extensions:` — an upload with `?process=false` skips the allowlist
  entirely.
* **No magic-byte validation of user uploads.** `determineFileType`-style sniffing does not exist here;
  `file.content_type` is stored as metadata only (`:411`). Pillow is imported in `routers/images.py` but
  used for *generated* image normalization (`:129`), never to validate an upload.
* **The size cap runs AFTER the whole file is written, and the whole file is in RAM:**
  `storage/provider.py:60-67` — `contents = file.read()` … `open(file_path,'wb').write(contents)` (no
  temp file, no fsync, no atomic rename), then `files.py:384-390`:
  ```python
  max_size = await Config.get('rag.file.max_size')
  if max_size and len(contents) > int(max_size) * 1024 * 1024:
      await asyncio.to_thread(Storage.delete_file, file_path)
      raise HTTPException(status_code=413, ...)
  ```
  Write-then-measure-then-delete. Both the RAM and the disk have already been spent when the 413 is
  raised, and a crash between the write and the check leaks the file.
* **Delete:** `files.py:1000-1010` → `404` when the DB row is missing; the storage layer logs a warning
  and continues when the file is missing (`provider.py:78-82`).
* One good habit to steal: `ENAMETOOLONG` is caught explicitly and retried with `f'{id}.{ext}'`
  (`:369-382`) — the only peer that treats a too-long name as a recoverable condition rather than a 500.

### 7.2 LibreChat — `9cee6f9` (HEAD 2026-08-23)

* **The best filename rule in the field**, `packages/api/src/utils/files.ts:100-120` + `:12-14`:
  ```ts
  const ASCII_FILENAME_SAFE_PATTERN = /^[a-zA-Z0-9._-]$/;
  const UNSAFE_UNICODE_FILENAME_PATTERN = /[^\p{L}\p{M}\p{N}\p{Emoji}\u200d._-]/gu;
  const FILENAME_SEGMENT_MAX_BYTES = 255;
  ```
  `path.basename` → NFC normalize → ASCII allowlist (everything else → `_`), Unicode letters/marks/
  numbers/emoji kept → **leading dot prefixed with `_`** → truncated to **255 UTF-8 bytes** with a random
  6-hex suffix, extension preserved (`truncateLeafWithSuffix`, `:53-63`). Their comment names the exact
  fact we measured: *"matches filesystem `NAME_MAX` (255 bytes on Linux/ext4, 255 chars on
  Windows/NTFS)"*.
* **Type check is by MIME regex on a client/extension-inferred type**, not bytes:
  `api/server/routes/files/multer.js:59-88` (`defaultFileConfig.checkType(mimeType, supportedMimeTypes)`
  → 415). `inferMimeType` prefers the *extension*'s mapping over the client's header.
* **Size cap is multer's `limits: { fileSize }`** (`multer.js:98`), default **512 MB**
  (`packages/data-provider/src/file-config.ts:446-484` — `defaultSizeLimit = mbToBytes(512)`). multer
  counts streamed bytes, so this *is* a real streamed cap — the pattern §3 recommends, obtained from a
  library.
* **Validation-by-decode for images:** every user image goes through `sharp`
  (`api/server/services/Files/Local/images.js:29-66`, `images/resize.js`) and is re-encoded to the
  configured output type. A file that is not a decodable image dies there. ctrl-b's ruling forbids this
  path — and note what it costs LibreChat: a full native decoder in the request path. Their magic-byte
  checker (`file-type`, `api/server/utils/files.js:9-15`) is applied **only to provider outputs**
  (`services/Files/process.js:1256`), not to user uploads.
* **Disk writes are plain `fs.promises.writeFile`** — no temp+rename, no fsync.
* **Delete has the textbook containment guard**, `Local/crud.js:249-252`:
  ```js
  const rel = path.relative(userUploadDir, filepath);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(`..${path.sep}`)) {
    throw new Error(`Invalid file path: ${cleanFilepath}`);
  }
  ```
  and the unlink itself is idempotent — `:210-216` catches and logs.

### 7.3 Immich — `cbf5d83` (HEAD 2026-08-23) — the gallery-domain leader, and the only true streamer

`server/src/middleware/file-upload.interceptor.ts:97-144` replaces multer's storage engine wholesale:

```ts
const writeStream = this.storageRepository.createWriteStream(path);
const hash = file.fieldname === UploadFieldName.ASSET_DATA ? createHash('sha1') : null;
let size = 0;
file.stream.on('data', (chunk) => { hash?.update(chunk); size += chunk.length; });
pipeline(file.stream, writeStream, (error) => {
  if (error) { hash?.destroy(); return callback(error); }
  if (size === 0) { return callback(new BadRequestException('File is empty')); }
  callback(null, { path, size, checksum: hash?.digest() });
});
```

Four things worth taking:

1. **the bytes never buffer** — straight from the socket to the file, with the size counted on the way
   (this is §3's pattern, in a peer, at gallery scale);
2. **empty file is an explicit 400**, checked at the end of the stream, not from `Content-Length`;
3. **every failure path deletes the partial file** — `_removeFile` (`:146-151`) plus an explicit
   `request.on('error')` handler that queues a delete on `ECONNRESET`, i.e. they treat *client
   disconnect mid-upload* as a first-class case rather than leaking a `.part`;
4. **the stored name is `sanitize(\`${file.uuid}${ext}\`)`** (`services/asset-media.service.ts:91-102`)
   and the type gate is `mimeTypes.isAsset(filename)` — **extension-based**, at `:59-89`. Even the photo
   specialists do not magic-byte the upload; real format determination is deferred to the async metadata
   job.
5. **duplicates are a success**, not a conflict — `:203-217`, `{status: AssetMediaStatus.DUPLICATE, id}`
   after the checksum unique-constraint fires, with the uploaded file cleaned up.

### 7.4 The cross-peer summary

| | open-webui | LibreChat | Immich | **ctrl-b (proposed)** |
|---|---|---|---|---|
| transport | multipart POST | multipart POST | multipart POST | **raw-body PUT** |
| buffers whole file? | **yes, in RAM** | to a temp file, then re-read | **no, streams** | **no, streams** |
| size cap | after write, `len(contents)` | multer streamed, 512 MB | quota, post-hoc | **streamed counter, config** |
| magic bytes? | **no** | only for provider output | **no** | **yes (`probe_image`)** |
| extension allowlist | config, conditional | MIME regex | extension | **closed, + byte agreement** |
| decodes the image? | no (uploads) | **yes (`sharp`)** | later, async | **never (ruled)** |
| stored name | `{uuid}_{name}` | `{id}__{sanitized}` | `{uuid}{ext}` | **the owner's name (it IS the binding)** |
| atomic write | no | no | no | **temp + link/replace + fsync** |
| collision | impossible (uuid) | impossible | success/duplicate | **409, `?overwrite=1`** |
| delete missing | 404 (row), warn (file) | swallow | — | **404** |

**The headline negative:** *no peer in this class validates an uploaded image by its magic bytes.* Two
sniff only provider-returned files; one validates by decoding. ctrl-b's read side already does better
than all three, and the write side inherits it for free — `probe_image` on the finished temp file is
strictly stronger than every peer's upload gate and costs one `open()` + ≤1 MB of bounded scanning.

**The headline positive:** Immich's streaming interceptor is the pattern to copy, and the two habits
worth copying beyond the stream itself are *"empty is an explicit error"* and *"the disconnect handler
deletes the partial."*

---

## 8. Concurrency + PWA edges (Q6)

### 8.1 Two simultaneous uploads of the same name

Each request gets its own `mkstemp` name in the role dir, so the two never touch each other's bytes. At
the commit point: with `os.link`, exactly one wins and the loser gets a clean `409`; with `os.replace`,
last-writer-wins and the file is always one complete version of one upload. Neither can produce a torn
file. No lock is needed, and adding one would be the wrong instinct — the filesystem primitive already is
the lock.

### 8.2 Upload racing the index GET

`GET /api/media/{ns}` walks the directory in a thread (`api/media.py:156`,
`asyncio.to_thread(build_index, ...)`). Because the temp file has a non-allowlisted extension (§4.2), an
in-flight upload is **invisible** to that walk; the rename then publishes the file atomically, so a
concurrent index sees either the old file or the new one, never a partial. A `describe_file` that races a
delete already degrades (`core/media.py:544-548` — `except OSError: size, revision = 0, ""`).

### 8.3 The service worker does not touch writes — VERIFIED

`frontend/vite.config.ts:123-154` registers two `runtimeCaching` routes; neither declares a `method`.
Workbox's generator:

> `node_modules/workbox-build/build/lib/runtime-caching-converter.js:110`
> ```js
> const method = entry.method || 'GET';
> ```

so both are emitted as `registerRoute(matcher, strategy, 'GET')`. **PUT and DELETE are never matched, never
cached, never replayed.** (`navigateFallbackDenylist: [/^\/api\//]` at `:93` keeps the navigation route
off `/api` as well.) Nothing in the PWA config needs to change for the write API.

### 8.4 What the client must invalidate after a write

* **`queryClient.invalidateQueries({ queryKey: ["media", ns] })`** — the existing key
  (`hooks/useMedia.ts:73`); the gallery and every theme surface share it
  (`theme-engine/kit/ownerArt.ts:128-129`). `useSettings.ts:331` already does the prefix form
  `["media"]` after a settings save; the upload/delete mutation should do the same.
* **…and that is not sufficient for an OVERWRITE.** The `ctrlb-media` cache is
  `StaleWhileRevalidate` (`vite.config.ts:145-152`) keyed on the URL, and the URL is stable across an
  in-place replacement by design. A refetched index gives new `revision` metadata, but the `<img>` will
  paint the **old cached bytes** first and repair on the next load. The repo already owns the fix —
  `revUrl(url, revision)` (`lib/media.ts:187-189`), used by `kit/ownerArt.ts` and the gacha wallpaper —
  and the **gallery is not using it**:
  > `frontend/src/components/MediaGallery.tsx:350`
  > ```tsx
  > <img className="mgal-thumb" src={f.url} alt="" loading="lazy" decoding="async" />
  > ```
  With uploads shipping, that becomes a visible bug ("I replaced the picture and the gallery still shows
  the old one"). **Recommendation: `src={revUrl(f.url, f.revision)}`** — a one-line change to an existing
  helper, no new mechanism. Worth verifying on the device round, because `revision` includes `st_ino` and
  `os.replace` always yields a fresh inode, so the query genuinely moves on every upload.
* **No `caches.delete()` is needed.** Chasing the Cache API by hand would be a second source of truth for
  freshness next to `revision`; the `?rev=` key change retires the old entry through ordinary expiration
  (`maxEntries: 64`).
* Delete needs no cache work: once the index stops listing the file, nothing requests the URL again.

---

## 9. Bounded open sweep — 3 items (Q7)

**① Where the cap and the kill-switch live is a real shape fork, and it is the "extend, don't migrate"
rule's exact case.** `Settings.media` is `dict[str, MediaNsCfg]` keyed by namespace
(`config.py:1250`), validated against `MEDIA_NAMESPACES` (`:1346-1372`). A scalar `max_upload_bytes` has
no home inside a namespace-keyed map. Two options, and the plan must pick before coding:
(a) a new top-level block `media_upload: {enabled, max_bytes}` — additive, zero migration, but a second
top-level key spelled `media*`;
(b) fold `media:` into an object (`media: {namespaces: {...}, max_bytes: N}`) — green-field-correct, but a
real schema migration of a key the owner has already populated in prod.
The R47 §4 precedent (persisted-shape A/B/C) resolved the same tension in favour of the additive option
with the green-field one recorded as the cost. **Also recommend an `enabled` toggle defaulting to the
owner's ruling**, matching `shell.*_exec_enabled`'s kill-switch shape and the owner's standing
"whole-functionality enable/disable" requirement — this endpoint is a security-posture reversal, and a
reversal you can switch back off is cheaper than one you cannot.

**② The module docstrings currently assert the opposite of the new ruling, in two places, and they are
load-bearing prose.** `core/media.py:5-7` — *"**There is no write API and there must never be one here**
(§5.4 ruled option (b))"* — and `api/media.py:10-13` — *"Read-only, and deliberately so. No upload, no
delete, no rename."* Both name the reasoning (no auth ⇒ tailnet-reachable). Leaving them contradicting
the code is exactly the doc-drift class the 2026-08-17 doc-truth pass was run to kill. The rewrite should
**keep** the original reasoning and record what changed the answer, since §2 above shows the concern was
correct and is now handled by the verb choice rather than by absence.

**③ A client that disconnects mid-upload leaves a `.part` file, and nothing sweeps it.** Starlette
raises `ClientDisconnect` from `request.stream()`; the `except BaseException: unlink(tmp)` arm in §3
handles it — but a hard process kill (an `install.sh` restart mid-upload, the exit-78 path) does not run
it. Immich is the only peer that treats this as first-class (`request.on('error')` → queue a delete). At
N=1 the cheap answer is a **boot-time sweep of `.part` files older than N minutes** inside
`ensure_media_dirs` — it already walks every role dir, it already has the degrade-never-brick posture, and
the files are self-identifying by suffix. Roughly five lines, and it prevents a slow leak in a directory
the owner browses.

---

## 10. What I could NOT determine

* **Behaviour on the phone**, entirely. Whether Fennec/Chrome-Android send a `PUT` with a `Blob` body
  the way desktop curl does, how a large upload behaves over Tailscale Serve's HTTPS proxy, and whether
  the 413-mid-body response reaches a `fetch()` promise as a readable `Response` rather than a network
  error on mobile Gecko. My 413 probe was **curl on loopback**. This is a device-round item, and it is
  the single most likely place the recommended shape needs adjusting.
* **Whether Tailscale Serve imposes a body-size or timeout limit** in front of `:5433`. Not probed; no
  documentation read this pass.
* **The right default for `max_bytes`.** The read side's only size signal is the client-side per-role
  advisory ("the index warns about a 3.6 MB one; it does not refuse it",
  `vite.config.ts:148-149`), and the owner's real drops were not measured. `voice.stt.max_upload_bytes`
  is 25 MB by analogy to OpenAI's Whisper limit; there is no equivalent external anchor for art.
* **Whether `os.link` no-clobber behaves identically on the Windows deployment profile.** `os.link` is
  documented for Windows and NTFS supports hard links, but I did not probe a Windows host, and neither
  did any peer (all three are Linux-container-first).
* **Whether uvicorn's `h11` implementation ever delivers a body chunk larger than the remaining cap in
  one `receive`** (i.e. whether the counter can overshoot the cap by a full chunk before it trips). It
  can, by at most one chunk; I did not measure the maximum chunk size. This is a bounded overshoot, not
  a hole, but it means the temp file may briefly hold `max_bytes + one chunk` bytes.
* **open-webui / LibreChat / Immich frontends** were not read — only the server upload paths. Their
  client-side pre-validation may be stricter than the server rules quoted here.

---

## 11. Implications — the recommended contract (short, and separate from the evidence)

```
PUT    /api/media/{ns}/files/{role}/{filename}[?overwrite=1]
       Content-Type: image/png | image/jpeg | image/webp     (any non-safelisted value works)
       body: the raw image bytes
    -> 201 MediaFile          (the existing wire model, from describe_file)
    -> 200 MediaFile          when overwrite replaced an existing name
    -> 404 unknown ns/role, namespace disabled, or an unaddressable name
    -> 409 {"detail": "<filename> already exists"}          (no overwrite flag)
    -> 413 {"detail": "image too large (limit N bytes)"}
    -> 415 {"detail": "..."}  extension not allowed, or bytes disagree with the extension
    -> 422 {"detail": "..."}  filename not representable, or an empty body

DELETE /api/media/{ns}/files/{role}/{filename}
    -> 204 (no body)
    -> 404 not there / unaddressable / not a regular file
```

Both routes are registered on `media_api.router` **before** the per-namespace mounts in `create_app`
(they already are — `main.py:550` precedes `:575`). Sharing the URL with the read mount is safe and
verified: Starlette's router records a method-mismatch as `Match.PARTIAL` and **keeps looking**, so `GET`
falls through to the mount while `PUT`/`DELETE` are taken by the route
(`starlette/routing.py:674-687`).

Reuse ledger — everything in the write path already exists except the streaming writer:
`MEDIA_NAMESPACES` (ns/role gate) · `media_health` (disabled-namespace gate) · `ALLOWED_TYPES` (extension
+ expected format) · `probe_image` (byte validation) · `is_served_file` (delete guard) · `describe_file`
(the response) · `role_dir` (the path) · `fsutil._fsync_dir` → promote to `fsync_dir` (durability) ·
`config.Settings` (the cap, `voice.stt.max_upload_bytes` shape). New: one streaming byte-writer in
`core/media.py`, one shared bare-filename predicate (also adopted by the `config.py:1365` validator), one
config block (§9 ①). Client: one `revUrl` on the gallery thumb, one `["media", ns]` invalidation.
