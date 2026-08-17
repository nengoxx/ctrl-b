"""Phase 20 / S1 — the Core Memory corpus module, read-only (D57, CORE_MEMORY_PLAN §3/§8-1).

Acceptance family 1's READ half: a ctrl-b-born corpus and a copied Claude-shaped one go through one
path, and reading changes nothing on disk. What's exercised:

  0. Gitignore   — a copied corpus's `logs/` + `.consolidate-lock` never enter the D26 repo.
  1. Config      — the §6.1 shape + defaults, and `config.example.yaml` staying in sync with it.
  2. Frontmatter — top-level / nested `metadata.*` / conflicting (top-level wins) / unknown type.
  3. Scanner     — every basename `MEMORY.md`, dotted paths, `logs/`, `.consolidate-lock`, symlinks;
                   a file with neither frontmatter nor an index link is skipped, logged ONCE.
  4. Preservation— a CRLF file parses, and a full scan + render leaves every byte identical.
  5. Index       — dangling/duplicate links omitted, an unindexed topic still scanned + flagged.
  6. Render      — per-entry clamp, normalization of foreign text, soft cap truncation with the
                   warning line INSIDE the cap.
  7. Cache       — an unchanged corpus never re-parses; an edited file re-renders.
  8. Root        — `"."`, tier-1 overlap, `$CTRLB_HOME` refused with one diagnostic; absolute honored.
  9. Fix wave    — the S1 Codex-review round: degenerate YAML, symlinks, unreadable subtrees, index
                   case races, hostile targets/hooks, path-preserving clamps, header accuracy,
                   stamp-preserving replacement, and the dynamic `AgentDef.memory_dir` overlap.

Every test runs against a synthesized corpus in its own `$CTRLB_HOME` (conftest) — never the owner's
real config, memory dir or vault.
"""

from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path

import yaml

from app.config import CoreMemoryCfg, LongTermCfg, MemoryCfg, load_settings
from app.services.agent.core_memory import CoreMemoryCorpus
from app.services.agent.memory_backup import _GITIGNORE

EXAMPLE = Path(__file__).resolve().parents[2] / "config.example.yaml"


def _corpus(tmp_path: Path, backend: str | None = "core", **core) -> CoreMemoryCorpus:
    """A corpus over a temp config carrying only the tier-2 block (everything else defaults)."""
    cfg = tmp_path / "config.yaml"
    cfg.write_text(
        yaml.safe_dump({"memory": {"longterm": {"backend": backend, "core": core}}}), encoding="utf-8"
    )
    return CoreMemoryCorpus(load_settings(cfg))


def _memories() -> Path:
    return Path(os.environ["CTRLB_HOME"]) / "memories"


def _root() -> Path:
    root = _memories() / "core"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _topic(root: Path, rel: str, text: str) -> Path:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _index(root: Path, *lines: str) -> None:
    (root / "MEMORY.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _digest(root: Path) -> dict[str, str]:
    return {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


# ── 1. config ─────────────────────────────────────────────────────────────────────────────────────


def test_the_tier2_slot_is_off_by_default_with_the_locked_shape():
    """§6.1 is normative: `backend` is the only switch and every cap has its pinned default."""
    longterm = MemoryCfg().longterm
    assert isinstance(longterm, LongTermCfg) and longterm.backend is None
    assert longterm.core == CoreMemoryCfg(
        root="core",
        index_char_limit=8192,
        topic_char_limit=4096,
        recall_char_limit=20480,
        consolidation_nudge_pct=80,
    )


def test_a_copied_corpus_foreign_artifacts_are_never_versioned():
    """§3 / council M7 — the corpus lives inside the D26 repo, so the ignore template (which the
    repo's own test proves reaches `.gitignore`) must cover a copied Claude corpus's own files."""
    assert "logs/" in _GITIGNORE and ".consolidate-lock" in _GITIGNORE


def test_the_example_config_documents_the_same_tier2_block():
    """The commented `memory:` block in `config.example.yaml` must stay loadable AND agree with the
    model's defaults — the owner's bootstrap file is the one place the shape is spelled out."""
    lines = EXAMPLE.read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith("# memory:"))
    block = []
    for line in lines[start:]:
        if not line.startswith("#"):
            break
        block.append(line[2:] if line.startswith("# ") else line[1:])
    parsed = yaml.safe_load("\n".join(block))
    # Raw keys first — a deleted example field would otherwise be masked by the model's defaults.
    assert set(parsed["memory"]["longterm"]) == {"backend", "core"}
    assert parsed["memory"]["longterm"]["core"] == {
        "root": "core",
        "index_char_limit": 8192,
        "topic_char_limit": 4096,
        "recall_char_limit": 20480,
        "consolidation_nudge_pct": 80,
    }
    assert MemoryCfg(**parsed["memory"]).longterm == MemoryCfg().longterm


# ── 2. tolerant frontmatter ───────────────────────────────────────────────────────────────────────


def test_frontmatter_reads_top_level_or_nested_metadata_with_top_level_winning(tmp_path):
    root = _root()
    _topic(root, "flat.md", "---\nname: Flat\ndescription: flat desc\ntype: project\n---\nbody\n")
    _topic(
        root,
        "nested.md",
        "---\nmetadata:\n  name: Nested\n  description: nested desc\n  type: reference\n---\nbody\n",
    )
    _topic(
        root,
        "both.md",
        "---\nname: Top\ndescription: top desc\ntype: user\n"
        "metadata:\n  name: Deep\n  description: deep desc\n  type: feedback\n---\nbody\n",
    )
    _topic(root, "odd.md", "---\nname: Odd\ntype: not-a-known-type\n---\nbody\n")
    by_path = {t.path: t for t in _corpus(tmp_path).scan().topics}

    assert (by_path["flat.md"].name, by_path["flat.md"].type) == ("Flat", "project")
    assert (by_path["nested.md"].name, by_path["nested.md"].description) == ("Nested", "nested desc")
    assert by_path["nested.md"].type == "reference"
    # The conflict rule: top-level is Claude's canonical shape, so it wins on every field.
    assert (by_path["both.md"].name, by_path["both.md"].description) == ("Top", "top desc")
    assert by_path["both.md"].type == "user"
    # An unknown type degrades to untyped — still a valid topic, not a skip.
    assert by_path["odd.md"].type is None


# ── 3. scanner exclusions ─────────────────────────────────────────────────────────────────────────


def test_the_scan_excludes_nested_indexes_dotted_paths_and_logs(tmp_path):
    root = _root()
    _topic(root, "keep.md", "---\nname: Keep\n---\nbody\n")
    _topic(root, "sub/MEMORY.md", "---\nname: Foreign index\n---\n")  # basename, at any depth
    _topic(root, "logs/run.md", "---\nname: Log\n---\n")
    _topic(root, ".hidden/secret.md", "---\nname: Hidden\n---\n")
    _topic(root, ".dotfile.md", "---\nname: Dotted\n---\n")
    (root / ".consolidate-lock").write_text("", encoding="utf-8")
    _index(root, "- [Keep](keep.md) — the only topic")

    scan = _corpus(tmp_path).scan()
    assert [t.path for t in scan.topics] == ["keep.md"]
    assert scan.skipped == 0  # excluded ≠ skipped: nothing was even a candidate


def test_a_file_with_neither_frontmatter_nor_an_index_link_is_skipped_once(tmp_path, caplog):
    root = _root()
    _topic(root, "loose.md", "no frontmatter at all\n")
    _topic(root, "linked.md", "no frontmatter either\n")
    _index(root, "- [Linked](linked.md) — indexed, so it counts")
    corpus = _corpus(tmp_path)

    with caplog.at_level(logging.WARNING, logger="app.services.agent.core_memory"):
        scan = corpus.scan()
        _topic(root, "later.md", "---\nname: Later\n---\nbody\n")  # new signature → a real re-parse
        corpus.scan()

    assert [t.path for t in scan.topics] == ["linked.md"]  # an index link makes it a topic
    assert scan.skipped == 1
    assert corpus.parses == 2
    assert sum("loose.md" in r.getMessage() for r in caplog.records) == 1


# ── 4. preservation ───────────────────────────────────────────────────────────────────────────────


def test_reading_a_corpus_including_a_crlf_file_leaves_every_byte_identical(tmp_path):
    root = _root()
    _topic(root, "unix.md", "---\nname: Unix\ndescription: lf file\n---\nbody\n")
    (root / "dos.md").write_bytes(b"---\r\nname: Dos\r\ndescription: crlf file\r\n---\r\nbody\r\n")
    _index(root, "- [Unix](unix.md) — lf", "- [Dos](dos.md) — crlf")
    before = _digest(root)

    corpus = _corpus(tmp_path)
    scan = corpus.scan()
    corpus.render_index()

    assert {t.path: t.description for t in scan.topics} == {"dos.md": "crlf file", "unix.md": "lf file"}
    assert _digest(root) == before


# ── 5. the index is the routing source, never repaired ────────────────────────────────────────────


def test_dangling_and_duplicate_links_are_omitted_and_an_orphan_topic_is_flagged(tmp_path):
    root = _root()
    _topic(root, "real.md", "---\nname: Real\ndescription: indexed\n---\nbody\n")
    _topic(root, "orphan.md", "---\nname: Orphan\ndescription: unindexed\n---\nbody\n")
    _index(
        root,
        "- [Real](real.md) — the one good link",
        "- [Ghost](ghost.md) — points at nothing",
        "- [Real again](real.md) — the same target twice",
        "- [Remote](https://example.invalid/x.md) — not a corpus path",
    )
    scan = _corpus(tmp_path).scan()

    assert [e[1] for e in scan.entries] == ["real.md"]
    assert {t.path for t in scan.topics} == {"orphan.md", "real.md"}  # the orphan stays searchable
    assert scan.anomalies == (
        "dangling index link: ghost.md",
        "duplicate index link: real.md",
        "topic not in the index: orphan.md",
    )


# ── 6. render ─────────────────────────────────────────────────────────────────────────────────────


def test_an_entry_is_normalized_and_clamped_before_it_reaches_the_block(tmp_path):
    """A description is foreign, model-written text entering a system message: it may not add lines,
    smuggle control characters, or forge markdown links — and its on-disk length is not the index's
    problem (the copied corpus's p100 description is 6,337 chars)."""
    root = _root()
    _topic(
        root,
        "wild.md",
        '---\nname: Wild\ndescription: "line one\\nstill\\tthe hook [x](y) ' + "z" * 400 + '"\n---\nbody\n',
    )
    _index(root, "- [Wild](wild.md)")  # no hook → the frontmatter description supplies it
    block = _corpus(tmp_path).render_index()
    entry = block.splitlines()[1]

    assert len(entry) <= 150 and entry.endswith("…")
    assert "\n" not in entry and "\t" not in entry and "line one still the hook" in entry
    assert "[x](y)" not in entry and r"\[x\]\(y\)" in entry


def test_the_block_truncates_softly_with_the_warning_line_inside_the_cap(tmp_path):
    root = _root()
    lines = []
    for i in range(30):
        _topic(root, f"t{i:02d}.md", f"---\nname: Topic {i}\n---\nbody\n")
        lines.append(f"- [Topic {i}](t{i:02d}.md) — hook number {i} for this topic")
    _index(root, *lines)
    block = _corpus(tmp_path, index_char_limit=400).render_index()

    assert len(block) <= 400
    assert block.startswith("## Core memory index (")
    assert "not listed — the index is at its cap." in block.splitlines()[-1]
    listed = [line for line in block.splitlines() if line.startswith("- [")]
    assert 0 < len(listed) < 30


def test_nothing_renders_while_the_tier2_slot_is_off(tmp_path):
    root = _root()
    _topic(root, "a.md", "---\nname: A\n---\nbody\n")
    _index(root, "- [A](a.md) — present")

    assert _corpus(tmp_path, backend=None).render_index() == ""
    assert _corpus(tmp_path).render_index() != ""


# ── 7. cache ──────────────────────────────────────────────────────────────────────────────────────


def test_the_render_is_cached_on_the_scan_signature_and_reloads_on_an_edit(tmp_path):
    root = _root()
    _topic(root, "a.md", "---\nname: A\n---\nbody\n")
    _index(root, "- [A](a.md) — first hook")
    corpus = _corpus(tmp_path)

    first = corpus.render_index()
    for _ in range(3):
        assert corpus.render_index() == first
    assert corpus.parses == 1  # a stat sweep per call, one parse total

    _index(root, "- [A](a.md) — a hand edit, live next turn")
    assert "hand edit" in corpus.render_index()
    assert corpus.parses == 2


# ── 8. root validation ────────────────────────────────────────────────────────────────────────────


def test_a_root_overlapping_tier_1_or_the_workspace_is_refused_with_one_diagnostic(tmp_path, caplog):
    home = Path(os.environ["CTRLB_HOME"])
    refused = {
        ".": "its index would BE the root agent's MEMORY.md",
        "": "empty",
        "agents": "the specialist memory tree",
        "agents/helper": "one specialist's own stores",
        "../elsewhere": "outside the memory dir",
        str(home): "$CTRLB_HOME itself",
        str(home.parent): "an ancestor of $CTRLB_HOME",
    }
    with caplog.at_level(logging.WARNING, logger="app.services.agent.core_memory"):
        for root, why in refused.items():
            corpus = _corpus(tmp_path, root=root)
            assert corpus.root() is None, f"root {root!r} should be refused — {why}"
            corpus.root()  # a second call must not re-log
    ours = [r for r in caplog.records if r.name == "app.services.agent.core_memory"]
    assert len(ours) == len(refused)


def test_an_absolute_root_outside_the_memory_dir_is_honored(tmp_path):
    external = tmp_path / "external-corpus"
    external.mkdir()
    _topic(external, "note.md", "---\nname: Note\ndescription: elsewhere\n---\nbody\n")
    (external / "MEMORY.md").write_text("- [Note](note.md) — outside the memory dir\n", encoding="utf-8")

    corpus = _corpus(tmp_path, root=str(external))
    assert corpus.root() == external.resolve()
    assert [t.path for t in corpus.scan().topics] == ["note.md"]
    assert "note.md" in corpus.render_index()


def test_an_absent_root_is_an_empty_corpus_not_an_error(tmp_path):
    corpus = _corpus(tmp_path)  # nothing ever created under memories/core
    status = corpus.status()

    assert corpus.scan().topics == () and corpus.render_index() == ""
    assert status.enabled and status.topics == 0
    assert status.root == str((_memories() / "core").resolve())
    assert not _memories().exists()  # a read never creates anything


# ── 9. the S1 review fix wave (Codex round) ───────────────────────────────────────────────────────


def test_degenerate_yaml_degrades_to_a_skip_never_a_crash(tmp_path):
    """`yaml.safe_load` raises more than YAMLError: ~2k nested sequences → RecursionError, a
    10k-digit int → ValueError. A poisoned copied-in topic must degrade exactly like unparseable
    frontmatter, not fail the (soon synchronous, S2) scan."""
    root = _root()
    _topic(root, "ok.md", "---\nname: Ok\n---\nbody\n")
    _topic(root, "deep.md", "---\nx: " + "[" * 2000 + "]" * 2000 + "\n---\nbody\n")
    _topic(root, "bigint.md", "---\nn: " + "9" * 10000 + "\n---\nbody\n")
    _index(root, "- [Ok](ok.md) — the survivor")
    scan = _corpus(tmp_path).scan()

    assert [t.path for t in scan.topics] == ["ok.md"]
    assert scan.skipped == 2


def test_symlinked_files_and_directories_are_never_scanned(tmp_path):
    root = _root()
    _topic(root, "real.md", "---\nname: Real\n---\nbody\n")
    outside = tmp_path / "outside"
    outside.mkdir()
    _topic(outside, "lured.md", "---\nname: Lured\n---\nbody\n")
    (root / "link.md").symlink_to(outside / "lured.md")
    (root / "linkdir").symlink_to(outside, target_is_directory=True)
    _index(root, "- [Real](real.md) — the only real topic")

    assert [t.path for t in _corpus(tmp_path).scan().topics] == ["real.md"]


def test_an_unreadable_subtree_is_an_anomaly_not_a_silent_hole(tmp_path):
    root = _root()
    _topic(root, "ok.md", "---\nname: Ok\n---\nbody\n")
    _topic(root, "sub/hidden.md", "---\nname: Hidden\n---\nbody\n")
    _index(root, "- [Ok](ok.md) — readable")
    (root / "sub").chmod(0o000)
    try:
        scan = _corpus(tmp_path).scan()
    finally:
        (root / "sub").chmod(0o755)

    assert [t.path for t in scan.topics] == ["ok.md"]
    assert any(a.startswith("unreadable directory: sub") for a in scan.anomalies)


def test_a_newly_unreadable_directory_invalidates_the_cache(tmp_path):
    """An unreadable dir's contents were never stat'd, so the file signature alone can't see it
    appear — the error set must be part of the cache key (confirm-round residual)."""
    root = _root()
    _topic(root, "ok.md", "---\nname: Ok\n---\nbody\n")
    _index(root, "- [Ok](ok.md) — fine")
    (root / "sub").mkdir()
    corpus = _corpus(tmp_path)
    assert corpus.scan().anomalies == ()

    _topic(root, "sub/x.md", "---\nname: X\n---\nbody\n")
    (root / "sub").chmod(0o000)
    try:
        scan = corpus.scan()
    finally:
        (root / "sub").chmod(0o755)
    assert any(a.startswith("unreadable directory: sub") for a in scan.anomalies)


def test_only_the_exact_case_root_index_routes(tmp_path):
    """Two case variants of the index on a case-sensitive fs must not race scandir order: exactly
    `MEMORY.md` is the index; a variant is excluded everywhere (not a topic, not the index)."""
    root = _root()
    _topic(root, "a.md", "---\nname: A\n---\nbody\n")
    _topic(root, "b.md", "---\nname: B\n---\nbody\n")
    (root / "memory.md").write_text("- [B](b.md) — the impostor index\n", encoding="utf-8")
    _index(root, "- [A](a.md) — the real index")
    scan = _corpus(tmp_path).scan()

    assert [e[1] for e in scan.entries] == ["a.md"]
    assert {t.path for t in scan.topics} == {"a.md", "b.md"}


def test_hostile_targets_and_hooks_cannot_forge_a_route(tmp_path):
    """A `:` admits every URI scheme (`mailto:x.md` is a legal filename that would render as a live
    URI); structural chars in a filename would break the `[title](path)` around them; `<>` in a hook
    would survive as a Markdown autolink."""
    root = _root()
    _topic(root, "a.md", "---\nname: A\n---\nbody\n")
    _topic(root, "mailto:x.md", "---\nname: Mailto\n---\nbody\n")
    _index(
        root,
        "- [A](a.md) — see <https://evil.invalid> now",
        "- [M](mailto:x.md) — a URI-shaped filename",
    )
    corpus = _corpus(tmp_path)
    block = corpus.render_index()

    assert [e[1] for e in corpus.scan().entries] == ["a.md"]
    assert "<https://evil.invalid>" not in block and r"\<https" in block


def test_a_long_title_never_displaces_the_path_and_an_unroutable_path_is_dropped(tmp_path):
    root = _root()
    _topic(root, "t.md", "---\nname: T\n---\nbody\n")
    long_rel = "d" * 70 + "/" + "e" * 70 + "/deep.md"
    _topic(root, long_rel, "---\nname: Deep\n---\nbody\n")
    _index(root, "- [" + "T" * 300 + "](t.md) — a hook", f"- [Deep]({long_rel}) — unroutable")
    corpus = _corpus(tmp_path)
    scan = corpus.scan()
    entry = corpus.render_index().splitlines()[1]

    assert len(entry) <= 150 and "](t.md)" in entry  # the title clamps, the route survives
    assert [e[1] for e in scan.entries] == ["t.md"]
    assert f"index link path too long: {long_rel}" in scan.anomalies


def test_the_header_reports_the_blocks_actual_length(tmp_path):
    """The header prints the block's own length (a fixpoint including itself) — the review probe
    found cap 474 + a one-entry index reporting one char short."""
    root = _root()
    _topic(root, "a.md", "---\nname: A\n---\nbody\n")
    _index(root, "- [A](a.md) — h")
    for cap in (474, 300, 8192):
        block = _corpus(tmp_path, index_char_limit=cap).render_index()
        reported = block.splitlines()[0].rsplit(" ", 1)[1].rstrip(")").split("/")[0]
        assert int(reported.replace(",", "")) == len(block), f"cap {cap}"


def test_a_replacement_preserving_mtime_and_size_still_invalidates(tmp_path):
    """rsync-style tools preserve mtime and size; the inode/ctime in the stamp still change, so the
    cache must reload (the signature is the hand-edit boundary, §8-1)."""
    root = _root()
    path = _topic(root, "a.md", "---\nname: A\ndescription: before-x\n---\nbody\n")
    _index(root, "- [A](a.md)")
    corpus = _corpus(tmp_path)
    assert "before-x" in corpus.render_index()

    st = path.stat()
    swap = root / "a.md.new"
    swap.write_text(path.read_text(encoding="utf-8").replace("before-x", "after-y"), encoding="utf-8")
    os.utime(swap, ns=(st.st_atime_ns, st.st_mtime_ns))  # same size, same mtime — new inode
    os.replace(swap, path)

    assert "after-y" in corpus.render_index()
    assert corpus.parses == 2


def test_an_agent_memory_dir_overlapping_the_corpus_falls_back_to_the_default(tmp_path):
    """`AgentDef.memory_dir` makes the reserved tier-1 set dynamic, so the corpus root can't refuse
    it statically — tier 1 yields instead (the same safe-default fallback as a `..` escape), else
    one agent's MEMORY.md would double as the tier-2 index."""
    from app.domain.agent import AgentDef
    from app.services.agent.memory import FileMemoryProvider

    corpus = _corpus(tmp_path)  # backend=core, root=memories/core
    provider = FileMemoryProvider(corpus._settings)
    memories = _memories()

    inside = provider._agent_memory_dir(AgentDef(name="helper", memory_dir="core"))
    nested = provider._agent_memory_dir(AgentDef(name="helper", memory_dir="core/nested"))
    fine = provider._agent_memory_dir(AgentDef(name="helper", memory_dir="elsewhere"))
    assert inside == nested == memories / "agents" / "helper"
    assert fine == memories / "elsewhere"


def test_status_reports_what_the_conf_line_will_show(tmp_path):
    root = _root()
    _topic(root, "a.md", "---\nname: A\ndescription: indexed\n---\nbody\n")
    _topic(root, "b.md", "---\nname: B\ndescription: orphan\n---\nbody\n")
    _topic(root, "c.md", "not a topic\n")
    _index(root, "- [A](a.md) — indexed")
    corpus = _corpus(tmp_path)
    status = corpus.status()

    assert (status.enabled, status.topics, status.skipped) == (True, 2, 1)
    assert status.anomalies == ("topic not in the index: b.md",)
    assert status.root == str(root.resolve())
    assert status.index_chars == len(corpus.render_index()) > 0
    assert status.index_char_limit == 8192 and 0 <= status.index_pct <= 100
