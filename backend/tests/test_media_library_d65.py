"""D65 / MEDIA_MANAGER_PLAN S1 — the LIBRARY: the `library-v1` collation, the per-item wire facts,
and the `config_version` 1 → 2 fold that gets an existing config there.

Three subjects, in the order they compose:

  1. **collation** (`core.media.list_role`, the ONE chokepoint): `files` entries in the owner's order,
     then unlisted disk files by `sort_key`, then the role's unlisted BUNDLED ids as the fallback tier.
  2. **the wire**: `focal`/`hidden`/`listed`/`bundled` merged onto `MediaFile`, so resolution is
     decidable from the index ALONE (§2.3 ④) — including telling a listed bundled entry apart from a
     fallback one, which is what lets a theme ladder keep today's semantics.
  3. **the migration**: `media.<ns>` → `media.namespaces.<ns>` and `order: [n]` → `files: [{name: n}]`,
     config-pure, idempotent, old keys deleted — and PAINT-PARITY, proved against an independent
     statement of the v1 rule rather than asserted.

Config writes go to a temp `CTRLB_CONFIG`/`CTRLB_DB` — never the operator's real config.yaml.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from test_media_g5 import _SEED, disk, home, make_client, png_bytes, role

from app import config_migration as cm
from app.config import Settings, load_settings
from app.core.media import (
    MEDIA_NAMESPACES,
    MediaItem,
    list_role,
    sort_key,
)

__all__ = ["home"]

CHARS = MEDIA_NAMESPACES["gacha"].roles["characters"].bundled  # pegasus atlas 3 4 lyra rook


def items(*entries: dict) -> list[MediaItem]:
    return [MediaItem.model_validate(e) for e in entries]


def put_files(c, role_name: str, entries: list[dict], ns: str = "gacha"):
    """The gallery's own write path: one `files` list through the ordinary settings PUT."""
    return c.put(
        "/api/settings",
        json={"media": {"namespaces": {ns: {"roles": {role_name: {"files": entries}}}}}},
    )


# ── ① the collation, at the chokepoint ────────────────────────────────────────────────────────────


def test_the_three_tiers_come_out_in_order(home: Path) -> None:
    """`files` first (in the owner's order), then the unlisted disk files by `sort_key`, then the
    unlisted bundled ids. One assertion over one role, because the RULE is the ordering of the three
    tiers against each other — asserting each tier alone would not catch them being interleaved."""
    chars = role(home, "characters")
    chars.mkdir(parents=True)
    for name in ("b.png", "a.png", "z.png"):
        (chars / name).write_bytes(png_bytes())
    rows = list_role(home, "gacha", "characters", items({"name": "z.png"}, {"bundled": "lyra"}))
    assert [(r.name, r.listed, r.bundled) for r in rows] == [
        ("z", True, None),  # ① listed disk entry, in the owner's order
        ("lyra", True, "lyra"),  # ① a listed bundled entry is a full mixed citizen
        ("a", False, None),  # ② the rest of the folder, collated
        ("b", False, None),
        ("pegasus", False, "pegasus"),  # ③ the fallback tier, registry order, minus the listed one
        ("atlas", False, "atlas"),
        ("3", False, "3"),
        ("4", False, "4"),
        ("rook", False, "rook"),
    ]


def test_a_dangling_name_drops_and_the_rest_of_the_order_survives(home: Path) -> None:
    """Self-heal (§2.3 ①): deleting a file is a DELETE plus a config write, and a failure between the
    two must be harmless — the entry disappears from the listing and nothing else moves."""
    chars = role(home, "characters")
    chars.mkdir(parents=True)
    for name in ("a.png", "b.png"):
        (chars / name).write_bytes(png_bytes())
    rows = list_role(
        home, "gacha", "characters", items({"name": "b.png"}, {"name": "gone.png"}, {"name": "a.png"})
    )
    assert [r.file for r in rows if r.bundled is None] == ["b.png", "a.png"]


def test_a_bundled_id_the_role_no_longer_ships_drops_the_same_way(home: Path) -> None:
    """The bundled half of self-heal. Config validation refuses an unknown id, so reaching this means
    the REGISTRY shrank under a config that named it — and a row the client cannot map to an asset
    would hold a priority slot for nothing."""
    role(home, "characters").mkdir(parents=True)
    rows = list_role(home, "gacha", "characters", items({"bundled": "retired-id"}))
    assert [r.name for r in rows] == list(CHARS)
    assert all(not r.listed for r in rows)


def test_the_unlisted_tiers_are_stable_across_calls(home: Path) -> None:
    """Determinism is the contract the wire NAMES (`collation`): tier ② is `sort_key`, tier ③ is the
    registry's own order (for a dealt pool that order IS the deal)."""
    chars = role(home, "characters")
    chars.mkdir(parents=True)
    for name in ("10.png", "2.png", "B.png", "a.png"):
        (chars / name).write_bytes(png_bytes())
    rows = list_role(home, "gacha", "characters")
    assert [r.file for r in rows if r.bundled is None] == sorted(
        ["10.png", "2.png", "B.png", "a.png"], key=sort_key
    )
    assert [r.bundled for r in rows if r.bundled is not None] == list(CHARS)


def test_a_role_that_ships_nothing_has_no_third_tier(home: Path) -> None:
    """The kit ships no fallback art BY DESIGN (§3), so its roles' libraries are exactly what is on
    disk and the tier is absent rather than empty. It is the whole namespace now: every THEME role
    ships something and says so (the S6 ruling), gacha's oracle backdrop included."""
    (home / "media" / "kit" / "background").mkdir(parents=True)
    assert list_role(home, "kit", "background") == []
    (home / "media" / "kit" / "services").mkdir(parents=True)
    assert list_role(home, "kit", "services") == []


# ── ② the wire: the per-item facts, and hidden vs unusable ────────────────────────────────────────


def test_the_index_carries_focal_hidden_and_listed_on_every_row(home: Path) -> None:
    """The whole truth on the wire (§2.3 ④, Emma confirm E2): a resolver is a pure function of the
    index rows plus the slots, so every fact it needs must be HERE — never read back out of config."""
    with make_client() as c:
        for name in ("a.png", "b.png"):
            (role(home, "characters") / name).write_bytes(png_bytes())
        r = put_files(
            c,
            "characters",
            [
                {"name": "a.png", "focal": {"x": 0.42, "y": 0.18, "rev": "r1"}, "key": "hero"},
                {"name": "b.png", "hidden": True},
            ],
        )
        assert r.status_code == 200, r.text
        rows = {f["name"]: f for f in c.get("/api/media/gacha").json()["roles"]["characters"]}

        assert rows["a"]["focal"] == {"x": 0.42, "y": 0.18, "rev": "r1"}
        assert (rows["a"]["listed"], rows["a"]["hidden"]) == (True, False)
        # …including the BINDING key (§2.3 ④): a named role's file binds by this field when it has
        # one and by its stem otherwise, and a resolver may not read config to find that out.
        assert rows["a"]["key"] == "hero"
        assert rows["b"]["key"] is None  # no explicit key ⇒ it binds by its stem, the permanent rule
        # HIDDEN IS PRESENT, MARKED — never dropped: the gallery has to show what resolution skips,
        # and one index serves both consumers (no config side-channel).
        assert (rows["b"]["listed"], rows["b"]["hidden"], rows["b"]["focal"]) == (True, True, None)
        assert rows["b"]["url"].endswith("b.png")


def test_a_bundled_row_carries_its_id_and_nothing_it_could_not_know(home: Path) -> None:
    """The server has never seen the client's assets, so it emits the ID and refuses to invent a URL,
    a revision or dimensions for one. `name` carries the id too — a pin addresses ONE identity space."""
    with make_client() as c:
        row = next(
            f for f in c.get("/api/media/gacha").json()["roles"]["characters"] if f["bundled"] == "pegasus"
        )
        assert row["name"] == "pegasus"
        assert (row["file"], row["url"], row["revision"], row["format"]) == ("", "", "", None)
        assert row["key"] is None  # a bundled asset binds through the theme's ladder, not a stem
        assert (row["width"], row["height"]) == (None, None)
        assert (row["unusable"], row["unusable_reason"]) == (False, None)


def test_a_listed_bundled_entry_is_distinguishable_from_a_fallback_one(home: Path) -> None:
    """The E2 arm. A ladder's fallback predicate ("nothing owner-listed here → use the bundled art")
    is implementable ONLY if the wire says which tier a bundled row came from — otherwise listing one
    deliberately and inheriting five by default look identical, and paint parity dies on the fold."""
    with make_client() as c:
        assert put_files(c, "characters", [{"bundled": "lyra"}]).status_code == 200
        rows = {f["name"]: f for f in c.get("/api/media/gacha").json()["roles"]["characters"]}
        assert rows["lyra"]["listed"] is True
        assert all(rows[b]["listed"] is False for b in CHARS if b != "lyra")
        # …and the listed one moved to the FRONT: it is a full mixed citizen, priority and all.
        assert [f["name"] for f in c.get("/api/media/gacha").json()["roles"]["characters"]][0] == "lyra"


def test_hidden_and_unusable_take_OPPOSITE_list_treatments(home: Path) -> None:
    """The §2.2 pair arm, asserted side by side so neither predicate can absorb the other:

    * an UNUSABLE file HOLDS its position — the shipped `cycleAt` rule, so one bad drop cannot re-deal
      the whole fleet's art;
    * a HIDDEN entry is emitted MARKED and the CLIENT filters it — re-dealing is the whole point of
      hiding one (it is how a bundled default is retired from an all-entries role).

    Both are on the wire; only their consumers differ. Folding them into one server-side predicate
    would silently give `unusable` the filtering treatment, which is exactly the bug the `cycleAt`
    rule exists to prevent."""
    chars = role(home, "characters")
    chars.mkdir(parents=True)
    (chars / "good.png").write_bytes(png_bytes())
    (chars / "broken.png").write_bytes(b"\x89PNG\r\n\x1a\n")  # a truncated drop
    (chars / "retired.png").write_bytes(png_bytes())
    rows = list_role(
        home,
        "gacha",
        "characters",
        items({"name": "broken.png"}, {"name": "retired.png", "hidden": True}, {"name": "good.png"}),
    )
    by_name = {r.name: r for r in rows}
    assert [r.name for r in rows if r.bundled is None] == ["broken", "retired", "good"]
    assert (by_name["broken"].unusable, by_name["broken"].hidden) == (True, False)
    assert (by_name["retired"].unusable, by_name["retired"].hidden) == (False, True)


# ── ③ the config shape: the discriminated union and the two-tier predicate ────────────────────────


@pytest.mark.parametrize(
    ("entry", "why"),
    [
        ({}, "neither identity"),
        ({"name": "a.png", "bundled": "lyra"}, "both identities"),
        ({"bundled": "nobody"}, "an id this role does not ship"),
        ({"name": "sub/a.png"}, "a path, not a bare filename"),
        ({"name": ".."}, "a directory"),
        ({"name": "  "}, "blank"),
    ],
)
def test_a_files_entry_that_is_not_one_identity_is_refused(entry: dict, why: str) -> None:
    """Identity is a validator-enforced discriminated union (Emma #10): an entry naming two things has
    two answers to "which picture is this", and one naming nothing holds a priority slot for none."""
    with pytest.raises(ValueError):
        (
            Settings.model_validate(
                {"media": {"namespaces": {"gacha": {"roles": {"characters": {"files": [entry]}}}}}}
            ),
            why,
        )


@pytest.mark.parametrize(
    "pair",
    [
        [{"name": "a.png"}, {"name": "a.png"}],
        [{"bundled": "lyra"}, {"bundled": "lyra"}],
    ],
)
def test_one_identity_listed_twice_is_refused(pair: list[dict]) -> None:
    """`(kind, id)` is unique per role: a list naming one entry twice has no single answer to "where
    does it sit", and every transform downstream (move-to-front, delete-promote) would fork on it."""
    with pytest.raises(ValueError):
        Settings.model_validate(
            {"media": {"namespaces": {"gacha": {"roles": {"characters": {"files": pair}}}}}}
        )


def test_the_same_name_in_two_ROLES_is_fine() -> None:
    """Uniqueness is per role, not per namespace — two folders may hold `lyra.png`, and they are two
    different pictures with two different destinations."""
    s = Settings.model_validate(
        {
            "media": {
                "namespaces": {
                    "gacha": {
                        "roles": {
                            "characters": {"files": [{"name": "lyra.png"}]},
                            "reel": {"files": [{"name": "lyra.png"}]},
                        }
                    }
                }
            }
        }
    )
    assert set(s.media_overrides("gacha")[0]) == {"characters", "reel"}


def test_a_BACKSLASH_named_file_now_loads_and_reorders(home: Path) -> None:
    """Defect #8, re-ruled (council M5). A backslash is an ordinary POSIX filename character: the
    index LISTS such a file and the mount SERVES it, so the config predicate refusing to name it made
    a currently-painting drop impossible to reorder — with an opaque 422 the owner could not act on.
    The fix is to let config express what the surface already serves; `is_served_file` is untouched.

    The upgrade arm proves both halves: it LOADS, and the reorder that used to 422 now commits."""
    weird = "we\\ird.png"
    with make_client() as c:
        for name in (weird, "b.png"):
            (role(home, "characters") / name).write_bytes(png_bytes())
        assert disk(c.get("/api/media/gacha").json()["roles"]["characters"]) == ["b.png", weird]

        r = put_files(c, "characters", [{"name": weird}, {"name": "b.png"}])
        assert r.status_code == 200, r.text
        assert disk(c.get("/api/media/gacha").json()["roles"]["characters"]) == [weird, "b.png"]
        assert c.get(f"/api/media/gacha/files/characters/{weird}").status_code == 200

    # …and the ADMISSION tier still refuses to MINT one: the app never has to be able to create every
    # name it can serve (the two tiers answer different questions, §3).
    from app.core.media import admission_reason

    assert admission_reason(weird) is not None


def test_the_write_cap_is_a_validated_tunable() -> None:
    """`media.write.max_bytes` is config, not a constant: 15 MB by default (ruling ③), and a
    nonsensical cap is a load error rather than a server that accepts nothing."""
    assert Settings().media.write.max_bytes == 15_728_640
    assert Settings.model_validate({"media": {"write": {"max_bytes": 1}}}).media.write.max_bytes == 1
    with pytest.raises(ValueError):
        Settings.model_validate({"media": {"write": {"max_bytes": 0}}})


# ── ④ the `config_version` 1 → 2 migration ───────────────────────────────────────────────────────

V1_YAML = """server:
  port: 5433
media:
  gacha:
    roles:
      characters:
        order:
        - c.png
        - gone.png
        - a.png
      # the owner's own note, INSIDE the block that moves
      reel:
        order: [cut.png]
    slots:
      wallpaper: kira
  kit:
    roles:
      background:
        order: [neb.png]
# the fleet's own header, OUTSIDE the block that moves
computers:
  alpha:
    ip: 192.168.1.10
"""


def _v1_workspace(tmp_path, monkeypatch) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(V1_YAML, encoding="utf-8")
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    return home


def test_the_fold_moves_the_namespaces_and_rewrites_every_order_list(tmp_path, monkeypatch) -> None:
    home = _v1_workspace(tmp_path, monkeypatch)
    status = cm.detect(cm.context_from_env())
    assert 2 in status.pending
    assert cm.apply(cm.context_from_env()).wrote is True

    doc = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
    assert set(doc["media"]) == {"namespaces"}  # the old top-level namespace keys are GONE
    gacha = doc["media"]["namespaces"]["gacha"]
    assert gacha["roles"]["characters"]["files"] == [
        {"name": "c.png"},
        {"name": "gone.png"},
        {"name": "a.png"},
    ]
    assert "order" not in gacha["roles"]["characters"]
    assert gacha["roles"]["reel"]["files"] == [{"name": "cut.png"}]
    assert gacha["slots"] == {"wallpaper": "kira"}
    assert doc["media"]["namespaces"]["kit"]["roles"]["background"]["files"] == [{"name": "neb.png"}]
    # COMMENT SURVIVAL, stated exactly (UPDATE_PLAN's promise is about keys the plan does not
    # touch): everything outside the moved subtree keeps its prose, while a comment INSIDE
    # `media.<ns>` cannot — that subtree is deleted and rewritten one level down, which is the fold.
    # Recorded rather than fought: the alternative is a ruamel node transplant for two lines of
    # gallery-written config the owner never hand-authors.
    text = (home / "config.yaml").read_text(encoding="utf-8")
    assert "# the fleet's own header" in text
    assert "# the owner's own note" not in text
    # …and the app can read what the migration wrote
    settings = load_settings(home / "config.yaml")
    assert [i.name for i in settings.media_overrides("gacha")[0]["characters"]] == [
        "c.png",
        "gone.png",
        "a.png",
    ]


RETIRED_PIN_YAML = """server:
  port: 5433
media:
  gacha:
    slots:
      reel_figure: cut
"""


def test_a_v1_config_holding_a_RETIRED_pin_refuses_LOUDLY_rather_than_folding_it(
    tmp_path, monkeypatch
) -> None:
    """The 2026-08-26 owner ruling ("W6") retired every POOL pin — gacha's `reel_figure`, frontier's
    `hero`, the kit's `background`/`brand` — because ORDER is the only priority system and each of them
    was a second way to say what the library order already said.

    Removed CLEAN, with no compat rung: media v2 has never shipped to prod, and neither live config on
    disk holds any `slots:` block at all (both verified before the sweep). So a hand-authored leftover
    is an unknown slot key, and the migration REFUSES rather than folding a knob forward that would
    silently do nothing — the same treatment the deleted `wallpaper` ROLE and the retired `hero` seat
    get. The refusal names the key and the keys that are real, which is the whole of what the owner has
    to act on."""
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(RETIRED_PIN_YAML, encoding="utf-8")
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    with pytest.raises(cm.MigrationRefused) as exc:
        cm.apply(cm.context_from_env())
    assert "reel_figure" in str(exc.value)
    assert "wallpaper" in str(exc.value)  # …and it names what IS accepted


def test_the_migration_writes_no_bundled_entries(tmp_path, monkeypatch) -> None:
    """Config-pure BY CONTRACT (a step never touches the filesystem) and bundled-free BY DESIGN: paint
    parity comes from the collation's fallback tier instead, which is what let the server-manifest fix
    be re-derived away (§2.3/§13). A migration that listed bundled ids would need to know what is on
    disk — and would promote five bundled characters into the owner's fleet deal."""
    home = _v1_workspace(tmp_path, monkeypatch)
    cm.apply(cm.context_from_env())
    text = (home / "config.yaml").read_text(encoding="utf-8")
    assert "bundled" not in text
    assert not (home / "media").exists()  # the step never created, read or walked a media tree


def test_the_migration_is_idempotent_and_stamps_the_marker(tmp_path, monkeypatch) -> None:
    home = _v1_workspace(tmp_path, monkeypatch)
    cm.apply(cm.context_from_env())
    before = (home / "config.yaml").read_bytes()
    fresh = cm.context_from_env()
    assert cm.needs_migration(fresh) is False
    assert cm.read_marker(fresh.config) == cm.CONFIG_VERSION == 2
    assert cm.apply(cm.context_from_env()).wrote is False
    assert (home / "config.yaml").read_bytes() == before


def test_an_already_folded_config_with_a_stray_old_key_converges(tmp_path, monkeypatch) -> None:
    """New-wins, the house rule every fold follows: a half-migrated document keeps the FOLDED block
    and still deletes the old key, rather than accreting two homes for one namespace."""
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(
        "server:\n  port: 5433\n"
        "media:\n"
        "  namespaces:\n"
        "    gacha:\n"
        "      roles:\n"
        "        characters:\n"
        "          files:\n"
        "          - name: new.png\n"
        "  gacha:\n"
        "    roles:\n"
        "      characters:\n"
        "        order: [old.png]\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    cm.apply(cm.context_from_env())
    doc = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
    assert set(doc["media"]) == {"namespaces"}
    assert doc["media"]["namespaces"]["gacha"]["roles"]["characters"]["files"] == [{"name": "new.png"}]


def test_a_namespaces_key_of_the_wrong_shape_is_REFUSED_not_overwritten(tmp_path, monkeypatch) -> None:
    """The A11 `providers:` precedent: folding into a scalar would destroy whatever the operator
    actually wrote, and the diff writer would record it as an ordinary authorised change."""
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(
        "media:\n  namespaces: nonsense\n  gacha:\n    roles:\n      reel:\n        order: [a.png]\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    with pytest.raises(cm.MigrationRefused):
        cm.apply(cm.context_from_env())


@pytest.mark.parametrize(
    ("order_yaml", "label"),
    [("order:", "null"), ("order: lyra.png", "a scalar"), ("order: {a: 1}", "a mapping")],
)
def test_a_malformed_order_is_REFUSED_rather_than_folded_into_an_empty_library(
    tmp_path, monkeypatch, order_yaml: str, label: str
) -> None:
    """The A11 refuse-don't-coerce precedent, at the leaf. Popping an unreadable `order:` and writing
    `files: []` would destroy the owner's library — silently, under a "verified" stamp, with the
    migration reporting success. The remedy names the path, because a hand-authored `order: lyra.png`
    is one character from correct."""
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(
        f"server:\n  port: 5433\nmedia:\n  gacha:\n    roles:\n      reel:\n        {order_yaml}\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    with pytest.raises(cm.MigrationRefused) as exc:
        cm.apply(cm.context_from_env())
    assert "media.namespaces.gacha.roles.reel.order" in str(exc.value), label
    # …and NOTHING was written: the owner's file still says what it said.
    assert order_yaml.split(":")[0] in (home / "config.yaml").read_text(encoding="utf-8")


def test_a_malformed_order_beside_an_existing_files_list_is_dropped_not_refused(
    tmp_path, monkeypatch
) -> None:
    """The one exception, and it is new-wins rather than leniency: with `files:` already there the
    unreadable legacy key is genuinely dead, so deleting it is the migration finishing its job."""
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(
        "server:\n  port: 5433\nmedia:\n  namespaces:\n    gacha:\n      roles:\n        reel:\n"
        "          files:\n          - name: cut.png\n          order: 7\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    cm.apply(cm.context_from_env())
    doc = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
    reel = doc["media"]["namespaces"]["gacha"]["roles"]["reel"]
    assert reel == {"files": [{"name": "cut.png"}]}
    assert cm.needs_migration(cm.context_from_env()) is False


def test_an_unknown_namespace_key_is_left_where_the_owner_wrote_it(tmp_path, monkeypatch) -> None:
    """The step moves only KNOWN namespaces. A typo'd `media.gachaa` is not a namespace this build can
    name, so guessing a home for it would be worse than leaving it visible and inert (the `themes:`
    leftover precedent) — and it must not keep the step applying forever either."""
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(
        "server:\n  port: 5433\nmedia:\n  gachaa:\n    roles: {}\n"
        "  gacha:\n    roles:\n      reel:\n        order: [a.png]\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    cm.apply(cm.context_from_env())
    doc = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
    assert doc["media"]["gachaa"] == {"roles": {}}
    assert doc["media"]["namespaces"]["gacha"]["roles"]["reel"]["files"] == [{"name": "a.png"}]
    assert cm.needs_migration(cm.context_from_env()) is False


def test_a_config_with_no_media_block_is_untouched(tmp_path, monkeypatch) -> None:
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(_SEED, encoding="utf-8")
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    assert 2 not in cm.detect(cm.context_from_env()).pending


# ── the parity proof: a populated v1 config lists exactly what it listed before ───────────────────


def _v1_rule(order: list[str], on_disk: list[str]) -> list[str]:
    """The v1 collation, stated INDEPENDENTLY of the code under test: the owner's order (names still
    present), then everything else by `sort_key`. Written out here so the parity claim is checked
    against the rule the owner had, not against the implementation that replaced it."""
    rest = sorted(set(on_disk) - set(order), key=sort_key)
    return [n for n in order if n in on_disk] + rest


def test_a_populated_v1_config_round_trips_to_the_SAME_listing(tmp_path, monkeypatch) -> None:
    """Paint parity holds BY CONSTRUCTION (the fallback tier is today's semantics) — this is the test
    that proves it. Two roles, and the second is the all-unusable arm (the incidental catch of council
    round 2): a role whose every file is broken must come out in the same positions as before, because
    `unusable` HOLDS its position and the fold must not have quietly changed that.
    """
    home = tmp_path / "home"
    (home / "media" / "gacha" / "characters").mkdir(parents=True)
    (home / "media" / "gacha" / "reel").mkdir(parents=True)
    chars = ["c.png", "a.png", "10.png", "2.png"]
    for name in chars:
        (home / "media" / "gacha" / "characters" / name).write_bytes(png_bytes())
    broken = ["x.png", "y.png"]
    for name in broken:
        (home / "media" / "gacha" / "reel" / name).write_bytes(b"\x89PNG\r\n\x1a\n")
    (home / "config.yaml").write_text(
        "server:\n  port: 5433\nmedia:\n  gacha:\n    roles:\n"
        "      characters:\n        order: [c.png, gone.png, a.png]\n"
        "      reel:\n        order: [y.png, x.png]\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.setenv("CTRLB_CONFIG", str(home / "config.yaml"))
    monkeypatch.setenv("CTRLB_DB", str(home / "t.db"))

    cm.apply(cm.context_from_env())
    with make_client() as c:
        body = c.get("/api/media/gacha").json()

    assert disk(body["roles"]["characters"]) == _v1_rule(["c.png", "gone.png", "a.png"], chars)
    assert disk(body["roles"]["reel"]) == _v1_rule(["y.png", "x.png"], broken)
    assert [f["unusable"] for f in body["roles"]["reel"] if f["bundled"] is None] == [True, True]
    # Everything the fold ADDED is the fallback tier, and it is unlisted — i.e. it participates in
    # resolution exactly where bundled art already did, which is the whole parity argument.
    for rows in body["roles"].values():
        assert all(not f["listed"] for f in rows if f["bundled"] is not None)
