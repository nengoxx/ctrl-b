"""The relay-owned streaming VAD (Phase 26 / D82, ASR_PLAN §3.4 + the §3.4.1 boundary; S6-i).

Three layers, each replaceable without touching the others (§3.4.1 — the peer-converged shape: Strategy
behind one small Adapter per model, plus a plain dict):

* **The model** — `VadModel` / `VadStream` protocols, the Silero adapter (v6.2 default, v5.1.2 the
  replay A/B) and `VAD_MODELS`, keyed by `config.VadModelName`. A model turns 16 kHz float32 into one
  P(speech) per hop and nothing else; `get_model(name)` is the ONE ORT session per model per process.
* **The policy** — `VadParams` (milliseconds) → `derive()` → `Counts` (hops, once per leg), and the PURE
  `step(state, counts, probs, first_index) -> (state, edges)` implementing the §3.4 band + rule tables as
  ruled in session 64 (H13). It knows hops and 16 kHz model samples, never frames or the leg clock.
* **The segmenter** — `VadSegmenter`, the ONE model-agnostic owner of the frame↔hop mismatch (the
  residual, via `voice_audio.HopBuffer`) and of the 16 kHz cursor → leg-clock mapping. `Segmenter` is the
  seam downstream code sees (a later bool-only `EdgeSegmenter` slots in beside it, R95 §8).

Nothing here is wired into the relay yet (S6-i: "No relay or route change"); S6-ii stamps frames, S7b
flips the ear onto it, and `tools/vad_replay.py` (S6-ii) imports these symbols rather than re-implementing
them. **Import-safe (ruling H1):** numpy/onnxruntime are imported inside functions; model construction
reads a 2.3 MB file and builds a session — sync work, never inside `async def` (the SYS-16 invariant).
"""

from __future__ import annotations

import math
import threading
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from fractions import Fraction
from pathlib import Path
from typing import TYPE_CHECKING, Literal, Protocol

from app.config import VadModelName
from app.services.voice_audio import MODEL_RATE, HopBuffer, pcm16_to_float32

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray

#: Where the vendored model files live (provenance + licence in its README).
ASSETS_DIR = Path(__file__).resolve().parents[1] / "assets" / "silero"

# ── the policy's named constants (each from the plan; none is a config key) ──
#: The EMA's time constant, ms: LiveKit's α = 0.35 IS per 32 ms, so τ = 32 / ln(1/0.35) ≈ 30.48 keeps the
#: same smoothing in TIME at any hop (§3.4.1 ③; R97 P-5b). `ema_tau_ms = 0` ⇒ raw (the replay variant).
EMA_TAU_MS = 32 / math.log(1 / 0.35)
#: The hysteresis gap and its floor: `deact = act − 0.15`, clamped `≥ 0.05` — the LiveKit/Silero
#: constant; a per-model gap is a seam no registered model needs (§3.4.1 ④, R24).
HYSTERESIS_GAP = 0.15
DEACT_FLOOR = 0.05
#: The max_segment cut looks for its lowest hop in the last second (§3.4 Max segment rule, Q4/R20).
CUT_WINDOW_MS = 1000
#: An unconfirmed onset retracts after `2·onset_ms` (§3.4 Retraction rule — the bound on how long a
#: rejected transient can hold the mouth).
AGE_BOUND_FACTOR = 2
#: The Silero adapter's fixed IO (upstream `OnnxWrapper`; R98 `models_lib.py`): 64 context samples ride
#: in front of every 512-sample hop, and the recurrent state is [2, 1, 128].
_SILERO_CONTEXT = 64
_SILERO_STATE_SHAPE = (2, 1, 128)

#: Why a segment ENDED (§3.5 ②'s `reason`; the producer owns the vocabulary — the `LiveMode` pattern).
StopReason = Literal["endpoint", "flush", "max_segment", "short"]
EdgeKind = Literal["start", "confirm", "stop"]


def deact_of(act: float) -> float:
    """The quiet threshold for an activation — ONE helper, used by the policy and the pass."""
    return max(act - HYSTERESIS_GAP, DEACT_FLOOR)


# ═══════════════════════════════ the model boundary (§3.4.1 ①) ═══════════════════════════════


class VadStream(Protocol):
    def probs(self, pcm: NDArray[np.float32]) -> NDArray[np.float32]:
        """`len(pcm) % hop == 0` → exactly `len(pcm) // hop` probabilities in [0, 1], in order; the
        model's state carries across calls."""
        ...


class VadModel(Protocol):
    """One per process per model; owns its ORT session; immutable. The metadata is CLASS-level on every
    adapter (ruling H3), so the registry invariant and the replay header read it without a session."""

    name: str  # the config value, the trail's `leg_start.model`, replay `--model`
    sample_rate: int  # 16000 for every live-eligible candidate
    hop: int  # samples per probability
    delay_hops: int  # 0 = causal; probability j describes hop j − delay_hops
    default_act: float  # THIS model's calibrated act — the replay's recommendation; never read at runtime
    prepass_act: float  # the pre-ASR pass's threshold on THIS model's scale (read by the pass)
    sha256: str  # the vendored file's digest (test-pinned; printed by the replay header)
    asset: str  # the file name under `ASSETS_DIR`

    def open(self) -> VadStream:
        """A fresh per-leg stream ("reset" = open a new one, only at leg start)."""
        ...


class _SileroStream:
    """One leg's Silero state: the 64-sample context and the recurrent state, carried hop to hop. The
    session is shared (ORT's `run()` is thread-safe); the state never is."""

    def __init__(self, model: SileroModel) -> None:
        import numpy as np

        self._session = model.session
        self._hop = model.hop
        self._state = np.zeros(_SILERO_STATE_SHAPE, dtype=np.float32)
        self._context = np.zeros((1, _SILERO_CONTEXT), dtype=np.float32)
        self._sr = np.array(model.sample_rate, dtype=np.int64)

    def probs(self, pcm: NDArray[np.float32]) -> NDArray[np.float32]:
        import numpy as np

        if len(pcm) % self._hop:
            raise ValueError(f"pcm length {len(pcm)} is not a multiple of the hop {self._hop}")
        x = np.asarray(pcm, dtype=np.float32).reshape(-1, self._hop)
        out = np.empty(len(x), dtype=np.float32)
        for i, window in enumerate(x):
            inp = np.concatenate([self._context, window[None, :]], axis=1)
            prob, self._state = self._session.run(None, {"input": inp, "state": self._state, "sr": self._sr})
            self._context = inp[:, -_SILERO_CONTEXT:]
            out[i] = np.asarray(prob)[0, 0]
        return out


class SileroModel:
    """The Silero adapter (raw onnxruntime + numpy; never the torch `silero-vad` package, never
    `sherpa-onnx` — §3.4). One subclass per vendored file carries the metadata; instantiating one loads
    the file and builds the session with the options §3.4 pins (council 14): one intra-op thread, one
    inter-op thread, no spinning, CPU only."""

    name: str
    asset: str
    sha256: str
    sample_rate: int = MODEL_RATE
    hop: int = 512
    delay_hops: int = 0
    default_act: float = 0.6  # R98's bake-off at 0.6 (v6.2) / R84 (v5) — provisional until TUNE
    prepass_act: float = 0.5  # the STARTING point on both scales (§3.4.1 ⑤); the S9 sweep settles it

    def __init__(self) -> None:
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.add_session_config_entry("session.intra_op.allow_spinning", "0")
        self.session = ort.InferenceSession(
            str(ASSETS_DIR / self.asset), sess_options=options, providers=["CPUExecutionProvider"]
        )

    def open(self) -> VadStream:
        return _SileroStream(self)


class SileroV62(SileroModel):
    name = "silero-v6.2"
    asset = "silero_vad_v6.2.onnx"
    sha256 = "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3"


class SileroV512(SileroModel):
    name = "silero-v5.1.2"
    asset = "silero_vad_v5.1.2.onnx"
    sha256 = "2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f"


#: The registry (§3.4.1 ①): config value → the class (calling it builds the model). Its keys equal
#: `get_args(VadModelName)` and every entry is causal within 32 ms — a TEST, never a load check (⑤).
VAD_MODELS: dict[VadModelName, type[VadModel]] = {
    "silero-v6.2": SileroV62,
    "silero-v5.1.2": SileroV512,
}


#: The per-process models, filled under `_MODELS_LOCK`: the `vad` executor and a pre-pass `to_thread` can
#: both arrive on a cold cache, and a bare `functools.cache` would build (and discard) a second session.
_MODELS: dict[VadModelName, VadModel] = {}
_MODELS_LOCK = threading.Lock()


def get_model(name: VadModelName) -> VadModel:
    """The ONE model (and ORT session) per name per process, built on first use — sync file work, so a
    caller on the event loop goes through `to_thread`."""
    with _MODELS_LOCK:
        model = _MODELS.get(name)
        if model is None:
            model = _MODELS[name] = VAD_MODELS[name]()
        return model


# ═══════════════════════════════ the policy (§3.4 tables, §3.4.1 ③) ═══════════════════════════════


@dataclass(frozen=True, slots=True)
class VadParams:
    """The policy's knobs, in MILLISECONDS (never hops — §3.4.1 ③). No defaults for the five the config
    will own (ruling H5): every caller constructs them explicitly — the vectors here, S7b's
    `from_live_cfg` later — so there is no second source of truth for a default."""

    act: float
    onset_ms: int
    silence_ms: int
    prefix_padding_ms: int
    max_segment_s: float
    ema_tau_ms: float = EMA_TAU_MS
    #: `m1` counts `≥ deact` hops toward confirmation (the replay's A/B), `default` only `≥ act` (§3.4).
    variant: Literal["default", "m1"] = "default"


@dataclass(frozen=True, slots=True)
class Counts:
    """`VadParams` in hops for ONE model's hop — derived once per leg (§3.4.1 ③). Every `⌈x_ms/hop_ms⌉`
    is computed exactly (rationals), so the golden vectors stay integer and exact."""

    hop: int
    act: float
    deact: float
    k_onset: int  # consecutive confirming hops; 0 = dictation (every crossing is a segment)
    k_end: int  # consecutive quiet hops that end a confirmed segment
    k_rearm: int  # consecutive quiet hops that re-arm after a retraction (= k_onset, ruling H13g)
    age_bound: int  # hops from the crossing (inclusive) an onset may stay unconfirmed
    max_hops: int  # hops from the crossing at which a segment is cut
    cut_span: int  # hops the cut looks back over
    alpha: float  # the EMA weight on the previous p̂ (0 = raw)
    preroll: int  # the START pre-roll, in MODEL SAMPLES (independent of the hop)
    variant: Literal["default", "m1"]


def _exact(value: float) -> Fraction:
    """A config number as the DECIMAL it was written as: `Fraction(16.1)` is the binary float's
    16.100000000000001…, which would make ⌈16100/10⌉ come out 1611."""
    return Fraction(str(value)) if isinstance(value, float) else Fraction(value)


def _ceil_hops(ms: Fraction, hop: int, sample_rate: int) -> int:
    return math.ceil(ms * sample_rate / (hop * 1000))


def derive(params: VadParams, hop: int, sample_rate: int) -> Counts:
    """`VadParams` → `Counts` for one hop. Refuses a cap that cannot hold the LATEST possible confirmation
    (on the `age_bound` hop) plus the cut's look-back (`max_hops ≤ age_bound + cut_span + 1`): there the
    cut could land before the confirm, or re-cut every hop. A consequence: an unconfirmed onset always
    meets its age bound before the cap. S7b's config bounds on `max_segment_s` (5–20 s) keep the refusal
    unreachable from Conf."""
    hop_ms = hop * 1000 / sample_rate
    k_onset = _ceil_hops(_exact(params.onset_ms), hop, sample_rate)
    max_hops = _ceil_hops(_exact(params.max_segment_s) * 1000, hop, sample_rate)
    cut_span = _ceil_hops(Fraction(CUT_WINDOW_MS), hop, sample_rate)
    age_bound = _ceil_hops(AGE_BOUND_FACTOR * _exact(params.onset_ms), hop, sample_rate)
    # This makes §3.4's "an unconfirmed segment at the cap retracts" true by construction (a tentative
    # onset always hits its age bound first), so the policy carries no cap arm for tentative segments.
    if max_hops <= age_bound + cut_span + 1:
        raise ValueError(f"max_segment_s {params.max_segment_s} is too short for this onset")
    return Counts(
        hop=hop,
        act=params.act,
        deact=deact_of(params.act),
        k_onset=k_onset,
        k_end=_ceil_hops(_exact(params.silence_ms), hop, sample_rate),
        k_rearm=k_onset,
        age_bound=age_bound,
        max_hops=max_hops,
        cut_span=cut_span,
        alpha=math.exp(-hop_ms / params.ema_tau_ms) if params.ema_tau_ms > 0 else 0.0,
        preroll=params.prefix_padding_ms * sample_rate // 1000,
        variant=params.variant,
    )


@dataclass(frozen=True, slots=True)
class Edge:
    """One policy event (ruling H6). `model_sample` is on the 16 kHz model cursor (slices the model
    audio); `leg_sample` is the leg clock (the wire's `audio_*_ms`), filled by the Segmenter — the policy
    leaves it None. `reason` and `max_p` (the segment's max RAW probability) ride stops only. A segment is
    confirmed when a `confirm` follows its `start`; ids are the relay's to mint, never the policy's."""

    kind: EdgeKind
    model_sample: int
    leg_sample: int | None = None
    reason: StopReason | None = None
    max_p: float | None = None


Phase = Literal["idle", "rearm", "tentative", "confirmed"]


@dataclass(frozen=True, slots=True)
class PolicyState:
    """The policy's whole memory between `step` calls (immutable; `step` returns a new one).

    `run` is the phase's consecutive counter — confirming hops (tentative), the end run (confirmed), the
    quiet run (rearm). `quiet` is a tentative onset's CUMULATIVE quiet count. `window` holds `(p̂, p)` of
    the open segment's last `cut_span` hops (the cut's look-back); `evicted_max` is the max raw p of the
    segment's hops that already left it."""

    phase: Phase = "idle"
    next_index: int | None = None
    ema: float | None = None
    run: int = 0
    quiet: int = 0
    seg_start: int = 0
    max_p: float = 0.0
    evicted_max: float = -math.inf
    window: tuple[tuple[float, float], ...] = field(default=())


def step(
    state: PolicyState, counts: Counts, probs: Sequence[float], first_index: int
) -> tuple[PolicyState, list[Edge]]:
    """Run the §3.4 policy over `probs` (hop `first_index` onward). PURE: same input, same output.

    Hop j covers model samples `[j·hop, (j+1)·hop)` (delay 0 — §3.4.1 ②). START = the crossing hop's
    first sample minus the pre-roll (raw: it may precede the leg — the Segmenter clamps it); a max_segment
    cut = the chosen hop's first sample; confirm and every stop = the EXCLUSIVE end of the hop that
    completed the run."""
    if state.next_index is not None and first_index != state.next_index:
        raise ValueError(f"hop {first_index} does not follow hop {state.next_index}")
    c = counts
    hop = c.hop
    phase, ema, run, quiet = state.phase, state.ema, state.run, state.quiet
    seg_start, max_p, evicted_max = state.seg_start, state.max_p, state.evicted_max
    window = list(state.window)
    edges: list[Edge] = []

    def open_segment(j: int, ph: float, p: float) -> None:
        nonlocal seg_start, max_p, evicted_max, window
        seg_start, max_p, evicted_max, window = j, p, -math.inf, [(ph, p)]

    def remember(ph: float, p: float) -> None:
        nonlocal max_p, evicted_max
        max_p = max(max_p, p)
        window.append((ph, p))
        if len(window) > c.cut_span:
            evicted_max = max(evicted_max, window.pop(0)[1])

    for offset, raw in enumerate(probs):
        j = first_index + offset
        p = float(raw)
        ema = p if ema is None else c.alpha * ema + (1 - c.alpha) * p  # p̂₀ = p₀
        ph = ema
        m = j * hop
        if phase == "rearm":
            run = run + 1 if ph < c.deact else 0
            if run >= c.k_rearm:
                phase, run = "idle", 0
        elif phase == "idle":
            if ph >= c.act:  # the tentative start — the crossing counts as hop 1 of k_onset (H13b)
                open_segment(j, ph, p)
                edges.append(Edge("start", m - c.preroll))
                run, quiet = 1, 0
                if run >= c.k_onset:  # k_onset ≤ 1 (dictation's 0 included): confirmed on the crossing
                    edges.append(Edge("confirm", m + hop))
                    phase, run = "confirmed", 0
                else:
                    phase = "tentative"
        elif phase == "tentative":
            remember(ph, p)
            confirming = ph >= c.act or (c.variant == "m1" and ph >= c.deact)
            if confirming:
                run += 1
            else:
                run = 0
                if ph < c.deact:
                    quiet += 1
            age = j - seg_start + 1
            if run >= c.k_onset:
                edges.append(Edge("confirm", m + hop))
                phase, run = "confirmed", 0
            elif quiet >= c.k_onset or age >= c.age_bound:
                edges.append(Edge("stop", m + hop, reason="short", max_p=max_p))
                phase, run = "rearm", 0
        else:  # confirmed
            remember(ph, p)
            run = run + 1 if ph < c.deact else 0
            if run >= c.k_end:
                edges.append(Edge("stop", m + hop, reason="endpoint", max_p=max_p))
                phase, run = "idle", 0
            elif j - seg_start + 1 >= c.max_hops:
                # The cut (H13d/e/f): the lowest p̂ in the last `cut_span` hops (never the segment's first
                # hop, so A keeps at least one), the EARLIEST on a tie. A ends there; B starts AT it with
                # zero pre-roll, already confirmed, and owns hops cut..j — its counters recomputed on them.
                first_in_window = j - len(window) + 1
                lo = max(seg_start + 1, first_in_window) - first_in_window
                cut = min(range(lo, len(window)), key=lambda k: (window[k][0], k))
                a_max = max([evicted_max, *(w[1] for w in window[:cut])])
                m_cut = (first_in_window + cut) * hop
                edges.append(Edge("stop", m_cut, reason="max_segment", max_p=a_max))
                edges.append(Edge("start", m_cut))
                edges.append(Edge("confirm", m_cut))
                window = window[cut:]
                seg_start, evicted_max = first_in_window + cut, -math.inf
                max_p = max(w[1] for w in window)
                run = 0
                for w in reversed(window):
                    if w[0] >= c.deact:
                        break
                    run += 1

    return (
        PolicyState(
            phase=phase,
            next_index=first_index + len(probs),
            ema=ema,
            run=run,
            quiet=quiet,
            seg_start=seg_start,
            max_p=max_p,
            evicted_max=evicted_max,
            window=tuple(window),
        ),
        edges,
    )


def flush(state: PolicyState, counts: Counts) -> tuple[PolicyState, list[Edge]]:
    """Force-endpoint whatever is open — a tentative onset included (§3.5 ⑥) — at the exclusive end of
    the last processed hop, `reason: "flush"`. Nothing open → no edge. The EMA and position survive."""
    if state.phase not in ("tentative", "confirmed") or state.next_index is None:
        return state, []
    stop = Edge("stop", state.next_index * counts.hop, reason="flush", max_p=state.max_p)
    return replace(state, phase="idle", run=0, quiet=0, window=()), [stop]


# ═══════════════════════════════ the segmenter (§3.4.1 ②) ═══════════════════════════════


@dataclass(frozen=True, slots=True)
class StampedFrame:
    """One uplink frame as the relay received it (§3.2): its index on the LEG clock (client-rate samples,
    stamped at receipt — a later drop is a GAP here, never a shifted boundary), its length on that clock,
    and its audio after the resampler (pcm16 LE mono at 16 kHz)."""

    leg_index: int
    client_samples: int
    pcm16k: bytes


class Segmenter(Protocol):
    """What downstream code sees (§3.4 seams): edges per frame, and a release that force-endpoints."""

    def feed(self, frame: StampedFrame) -> list[Edge]: ...

    def flush(self) -> list[Edge]: ...


@dataclass(frozen=True, slots=True)
class _Anchor:
    m_start: int  # the frame's first sample on the 16 kHz model cursor
    m_len: int
    leg_index: int


class VadSegmenter:
    """The ONE model-agnostic segmenter: frames in, policy edges out, each edge stamped on BOTH clocks.

    * **Two clocks.** The 16 kHz model cursor counts post-resampler samples; the leg clock counts
      client-rate samples. A boundary at cursor `m` maps through the frame that CONTAINS it:
      `leg = frame.leg_index + round((m − frame.m_start) · client_rate / 16000)` — never by adding hops to
      a leg index, so a dropped call frame (a gap in `leg_index`) cannot shift one.
    * **Anchors** reach back `max(prefix_padding_ms, 1000 ms) + hop` of model audio — far enough for a
      START's pre-roll and for a cap cut's look-back. A pre-roll before the leg's first sample clamps to it.
    * **The residual** rides `HopBuffer`: `probs()` sees the largest whole-hop block, nothing is dropped.
    * **Flush** zero-pads the leftover to one hop, force-endpoints whatever is open, and clamps every edge
      it produced to the last real sample. It ends the leg: a new leg is a new segmenter (state resets
      only at leg start)."""

    def __init__(self, model: VadModel, params: VadParams, client_rate: int) -> None:
        if model.delay_hops:
            # §3.4.1 "named exits": the delay shift + drain are written when a delayed model is registered.
            raise NotImplementedError(f"{model.name}: delayed models are not supported yet")
        if client_rate <= 0:
            raise ValueError(f"client_rate must be positive (got {client_rate})")
        self.counts = derive(params, model.hop, model.sample_rate)
        self._rate = model.sample_rate
        self._client_rate = client_rate
        self._stream = model.open()
        self._hops = HopBuffer(model.hop)
        self._state = PolicyState(next_index=0)
        self._anchors: list[_Anchor] = []
        self._m = 0
        self._horizon = max(self.counts.preroll, CUT_WINDOW_MS * self._rate // 1000) + model.hop
        self._flushed = False

    def feed(self, frame: StampedFrame) -> list[Edge]:
        if self._flushed:
            raise RuntimeError("feed after flush: a new leg needs a new segmenter")
        samples = pcm16_to_float32(frame.pcm16k)
        if not len(samples):
            return []
        self._anchors.append(_Anchor(self._m, len(samples), frame.leg_index))
        self._m += len(samples)
        edges = self._run(self._hops.push(samples))
        self._trim()
        return edges

    def flush(self) -> list[Edge]:
        if self._flushed:
            return []
        self._flushed = True
        tail = self._run(self._hops.pad(), clamp=True)
        self._state, stops = flush(self._state, self.counts)
        return tail + [self._stamp(e, clamp=True) for e in stops]

    def _run(self, block: NDArray[np.float32], *, clamp: bool = False) -> list[Edge]:
        if not len(block):
            return []
        probs = self._stream.probs(block)
        self._state, edges = step(self._state, self.counts, probs.tolist(), self._state.next_index or 0)
        return [self._stamp(e, clamp=clamp) for e in edges]

    def _stamp(self, edge: Edge, *, clamp: bool) -> Edge:
        m = max(edge.model_sample, 0)  # a pre-roll before the leg's first sample clamps to it
        if clamp:
            m = self._hops.clamp(m)
        anchor = self._anchors[0]
        for a in self._anchors:
            if a.m_start > m:
                break
            anchor = a
        leg = anchor.leg_index + round(Fraction((m - anchor.m_start) * self._client_rate, self._rate))
        return replace(edge, model_sample=m, leg_sample=leg)

    def _trim(self) -> None:
        processed = (self._state.next_index or 0) * self.counts.hop
        keep_from = processed - self._horizon
        while len(self._anchors) > 1 and self._anchors[1].m_start <= keep_from:
            self._anchors.pop(0)
