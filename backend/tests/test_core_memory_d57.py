"""Phase 20 / S1–S2 + S4 — the Core Memory corpus, its head injection and the curation backstops
(D57, CORE_MEMORY_PLAN §3/§4/§4b, acceptance §8-1/§8-2/§8-4/§8-5).

S1 is acceptance family 1's READ half: a ctrl-b-born corpus and a copied Claude-shaped one go
through one path, and reading changes nothing on disk. S2 (§10 below) is families 2-index + 5: the
rendered index reaches the static head in one place, and the whole feature is invisible when off.
S4 (§11–§13) is family 4's promotion half plus family 1's copy-in matrix.
What's exercised:

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
 10. Head (S2)  — the block's position between the memory block and the skills note, its policy
                   framing + stamp, "off ⇒ byte-identical head and zero IO" (stub-guarded), the
                   frozen-per-session head + resume reload boundary, and the lifespan wiring.
 11. Curation   — §4b: the nudge latch (once per episode · per (agent, store) · clears on a fill
     (S4)        drop · an emptied store un-latches · a non-shrinking write does not), the
                   `{{longterm}}` promotion clause and the turn-level availability the session feeds
                   it, the reflection nudge's routing sentence, and the index header staying plain
                   DATA at every fill (D61 ③ — no pressure clause on the model's channel).
 12. Live app   — the `memory` tool's description following the slot with no restart (and the owner
     (S4)        override still winning), the cap error naming the promotion path (never for
                   `state`, byte-identical when off), and the read-only Conf status route.
 13. Copy-in    — the §8-1 matrix on a synthesized Claude-shaped corpus: counts, byte-identical
     (S4)        read, a clamped index, a body-only `search` hit, a neighbour-shaped `create`, and
                   the hand-edit reload boundary.

Every test runs against a synthesized corpus in its own `$CTRLB_HOME` (conftest) — never the owner's
real config, memory dir or vault.
"""

from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path

import yaml
from _async import run_async

from app.config import CoreMemoryCfg, LongTermCfg, MemoryCfg, load_settings
from app.core.tool import registry as tool_registry
from app.services.agent import core_memory_tool  # noqa: F401 — registers `core_memory` in the registry
from app.services.agent.core_memory import CoreMemoryCorpus
from app.services.agent.memory_backup import _GITIGNORE
from app.services.agent.prompts import resolve

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


class _Actions:
    """The one member the head path reads off `ActionService`: the tool registry, which
    `_tool_allowed` consults to answer whether `core_memory` is in this turn's schema (S4 §4b-2). The
    REAL module registry, so the exposure the head reasons about is the shipped one."""

    registry = tool_registry


def _session(
    corpus: CoreMemoryCorpus | None,
    settings,
    *,
    memory=None,
    skills_note: str | None = None,
    agent=None,
):
    """A bare `AgentSession` — `_static_prefix` reads only settings, the tool registry and the two
    memory collaborators, so the repos/inference it never touches are left unwired (the
    `test_prompts_registry_p18` bare-probe pattern). `skills_note` stands in for `_activate_skills`
    having run."""
    from app.services.agent.session import AgentSession

    session = AgentSession(None, None, None, settings, _Actions(), agent, memory=memory, core_memory=corpus)
    session._skills_note = skills_note
    return session


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
        index_char_limit=10240,  # D61 ④ — the owner's ~10K sizing replaces Kilo's 8192
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
        "index_char_limit": 10240,
        "topic_char_limit": 4096,
        "recall_char_limit": 20480,
        "recall_min_charge_chars": 256,  # D60 §15b-3
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
    assert status.index_char_limit == 10240 and 0 <= status.index_pct <= 100
    # D61 ② — the threshold rides the status so the client's pressure hint compares against config.
    assert status.consolidation_nudge_pct == 80


# ── 10. head injection (S2) ───────────────────────────────────────────────────────────────────────


def _tier1(settings):
    """A tier-1 provider over the same workspace, so the head under test carries a real memory block
    for the core index to sit after."""
    from app.services.agent.memory import FileMemoryProvider

    (_memories() / "MEMORY.md").write_text("Owner prefers dark mode.", encoding="utf-8")
    return FileMemoryProvider(settings)


def _seeded(tmp_path: Path, backend: str | None = "core") -> CoreMemoryCorpus:
    root = _root()
    _topic(root, "a.md", "---\nname: Wake ritual\ndescription: how the owner wakes hosts\n---\nbody\n")
    _index(root, "- [Wake ritual](a.md) — how the owner wakes hosts")
    return _corpus(tmp_path, backend)


def test_the_head_is_byte_identical_when_the_slot_is_off(tmp_path):
    """§4's strongest regression (family 5): a wired corpus with `backend: null` assembles exactly
    the head an unwired session does — and does it without touching the corpus at all, even though
    the files are sitting right there."""
    corpus = _seeded(tmp_path, backend=None)
    settings = corpus._settings
    wired = _session(corpus, settings, memory=_tier1(settings))
    unwired = _session(None, settings, memory=_tier1(settings))

    assert wired._static_prefix() == unwired._static_prefix()
    assert wired._stamps == unwired._stamps  # no `core_memory_policy` resolution either
    assert corpus.parses == 0  # off ⇒ no scan, no parse, no IO


def test_a_disabled_slot_never_resolves_or_scans(tmp_path, monkeypatch):
    """The no-IO contract itself, not just its current side effects: a disabled corpus must return
    before root resolution or scanning — stubbed to fail loudly if the head path ever reaches them."""
    corpus = _seeded(tmp_path, backend=None)

    def _boom(*_a, **_k):
        raise AssertionError("disabled slot touched the corpus")

    monkeypatch.setattr(corpus, "root", _boom)
    monkeypatch.setattr(corpus, "scan", _boom)
    _session(corpus, corpus._settings)._static_prefix()


def test_the_head_is_frozen_per_session_and_a_resume_sees_the_edit(tmp_path):
    """ACA-15e as a regression (the council's frozen-head correction): a corpus edit after the first
    build never reaches this session's cached head; a fresh resume-style session renders the new
    index — the reload boundary is the new `AgentSession`, not a mid-turn re-read."""
    corpus = _seeded(tmp_path)
    settings = corpus._settings
    session = _session(corpus, settings)
    first = session._static_prefix()
    assert any("Wake ritual" in m["content"] for m in first)

    _index(_memories() / "core", "- [Wake ritual](a.md) — RENAMED hook after the head was built")
    assert session._static_prefix() is first  # frozen: the cached head, not a rebuild
    resumed = _session(corpus, settings)
    assert any("RENAMED hook" in m["content"] for m in resumed._static_prefix())


def test_an_off_slot_never_creates_the_corpus_root(tmp_path):
    """The other half of "no IO": a fresh install with the slot off must not grow a `core/` dir."""
    corpus = _corpus(tmp_path, backend=None, root="never-made")
    _session(corpus, corpus._settings)._static_prefix()
    assert not (_memories() / "never-made").exists()


def test_the_index_block_sits_between_memory_and_the_skills_note(tmp_path):
    """§4: system → appends → roster → tier-1 memory → **core index** → skills note. Asserted as the
    whole rendered sequence, since a minimal fixture has no roster and each block is optional."""
    from app.services.agent.prompts import resolve
    from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

    corpus = _seeded(tmp_path)
    settings = corpus._settings
    provider = _tier1(settings)
    session = _session(corpus, settings, memory=provider, skills_note="Skill instructions.")

    index = corpus.render_index()
    expected = resolve("core_memory_policy", settings) + "\n\n" + index
    assert [m["content"] for m in session._static_prefix()] == [
        DEFAULT_SYSTEM_PROMPT,
        provider.load_context(settings.resolve_agent(None)),
        expected,
        "Skill instructions.",
    ]
    assert all(m["role"] == "system" for m in session._static_prefix())
    assert "Wake ritual" in index and len(index) <= settings.memory.longterm.core.index_char_limit
    assert "core_memory_policy" in session._stamps  # stamped like every other model-facing text


def test_an_enabled_but_empty_corpus_injects_nothing(tmp_path):
    """Nothing to route ⇒ no block AND no policy text — the framing is never injected on its own."""
    corpus = _corpus(tmp_path)
    _root()  # the dir exists; it just has no index and no topics
    settings = corpus._settings
    session = _session(corpus, settings, memory=_tier1(settings))

    assert session._static_prefix() == _session(None, settings, memory=_tier1(settings))._static_prefix()
    assert "core_memory_policy" not in session._stamps


def test_the_lifespan_wires_one_corpus_into_the_state_and_the_deps(tmp_path, monkeypatch):
    """The other end of the wiring: `main.py` builds ONE singleton beside the memory provider (one
    scan cache, shared by every session), back-fills it onto `Deps` for the subagent path, and the
    shared session builder hands it to both the interactive and the automation session."""
    from fastapi.testclient import TestClient

    from app.api.agent import _build_session
    from app.main import create_app

    cfg = tmp_path / "config.yaml"
    cfg.write_text("server:\n  port: 5433\n", encoding="utf-8")
    monkeypatch.setenv("CTRLB_CONFIG", str(cfg))
    monkeypatch.setenv("CTRLB_DB", str(tmp_path / "t.db"))
    with TestClient(create_app()) as c:
        state = c.app.state
        assert isinstance(state.core_memory, CoreMemoryCorpus)
        assert state.deps.core_memory is state.core_memory
        assert _build_session(state)._core_memory is state.core_memory


# ── 11. curation + Conf (S4, §4b) ─────────────────────────────────────────────────────────────────


def _pressured(tmp_path: Path, *, backend: str | None = None, cap: int = 20, fill: int = 18):
    """A tier-1 provider whose root agent memory sits over the nudge threshold, with the nudge on —
    the state every §4b-2/§4b-3 assertion starts from."""
    from app.services.agent.memory import FileMemoryProvider

    cfg = tmp_path / "config.yaml"
    cfg.write_text(
        yaml.safe_dump(
            {
                "memory": {
                    "consolidation_nudge": True,
                    "consolidation_nudge_pct": 80,
                    "memory_char_limit": cap,
                    "longterm": {"backend": backend},
                }
            }
        ),
        encoding="utf-8",
    )
    settings = load_settings(cfg)
    _memories().mkdir(parents=True, exist_ok=True)
    _fill(fill)
    return FileMemoryProvider(settings), settings


def _fill(chars: int, agent: str | None = None) -> None:
    path = _memories() / "MEMORY.md" if agent is None else _memories() / "agents" / agent / "MEMORY.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("x" * chars, encoding="utf-8")


_NUDGE = "Consolidate before adding more"
_PROMOTE = "promote the durable, generally useful entries to `core_memory`"


def test_the_nudge_fires_once_per_pressure_episode_and_clears_on_a_fill_drop(tmp_path):
    """§4b-3 (R39 ②, field-unanimous): the nudge re-renders into a cached head EVERY turn while
    pressured, which turns an ignored suggestion into a permanent standing order. Latched on the
    provider singleton and cleared only when fill drops back under the threshold."""
    provider, settings = _pressured(tmp_path)
    agent = settings.resolve_agent(None)

    assert _NUDGE in provider.load_context(agent)
    assert _NUDGE not in provider.load_context(agent)  # latched — once per episode
    # …and the pressure is still visible: the correction rides the always-rendered usage header, not
    # a re-fired nudge (§4b's deliberate non-fix for the non-transactional promote-then-trim).
    assert "## Agent memory (90% — 18/20)" in provider.load_context(agent)

    _fill(4)  # 20% — the episode is over
    assert _NUDGE not in provider.load_context(agent)
    _fill(18)  # …and a NEW episode warns again
    assert _NUDGE in provider.load_context(agent)


def test_one_agents_latch_never_suppresses_anothers(tmp_path):
    """§4b-3 / council Opus-H4: the stores are per-agent, so a bare store key would have the root
    agent's fired nudge silence a specialist that has never been warned."""
    from app.domain.agent import AgentDef

    provider, settings = _pressured(tmp_path)
    root, coder = settings.resolve_agent(None), AgentDef(name="coder")
    _fill(18, "coder")

    assert _NUDGE in provider.load_context(root)
    assert _NUDGE not in provider.load_context(root)
    assert _NUDGE in provider.load_context(coder)  # its own latch is still down


def test_an_emptied_store_un_latches(tmp_path):
    """The council confirm round's residual: `load_context` used to `continue` on an empty body
    BEFORE the fill check, so a store the owner blanked stayed latched forever — it could never warn
    again however full it got."""
    provider, settings = _pressured(tmp_path)
    agent = settings.resolve_agent(None)

    assert _NUDGE in provider.load_context(agent)
    _fill(0)
    assert provider.load_context(agent) == ""  # nothing injected at all — the clear still ran
    _fill(18)
    assert _NUDGE in provider.load_context(agent)


def test_a_non_shrinking_write_does_not_un_latch_mid_episode(tmp_path):
    """The ruled half of the one reviewer conflict: clearing on *write* would re-arm the nudge on an
    edit that freed no space, which is the loop the latch exists to stop. Fill-drop only."""
    provider, settings = _pressured(tmp_path)
    agent = settings.resolve_agent(None)

    assert _NUDGE in provider.load_context(agent)
    _fill(19)  # a write, still over the threshold
    assert _NUDGE not in provider.load_context(agent)


def test_the_promotion_clause_rides_the_nudge_only_when_the_tool_is_reachable(tmp_path):
    """§4b-2: `{{longterm}}` is always in the context and empty when tier 2 is unreachable, so the
    tier-1 wording is byte-identical to a deployment without Core Memory."""
    from app.services.agent.memory import FileMemoryProvider

    provider, settings = _pressured(tmp_path, backend="core")
    agent = settings.resolve_agent(None)

    off = provider.load_context(agent)
    on = FileMemoryProvider(settings).load_context(agent, None, True)  # a fresh, unlatched provider
    assert _PROMOTE not in off and _PROMOTE in on
    assert on == off + " " + resolve("consolidation_promote", settings)


def test_the_session_hands_the_provider_this_turns_availability(tmp_path):
    """The wiring: only the session knows the turn's effective schema, so it computes the flag and
    passes it down — an agent whose allowlist excludes `core_memory` (it is `core=False`) must not be
    told to promote into a tool it cannot call."""
    from app.domain.agent import AgentDef
    from app.services.agent.memory import FileMemoryProvider

    corpus = _seeded(tmp_path, "core")
    settings = corpus._settings
    settings.memory.consolidation_nudge = True
    settings.memory.memory_char_limit = 20
    _fill(18)  # the root agent's store…
    _fill(18, "narrow")  # …and the narrowed agent's own, both over the threshold
    provider = FileMemoryProvider(settings)

    allowed = _session(corpus, settings, memory=provider)._memory_block() or ""
    excluded = (
        _session(
            corpus, settings, memory=provider, agent=AgentDef(name="narrow", tools=["ping_host"])
        )._memory_block()
        or ""
    )
    assert _PROMOTE in allowed
    assert _NUDGE in excluded and _PROMOTE not in excluded


def test_the_reflection_nudge_gains_the_routing_sentence_only_with_tier2(tmp_path):
    """§4b-5's second surface, on the `state_clause` precedent: with a durable tier available, a
    nudge that sends every lasting fact to tier 1 aims it at the store that is trimmed first."""
    corpus = _seeded(tmp_path)
    settings = corpus._settings
    routing = " Durable, shared knowledge belongs in `core_memory` instead."

    assert routing in _session(corpus, settings)._reflection_nudge()
    off = _session(None, settings)._reflection_nudge()
    assert off == resolve(
        "reflection_nudge",
        settings,
        {
            "reflection_interval": str(settings.memory.reflection_interval),
            "state_clause": "",
            "longterm": "",
        },
    )


def test_the_index_header_is_plain_data_at_every_fill(tmp_path):
    """D61 ③: the header reports the fill and NOTHING else. The old clause ("near the cap:
    consolidate topics before adding more") was mid-task steering on a second channel beside the
    owner-facing hint — so it is gone at every fill, and at every `consolidation_nudge_pct`."""
    root = _root()
    for i in range(14):
        _topic(root, f"t{i}.md", f"---\nname: T{i}\ndescription: hook {i}\n---\nbody\n")
    _index(root, *[f"- [T{i}](t{i}.md) — hook {i}" for i in range(14)])

    roomy = _corpus(tmp_path, index_char_limit=8192)
    tight = _corpus(tmp_path, index_char_limit=480)
    for corpus in (roomy, tight):
        for pct in (1, 80, 100):  # a live Conf edit no longer reaches the render at all
            corpus._settings.memory.longterm.core.consolidation_nudge_pct = pct
            head = corpus.render_index().splitlines()[0]
            assert "consolidate" not in head and "near the cap" not in head
            assert head.endswith(")") and "%" in head  # the counts + fill stay, as plain data
    # …and the fill the tight corpus reports is genuinely over the default threshold — the removal
    # is not an artefact of never being pressured.
    assert tight.status().index_pct >= 80 > roomy.status().index_pct


# ── 12. the tier-1 surfaces + the Conf status route (S4, live app) ────────────────────────────────


def _app(tmp_path: Path, monkeypatch, config: str = "server:\n  port: 5433\n"):
    from fastapi.testclient import TestClient

    from app.main import create_app

    cfg = tmp_path / "config.yaml"
    cfg.write_text(config, encoding="utf-8")
    monkeypatch.setenv("CTRLB_CONFIG", str(cfg))
    monkeypatch.setenv("CTRLB_DB", str(tmp_path / "t.db"))
    return TestClient(create_app())


def _memory_description(client) -> str:
    return client.app.state.actions.registry.get("memory").spec.description


def test_the_memory_tools_description_follows_the_slot_live(tmp_path, monkeypatch):
    """§4b-5 / council Codex-10: with tier 2 on, the tier-1 tool stops advertising itself as the home
    of lasting facts. `apply_tool_overrides` is the one seam that reaches the model schema and
    `/api/actions` together, and it re-runs on reconfigure — so the flip needs no restart."""
    with _app(tmp_path, monkeypatch) as c:
        assert "durable memory" in _memory_description(c)
        assert "core_memory" not in _memory_description(c)

        assert c.put("/api/settings", json={"memory": {"longterm": {"backend": "core"}}}).status_code == 200
        assert "short-horizon working memory" in _memory_description(c)
        assert "durable, shared knowledge belongs in `core_memory`" in _memory_description(c)

        # …and the owner's own override still wins over both (Class B stays `tool_overrides` land).
        body = {"tool_overrides": {"memory": {"description": "Mine."}}}
        assert c.put("/api/settings", json=body).status_code == 200
        assert _memory_description(c) == "Mine."


def test_the_cap_error_names_the_promotion_path(tmp_path, monkeypatch):
    """§4b-4 (R39's higher-signal point): the hard boundary is the deterministic moment to say where
    a durable entry should go instead — resolved at the TOOL boundary, where the stamps live."""
    from app.domain.enums import Actor, Privilege, RunState
    from app.domain.event import ORIGIN_USER_CHAT

    stock = "a remove/shrink is always allowed."
    with _app(tmp_path, monkeypatch) as c:
        c.app.state.settings.memory.memory_char_limit = 10
        stamps: dict[str, str] = {}

        def _add(target: str = "memory"):
            return run_async(
                c.app.state.actions.invoke(
                    "memory",
                    {"target": target, "action": "add" if target != "state" else "set", "content": "x" * 40},
                    origin=ORIGIN_USER_CHAT,
                    actor=Actor.AGENT,
                    privilege=Privilege.CONFIRM,
                    agent=c.app.state.settings.resolve_agent(None),
                    stamps=stamps,
                )
            ).result

        off = _add()
        assert off.state == RunState.ERROR and off.error.endswith(stock)  # byte-identical to pre-D57

        assert c.put("/api/settings", json={"memory": {"longterm": {"backend": "core"}}}).status_code == 200
        on = _add()
        assert on.error == off.error + " " + resolve("consolidation_promote", c.app.state.settings)
        assert "memory_cap_error" in stamps and "consolidation_promote" in stamps

        # `state` is this agent's own mood — never promotable, so it never gets the clause.
        c.app.state.settings.memory.state_enabled = True
        c.app.state.settings.memory.state_char_limit = 10
        assert "core_memory" not in (_add("state").error or "")


def test_the_status_route_serves_the_scan_for_the_conf_disclosure(tmp_path, monkeypatch):
    """§6 / council M8: derived data gets its own read-only route — the settings GET carries config
    only. It reports even while the slot is off, which is what makes it the copy-in validation
    affordance (§3b)."""
    root = _root()
    _topic(root, "a.md", "---\nname: A\ndescription: indexed\n---\nbody\n")
    _topic(root, "b.md", "---\nname: B\ndescription: orphan\n---\nbody\n")
    _index(root, "- [A](a.md) — indexed")

    with _app(tmp_path, monkeypatch) as c:
        res = c.get("/api/memory/core/status")
        assert res.status_code == 200
        body = res.json()
        assert (body["enabled"], body["topics"], body["skipped"]) == (False, 2, 0)
        assert body["anomalies"] == ["topic not in the index: b.md"]
        assert body["root"] == str(root.resolve()) and body["index_char_limit"] == 10240
        assert body["index_chars"] == 0 and body["index_pct"] == 0  # off ⇒ nothing would be injected
        assert body["consolidation_nudge_pct"] == 80  # D61 ② — the client's hint threshold

        assert c.put("/api/settings", json={"memory": {"longterm": {"backend": "core"}}}).status_code == 200
        on = c.get("/api/memory/core/status").json()
        assert on["enabled"] and on["index_chars"] > 0


# ── 13. copy-in: a synthesized Claude-shaped corpus (§8-1, the family-1 matrix) ───────────────────


#: p100 of the owner's real corpus is a 6,337-char description (§2a-1) — past both the entry clamp
#: and the per-read cap, and the case the `delete` token had to stop being a description over.
_HUGE = "wake ritual detail " * 337  # 6,403 chars


def _copied_corpus() -> Path:
    """A Claude-shaped corpus as a COPY-IN would land it (§8-1): the nested `metadata.*` shape the
    current Claude client writes, foreign artifacts beside the topics, a nested index, one file with
    conflicting frontmatter, one CRLF file, one unparseable file, and an index carrying a dangling
    link, a duplicate link and one topic it never mentions.

    Synthesized, never a copy of the owner's real vault — the shapes are what matter."""
    root = _root()
    (root / ".consolidate-lock").write_text("pid 4127\n", encoding="utf-8")
    (root / "logs").mkdir(exist_ok=True)
    (root / "logs" / "2026-08-01.md").write_text("---\nname: Log\n---\nnoise\n", encoding="utf-8")
    _topic(root, "notes/MEMORY.md", "- [A foreign index](../preferences.md) — not ours\n")

    _topic(
        root,
        "preferences.md",
        "---\nmetadata:\n  name: Preferences\n  description: how the owner likes things done\n"
        "  type: user\n---\nThe owner reviews in the afternoon.\n",
    )
    _topic(
        root,
        "workflows/deploy.md",
        "---\nmetadata:\n  name: Deploy\n  description: the release ritual\n  type: project\n---\n"
        "Tag, wait for the gate, re-pin, verify. The staging box is called hyperbolic.\n",
    )
    _topic(
        root,
        "workflows/wake.md",
        f"---\nmetadata:\n  name: Wake\n  description: {_HUGE}\n---\nSend the magic packet.\n",
    )
    _topic(
        root,
        "conflicting.md",
        "---\nname: Canonical\ndescription: the top-level one wins\n"
        "metadata:\n  name: Shadow\n  description: the nested one loses\n---\nbody\n",
    )
    (root / "legacy.md").write_bytes(
        b"---\r\nmetadata:\r\n  name: Legacy\r\n  description: written on windows\r\n---\r\nCRLF body\r\n"
    )
    _topic(root, "orphan.md", "---\nmetadata:\n  name: Orphan\n  description: nobody links me\n---\nb\n")
    _topic(root, "scratch.md", "just some text, no frontmatter and no index line\n")

    # Bulk to the live corpus's SCALE (§8-1: the fixture is "synthesized to the live 56-topic
    # shape"): 50 ordinary nested-shape indexed topics beside the 6 special ones, so clamp/cache
    # behavior is exercised on a real-sized index rather than a toy one.
    bulk_lines = [f"- [Topic {i}](bulk/topic-{i:02d}.md) — bulk topic number {i}" for i in range(50)]
    for i in range(50):
        _topic(
            root,
            f"bulk/topic-{i:02d}.md",
            f"---\nmetadata:\n  name: Topic {i}\n  description: bulk topic number {i}\n"
            "  type: reference\n---\nbody\n",
        )

    _index(
        root,
        "# Memory index",
        "",
        "- [Preferences](preferences.md) — how the owner likes things done",
        "- [Deploy](workflows/deploy.md) — the release ritual",
        "- [Wake](workflows/wake.md) — how hosts get woken",
        "- [Canonical](conflicting.md) — the top-level one wins",
        "- [Legacy](legacy.md) — written on windows",
        "- [Gone](missing.md) — deleted last month",
        "- [Preferences again](preferences.md) — a duplicate line",
        *bulk_lines,
    )
    return root


def test_a_copied_claude_corpus_works_through_one_path(tmp_path):
    """Acceptance family 1 end to end: the copy-in procedure (§3b) is "put the folder there and turn
    it on", so this asserts what the owner would see afterwards — the scan's counts, that nothing on
    disk moved, that the index renders clamped, that a body-only fact is findable, that a new topic
    is written in the corpus's own shape, and that a hand edit shows up on the next scan."""
    root = _copied_corpus()
    before = _digest(root)
    corpus = _corpus(tmp_path)

    # 1. what the Conf status line reports — the validation affordance the procedure points at.
    #    56 topics = the live corpus's shape (§8-1's normative scale); scratch.md is the one skip.
    status = corpus.status()
    assert (status.enabled, status.topics, status.skipped) == (True, 56, 1)
    assert sorted(status.anomalies) == [
        "dangling index link: missing.md",
        "duplicate index link: preferences.md",
        "topic not in the index: orphan.md",
    ]
    # The oversized description survived the tolerant parse WHOLE (§2a's p100 hazard — corruption or
    # truncation here would silently degrade routing), and search reaches into it as frontmatter.
    assert len(_HUGE) == 6403
    wake = next(t for t in corpus.scan().topics if t.path == "workflows/wake.md")
    assert wake.description == _HUGE.strip()  # `_pick` strips surrounding whitespace, nothing else
    assert "workflows/wake.md" in [h.path for h in corpus.search("wake ritual detail").hits]

    # 2. enabling and reading changed NOTHING on disk (the preservation contract's read half): the
    #    CRLF file, the lock, the logs tree and the nested index are all still byte-for-byte there.
    index = corpus.render_index()
    assert corpus.search("hyperbolic").hits and _digest(root) == before
    assert (root / ".consolidate-lock").exists() and (root / "notes" / "MEMORY.md").exists()

    # 3. the index renders, every entry clamped despite the 6,403-char description, and the foreign
    #    index is not a topic while the duplicate/dangling links are simply absent.
    assert all(len(line) <= 150 for line in index.splitlines())
    assert index.count("preferences.md") == 1 and "missing.md" not in index
    assert "notes/MEMORY.md" not in index and "logs/" not in index
    assert len(index) <= corpus._settings.memory.longterm.core.index_char_limit

    # 4. `search` reaches a fact no index hook mentions (the description-only ceiling, §5).
    hit = corpus.search("hyperbolic")
    assert [h.path for h in hit.hits] == ["workflows/deploy.md"]

    # 5. a new topic matches the neighbours' shape rather than ctrl-b's own (§3's deterministic vote:
    #    this corpus's root directory is majority-nested, so the created file is too).
    run_async(corpus.create("Fresh topic", "a new hook", "reference", "fresh body"))
    written = (root / "fresh-topic.md").read_text(encoding="utf-8")
    assert written.startswith("---\nmetadata:\n") and "name: Fresh topic" in written
    assert "- [Fresh topic](fresh-topic.md) — a new hook" in (root / "MEMORY.md").read_text(encoding="utf-8")

    # 6. a HAND edit (Obsidian, the D26 sweep's world) is picked up on the next scan — the
    #    paths+mtimes signature is the reload boundary (R40 §19-8), not a restart. Both halves: an
    #    edited BODY becomes searchable, and an edited index hook re-renders (the hook is the index's
    #    own text, which is why editing the topic's description alone would NOT move the line — §3's
    #    "the index is the routing source").
    _topic(root, "preferences.md", "---\nmetadata:\n  name: Preferences\n---\nAdded by hand: mornings.\n")
    assert [h.path for h in corpus.search("added by hand").hits] == ["preferences.md"]
    _index(root, "- [Preferences](preferences.md) — EDITED BY HAND")
    assert "EDITED BY HAND" in corpus.render_index()
