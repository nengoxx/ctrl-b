"""D26 — the memory directory's git backup (`GitMemoryBackup` + `FileMemoryProvider` coupling).

Drives the provider directly on a single `asyncio.run` loop (no TestClient), pointed at an isolated
`$CTRLB_HOME` temp workspace, and inspects the resulting repo with the `git` CLI.

What's exercised:
  1. init+commit  — the first write lazily inits the repo and commits the file (content verbatim).
  2. per-change   — each write is its own commit.
  3. deletion     — a blank overwrite commits the file's removal.
  4. identity     — commits use the configured author, NOT the machine's global git identity.
  5. secrets guard — `memory_dir` containing config.yaml/db → backup disabled, but the write still lands.
  6. disabled     — git_backup.enabled off → writes work, no repo.
  7. reconcile    — a manual/external edit to a file is captured by reconcile() as its own commit.
  8. .gitignore   — written at init and lists the secret/db patterns.
  9. env sanitization (SYS-20) — poisoned ambient `GIT_*` vars can't retarget the repo or the identity.

Skipped cleanly when `git` is not installed.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

_HAS_GIT = shutil.which("git") is not None


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


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=True, check=False
    ).stdout.strip()


def _build():
    """A fresh provider + git backup over the live temp settings (a single shared loop via asyncio.run)."""
    from app.config import load_settings
    from app.services.agent.memory import FileMemoryProvider
    from app.services.agent.memory_backup import GitMemoryBackup

    settings = load_settings()
    backup = GitMemoryBackup(settings)
    prov = FileMemoryProvider(settings, backup=backup)
    return settings, prov, backup, settings.resolve_agent(None)


# ── tests ────────────────────────────────────────────────────────────────────────────────────────


def test_first_write_inits_repo_and_commits_verbatim() -> None:
    with _workspace() as tmp:

        async def go():
            _s, prov, _b, agent = _build()
            await prov.write(agent, "memory", "add", "the owner runs a 3090")

        asyncio.run(go())
        root = tmp / "memories"
        assert (root / ".git").is_dir()
        assert "the owner runs a 3090" in _git(root, "show", "HEAD:MEMORY.md")  # content committed verbatim


def test_each_write_is_its_own_commit() -> None:
    with _workspace() as tmp:

        async def go():
            _s, prov, _b, agent = _build()
            await prov.write(agent, "memory", "add", "fact one")
            await prov.write(agent, "memory", "add", "fact two")
            await prov.write(agent, "memory", "add", "fact three")

        asyncio.run(go())
        root = tmp / "memories"
        commits = [ln for ln in _git(root, "log", "--format=%s").splitlines() if ln]
        memory_commits = [c for c in commits if c.startswith("memory(")]
        assert len(memory_commits) >= 3  # one per write (+ the init commit)


def test_blank_overwrite_commits_a_removal() -> None:
    with _workspace() as tmp:

        async def go():
            _s, prov, _b, agent = _build()
            await prov.overwrite(agent, "memory", "temporary note")
            await prov.overwrite(agent, "memory", "   ")  # blank → delete

        asyncio.run(go())
        root = tmp / "memories"
        assert not (root / "MEMORY.md").exists()  # removed from the working tree
        assert _git(root, "log", "--format=%s", "--", "MEMORY.md")  # it has history (add then remove)
        # the file is absent at HEAD (a deletion was committed)
        assert _git(root, "ls-files", "MEMORY.md") == ""


def test_commit_identity_is_configured_not_global() -> None:
    with _workspace() as tmp:

        async def go():
            _s, prov, _b, agent = _build()
            await prov.write(agent, "memory", "add", "who am I")

        asyncio.run(go())
        root = tmp / "memories"
        assert _git(root, "log", "-1", "--format=%an") == "ctrl-b memory"
        assert _git(root, "log", "-1", "--format=%ae") == "memory@ctrl-b.local"


def test_poisoned_git_env_cannot_retarget_repo_or_identity() -> None:
    """SYS-20 — ambient `GIT_DIR` overrides `git -C` and `GIT_AUTHOR_*`/`GIT_CONFIG_PARAMETERS`
    override `-c`, so a launcher's leaked env (git exports these to hooks) must be stripped."""
    with _workspace() as tmp:
        decoy = tmp / "decoy"
        subprocess.run(["git", "init", "-q", str(decoy)], check=True)
        poison = {
            "GIT_DIR": str(decoy / ".git"),  # absolute, like git's export from a linked worktree
            "GIT_WORK_TREE": str(decoy),
            "GIT_INDEX_FILE": str(decoy / ".git" / "index"),
            "GIT_AUTHOR_NAME": "Poisoned",
            "GIT_CONFIG_PARAMETERS": "'user.email'='poisoned@env'",
        }
        saved = {k: os.environ.get(k) for k in poison}
        os.environ.update(poison)
        try:

            async def go():
                _s, prov, _b, agent = _build()
                await prov.write(agent, "memory", "add", "immune to ambient git env")

            asyncio.run(go())
        finally:  # restore (not just pop) so a pre-existing ambient value survives this test
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        root = tmp / "memories"
        assert "immune to ambient git env" in _git(root, "show", "HEAD:MEMORY.md")  # landed here…
        assert _git(decoy, "rev-list", "--all") == ""  # …not in the decoy
        assert _git(root, "log", "-1", "--format=%an <%ae>") == "ctrl-b memory <memory@ctrl-b.local>"


def test_secrets_guard_disables_backup_but_write_still_lands() -> None:
    with _workspace() as tmp:

        async def go():
            settings, prov, _b, agent = _build()
            settings.memory.memory_dir = "."  # → repo root would be $CTRLB_HOME (holds config.yaml + db)
            await prov.write(agent, "memory", "add", "still saved")

        asyncio.run(go())
        assert (tmp / "MEMORY.md").read_text(encoding="utf-8").strip().endswith("still saved")  # write landed
        assert not (tmp / ".git").exists()  # backup refused to version a dir holding secrets


def test_disabled_backup_still_writes_no_repo() -> None:
    with _workspace() as tmp:

        async def go():
            settings, prov, _b, agent = _build()
            settings.memory.git_backup.enabled = False
            await prov.write(agent, "memory", "add", "no git here")

        asyncio.run(go())
        root = tmp / "memories"
        assert "no git here" in (root / "MEMORY.md").read_text(encoding="utf-8")
        assert not (root / ".git").exists()


def test_reconcile_captures_external_edit() -> None:
    with _workspace() as tmp:

        async def go():
            _s, prov, backup, agent = _build()
            await prov.write(agent, "memory", "add", "agent-written")
            # simulate the owner editing the file directly on disk (outside the app)
            (tmp / "memories" / "MEMORY.md").write_text("§ hand edited by the owner\n", encoding="utf-8")
            await backup.reconcile()

        asyncio.run(go())
        root = tmp / "memories"
        assert "hand edited by the owner" in _git(root, "show", "HEAD:MEMORY.md")  # external edit committed
        assert "external" in _git(root, "log", "-1", "--format=%s")  # as a reconcile commit


def test_tree_clean_after_write_no_churn() -> None:
    """After an app write the working tree must read clean (no CRLF/autocrlf churn), so the reconcile
    sweep is a true no-op and the 'dirty tree = external edit' invariant holds."""
    with _workspace() as tmp:

        async def go():
            _s, prov, backup, agent = _build()
            await prov.write(agent, "memory", "add", "a durable fact")
            before = _git(tmp / "memories", "rev-parse", "HEAD")
            await backup.reconcile()  # nothing external changed → must commit nothing
            after = _git(tmp / "memories", "rev-parse", "HEAD")
            return before, after

        before, after = asyncio.run(go())
        root = tmp / "memories"
        assert _git(root, "status", "--porcelain") == ""  # clean: no perpetually-"modified" file
        assert before == after  # the no-op reconcile created no commit


def test_gitignore_written_at_init() -> None:
    with _workspace() as tmp:

        async def go():
            _s, prov, _b, agent = _build()
            await prov.write(agent, "memory", "add", "x")

        asyncio.run(go())
        gi = (tmp / "memories" / ".gitignore").read_text(encoding="utf-8")
        assert "config.yaml" in gi and "*.db" in gi


if __name__ == "__main__":
    if not _HAS_GIT:
        print("skipped — git not installed")
        raise SystemExit(0)
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
