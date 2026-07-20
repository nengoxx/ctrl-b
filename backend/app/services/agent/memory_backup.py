"""GitMemoryBackup — auto-version the memory directory in a local git repo (D26).

Every app-driven memory mutation commits immediately, coupled to its file write under a process-wide
lock so the commit captures exactly that write (`guard()` + `commit()`). The owner's *manual* edits
to the files are captured by a startup reconcile + a periodic sweep (`reconcile()`): `git status` →
per-file, mtime-dated commits — possible *because* app writes leave the tree clean, so a dirty tree is
by definition an external edit (no self-write disambiguation, no watcher needed).

System `git` via `core.proc.run_capture` (argv, no shell); identity via `-c` (global config never
touched); local-only (no network → no auth prompt); push is out of scope. Best-effort throughout: a
git failure is swallowed so it can never break a memory write. A `NoopBackup` (lock only, no git) is
the fallback when the backup is disabled or absent.
"""

from __future__ import annotations

import asyncio
import datetime
import logging
import shutil
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from pathlib import Path

from app.config import Settings, config_path
from app.core.proc import run_capture
from app.db import db_path

logger = logging.getLogger(__name__)

# Defense-in-depth: even though the memory dir is validated to never *be* (or contain) $CTRLB_HOME,
# a `.gitignore` keeps secrets/state/junk out if the dir is ever pointed somewhere broader or grows.
_GITIGNORE = """\
# ctrl-b memory repo (D26) — markdown notes only. Never version secrets / db / volatile state.
config.yaml
*.db
*.db-journal
*.db-wal
*.db-shm
clients/
*_prompt.*
# atomic-write temp files (orphaned only if the process dies mid-write)
.tmp-*
# OS / editor cruft
.DS_Store
Thumbs.db
*.swp
# Obsidian volatile UI state (if this dir later becomes an Obsidian vault)
.obsidian/workspace.json
.obsidian/workspace-mobile.json
"""


class GitMemoryBackup:
    """The default `MemoryBackup`. Holds the single process-wide `asyncio.Lock` that serializes every
    memory mutation + its commit (so subagents sharing one provider can't interleave either)."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._lock: asyncio.Lock | None = None
        self._lock_loop: asyncio.AbstractEventLoop | None = None
        # Resolve git once; None → unavailable → every op no-ops (a restart re-resolves).
        self._git_bin = shutil.which("git")

    @property
    def _cfg(self):  # noqa: ANN202 — MemoryGitCfg, kept local to dodge an import cycle
        return self._settings.memory.git_backup

    def _root(self) -> Path:
        return self._settings.memories_dir_path()

    def _get_lock(self) -> asyncio.Lock:
        """The serialization lock, bound to the *current* running loop. The app has exactly one loop, so
        in production this is created once and reused. It re-creates when the running loop differs only
        to tolerate the test harness (TestClient runs lifespan on a portal-thread loop while unit tests
        drive coroutines on the main loop) — those loops never run concurrently, so single-writer holds."""
        loop = asyncio.get_running_loop()
        if self._lock is None or self._lock_loop is not loop:
            self._lock = asyncio.Lock()
            self._lock_loop = loop
        return self._lock

    @asynccontextmanager
    async def guard(self) -> AsyncIterator[None]:
        """The serialization lock. The provider holds this across `atomic-write → commit` so the commit
        snapshots exactly that write. Not reentrant — `commit()` (called inside) must not re-acquire it."""
        async with self._get_lock():
            yield

    async def commit(self, paths: Sequence[Path], message: str) -> None:
        """Stage + commit specific paths. **Assumes `guard()` is held.** Best-effort: any git failure
        (incl. a benign 'nothing to commit') is ignored — the memory write already succeeded."""
        if not self._cfg.enabled or self._git_bin is None:
            return
        root = self._root()
        if not await self._ensure_repo(root):
            return
        rels = await asyncio.to_thread(self._rel_paths, paths, root)
        if not rels:
            return
        await self._run(root, ["add", "--", *rels])  # `add` stages modifies, adds, AND deletions
        await self._run(root, ["commit", "-m", message, "--", *rels])

    async def reconcile(self) -> None:
        """Commit any dirty (externally-edited) files — one commit per file, dated to the file's mtime
        so `git log` reflects when the edit happened. **Acquires `guard()`** (driven by startup + the
        background sweep, outside any app write). A clean tree → no-op."""
        if not self._cfg.enabled or self._git_bin is None:
            return
        async with self._get_lock():
            root = self._root()
            if not await self._ensure_repo(root):
                return
            for rel in await self._dirty_paths(root):
                abspath = root / rel
                exists, date = await asyncio.to_thread(self._file_state, abspath)
                msg = f"memory: external {'edit to' if exists else 'removal of'} {rel}"
                await self._run(root, ["add", "--", rel])
                args = ["commit", "-m", msg, "--", rel]
                if date:
                    args.insert(1, f"--date={date}")  # ["commit", "--date=…", "-m", msg, "--", rel]
                await self._run(root, args)

    # ── internals ──────────────────────────────────────────────────────────────────────────────

    async def _run(self, root: Path, args: list[str]):  # noqa: ANN202 — Capture | None
        """One `git` invocation under the repo, with per-commit identity via `-c` (global config
        untouched) + the configured timeout. Returns the `Capture`, or `None` if git couldn't start /
        timed out. Never raises — best-effort."""
        if self._git_bin is None:
            return None
        cfg = self._cfg
        argv = [
            self._git_bin,
            "-C",
            str(root),
            "-c",
            f"user.name={cfg.author_name}",
            "-c",
            f"user.email={cfg.author_email}",
            # Treat files byte-for-byte: our files are LF, and the host's global core.autocrlf (true by
            # default on Git for Windows) would otherwise make every LF file read as perpetually
            # "modified", churning the sweep and breaking the "dirty tree = external edit" invariant.
            "-c",
            "core.autocrlf=false",
            "-c",
            "core.safecrlf=false",
            *args,
        ]
        try:
            cap = await run_capture(argv, timeout_s=cfg.commit_timeout_s)
        except OSError, ValueError:
            return None
        if cap.timed_out:
            logger.warning("memory git %s timed out after %ss", args[:1], cfg.commit_timeout_s)
            return None
        return cap

    @staticmethod
    def _rel_paths(paths: Sequence[Path], root: Path) -> list[str]:
        """Repo-relative strings for `paths`; drops any path outside `root` (shouldn't happen — skip
        rather than stage broadly). Blocking (resolve touches the fs) → call via asyncio.to_thread."""
        root_r = root.resolve()
        rels: list[str] = []
        for p in paths:
            try:
                rels.append(str(Path(p).resolve().relative_to(root_r)))
            except ValueError:
                continue
        return rels

    def _prep_repo_dir(self, root: Path) -> str:
        """Blocking fs prelude to git-init, hoisted for one to_thread hop (ASYNC240; also covers the
        is_dir/mkdir/gitignore neighbors the rule misses). Returns:
        'ready' — .git exists (caller returns True); 'init' — dir created + .gitignore written (caller
        runs git init); 'abort' — unsafe root or mkdir failed (caller returns False)."""
        if not self._safe_root(root):
            return "abort"
        if (root / ".git").is_dir():
            return "ready"
        try:
            root.mkdir(parents=True, exist_ok=True)
        except OSError:
            return "abort"
        self._write_gitignore(root)
        return "init"

    async def _ensure_repo(self, root: Path) -> bool:
        """Lazy `git init -b main` + `.gitignore` + a root commit, guarded by the secrets check. Returns
        False (→ caller no-ops) when git is unavailable, the root is unsafe, or init failed."""
        if self._git_bin is None:
            return False
        state = await asyncio.to_thread(self._prep_repo_dir, root)
        if state == "ready":
            return True
        if state != "init":
            return False
        init = await self._run(root, ["init", "-b", "main"])
        if init is None or init.code != 0:
            return False
        await self._run(root, ["add", "--", ".gitignore"])
        await self._run(root, ["commit", "-m", "chore: initialize memory repo", "--", ".gitignore"])
        return await asyncio.to_thread((root / ".git").is_dir)

    def _safe_root(self, root: Path) -> bool:
        """Refuse to version a directory that would capture secrets — `config.yaml` or the db lying
        *inside* `root` (a misconfigured `memory_dir: "."` pointing at `$CTRLB_HOME`). Disable, don't
        crash, don't leak."""
        try:
            root_r = root.resolve()
        except OSError:
            return False
        for sensitive in (config_path(), db_path()):
            try:
                if sensitive.resolve().is_relative_to(root_r):
                    logger.warning(
                        "memory git backup disabled: %s lies inside the memory dir %s", sensitive, root_r
                    )
                    return False
            except OSError:
                continue
        return True

    def _write_gitignore(self, root: Path) -> None:
        gi = root / ".gitignore"
        if gi.exists():
            return
        try:
            gi.write_text(_GITIGNORE, encoding="utf-8")
        except OSError:
            pass

    async def _dirty_paths(self, root: Path) -> list[str]:
        """Repo-relative paths of every dirty/untracked file (`git status --porcelain`). Conservative
        parse — memory filenames are sanitized slugs (no spaces/quotes); a rename takes the destination."""
        cap = await self._run(root, ["status", "--porcelain", "--untracked-files=all"])
        if cap is None or cap.code != 0:
            return []
        out: list[str] = []
        for line in cap.output.splitlines():
            if len(line) < 4:
                continue
            path = line[3:]
            if " -> " in path:  # rename/copy → the destination side
                path = path.split(" -> ", 1)[1]
            path = path.strip()
            if len(path) >= 2 and path[0] == '"' and path[-1] == '"':
                path = path[1:-1]
            if path:
                out.append(path)
        return out

    @classmethod
    def _file_state(cls, p: Path) -> tuple[bool, str | None]:
        """`(exists, mtime-iso-or-None)` for the reconcile loop — the exists+stat pair in one
        `asyncio.to_thread` hop (SYS-16), and one fs view rather than two."""
        exists = p.exists()
        return exists, (cls._mtime_iso(p) if exists else None)

    @staticmethod
    def _mtime_iso(p: Path) -> str | None:
        try:
            ts = p.stat().st_mtime
        except OSError:
            return None
        return datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc).isoformat()


class NoopBackup:
    """A `MemoryBackup` that serializes (holds the lock so async write→commit can't interleave) but does
    no git — the fallback when a provider is built without a backup. Same single-writer invariant, no repo."""

    def __init__(self) -> None:
        self._lock: asyncio.Lock | None = None
        self._lock_loop: asyncio.AbstractEventLoop | None = None

    @asynccontextmanager
    async def guard(self) -> AsyncIterator[None]:
        loop = asyncio.get_running_loop()
        if self._lock is None or self._lock_loop is not loop:
            self._lock, self._lock_loop = asyncio.Lock(), loop
        async with self._lock:
            yield

    async def commit(self, paths: Sequence[Path], message: str) -> None:  # noqa: ARG002
        return None

    async def reconcile(self) -> None:
        return None
