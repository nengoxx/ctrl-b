"""The config docs drift guard (QH-8, widened 2026-10-27) — `Settings` vs the two documents that teach it.

`config.example.yaml` is the owner's bootstrap path (README: "copy to config.yaml and fill in") and
`docs/user-guide/configuration-reference.md` is the key-by-key reference. `extra="allow"` lets a
misspelt or retired key load silently and do nothing, so nothing else notices when either document
drifts from the model. This pins, both ways:

- the example parses, validates against `Settings`, and its secret placeholders are masked;
- the example, with every commented `key:` / `- ` line uncommented (the file's convention: a commented
  key line is YAML you can uncomment), parses with NO duplicate key, validates, and names every model
  key and no other — a list or map shown empty covers its children; its `config_version` stamp is the
  migrator's `CONFIG_VERSION`;
- the reference has a row for every model key (its own or an ancestor's), every row names a real key,
  and each row's default cell starts with the model's default;
- every `CTRLB_<SECTION>__<KEY>` line in `.env.example` names a declared path.

Paths are dotted: a name-keyed map adds a `*` segment (the docs' `<name>`), a list item adds none
(`files[].key` → `files.key`). `DOC_ONLY` holds the one documented key the model does not carry.
"""

from __future__ import annotations

import functools
import re
import types
import typing
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel
from pydantic_core import to_jsonable_python

from app.config import (
    CONFIG_VERSION_KEY,
    Settings,
    _env_path_is_declared,
    env_override_vars,
    load_settings,
    mask_secrets,
    secret_values,
)
from app.config_migration import CONFIG_VERSION

ROOT = Path(__file__).resolve().parents[2]
EXAMPLE = ROOT / "config.example.yaml"
REFERENCE = ROOT / "docs" / "user-guide" / "configuration-reference.md"
ENV_EXAMPLE = ROOT / ".env.example"
#: Documented, never a `Settings` field: the file-shape stamp `load_settings` pops (UPDATE_PLAN §3.8).
DOC_ONLY = (CONFIG_VERSION_KEY,)
_NO_DEFAULT = object()


def _shape(ann: Any) -> tuple[str, Any] | None:
    """`("model", cls)`, `("map", inner)` or `("list", inner)` for a field that nests models; None = a leaf."""
    if typing.get_origin(ann) in (typing.Union, types.UnionType):
        args = [a for a in typing.get_args(ann) if a is not type(None)]
        return _shape(args[0]) if len(args) == 1 else None
    if isinstance(ann, type) and issubclass(ann, BaseModel):
        return ("model", ann)
    args = typing.get_args(ann)
    inner = _shape(args[-1]) if typing.get_origin(ann) in (dict, list) else None
    return (("map" if typing.get_origin(ann) is dict else "list"), inner) if inner else None


@functools.cache
def _model_paths() -> tuple[dict[str, Any], set[str]]:
    """Every node + leaf path of `Settings` → its default (`_NO_DEFAULT` for a required field or a map
    entry), and the set of leaves."""
    paths: dict[str, Any] = {}
    leaves: set[str] = set()

    def walk(shape: tuple[str, Any], path: str) -> None:
        kind, inner = shape
        if kind == "model":
            for name, f in inner.model_fields.items():
                p = f"{path}.{name}" if path else name
                paths[p] = _NO_DEFAULT if f.is_required() else f.get_default(call_default_factory=True)
                if sub := _shape(f.annotation):
                    walk(sub, p)
                else:
                    leaves.add(p)
        elif kind == "map":
            paths[f"{path}.*"] = _NO_DEFAULT
            walk(inner, f"{path}.*")
        else:
            walk(inner, path)

    walk(("model", Settings), "")
    return paths, leaves


def _covered(path: str, by: set[str]) -> bool:
    return any(path == p or path.startswith(p + ".") for p in by)


@functools.cache
def _reference_rows() -> list[tuple[str, str, int]]:
    """`(path, default cell, line)` for every table row under a dotted-path heading."""
    rows, section = [], None
    for n, line in enumerate(REFERENCE.read_text(encoding="utf-8").splitlines(), 1):
        if m := re.match(r"#{2,3} (\S+)$", line):
            section = re.sub(r"<[^>]+>", "*", m[1])
        elif line.startswith("#"):
            section = None
        elif section and (m := re.match(r"\| `([^`]+)` \|", line)):
            key = re.sub(r"<[^>]+>", "*", m[1]).replace("[]", "")
            cells = [c.strip() for c in re.split(r"(?<!\\)\|", line)[1:-1]]
            assert len(cells) == 5, f"reference line {n}: expected 5 cells, got {len(cells)}"
            rows.append((key if key == section else f"{section}.{key}", cells[2], n))
    assert len(rows) > 300, f"reference parse found only {len(rows)} rows — the table format changed?"
    return rows


class _UniqueKeyLoader(yaml.SafeLoader):
    """PyYAML keeps the LAST of two equal keys; a doc that shows a key twice teaches one of them wrong."""

    def construct_mapping(self, node: yaml.MappingNode, deep: bool = False) -> dict[Any, Any]:
        keys = [self.construct_object(k, deep=deep) for k, _ in node.value]
        dupes = sorted({str(k) for k in keys if keys.count(k) > 1})
        if dupes:
            raise yaml.constructor.ConstructorError(None, None, f"duplicate key {dupes}", node.start_mark)
        return super().construct_mapping(node, deep)


_KEY_LINE = re.compile(r"(?:[a-z_<][\w.+<>-]*:(?:\s|$)|- |#)")


def _example_uncommented() -> Any:
    """The example with each commented `key:` / `- ` / `#` line uncommented at its own indent."""
    out = []
    for line in EXAMPLE.read_text(encoding="utf-8").splitlines():
        m = re.match(r"(\s*)# ?(.*)$", line)
        out.append(m[1] + m[2] if m and _KEY_LINE.match(m[2].lstrip()) else line)
    return yaml.load("\n".join(out), _UniqueKeyLoader)  # noqa: S506 — a SafeLoader subclass


def _raw_paths(node: Any) -> tuple[set[str], set[str]]:
    """The RAW parsed keys as model paths (not `model_extra`: `ServerCfg` drops extras), and the paths of
    the lists/maps shown empty (they cover their children)."""
    seen: set[str] = set()
    empty: set[str] = set()

    def walk(shape: tuple[str, Any], value: Any, path: str) -> None:
        kind, inner = shape
        if not value:
            if kind != "model":  # `[]` / `{}` / null: the shape is shown, its entries are examples
                empty.add(path)
        elif kind == "model":
            for key, sub in value.items():
                p = f"{path}.{key}" if path else str(key)
                seen.add(p)
                f = inner.model_fields.get(key)
                if f is not None and (s := _shape(f.annotation)):
                    walk(s, sub, p)
        elif kind == "map":
            seen.add(f"{path}.*")
            for sub in value.values():
                walk(inner, sub, f"{path}.*")
        else:
            for sub in value:
                walk(inner, sub, path)

    walk(("model", Settings), node, "")
    return seen, empty


def _literal_matches(cell: str, want: Any) -> bool:
    """The default cell's leading `literal` equals the model default (numbers numerically)."""
    text = re.match(r"`([^`]*)`", cell)[1]  # type: ignore[index]  # callers pass backticked cells only
    want = to_jsonable_python(want)
    try:
        got = "" if text == '""' else yaml.safe_load(text)
    except yaml.YAMLError:
        got = text
    if isinstance(want, (bool, int, float)):  # bool ≠ int; an int needs an int literal (R33)
        return type(got) in ((int, float) if type(want) is float else (type(want),)) and got == want
    return got == want or text == want


def test_example_config_loads_validates_and_masks():
    assert EXAMPLE.exists(), "config.example.yaml missing from the repo root"
    settings = load_settings(EXAMPLE)  # raises on YAML/validation rot

    # The file actually populated the model (not an accidental empty-mapping pass).
    assert settings.server.port, "server block did not load"
    assert settings.computers, "computers (fleet) block did not load"

    # The template's placeholder secrets are recognized as secrets and masked on read.
    dump = settings.model_dump()
    secrets = [v for v in secret_values(dump) if v]
    assert secrets, "template carries no recognizable secret placeholders — secret rules drifted?"
    masked_flat = str(mask_secrets(dump))
    for value in secrets:
        assert value not in masked_flat, f"secret placeholder {value!r} survives mask_secrets"


def test_every_config_key_has_a_reference_row():
    text = REFERENCE.read_text(encoding="utf-8").splitlines()
    rows = {path: text[n - 1] for path, _, n in _reference_rows()}
    _, leaves = _model_paths()
    missing = sorted(leaf for leaf in leaves if not _covered(leaf, set(rows)))
    assert not missing, f"configuration-reference.md has no row (own or ancestor's) for: {missing}"
    # R38: a leaf covered only by an ANCESTOR row (an inline shape such as `fallbacks[]`) must be NAMED
    # in that row, or a field added inside the shape would pass unnoticed.
    unnamed = sorted(
        leaf
        for leaf in leaves
        if leaf not in rows
        and not any(
            leaf.startswith(p + ".") and re.search(rf"\b{re.escape(leaf.rsplit('.', 1)[1])}\b", row)
            for p, row in rows.items()
        )
    )
    assert not unnamed, f"configuration-reference.md: an ancestor row covers but never names: {unnamed}"


def test_every_reference_row_names_a_config_key():
    paths, _ = _model_paths()
    stray = [(n, path) for path, _, n in _reference_rows() if path not in paths and path not in DOC_ONLY]
    assert not stray, f"configuration-reference.md rows naming no config key (line, path): {stray}"


def test_reference_defaults_match_the_model():
    paths, _ = _model_paths()
    wrong = [
        (n, path, cell)
        for path, cell, n in _reference_rows()
        if cell.startswith("`")
        and paths.get(path, _NO_DEFAULT) is not _NO_DEFAULT
        and not _literal_matches(cell, paths[path])
    ]
    assert not wrong, f"configuration-reference.md default ≠ the model's (line, path, cell): {wrong}"


def test_the_example_documents_every_config_key_and_no_other():
    raw = _example_uncommented()
    Settings.model_validate({k: v for k, v in raw.items() if k not in DOC_ONLY})
    seen, empty = _raw_paths(raw)
    paths, leaves = _model_paths()
    stray = sorted(p for p in seen if p not in paths and p not in DOC_ONLY)
    assert not stray, f"config.example.yaml (uncommented) names keys the model lacks: {stray}"
    missing = sorted(leaf for leaf in leaves if leaf not in seen and not _covered(leaf, empty))
    assert not missing, f"config.example.yaml never shows (live or commented): {missing}"


def test_the_example_is_stamped_at_the_current_config_version():
    stamp = re.search(rf"^{CONFIG_VERSION_KEY}: (\d+)", EXAMPLE.read_text(encoding="utf-8"), re.MULTILINE)
    assert stamp and int(stamp[1]) == CONFIG_VERSION, "stamp config.example.yaml at the migrator's version"


def test_env_example_overrides_name_declared_paths():
    names = re.findall(r"^#?\s*(CTRLB_\w+)=", ENV_EXAMPLE.read_text(encoding="utf-8"), re.MULTILINE)
    overrides = env_override_vars(dict.fromkeys(names, ""))
    assert overrides, ".env.example shows no CTRLB_<SECTION>__<KEY> line — the parse drifted?"
    bad = [full for full, section, key in overrides if not _env_path_is_declared(section, key)]
    assert not bad, f".env.example override lines naming no declared path: {bad}"
