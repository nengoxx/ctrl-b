"""D27 audit — `FileMemoryProvider.write` is a race-free read-modify-write under the backup lock.

Regression test for the lost-update bug found in the slice-B audit: D26 moved only the file *write*
under the backup lock, leaving the *read* outside it, so two concurrent appends to one file (e.g. two
subagents writing the shared USER.md, or any write arriving while the periodic `reconcile()` sweep
holds the same lock) both merged against a stale body and the second silently clobbered the first.

The fix runs the whole read→merge→cap-check→write→commit inside one `async with backup.guard()`. This
test forces the exact interleaving deterministically: a backup whose lock we pre-acquire (standing in
for the reconcile sweep / another in-flight writer) so both writers park *before* either can read,
then we release and let them serialize. With the read inside the lock the second writer reads the
first's result and both entries survive; with the old code both read "" and one entry is lost.

Driven on a single `asyncio.run` loop (no TestClient); isolated `$CTRLB_HOME` temp workspace.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import tempfile
from collections.abc import Sequence
from pathlib import Path


@contextlib.contextmanager
def _workspace(config_text: str = "server:\n  port: 5433\n"):
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(config_text, encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        yield tmp
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


class _LockBackup:
    """A no-git backup exposing the same one real `asyncio.Lock` the provider serializes on, so the
    test can pre-hold it to force contention. Mirrors `MemoryBackup` (guard/commit/reconcile)."""

    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.commits: list[str] = []

    @contextlib.asynccontextmanager
    async def guard(self):
        async with self.lock:
            yield

    async def commit(self, paths: Sequence[Path], message: str) -> None:
        self.commits.append(message)

    async def reconcile(self) -> None:  # pragma: no cover - unused here
        pass


def test_concurrent_appends_do_not_lose_an_update() -> None:
    with _workspace() as tmp:
        from app.config import load_settings
        from app.services.agent.memory import FileMemoryProvider

        async def go():
            settings = load_settings()
            backup = _LockBackup()
            prov = FileMemoryProvider(settings, backup=backup)
            agent = settings.resolve_agent(None)

            # Stand in for the reconcile sweep / another in-flight writer holding the lock: both writers
            # will reach `async with backup.guard()` and park *before* reading the file.
            await backup.lock.acquire()
            w1 = asyncio.create_task(prov.write(agent, "memory", "add", "entry one"))
            w2 = asyncio.create_task(prov.write(agent, "memory", "add", "entry two"))
            await asyncio.sleep(0.02)  # let both tasks run up to the lock and park
            backup.lock.release()
            await asyncio.gather(w1, w2)
            return (tmp / "memories" / "MEMORY.md").read_text(encoding="utf-8"), len(backup.commits)

        body, commits = asyncio.run(go())
        assert "entry one" in body and "entry two" in body  # neither append was lost
        assert commits == 2  # each write committed exactly once


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
