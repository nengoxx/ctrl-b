"""Config migration step 4 — D76's live-call fold (`config_version` 3 → 4; LIVE_VOICE_PLAN §7, the D76
block, §E).

Over `voice.live` when present:

* `route`: `speaker → call` · `speaker-hifi → media` · `headphones → media`; any other value untouched.
* `echo_workaround` → `mic_hold` (value carried, old key deleted); both present ⇒ `mic_hold` wins.
* `vad_threshold`: exactly `0.9` (the shipped default R84 condemned) → `0.6`; any other value clamped
  into [0.5, 0.8]; absent stays absent.
* `silence_ms`: clamped into [500, 1200]; absent stays absent.

The pure arms drive `applies`/`apply` over a hand-built `Context`; the runner arms go through
`cm.apply` on a temp `$CTRLB_HOME` (never the real config) and prove the write-back deletes the old
key, the marker is stamped, a second run writes nothing, and the app loads what landed.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml

from app import config_migration as cm
from app.config import CONFIG_VERSION_KEY, load_settings
from app.config_migration import Context
from app.config_migration.steps import LIVE_VOICE_D76, live_voice_applies, live_voice_apply


def _ctx(live: dict[str, Any] | None, **top: Any) -> Context:
    config: dict[str, Any] = dict(top)
    if live is not None:
        config["voice"] = {"live": live}
    return Context(
        config_path=Path("/nonexistent/config.yaml"), agents_dir=Path("/nonexistent"), config=config
    )


def _fold(live: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, ...]]]:
    plan = live_voice_apply(_ctx(live))
    return plan.config["voice"]["live"], [tuple(c) for c in plan.consumes]


# ── the pure step ────────────────────────────────────────────────────────────────────────────────


def test_the_step_is_version_4_and_the_last_in_the_chain() -> None:
    assert LIVE_VOICE_D76.version == 4 and cm.STEPS[-1] is LIVE_VOICE_D76
    assert cm.CONFIG_VERSION == 4
    # `voice.live.*` is two levels deep — beyond the one-level env grammar — so nothing is retired.
    assert LIVE_VOICE_D76.retires == ()


@pytest.mark.parametrize(
    ("old", "new"), [("speaker", "call"), ("speaker-hifi", "media"), ("headphones", "media")]
)
def test_each_old_route_folds_onto_the_media_call_axis(old: str, new: str) -> None:
    assert live_voice_applies(_ctx({"route": old})) is True
    live, consumed = _fold({"route": old, "input_device": "dev-1"})
    assert live == {"route": new, "input_device": "dev-1"}
    assert consumed == []  # a value change, not a removal


@pytest.mark.parametrize("route", ["media", "call", "earpiece", 3, None])
def test_a_route_the_fold_does_not_know_is_left_as_written(route: Any) -> None:
    """New values are already folded; an unknown spelling is validation's to report, not ours to guess."""
    assert live_voice_applies(_ctx({"route": route})) is False


@pytest.mark.parametrize("value", ["auto", "on", "off"])
def test_echo_workaround_is_renamed_to_mic_hold_with_its_value(value: str) -> None:
    live, consumed = _fold({"echo_workaround": value, "barge_in": True})
    assert live == {"mic_hold": value, "barge_in": True}
    assert consumed == [("voice", "live", "echo_workaround")]


def test_when_both_hold_keys_exist_mic_hold_wins_and_the_old_one_is_dropped() -> None:
    """New-wins, the house rule every fold follows — a half-migrated file converges."""
    live, consumed = _fold({"echo_workaround": "on", "mic_hold": "off"})
    assert live == {"mic_hold": "off"}
    assert consumed == [("voice", "live", "echo_workaround")]


def test_a_legacy_hold_key_in_any_shape_triggers_the_step() -> None:
    """The postcondition IS `applies`: a key this step strips but did not trigger on would survive."""
    assert live_voice_applies(_ctx({"echo_workaround": None})) is True
    live, _ = _fold({"echo_workaround": None})
    assert live == {"mic_hold": None}  # carried verbatim — validation reports a bad value, not us


def test_the_shipped_0_9_threshold_maps_to_the_new_default_not_the_ceiling() -> None:
    live, _ = _fold({"vad_threshold": 0.9})
    assert live == {"vad_threshold": 0.6}


@pytest.mark.parametrize(
    ("stored", "folded"),
    [
        (0.3, 0.5),  # under the floor
        (0, 0.5),  # an int zero is a number too
        (0.95, 0.8),  # over the ceiling, and not the shipped 0.9
        (1, 0.8),  # an int one clamps to a FLOAT ceiling, never truncates to 0
    ],
)
def test_any_other_out_of_bounds_threshold_is_clamped(stored: float, folded: float) -> None:
    live, _ = _fold({"vad_threshold": stored})
    assert live == {"vad_threshold": folded}
    assert type(live["vad_threshold"]) is float


@pytest.mark.parametrize(("stored", "folded"), [(100, 500), (499, 500), (1201, 1200), (5000, 1200)])
def test_silence_ms_is_clamped_both_sides(stored: int, folded: int) -> None:
    live, _ = _fold({"silence_ms": stored})
    assert live == {"silence_ms": folded}


@pytest.mark.parametrize(
    "live",
    [
        {"vad_threshold": 0.5},
        {"vad_threshold": 0.8},
        {"vad_threshold": 0.65},
        {"silence_ms": 500},
        {"silence_ms": 1200},
        {"silence_ms": 700},
        # not a number ⇒ not ours to coerce; validation rejects it as it would have yesterday
        {"vad_threshold": "high"},
        {"vad_threshold": True},
        {"silence_ms": "long"},
    ],
)
def test_in_bounds_or_non_numeric_values_do_not_trigger(live: dict[str, Any]) -> None:
    assert live_voice_applies(_ctx(live)) is False


def test_absent_keys_stay_absent() -> None:
    """The new defaults reach an unset key through the model, not by being written into the file."""
    live, _ = _fold({"route": "speaker"})
    assert set(live) == {"route"}


def test_the_barge_threshold_and_every_other_knob_ride_through_untouched() -> None:
    """S0a folds only the four named keys; `barge_threshold` stays (D76 S0b deletes it with the
    linear floor), and every neighbour is carried byte-for-byte."""
    others = {
        "barge_threshold": 0.06,
        "min_final_ms": 200,
        "debug": True,
        "frame_ms": 40,
        "input_device": "x",
    }
    live, _ = _fold({"route": "headphones", **others})
    assert live == {"route": "media", **others}


@pytest.mark.parametrize(
    "config",
    [
        {},
        {"voice": None},
        {"voice": {"stt": {"language": "en"}}},
        {"voice": {"live": None}},
        {"voice": {"live": "on"}},
        {"voice": {"live": {}}},
        {"voice": {"live": {"route": "media", "mic_hold": "auto", "vad_threshold": 0.6, "silence_ms": 700}}},
    ],
)
def test_nothing_to_fold_does_not_apply(config: dict[str, Any]) -> None:
    assert live_voice_applies(Context(config_path=Path("/x"), agents_dir=Path("/x"), config=config)) is False


def test_the_fold_is_idempotent_over_its_own_output() -> None:
    ctx = _ctx({"route": "speaker", "echo_workaround": "on", "vad_threshold": 0.9, "silence_ms": 100})
    once = live_voice_apply(ctx).config
    assert once["voice"]["live"] == {
        "route": "call",
        "mic_hold": "on",
        "vad_threshold": 0.6,
        "silence_ms": 500,
    }
    again = Context(config_path=ctx.config_path, agents_dir=ctx.agents_dir, config=once)
    assert live_voice_applies(again) is False


def test_apply_never_mutates_its_input() -> None:
    """A step must not touch `ctx.config`, or the runner's diff would compare a document to itself."""
    ctx = _ctx({"route": "speaker", "echo_workaround": "on"})
    live_voice_apply(ctx)
    assert ctx.config["voice"]["live"] == {"route": "speaker", "echo_workaround": "on"}


# ── through the runner ───────────────────────────────────────────────────────────────────────────

V3_YAML = """config_version: 3
server:
  port: 5433
voice:
  live:
    enabled: true
    # the owner's own note inside the live block
    route: speaker-hifi
    echo_workaround: "on"
    vad_threshold: 0.9
    silence_ms: 300
    barge_threshold: 0.06
"""


def _workspace(tmp_path: Path, monkeypatch, text: str) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(text, encoding="utf-8")
    monkeypatch.setenv("CTRLB_HOME", str(home))
    monkeypatch.delenv("CTRLB_CONFIG", raising=False)
    return home


def test_the_runner_folds_writes_back_and_the_app_loads_it(tmp_path, monkeypatch) -> None:
    home = _workspace(tmp_path, monkeypatch, V3_YAML)
    status = cm.detect(cm.context_from_env())
    assert status.pending == (4,) and status.legacy_keys == ("voice.live.echo_workaround",)
    assert cm.apply(cm.context_from_env()).wrote is True

    text = (home / "config.yaml").read_text(encoding="utf-8")
    doc = yaml.safe_load(text)
    assert doc["voice"]["live"] == {
        "enabled": True,
        "route": "media",
        "mic_hold": "on",
        "vad_threshold": 0.6,
        "silence_ms": 500,
        "barge_threshold": 0.06,
    }
    assert "echo_workaround" not in text  # the write-back DELETES the old key (no legacy seams)
    assert "# the owner's own note" in text
    assert doc[CONFIG_VERSION_KEY] == 4
    live = load_settings(home / "config.yaml").voice.live
    assert (live.route, live.mic_hold, live.vad_threshold, live.silence_ms) == ("media", "on", 0.6, 500)


def test_the_runner_is_idempotent_and_stamps_the_marker(tmp_path, monkeypatch) -> None:
    home = _workspace(tmp_path, monkeypatch, V3_YAML)
    cm.apply(cm.context_from_env())
    before = (home / "config.yaml").read_bytes()
    fresh = cm.context_from_env()
    assert cm.needs_migration(fresh) is False
    assert cm.read_marker(fresh.config) == cm.CONFIG_VERSION == 4
    assert cm.apply(cm.context_from_env()).wrote is False
    assert (home / "config.yaml").read_bytes() == before


def test_a_v3_config_without_voice_live_only_gets_the_stamp(tmp_path, monkeypatch) -> None:
    home = _workspace(tmp_path, monkeypatch, "config_version: 3\nserver:\n  port: 5433\n")
    assert cm.detect(cm.context_from_env()).pending == ()
    cm.apply(cm.context_from_env())
    doc = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
    assert doc == {CONFIG_VERSION_KEY: 4, "server": {"port": 5433}}
