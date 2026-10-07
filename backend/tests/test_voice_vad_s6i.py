"""Phase 26 S6-i — the VAD engine (`services/voice_vad.py`; ASR_PLAN §3.4 + §3.4.1).

What the arms pin:

* **the policy** against the HAND-AUTHORED golden vectors in `vad_vectors.py` (R94 §9's VAD-1…10, the
  plan's additions, two at a 10 ms hop), plus two invariants applied to every vector — any split of the
  probabilities across `step` calls gives the same edges (VAD-5 "state persists"), and the edges are
  structurally coherent (VAD-10);
* `derive()` at 32 ms and 10 ms (⌈x_ms/hop_ms⌉ exact, τ → α) and `deact_of`'s floor;
* **the segmenter** against its own vectors through a scripted fake model — both hop conventions at 32
  and 10 ms, the residual (no sample dropped, frames == one block), the native-rate mapping across a
  DROPPED frame, the pre-roll clamp, the flush pad + clamp;
* **the registry invariant** (§3.4.1 ⑤), the per-model **conformance** ×2 (⑥: the recorded reference
  within 1e-5, chunk invariance bit-exact, `len == n//hop`, the sha256, the first second of a leg), the
  ORT options (council 14);
* the import-blocked boot (ruling H1) and the `vad_model` config key.
"""

from __future__ import annotations

import hashlib
import math
import subprocess
import sys
import threading
import time
import wave
from pathlib import Path
from typing import Any, get_args

import numpy as np
import pytest
from pydantic import ValidationError
from vad_vectors import (
    CONFORMANCE_PROBS,
    FIRST_SECOND_ZERO_PROBS,
    P32_EMA,
    POLICY_VECTORS,
    SEGMENTER_VECTORS,
    expand,
)

from app.config import LiveCfg, VadModelName
from app.services.voice_audio import float32_to_pcm16, pcm16_to_float32
from app.services.voice_vad import (
    ASSETS_DIR,
    EMA_TAU_MS,
    VAD_MODELS,
    Edge,
    PolicyState,
    StampedFrame,
    VadParams,
    VadSegmenter,
    deact_of,
    derive,
    flush,
    get_model,
    step,
)

BACKEND = Path(__file__).resolve().parents[1]
FIXTURE = BACKEND / "tests" / "data" / "silero_test_3s.wav"
#: The vendored files' digests, pinned HERE independently of the classes (§3.4 "SHA-256 test-pinned").
PINNED_SHA256 = {
    "silero-v6.2": "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3",
    "silero-v5.1.2": "2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f",
}


def _row(edge: Edge, *, leg: bool = False) -> tuple[Any, ...]:
    head: tuple[Any, ...] = (edge.kind, edge.model_sample)
    if leg:
        head += (edge.leg_sample,)
    if edge.kind == "stop":
        assert edge.max_p is not None
        head += (edge.reason, round(edge.max_p, 6))
    return head


def _run_policy(vector: dict[str, Any], chunks: list[int] | None = None) -> list[tuple[Any, ...]]:
    counts = derive(VadParams(**vector["params"]), vector.get("hop", 512), 16000)
    probs = expand(vector["probs"])
    state = PolicyState()
    edges: list[Edge] = []
    i = 0
    sizes = iter(chunks or [len(probs)])
    while i < len(probs):
        n = next(sizes, len(probs) - i)
        state, out = step(state, counts, probs[i : i + n], vector.get("first_index", 0) + i)
        edges += out
        i += n
    if vector.get("flush"):
        state, out = flush(state, counts)
        edges += out
    return [_row(e) for e in edges]


# ═══════════════════════════════ the policy ═══════════════════════════════


@pytest.mark.parametrize("vector", POLICY_VECTORS, ids=[v["name"] for v in POLICY_VECTORS])
def test_policy_matches_the_hand_authored_vector(vector: dict[str, Any]) -> None:
    assert _run_policy(vector) == [tuple(e) for e in vector["expected"]]


@pytest.mark.parametrize("vector", POLICY_VECTORS, ids=[v["name"] for v in POLICY_VECTORS])
def test_state_persists_across_any_split_vad5(vector: dict[str, Any]) -> None:
    whole = _run_policy(vector)
    for size in (1, 3, 7, 64):
        n = len(expand(vector["probs"]))
        assert _run_policy(vector, [size] * (n // size + 1)) == whole, size


@pytest.mark.parametrize("vector", POLICY_VECTORS, ids=[v["name"] for v in POLICY_VECTORS])
def test_edges_are_coherent_vad10(vector: dict[str, Any]) -> None:
    """Starts and stops strictly alternate; a confirm only inside an open segment, at most once; every
    stop carries a reason and a max p; nothing but a START (whose pre-roll reaches back) moves backwards."""
    edges = _run_policy(vector)
    open_seg = confirmed = False
    last = -math.inf
    for row in edges:
        kind, m = row[0], row[1]
        if kind == "start":
            assert not open_seg
            open_seg, confirmed = True, False
        else:
            assert open_seg
            assert m >= last
            last = m
            if kind == "confirm":
                assert not confirmed
                confirmed = True
            else:
                assert row[2] in ("endpoint", "flush", "max_segment", "short")
                assert row[2] != "short" or not confirmed  # a retraction is never confirmed
                open_seg = False


def test_ema_hovers_keep_their_bounds() -> None:
    """The two 5 s hovers WITH the default EMA (the property, not hand-computed edges): at most one
    retraction near deact, at most one start/retraction pair near act."""
    for runs in (
        [(0.1, 20), (0.9, 3)] + [(0.40, 1), (0.50, 1)] * 78,
        [(0.1, 20)] + [(0.65, 1), (0.55, 1)] * 78,
    ):
        vector = {"params": P32_EMA, "probs": runs + [(0.1, 10)]}
        rows = _run_policy(vector)
        assert sum(r[0] == "start" for r in rows) <= 1, rows
        assert [r[2] for r in rows if r[0] == "stop"] in ([], ["short"]), rows


def test_derive_at_32ms_and_10ms() -> None:
    params = VadParams(act=0.6, onset_ms=200, silence_ms=700, prefix_padding_ms=500, max_segment_s=20)
    c = derive(params, 512, 16000)
    assert (c.k_onset, c.k_rearm, c.age_bound, c.k_end, c.max_hops, c.cut_span, c.preroll) == (
        7, 7, 13, 22, 625, 32, 8000,
    )  # fmt: skip
    assert c.alpha == pytest.approx(0.35, abs=1e-12)
    assert c.deact == pytest.approx(0.45)
    c10 = derive(params, 160, 16000)
    assert (c10.k_onset, c10.k_rearm, c10.age_bound, c10.k_end, c10.max_hops, c10.cut_span) == (
        20, 20, 40, 70, 2000, 100,
    )  # fmt: skip
    assert c10.preroll == 8000  # the pre-roll is in samples, independent of the hop
    assert c10.alpha == pytest.approx(0.35 ** (10 / 32), abs=1e-12)
    assert c10.alpha == pytest.approx(0.7203, abs=1e-4)
    assert EMA_TAU_MS == pytest.approx(30.48, abs=0.01)
    raw = derive(VadParams(0.6, 200, 700, 500, 20, ema_tau_ms=0), 512, 16000)
    assert raw.alpha == 0.0
    dictation = derive(VadParams(0.6, 0, 700, 300, 20), 512, 16000)
    assert (dictation.k_onset, dictation.age_bound, dictation.preroll) == (0, 0, 4800)


def test_deact_is_act_minus_the_gap_with_a_floor() -> None:
    assert deact_of(0.6) == pytest.approx(0.45)
    assert deact_of(0.5) == pytest.approx(0.35)
    assert deact_of(0.19) == 0.05
    assert deact_of(0.1) == 0.05


def test_step_refuses_a_gap_in_the_hop_index() -> None:
    counts = derive(VadParams(0.6, 200, 700, 500, 20), 512, 16000)
    state, _ = step(PolicyState(), counts, [0.1, 0.1], 0)
    with pytest.raises(ValueError):
        step(state, counts, [0.1], 5)


# ═══════════════════════════════ the segmenter ═══════════════════════════════


class _FakeStream:
    def __init__(self, model: _FakeModel) -> None:
        self._model = model

    def probs(self, pcm: np.ndarray) -> np.ndarray:
        assert len(pcm) % self._model.hop == 0
        n = len(pcm) // self._model.hop
        self._model.received += len(pcm)
        out = self._model.script[self._model.cursor : self._model.cursor + n]
        assert len(out) == n, "the scripted model ran out of probabilities"
        self._model.cursor += n
        return np.asarray(out, dtype=np.float32)


class _FakeModel:
    """A scripted `VadModel`: emits the given per-hop probabilities in order, counts the samples it saw."""

    name = "fake"
    sample_rate = 16000
    delay_hops = 0
    default_act = 0.6
    prepass_act = 0.5
    sha256 = ""
    asset = ""

    def __init__(self, hop: int, script: list[float]) -> None:
        self.hop = hop
        self.script = script
        self.cursor = 0
        self.received = 0

    def open(self) -> _FakeStream:
        return _FakeStream(self)


def _frames(spec: dict[str, Any], total16: int, block: bool = False) -> list[StampedFrame]:
    audio = float32_to_pcm16(np.zeros(total16, dtype=np.float32))
    if block:
        return [StampedFrame(0, total16 * spec["rate"] // 16000, audio)]
    frames: list[StampedFrame] = []
    step16, client = spec["frame16"], spec["client"]
    lost = 0
    for i, at in enumerate(range(0, total16, step16)):
        chunk = audio[2 * at : 2 * min(at + step16, total16)]
        frames.append(StampedFrame((i + lost) * client, client * (len(chunk) // 2) // step16, chunk))
        if i in spec["drop"]:
            lost += 1
    return frames


def _segment(vector: dict[str, Any], block: bool = False) -> tuple[list[tuple[Any, ...]], _FakeModel]:
    model = _FakeModel(vector["hop"], expand(vector["script"]))
    seg = VadSegmenter(model, VadParams(**vector["params"]), vector["frames"]["rate"])
    edges: list[Edge] = []
    for frame in _frames(vector["frames"], vector["total16"], block):
        edges += seg.feed(frame)
    if vector.get("flush"):
        edges += seg.flush()
    return [_row(e, leg=True) for e in edges], model


@pytest.mark.parametrize("vector", SEGMENTER_VECTORS, ids=[v["name"] for v in SEGMENTER_VECTORS])
def test_segmenter_matches_the_hand_authored_vector(vector: dict[str, Any]) -> None:
    rows, _ = _segment(vector)
    assert rows == [tuple(e) for e in vector["expected"]]


def test_the_residual_drops_nothing_and_frames_equal_one_block() -> None:
    vector = next(v for v in SEGMENTER_VECTORS if v["name"] == "seg_conventions_32ms")
    framed, m1 = _segment(vector)
    whole, m2 = _segment(vector, block=True)
    assert framed == whole
    assert m1.received == m2.received == vector["total16"]
    # 40 ms frames are 1.25 hops: a leftover is HELD (not dropped) until the next frame or the flush.
    odd = {**vector, "total16": vector["total16"] + 300, "script": [*vector["script"], (0.1, 1)]}
    rows, model = _segment(odd)
    assert model.received == vector["total16"]  # the 300 wait…
    model = _FakeModel(512, expand(odd["script"]))
    seg = VadSegmenter(model, VadParams(**odd["params"]), 16000)
    for frame in _frames(odd["frames"], odd["total16"]):
        seg.feed(frame)
    seg.flush()
    assert model.received == vector["total16"] + 512  # …and are judged, zero-padded to a hop, at the flush


def test_a_segmenter_ends_at_its_flush() -> None:
    seg = VadSegmenter(_FakeModel(512, [0.1] * 4), VadParams(0.6, 200, 700, 500, 20), 16000)
    seg.feed(StampedFrame(0, 640, bytes(1280)))
    assert seg.flush() == []
    assert seg.flush() == []
    with pytest.raises(RuntimeError):
        seg.feed(StampedFrame(640, 640, bytes(1280)))


def test_the_anchors_reach_back_far_enough_and_no_further() -> None:
    """§3.4.1 ②: anchors cover max(prefix_padding_ms, 1000 ms) + hop of model audio behind the cursor."""
    seg = VadSegmenter(_FakeModel(512, [0.1] * 400), VadParams(0.6, 200, 700, 500, 20), 16000)
    for i in range(300):
        seg.feed(StampedFrame(i * 640, 640, bytes(1280)))
    processed = seg._state.next_index * 512  # type: ignore[operator]
    oldest = seg._anchors[0]
    assert oldest.m_start <= processed - (16000 + 512) < oldest.m_start + oldest.m_len
    assert len(seg._anchors) <= (16000 + 512) // 640 + 2


def test_a_delayed_model_is_refused_until_its_drain_exists() -> None:
    model = _FakeModel(512, [])
    model.delay_hops = 1  # type: ignore[misc]
    with pytest.raises(NotImplementedError):
        VadSegmenter(model, VadParams(0.6, 200, 700, 500, 20), 16000)


# ═══════════════════════════════ the registry + the models ═══════════════════════════════


def test_the_registry_invariant() -> None:
    """§3.4.1 ⑤ — the Literal's keys ARE the registry's, and every entry is causal within 32 ms. Read off
    the classes: no session is built (ruling H3)."""
    assert set(get_args(VadModelName)) == set(VAD_MODELS)
    for key, cls in VAD_MODELS.items():
        assert cls.name == key
        assert cls.delay_hops * cls.hop * 1000 / cls.sample_rate <= 32
        assert cls.sample_rate == 16000
        assert 0 < cls.prepass_act < 1 and 0 < cls.default_act < 1
        assert (ASSETS_DIR / cls.asset).is_file()


@pytest.mark.parametrize("name", sorted(PINNED_SHA256))
def test_the_vendored_file_is_the_pinned_one(name: str) -> None:
    cls = VAD_MODELS[name]
    digest = hashlib.sha256((ASSETS_DIR / cls.asset).read_bytes()).hexdigest()
    assert digest == PINNED_SHA256[name] == cls.sha256


@pytest.mark.parametrize("name", sorted(PINNED_SHA256))
def test_the_ort_session_options(name: str) -> None:
    """Council 14: one intra-op thread, one inter-op thread, no spinning, CPU only — read back off the
    built session."""
    session = get_model(name).session  # type: ignore[attr-defined]
    options = session.get_session_options()
    assert options.intra_op_num_threads == 1
    assert options.inter_op_num_threads == 1
    assert options.get_session_config_entry("session.intra_op.allow_spinning") == "0"
    assert session.get_providers() == ["CPUExecutionProvider"]


def test_get_model_is_one_per_process() -> None:
    assert get_model("silero-v6.2") is get_model("silero-v6.2")
    assert get_model("silero-v6.2") is not get_model("silero-v5.1.2")


def test_get_model_builds_once_under_a_cold_race(monkeypatch: pytest.MonkeyPatch) -> None:
    """Two threads on a cold cache (the `vad` executor + a pre-pass `to_thread`) share ONE build."""
    from app.services import voice_vad

    built: list[object] = []

    class _Slow:
        def __init__(self) -> None:
            time.sleep(0.05)
            built.append(self)

    monkeypatch.setitem(voice_vad.VAD_MODELS, "slow", _Slow)  # type: ignore[arg-type]
    monkeypatch.delitem(voice_vad._MODELS, "slow", raising=False)
    got: list[object] = []
    threads = [threading.Thread(target=lambda: got.append(get_model("slow"))) for _ in range(2)]  # type: ignore[arg-type]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    voice_vad._MODELS.pop("slow", None)  # type: ignore[call-overload]
    assert len(built) == 1 and got[0] is got[1] is built[0]


def test_derive_is_exact_for_decimal_ms() -> None:
    """`max_segment_s = 16.1` at a 10 ms hop is ⌈16100/10⌉ = 1610 hops (the binary float gave 1611)."""
    assert derive(VadParams(0.6, 200, 700, 500, 16.1), 160, 16000).max_hops == 1610
    assert derive(VadParams(0.6, 200, 700, 500, 64.4), 256, 16000).max_hops == 4025


def test_derive_refuses_a_cap_too_short_for_the_cut() -> None:
    """`max_hops > age_bound + cut_span + 1` or the cut could land before the confirm (S7b's 5–20 s bounds
    keep this unreachable from Conf). 32 ms, onset 200: age_bound 13 + 32 + 1 = 46 → a 46-hop cap
    (1.472 s) is refused, 47 (1.504 s) is not.

    Wave 1.5 (Opus's refusing case): onset 500 (k_onset 16, age_bound ⌈1000/32⌉ = 32) with a 2 s cap (63
    hops) passed the old `k_onset + cut_span` guard (63 > 48), and probs
    `[0.1]*20 + [0.9] + [0.5]*15 + [0.9]*16 + [0.95]*40 + [0.1]*40` then gave confirm 26624 followed by a
    max_segment stop at 26112 — before it. 63 ≤ 32 + 32 + 1 = 65 now refuses those params."""
    with pytest.raises(ValueError):
        derive(VadParams(0.6, 200, 700, 500, 1.472), 512, 16000)
    assert derive(VadParams(0.6, 200, 700, 500, 1.504), 512, 16000).max_hops == 47
    with pytest.raises(ValueError):
        derive(VadParams(0.6, 500, 700, 500, 2), 512, 16000)


def _fixture() -> np.ndarray:
    with wave.open(str(FIXTURE), "rb") as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()) == (1, 2, 16000, 48000)
        return pcm16_to_float32(w.readframes(w.getnframes()))


@pytest.mark.parametrize("name", sorted(PINNED_SHA256))
def test_conformance_against_the_recorded_reference(name: str) -> None:
    """§3.4.1 ⑥ — the adapter, state carried hop to hop, against probabilities recorded ONCE by R98's
    independent loop (`vad_vectors.CONFORMANCE_PROBS`), within 1e-5."""
    pcm = _fixture()
    model = get_model(name)
    n = len(pcm) // model.hop
    out = model.open().probs(pcm[: n * model.hop])
    assert len(out) == n == len(CONFORMANCE_PROBS[name]) == 93
    assert out.dtype == np.float32
    np.testing.assert_allclose(out, CONFORMANCE_PROBS[name], rtol=0, atol=1e-5)


@pytest.mark.parametrize("name", sorted(PINNED_SHA256))
def test_conformance_chunk_invariance_and_length(name: str) -> None:
    """40 ms frames through the hop helper == one block, bit-exact; `len(out) == len(pcm) // hop`;
    a length that is not a whole number of hops is refused."""
    from app.services.voice_audio import HopBuffer

    pcm = _fixture()
    model = get_model(name)
    whole = model.open().probs(pcm[: len(pcm) // model.hop * model.hop])
    stream, hops, parts = model.open(), HopBuffer(model.hop), []
    for at in range(0, len(pcm), 640):
        block = hops.push(pcm[at : at + 640])
        if len(block):
            parts.append(stream.probs(block))
    assert np.array_equal(np.concatenate(parts), whole)
    with pytest.raises(ValueError):
        model.open().probs(pcm[:700])


@pytest.mark.parametrize("name", sorted(PINNED_SHA256))
def test_conformance_the_first_second_of_a_leg(name: str) -> None:
    """Warm-up is a model fact: Silero has no "not ready" state — its first second of silence is 31 real
    probabilities, equal (1e-5) to the ones R98's independent loop recorded on zero input."""
    model = get_model(name)
    out = model.open().probs(np.zeros(31 * model.hop, dtype=np.float32))
    assert len(out) == 31 == len(FIRST_SECOND_ZERO_PROBS[name])
    np.testing.assert_allclose(out, FIRST_SECOND_ZERO_PROBS[name], rtol=0, atol=1e-5)


# ═══════════════════════════════ boot + config ═══════════════════════════════


def test_the_app_boots_without_the_voice_extra() -> None:
    """Ruling H1: nothing `app.main` reaches imports numpy/onnxruntime/av at import time, and the three
    ear modules import cleanly without them — so a wheel-less install (Termux) still boots."""
    code = (
        "import sys\n"
        "for name in ('numpy', 'onnxruntime', 'av'):\n"
        "    sys.modules[name] = None\n"
        "import app.main, app.services.voice_audio, app.services.voice_vad, app.services.voice_prepass\n"
        "leaked = [m for m in sys.modules if m.split('.')[0] in ('numpy', 'onnxruntime', 'av')\n"
        "          and sys.modules[m] is not None]\n"
        "assert not leaked, leaked\n"
    )
    done = subprocess.run(
        [sys.executable, "-c", code], cwd=BACKEND, capture_output=True, text=True, timeout=120
    )
    assert done.returncode == 0, done.stderr[-2000:]


def test_vad_model_is_a_closed_config_key() -> None:
    assert LiveCfg().vad_model == "silero-v6.2"
    assert LiveCfg.model_validate({"vad_model": "silero-v5.1.2"}).vad_model == "silero-v5.1.2"
    with pytest.raises(ValidationError):
        LiveCfg.model_validate({"vad_model": "silero-v4"})
