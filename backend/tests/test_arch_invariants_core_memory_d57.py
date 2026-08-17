"""D57 drift-guard — **no code path writes both memory tiers** (CORE_MEMORY_PLAN §8-4).

The acceptance family states this as a *code-path* invariant, deliberately not a per-write one: a
single TURN legitimately writes both tiers via two tool calls (§4b promotion is exactly that), so the
per-write phrasing would forbid the feature. What must never exist is one function that reaches
across — a tier-1 write that also edits the corpus, or a corpus write that also touches a tier-1
store. Two subsystems, two lanes, one owner each.

Enforced as an AST sweep in the `test_arch_invariants_*` family rather than as prose, for the same
reason QH-9 is: the property is invisible at review time and cheap to break with one import.

The one sanctioned crossing is **read-only and explicit**: `memory.py` calls
`core_memory.validated_root` so the tier-1 `_agent_memory_dir` can YIELD to an active corpus root
(`AgentDef.memory_dir` makes the reserved tier-1 set dynamic — the S1 review's finding). It reads the
corpus's configuration; it writes nothing.

The sweep resolves **aliases**: `import … as x`, `from … import y as z`. A guard that matched the
literal name `core_memory` would be bypassed by one `as` keyword, which is exactly the kind of quiet
drift it exists to catch (S3 review) — so the alias forms are pinned as their own positive controls.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]

TIER1 = ("app/services/agent/memory.py", "app/services/agent/memory_tool.py")
TIER2 = ("app/services/agent/core_memory.py", "app/services/agent/core_memory_tool.py")

#: The tier-2 corpus module, by its importable name.
_CORPUS = "app.services.agent.core_memory"

#: What tier 1 may use from the corpus module: root RESOLUTION only, never a write entry point.
_ALLOWED_CORPUS_USE = {"validated_root"}

#: The tier-1 modules a tier-2 file may not reach into — the store provider AND its tool.
_TIER1_MODULES = ("app.services.agent.memory", "app.services.agent.memory_tool")

#: Tier-1 write surface names. A tier-2 module naming any of these is reaching across the boundary.
_TIER1_WRITE_NAMES = {"FileMemoryProvider", "MemoryProvider", "apply_memory", "gate_memory"}


def _tree(rel: str) -> ast.Module:
    return ast.parse((BACKEND / rel).read_text(encoding="utf-8"))


def _dotted(node: ast.AST) -> str | None:
    """`a.b.c` as a dotted string, or None when the chain isn't pure names/attributes."""
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if not isinstance(node, ast.Name):
        return None
    parts.append(node.id)
    return ".".join(reversed(parts))


def _module_prefixes(tree: ast.Module, module: str) -> set[str]:
    """Every expression prefix that names `module` in this file: the local alias for
    `import m as x` / `from pkg import mod as x`, and the full dotted path for a plain
    `import pkg.mod` (whose uses read `pkg.mod.thing`)."""
    package, _, tail = module.rpartition(".")
    out: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out |= {a.asname or a.name for a in node.names if a.name == module}
        elif isinstance(node, ast.ImportFrom) and node.module == package:
            out |= {a.asname or a.name for a in node.names if a.name == tail}
    return out


def _attr_uses(tree: ast.Module, prefixes: set[str]) -> set[str]:
    """The attribute names read off any of `prefixes` — `cm.create` under prefix `cm` yields
    `create`, whatever `cm` was originally called."""
    out: set[str] = set()
    for node in ast.walk(tree):
        dotted = _dotted(node) if isinstance(node, ast.Attribute) else None
        if dotted is None:
            continue
        for prefix in prefixes:
            if dotted.startswith(f"{prefix}."):
                out.add(dotted[len(prefix) + 1 :].split(".")[0])
    return out


def _symbol_imports(tree: ast.Module, module: str) -> set[str]:
    """The ORIGINAL names imported out of `module` — the alias is irrelevant, the source name is."""
    return {
        a.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module == module
        for a in node.names
    }


def _corpus_crossings(tree: ast.Module) -> set[str]:
    """Corpus symbols this (tier-1) file touches, beyond the sanctioned read-only root lookup."""
    used = _attr_uses(tree, _module_prefixes(tree, _CORPUS)) | _symbol_imports(tree, _CORPUS)
    return used - _ALLOWED_CORPUS_USE


def _tier1_crossings(tree: ast.Module) -> set[str]:
    """Tier-1 store-subsystem references this (tier-2) file makes, under any alias."""
    out: set[str] = set()
    for module in _TIER1_MODULES:
        symbols = _symbol_imports(tree, module)
        if _module_prefixes(tree, module) or symbols:
            out.add(module)
        out |= {f"{module}.{name}" for name in symbols}
    out |= {n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and n.id in _TIER1_WRITE_NAMES}
    return out


def test_tier1_touches_the_corpus_only_through_the_read_only_root_lookup() -> None:
    for rel in TIER1:
        crossings = _corpus_crossings(_tree(rel))
        assert not crossings, (
            f"{rel} reaches into the tier-2 corpus beyond the sanctioned read-only root lookup: "
            f"{sorted(crossings)} — §8-4 forbids one code path writing both tiers"
        )


def test_the_corpus_never_imports_the_tier1_provider() -> None:
    for rel in TIER2:
        bad = _tier1_crossings(_tree(rel))
        assert not bad, (
            f"{rel} reaches into the tier-1 store subsystem ({sorted(bad)}) — the corpus owns "
            "its own root and nothing else; §8-4"
        )


#: Bypass forms an alias-blind sweep would wave through (the S3 review's failing cases).
_ALIASED_CORPUS_USES = (
    "import app.services.agent.core_memory as cm\ncm.CoreMemoryCorpus(s).create(1)\n",
    "from app.services.agent import core_memory as cm\ncm.CoreMemoryCorpus\n",
    "from app.services.agent.core_memory import CoreMemoryCorpus as C\n",
    "import app.services.agent.core_memory\napp.services.agent.core_memory.CoreMemoryCorpus\n",
)

_ALIASED_TIER1_USES = (
    "import app.services.agent.memory as m\nm.FileMemoryProvider\n",
    "from app.services.agent import memory_tool as mt\nmt.gate_memory\n",
    "from app.services.agent.memory_tool import gate_memory as g\n",
    "from app.services.agent.memory import FileMemoryProvider as P\n",
    "import app.services.agent.memory_tool\n",
)


@pytest.mark.parametrize("src", _ALIASED_CORPUS_USES)
def test_the_sweep_catches_an_aliased_corpus_crossing(src: str) -> None:
    """The guard's own positive control: each of these is a real §8-4 violation written so the
    literal module name never appears at the use site."""
    assert _corpus_crossings(ast.parse(src))


@pytest.mark.parametrize("src", _ALIASED_TIER1_USES)
def test_the_sweep_catches_an_aliased_tier1_crossing(src: str) -> None:
    assert _tier1_crossings(ast.parse(src))


def test_the_sanctioned_root_lookup_is_not_flagged_under_an_alias() -> None:
    """…and the negative control: the ONE allowed crossing stays allowed however it is spelled."""
    for src in (
        "from app.services.agent import core_memory\ncore_memory.validated_root(s)\n",
        "from app.services.agent import core_memory as cm\ncm.validated_root(s)\n",
        "from app.services.agent.core_memory import validated_root as vr\nvr(s)\n",
    ):
        assert not _corpus_crossings(ast.parse(src))


def test_the_two_write_surfaces_both_exist() -> None:
    """The positive control: a guard that swept the wrong names would pass vacuously."""
    from app.services.agent.core_memory import CoreMemoryCorpus
    from app.services.agent.memory import FileMemoryProvider

    assert callable(FileMemoryProvider.write)
    for name in ("create", "update", "remove", "delete"):
        assert callable(getattr(CoreMemoryCorpus, name)), name


def test_the_corpus_owns_exactly_its_own_index_file() -> None:
    """The other direction, stated as behaviour rather than syntax: a tier-2 mutation writes only
    paths under the corpus root — never a tier-1 store file — and its own `core/MEMORY.md` index is
    legitimately its to write (§8-4's explicit carve-out)."""
    import os
    import tempfile

    import yaml
    from _async import run_async

    from app.config import load_settings

    home = Path(os.environ["CTRLB_HOME"])
    cfg = Path(tempfile.mkdtemp()) / "config.yaml"
    cfg.write_text(yaml.safe_dump({"memory": {"longterm": {"backend": "core"}}}), encoding="utf-8")
    settings = load_settings(cfg)
    (home / "memories").mkdir(parents=True, exist_ok=True)
    (home / "memories" / "MEMORY.md").write_text("tier-1 agent memory", encoding="utf-8")

    from app.services.agent.core_memory import CoreMemoryCorpus

    corpus = CoreMemoryCorpus(settings)
    run_async(corpus.create("A topic", "a hook", None, "a body"))

    root = home / "memories" / "core"
    assert (root / "MEMORY.md").is_file() and (root / "a-topic.md").is_file()
    assert (home / "memories" / "MEMORY.md").read_text(encoding="utf-8") == "tier-1 agent memory"
