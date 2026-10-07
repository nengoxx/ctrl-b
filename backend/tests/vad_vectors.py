"""The VAD golden vectors (ASR_PLAN §3.4 "Golden vectors", §3.4.1 ②/③/⑥; S6-i, session-64 rulings H11–H13).

HAND-AUTHORED from the §3.4 band + rule tables and the H13 rulings BEFORE the policy ran, and NEVER
regenerated from its output (council 11). If a vector and `voice_vad.step` ever disagree, the vector is
re-derived BY HAND from the tables — never edited to match the code. Each vector's comment carries the hand
computation of its expected edges.

Shape (the plan's JSON shape, as Python literals — ruling H11: the house has no non-.py test fixtures
beyond the one conformance WAV): `{params, hop, sample_rate, probs, first_index, expected}` with `probs` in
run-length form `[(p, n), …]` (expanded by `expand`), `expected` as tuples `("start", m)`,
`("confirm", m)`, `("stop", m, reason, max_p)` on the 16 kHz model cursor, and an optional `flush: True`
(the policy's `flush` runs after the last hop).

Hop j covers model samples [j·hop, (j+1)·hop). START = the crossing hop's first sample − the pre-roll
(raw: the policy does not clamp; the Segmenter does); a cut = the chosen hop's first sample; confirm and
every stop = the EXCLUSIVE end (j+1)·hop of the hop that completed the run.
"""

from __future__ import annotations

from typing import Any

Run = list[tuple[float, int]]


def expand(runs: Run) -> list[float]:
    return [p for p, n in runs for _ in range(n)]


# ── parameter sets ──
# P32 at the Silero hop (512 @ 16 kHz = 32 ms), RAW (τ = 0) so every expected edge is hand-computable:
#   act 0.6 → deact 0.45 · k_onset = ⌈200/32⌉ = ⌈6.25⌉ = 7 · k_rearm = 7 · age_bound = ⌈400/32⌉ = ⌈12.5⌉ = 13
#   k_end = ⌈700/32⌉ = ⌈21.875⌉ = 22 · preroll = 500 ms · 16 = 8000 samples · cut_span = ⌈1000/32⌉ = 32
#   max_hops = ⌈20000/32⌉ = 625
P32: dict[str, Any] = {
    "act": 0.6,
    "onset_ms": 200,
    "silence_ms": 700,
    "prefix_padding_ms": 500,
    "max_segment_s": 20,
    "ema_tau_ms": 0.0,
}
#: P32 with LiveKit's EMA on (τ ≈ 30.48 ms ⇒ α = 0.35 at 32 ms) — `ema_tau_ms` omitted = the default.
P32_EMA: dict[str, Any] = {k: v for k, v in P32.items() if k != "ema_tau_ms"}
#: P32 with a 2 s cap: max_hops = ⌈2000/32⌉ = ⌈62.5⌉ = 63.
P32_CAP2 = {**P32, "max_segment_s": 2}
#: act 0.65 makes deact EXACTLY 0.5 in binary (0.65 − 0.15 == 0.5), so a hop AT deact is testable (at
#: act 0.6, deact = 0.44999999999999996 and a 0.45 hop sits above it).
P65 = {**P32, "act": 0.65}
#: Dictation: onset 0 ⇒ k_onset 0 — start + confirm on the crossing hop, no retraction (H13h).
P32_DICTATION = {**P32, "onset_ms": 0}
#: The M1 variant (≥ deact counts toward confirmation).
P32_M1 = {**P32, "variant": "m1"}
# P10 at a 10 ms hop (160 @ 16 kHz) — pins ⌈x_ms/hop_ms⌉ and τ → α (R98):
#   k_onset = ⌈200/10⌉ = 20 = k_rearm · age_bound = 40 · k_end = 70 · preroll 8000 · cut_span 100
#   max_hops = 2000 · α = exp(−10/30.48) = 0.35^(10/32) ≈ 0.72035
P10: dict[str, Any] = {**P32, "ema_tau_ms": 0.0}
P10_EMA: dict[str, Any] = P32_EMA

Q, S, M = 0.1, 0.9, 0.5  # quiet (< deact 0.45) · speech (≥ act 0.6) · the hysteresis band [0.45, 0.6)


def _alt(a: float, b: float, pairs: int) -> Run:
    return [(a, 1), (b, 1)] * pairs


POLICY_VECTORS: list[dict[str, Any]] = [
    # ── R94 §9 / A3's VAD-1…10 ──
    {
        # VAD-1 one transient ≠ a segment. Crossing hop 20 → start 20·512 − 8000 = 2240; quiet hops 21..27
        # bring the CUMULATIVE quiet count to 7 = k_onset at hop 27 (age 8 < 13) → stop short at 28·512.
        "name": "vad1_one_transient_is_not_a_segment",
        "params": P32,
        "probs": [(Q, 20), (S, 1), (Q, 30)],
        "expected": [("start", 2240), ("stop", 14336, "short", 0.9)],
    },
    {
        # VAD-2 an onset break resets the count. S 20..23 (run 4), M at 24 resets the run only (not quiet),
        # S 25..31 → run 7 at hop 31 (age 12 < 13) → confirm 32·512 = 16384. Quiet 32..53 → the 22nd at
        # hop 53 → stop endpoint 54·512 = 27648.
        "name": "vad2_onset_break_resets_the_count",
        "params": P32,
        "probs": [(Q, 20), (S, 4), (M, 1), (S, 7), (Q, 30)],
        "expected": [("start", 2240), ("confirm", 16384), ("stop", 27648, "endpoint", 0.9)],
    },
    {
        # H13c the age bound counts from the crossing INCLUSIVE: S 20..25 (run 6), M 26 (run 0), S 27..
        # → run 6 at hop 32, where age = 32 − 20 + 1 = 13 = age_bound → retract, stop short 33·512.
        # The re-arm then needs 7 quiet: 33 is S (resets), 34..40 → re-armed; nothing more crosses.
        "name": "age_bound_counts_from_the_crossing_inclusive",
        "params": P32,
        "probs": [(Q, 20), (S, 6), (M, 1), (S, 7), (Q, 30)],
        "expected": [("start", 2240), ("stop", 16896, "short", 0.9)],
    },
    {
        # VAD-3 pre-roll present: crossing 30 → start 30·512 − 8000 = 7360; confirm at hop 36 → 37·512;
        # quiet 40..61 → stop 62·512 = 31744.
        "name": "vad3_preroll_present",
        "params": P32,
        "probs": [(Q, 30), (S, 10), (Q, 30)],
        "expected": [("start", 7360), ("confirm", 18944), ("stop", 31744, "endpoint", 0.9)],
    },
    {
        # VAD-4 a short answer survives: 8 hops (256 ms) → confirm at 26 → 27·512; quiet 28..49 → 50·512.
        "name": "vad4_short_answer_256ms_survives",
        "params": P32,
        "probs": [(Q, 20), (S, 8), (Q, 30)],
        "expected": [("start", 2240), ("confirm", 13824), ("stop", 25600, "endpoint", 0.9)],
    },
    {
        # …7 hops (224 ms) is exactly k_onset: confirm at 26 → 13824; quiet 27..48 → 49·512 = 25088.
        "name": "vad4_short_answer_224ms_survives",
        "params": P32,
        "probs": [(Q, 20), (S, 7), (Q, 30)],
        "expected": [("start", 2240), ("confirm", 13824), ("stop", 25088, "endpoint", 0.9)],
    },
    {
        # …6 hops never confirm: quiet 26..32 = 7 at hop 32 (= age 13 too) → stop short 33·512.
        "name": "vad4_six_hops_retract",
        "params": P32,
        "probs": [(Q, 20), (S, 6), (Q, 30)],
        "expected": [("start", 2240), ("stop", 16896, "short", 0.9)],
    },
    # VAD-5 "state persists" is the chunking invariant the test applies to EVERY vector (any split of
    # `probs` across `step` calls gives the same edges).
    {
        # VAD-6 end hysteresis: confirmed at 26; 40 hops in [deact, act) keep it open (the end run counts
        # only < deact); quiet 70..91 → stop 92·512 = 47104.
        "name": "vad6_end_hysteresis",
        "params": P32,
        "probs": [(Q, 20), (S, 10), (M, 40), (Q, 30)],
        "expected": [("start", 2240), ("confirm", 13824), ("stop", 47104, "endpoint", 0.9)],
    },
    {
        # VAD-7 silence ends the segment at EXACTLY k_end: 21 quiet (30..50) do not; speech 51..55 resets;
        # quiet 56..77 (the 22nd at 77) → stop 78·512 = 39936. One segment.
        "name": "vad7_silence_ends_at_exactly_k_end",
        "params": P32,
        "probs": [(Q, 20), (S, 10), (Q, 21), (S, 5), (Q, 30)],
        "expected": [("start", 2240), ("confirm", 13824), ("stop", 39936, "endpoint", 0.9)],
    },
    {
        # VAD-8 no double commit: seg 1 stops at 52·512 = 26624 (quiet 30..51) and the further silence
        # emits nothing; seg 2 crosses at 70 → start 35840 − 8000 = 27840, confirm at 76 → 77·512 = 39424,
        # quiet 80..101 → stop 102·512 = 52224.
        "name": "vad8_no_double_commit",
        "params": P32,
        "probs": [(Q, 20), (S, 10), (Q, 40), (S, 10), (Q, 30)],
        "expected": [
            ("start", 2240),
            ("confirm", 13824),
            ("stop", 26624, "endpoint", 0.9),
            ("start", 27840),
            ("confirm", 39424),
            ("stop", 52224, "endpoint", 0.9),
        ],
    },
    {
        # VAD-9 no flap storm: S/Q alternate from hop 20 for 100 hops. The run never passes 1; quiet reaches
        # 6 by hop 31; hop 32 is age 13 → ONE retraction, stop short 33·512. The re-arm guard needs 7
        # CONSECUTIVE quiet — never during the flap — so nothing else starts (re-armed at 125).
        "name": "vad9_no_flap_storm",
        "params": P32,
        "probs": [(Q, 20), *_alt(S, Q, 50), (Q, 30)],
        "expected": [("start", 2240), ("stop", 16896, "short", 0.9)],
    },
    # VAD-10 "relay protections coherent" is the structural invariant the test applies to EVERY vector:
    # starts and stops strictly alternate, a confirm sits only inside an open segment, and edges are
    # ordered on the cursor except a START, whose pre-roll may reach back.
    # ── the plan's additions ──
    {
        # No pin + the pre-roll crosses the previous end: seg 1 stops at 26624 (quiet 30..51); a phrase
        # crosses 10 hops (320 ms) later at 62 → start 62·512 − 8000 = 23744 < 26624 (never clamped at the
        # previous stop); confirm at 68 → 69·512 = 35328; it ends k_end after its last speech hop, not at
        # 3 s: speech ends at 70·512 = 35840, + 22·512 = 47104.
        "name": "no_pin_and_preroll_crosses_the_previous_end",
        "params": P32,
        "probs": [(Q, 20), (S, 10), (Q, 32), (S, 8), (Q, 30)],
        "expected": [
            ("start", 2240),
            ("confirm", 13824),
            ("stop", 26624, "endpoint", 0.9),
            ("start", 23744),
            ("confirm", 35328),
            ("stop", 47104, "endpoint", 0.9),
        ],
    },
    {
        # Q1 flicker = ONE segment: S 20..21 (run 2), Q 22..24 (cumulative quiet 3 < 7, run 0), S 25..31 →
        # run 7 at 31 (age 12) → confirm 32·512 = 16384 — one start, no stop in between. Quiet 32..53 →
        # stop 54·512 = 27648.
        "name": "q1_flicker_stays_one_segment",
        "params": P32,
        "probs": [(Q, 20), (S, 2), (Q, 3), (S, 7), (Q, 30)],
        "expected": [("start", 2240), ("confirm", 16384), ("stop", 27648, "endpoint", 0.9)],
    },
    {
        # Hover at deact ± 0.05 (0.40/0.50 alternating, 156 hops ≈ 5 s) after one crossing: quiet = 6 by
        # hop 31, age 13 at hop 32 → ONE retraction within the bound, stop short 33·512 = 16896. The
        # re-arm never completes inside the hover (0.50 breaks every quiet run) → nothing else.
        "name": "hover_deact_retracts_once_by_age",
        "params": P32,
        "probs": [(Q, 20), (S, 1), *_alt(0.40, 0.50, 78), (Q, 10)],
        "expected": [("start", 2240), ("stop", 16896, "short", 0.9)],
    },
    {
        # …the cumulative arm of the bound: two quiet per dip (0.40, 0.40, 0.50) → quiet hits 7 at hop 30
        # (21, 22, 24, 25, 27, 28, 30; age 11) → stop short 31·512 = 15872; never re-armed in the hover.
        "name": "hover_deact_retracts_once_by_cumulative_quiet",
        "params": P32,
        "probs": [(Q, 20), (S, 1), *[(0.40, 2), (0.50, 1)] * 52, (Q, 10)],
        "expected": [("start", 2240), ("stop", 15872, "short", 0.9)],
    },
    {
        # Hover at act ± 0.05 (0.65/0.55, 156 hops): crossing 20; 0.55 resets the run, never quiet; age 13
        # at hop 32 → stop short 33·512, max_p 0.65. The re-arm guard needs 7 hops < 0.45 — none in the
        # hover — so AT MOST one start/retraction pair (P-1).
        "name": "hover_act_at_most_one_pair",
        "params": P32,
        "probs": [(Q, 20), *_alt(0.65, 0.55, 78), (Q, 10)],
        "expected": [("start", 2240), ("stop", 16896, "short", 0.65)],
    },
    {
        # The re-arm guard (P-1, k_rearm = k_onset = 7, H13g): retract at 27 (stop 14336); quiet 28..30 (3);
        # S at 31 starts NOTHING and resets the quiet run; quiet 32..38 → re-armed; S at 39 → start
        # 39·512 − 8000 = 11968; quiet 40..46 → stop short 47·512 = 24064.
        "name": "rearm_guard_blocks_a_crossing_inside_the_quiet_run",
        "params": P32,
        "probs": [(Q, 20), (S, 1), (Q, 7), (Q, 3), (S, 1), (Q, 7), (S, 1), (Q, 7), (Q, 10)],
        "expected": [
            ("start", 2240),
            ("stop", 14336, "short", 0.9),
            ("start", 11968),
            ("stop", 24064, "short", 0.9),
        ],
    },
    {
        # CHOICE (unruled; lane report): the guard's quiet run counts the hops AFTER the retraction hop.
        # Retract at 27; quiet 28..33 = 6 < 7 → the S at 34 starts nothing (were hop 27 counted, 27..33 = 7
        # would have re-armed it).
        "name": "rearm_counts_after_the_retraction_hop",
        "params": P32,
        "probs": [(Q, 20), (S, 1), (Q, 7), (Q, 6), (S, 1), (Q, 20)],
        "expected": [("start", 2240), ("stop", 14336, "short", 0.9)],
    },
    {
        # EMA applied (P-5b): one 0.7 hop. Raw would cross; p̂20 = 0.65·0.7 = 0.455 < 0.6 → nothing.
        "name": "ema_smooths_away_a_lone_hop",
        "params": P32_EMA,
        "probs": [(0.0, 20), (0.7, 1), (0.0, 30)],
        "expected": [],
    },
    {
        # …the raw twin (τ = 0): crossing 20, quiet 21..27 → stop short 28·512, max_p 0.7.
        "name": "raw_takes_the_lone_hop",
        "params": P32,
        "probs": [(0.0, 20), (0.7, 1), (0.0, 30)],
        "expected": [("start", 2240), ("stop", 14336, "short", 0.7)],
    },
    {
        # EMA on a 0.9 step then a 0.3 tail: p̂20 = 0.585 (no), p̂21 = 0.35·0.585 + 0.585 = 0.78975 → cross
        # at 21 → start 21·512 − 8000 = 2752; run 7 at 27 → confirm 28·512 = 14336. Tail: p̂29 ≈ 0.89998,
        # p̂30 = 0.35·0.89998 + 0.65·0.3 = 0.50999 (≥ 0.45, not quiet), p̂31 = 0.37350 (quiet) → the 22nd
        # quiet at 52 → stop 53·512 = 27136. One hop later at both ends than the raw twin below.
        "name": "ema_delays_onset_and_end_by_one_hop",
        "params": P32_EMA,
        "probs": [(0.0, 20), (S, 10), (0.3, 40)],
        "expected": [("start", 2752), ("confirm", 14336), ("stop", 27136, "endpoint", 0.9)],
    },
    {
        # …raw: cross 20 (2240), confirm 26 (13824), quiet 30..51 → stop 52·512 = 26624.
        "name": "raw_onset_and_end",
        "params": P32,
        "probs": [(0.0, 20), (S, 10), (0.3, 40)],
        "expected": [("start", 2240), ("confirm", 13824), ("stop", 26624, "endpoint", 0.9)],
    },
    {
        # p̂₀ = p₀ (not 0): p̂0 = 0.9 → crossing at hop 0 → start 0 − 8000 = −8000 (raw — the Segmenter clamps
        # it to the leg's first sample); confirm at 6 → 7·512 = 3584; p̂10 = 0.35·0.9 + 0.65·0.1 = 0.38
        # (quiet) → the 22nd at 31 → stop 32·512 = 16384. (Seeded with 0, p̂0 = 0.585 would not cross.)
        "name": "ema_seeds_with_the_first_probability",
        "params": P32_EMA,
        "probs": [(S, 10), (Q, 30)],
        "expected": [("start", -8000), ("confirm", 3584), ("stop", 16384, "endpoint", 0.9)],
    },
    {
        # Dictation (onset 0, H13h): every crossing is a confirmed segment, start + confirm on the crossing
        # hop. Hop 20 → start 2240, confirm 21·512 = 10752; quiet 21..42 → stop 43·512 = 22016. Hop 51 →
        # start 26112 − 8000 = 18112, confirm 52·512 = 26624; quiet 54..75 → stop 76·512 = 38912.
        "name": "dictation_every_crossing_is_a_segment",
        "params": P32_DICTATION,
        "probs": [(Q, 20), (S, 1), (Q, 30), (S, 3), (Q, 30)],
        "expected": [
            ("start", 2240),
            ("confirm", 10752),
            ("stop", 22016, "endpoint", 0.9),
            ("start", 18112),
            ("confirm", 26624),
            ("stop", 38912, "endpoint", 0.9),
        ],
    },
    {
        # The M1 variant counts [deact, act) toward confirmation: S 20..21 (2), M 22..26 → run 7 at 26 →
        # confirm 27·512 = 13824; quiet 27..48 → stop 49·512 = 25088.
        "name": "m1_counts_the_hysteresis_band",
        "params": P32_M1,
        "probs": [(Q, 20), (S, 2), (M, 5), (Q, 30)],
        "expected": [("start", 2240), ("confirm", 13824), ("stop", 25088, "endpoint", 0.9)],
    },
    {
        # …the default twin: M resets; quiet 27..32 = 6; age 13 at hop 32 → stop short 33·512 = 16896.
        "name": "default_does_not_count_the_hysteresis_band",
        "params": P32,
        "probs": [(Q, 20), (S, 2), (M, 5), (Q, 30)],
        "expected": [("start", 2240), ("stop", 16896, "short", 0.9)],
    },
    {
        # The max_segment split (cap 63 hops): crossing 20, confirm 26. At hop 82 the segment spans 63
        # hops → cut. The window = hops 51..82 (cut_span 32); its lowest p̂ is 0.7 at hop 70 (the 0.65 at
        # hop 40 is OUTSIDE it) → A stops AT 70·512 = 35840, reason max_segment, max_p 0.9; B starts AT the
        # cut with zero pre-roll, already confirmed (start + confirm at 35840). B owns 70..82 (end run 0);
        # speech to 100, quiet 101..122 → stop 123·512 = 62976 (B spans 53 hops < 63).
        "name": "max_segment_cuts_at_the_lowest_hop_in_the_last_second",
        "params": P32_CAP2,
        "probs": [(Q, 20), (S, 20), (0.65, 1), (S, 29), (0.7, 1), (S, 30), (Q, 40)],
        "expected": [
            ("start", 2240),
            ("confirm", 13824),
            ("stop", 35840, "max_segment", 0.9),
            ("start", 35840),
            ("confirm", 35840),
            ("stop", 62976, "endpoint", 0.9),
        ],
    },
    {
        # H13e a tie → the EARLIEST: two 0.7 hops at 60 and 70, both in the window 51..82 → cut at 60 →
        # A stops at 60·512 = 30720; B (owns 60..82) speech to 95, quiet 96..117 → stop 118·512 = 60416.
        "name": "max_segment_tie_takes_the_earliest_hop",
        "params": P32_CAP2,
        "probs": [(Q, 20), (S, 40), (0.7, 1), (S, 9), (0.7, 1), (S, 25), (Q, 40)],
        "expected": [
            ("start", 2240),
            ("confirm", 13824),
            ("stop", 30720, "max_segment", 0.9),
            ("start", 30720),
            ("confirm", 30720),
            ("stop", 60416, "endpoint", 0.9),
        ],
    },
    {
        # H13f B's counters are recomputed over the hops it owns: speech 20..77, quiet from 78. At the cap
        # (hop 82) the end run is 5; the window's lowest p̂ is 0.1 at 78..82 → earliest 78 → A stops at
        # 78·512 = 39936 (max_p 0.9); B owns 78..82 → end run 5, max_p 0.1 → the 22nd quiet hop is 99 →
        # stop 100·512 = 51200, max_p 0.1. (Reset to 0 instead, B would end at 104.)
        "name": "max_segment_b_recomputes_its_end_run",
        "params": P32_CAP2,
        "probs": [(Q, 20), (S, 58), (Q, 30)],
        "expected": [
            ("start", 2240),
            ("confirm", 13824),
            ("stop", 39936, "max_segment", 0.9),
            ("start", 39936),
            ("confirm", 39936),
            ("stop", 51200, "endpoint", 0.1),
        ],
    },
    # "An unconfirmed segment at the cap retracts" (§3.4) has NO vector since wave 1.5: `derive` now
    # refuses any cap ≤ age_bound + cut_span + 1, so an unconfirmed onset always meets its age bound
    # (≤ age_bound hops) before the cap — the rule cannot be reached through `derive`.
    {
        # Flush endpoints a TENTATIVE onset (§3.5 ⑥): crossing 20, run 3 at 22 → flush → stop at the end of
        # the last processed hop, 23·512 = 11776, reason flush.
        "name": "flush_endpoints_a_tentative_onset",
        "params": P32,
        "probs": [(Q, 20), (S, 3)],
        "flush": True,
        "expected": [("start", 2240), ("stop", 11776, "flush", 0.9)],
    },
    {
        # …and a confirmed one mid-silence: confirm 26; end run 5 at 34 → flush → stop 35·512 = 17920.
        "name": "flush_endpoints_a_confirmed_segment",
        "params": P32,
        "probs": [(Q, 20), (S, 10), (Q, 5)],
        "flush": True,
        "expected": [("start", 2240), ("confirm", 13824), ("stop", 17920, "flush", 0.9)],
    },
    {
        # …nothing open → nothing.
        "name": "flush_with_nothing_open",
        "params": P32,
        "probs": [(Q, 20)],
        "flush": True,
        "expected": [],
    },
    # ── review round №1 (wave 1): blind Opus's EIGHT vectors, VERBATIM (hand-derived by the reviewer,
    # independently of the code; each kills a mutant the first 35 let through — the lane report's table) ──
    {
        # MED-1 the CUMULATIVE tentative hangover: crossing 20 → start 2240; quiet 21..23 = 3; S at 24 →
        # run 1, quiet stays 3; quiet 25..28 → 7 at hop 28 (age 9) → stop short 29·512 = 14848.
        "name": "cumulative_quiet",
        "params": P32,
        "probs": [(Q, 20), (S, 1), (Q, 3), (S, 1), (Q, 4), (Q, 30)],
        "expected": [("start", 2240), ("stop", 14848, "short", 0.9)],
    },
    {
        # MED-2 a [deact, act) hop resets a CONFIRMED segment's end run: confirm 26; quiet 30..50 = 21; M at
        # 51 resets; quiet 52..73 → the 22nd at 73 → stop 74·512 = 37888.
        "name": "confirmed_band_resets_end_run",
        "params": P32,
        "probs": [(Q, 20), (S, 10), (Q, 21), (M, 1), (Q, 30)],
        "expected": [("start", 2240), ("confirm", 13824), ("stop", 37888, "endpoint", 0.9)],
    },
    {
        # MED-3 the cap fires AT max_hops (H13d): cap at hop 82 (82 − 20 + 1 = 63); window 51..82, lowest 0.7
        # at 51 → cut 51·512 = 26112. B owns 51..82, end run 0; quiet 83..104 → stop 105·512 = 53760 (B's
        # own cap would be hop 113, never reached). A one-hop-late cap would cut at 83 → 42496.
        "name": "cap_fires_at_max_hops",
        "params": P32_CAP2,
        "probs": [(Q, 20), (S, 31), (0.7, 1), (S, 8), (0.8, 1), (S, 22), (Q, 30)],
        "expected": [
            ("start", 2240),
            ("confirm", 13824),
            ("stop", 26112, "max_segment", 0.9),
            ("start", 26112),
            ("confirm", 26112),
            ("stop", 53760, "endpoint", 0.9),
        ],
    },
    {
        # MED-4 confirmation beats retraction on the same hop: run 7 at hop 32, which is also age 13 →
        # confirm 33·512 = 16896; quiet 33..54 → stop 55·512 = 28160.
        "name": "confirm_on_the_age_bound_hop",
        "params": P32,
        "probs": [(Q, 20), (S, 5), (M, 1), (S, 7), (Q, 30)],
        "expected": [("start", 2240), ("confirm", 16896), ("stop", 28160, "endpoint", 0.9)],
    },
    {
        # MED-4 the endpoint beats the cap on the same hop: quiet 61..82 → the 22nd at 82 = the cap hop →
        # endpoint 83·512 = 42496 (cap-first would cut at 31232).
        "name": "endpoint_beats_cap_same_hop",
        "params": P32_CAP2,
        "probs": [(Q, 20), (S, 41), (Q, 30)],
        "expected": [("start", 2240), ("confirm", 13824), ("stop", 42496, "endpoint", 0.9)],
    },
    {
        # k_onset = 1 (onset 32 ms): confirmed on the crossing → 21·512 = 10752; quiet 21..42 → 43·512 = 22016.
        "name": "k_onset_one",
        "params": {**P32, "onset_ms": 32},
        "probs": [(Q, 20), (S, 1), (Q, 30)],
        "expected": [("start", 2240), ("confirm", 10752), ("stop", 22016, "endpoint", 0.9)],
    },
    {
        # An M hop resets the RE-ARM run: retract at 27; re-arm 28..30 = 3; M at 31 resets; 32..35 = 4; the S
        # at 36 starts nothing; 37..43 re-arms.
        "name": "rearm_band_resets",
        "params": P32,
        "probs": [(Q, 20), (S, 1), (Q, 7), (Q, 3), (M, 1), (Q, 4), (S, 1), (Q, 30)],
        "expected": [("start", 2240), ("stop", 14336, "short", 0.9)],
    },
    {
        # A's max_p is over ITS OWN hops: cut at 51 (0.7) → 26112; A's max_p = 0.9 (hops 20..50), not 0.99;
        # B's max_p = 0.99; quiet 83..104 → 53760.
        "name": "a_max_p_over_its_own_hops",
        "params": P32_CAP2,
        "probs": [(Q, 20), (0.9, 31), (0.7, 1), (0.99, 31), (Q, 30)],
        "expected": [
            ("start", 2240),
            ("confirm", 13824),
            ("stop", 26112, "max_segment", 0.9),
            ("start", 26112),
            ("confirm", 26112),
            ("stop", 53760, "endpoint", 0.99),
        ],
    },
    # ── review round №1 (wave 1): Emma's vectors ──
    {
        # k_onset = 1 with a FIRST-HOP crossing (act .6, onset 32 → k_onset 1, silence 64 → k_end 2): hop 0
        # crosses → start 0 − 8000 = −8000 and confirm at its end 512; quiet hops 1, 2 → stop 3·512 = 1536.
        "name": "k_onset_one_on_the_first_hop",
        "params": {**P32, "onset_ms": 32, "silence_ms": 64},
        "probs": [(S, 1), (Q, 2)],
        "expected": [("start", -8000), ("confirm", 512), ("stop", 1536, "endpoint", 0.9)],
    },
    {
        # A hop EXACTLY at deact is not quiet (the band is deact ≤ p̂ < act). act 0.65 → deact exactly 0.5:
        # confirm at 26 → 13824; quiet 30..50 = 21; the 0.5 hop at 51 (== deact) resets the end run; quiet
        # 52..73 → the 22nd at 73 → stop 74·512 = 37888. (Counted quiet, the 22nd would be hop 51 → 26624.)
        "name": "exact_deact_hop_resets_the_end_run",
        "params": P65,
        "probs": [(Q, 20), (S, 10), (Q, 21), (0.5, 1), (Q, 30)],
        "expected": [("start", 2240), ("confirm", 13824), ("stop", 37888, "endpoint", 0.9)],
    },
    # ── two at a 10 ms hop (R98): the ms → count and τ → α derivations ──
    {
        # α = 0.72035: a 0 → 1 step gives p̂ = 1 − α^n: 0.27965, 0.48114, 0.62625 → crossing at hop 52 (the
        # THIRD hop; at 32 ms α 0.35 crosses on the first) → start 52·160 − 8000 = 320. k_onset 20 → run 20
        # at 71 → confirm 72·160 = 11520. Tail 0 from 80: p̂80 = α·0.99995 = 0.7203, p̂81 = 0.5188 (not
        # quiet), p̂82 = 0.3737 (quiet) → k_end 70 → the 70th quiet at 151 → stop 152·160 = 24320.
        "name": "hop10_ema_and_counts",
        "params": P10_EMA,
        "hop": 160,
        "probs": [(0.0, 50), (1.0, 30), (0.0, 100)],
        "expected": [("start", 320), ("confirm", 11520), ("stop", 24320, "endpoint", 1.0)],
    },
    {
        # Bounded in TIME at 10 ms: S/M flicker from 50 never confirms → age_bound 40 → retract at hop 89,
        # stop 90·160 = 14400 = the crossing (8000) + 6400 samples = 400 ms = 2·onset_ms (as at 32 ms:
        # 13 hops = 416 ms). Re-arm k_rearm 20 = 200 ms: quiet 110..128 (19), S at 129 starts nothing,
        # quiet 130..149 → re-armed; S at 150 → start 24000 − 8000 = 16000; quiet 151..170 (20th) → stop
        # short 171·160 = 27360.
        "name": "hop10_age_bound_and_rearm_bounded_in_time",
        "params": P10,
        "hop": 160,
        "probs": [(Q, 50), *_alt(S, M, 30), (Q, 19), (S, 1), (Q, 20), (S, 1), (Q, 25)],
        "expected": [
            ("start", 0),
            ("stop", 14400, "short", 0.9),
            ("start", 16000),
            ("stop", 27360, "short", 0.9),
        ],
    },
]


# ── segmenter vectors: a scripted fake model, frames in, edges on BOTH clocks ──
# `expected` rows are (kind, model_sample, leg_sample[, reason, max_p]). `frames` describes the uplink:
# `{"rate": client rate, "frame16": 16 kHz samples per frame, "client": client samples per frame,
# "drop": [received-frame positions after which ONE frame was lost]}`; `total16` is the leg's real length.
SEGMENTER_VECTORS: list[dict[str, Any]] = [
    {
        # Both hop conventions at 32 ms through the Segmenter (16 kHz: the two clocks coincide): START =
        # 20·512 − 8000 = 2240; confirm = the exclusive end of hop 26 = 13824; STOP = the exclusive end of
        # the 22nd quiet hop (51) = 26624 = the sample after the FULL silence run [15360, 26624).
        "name": "seg_conventions_32ms",
        "params": P32,
        "hop": 512,
        "script": [(Q, 20), (S, 10), (Q, 30)],
        "frames": {"rate": 16000, "frame16": 640, "client": 640, "drop": []},
        "total16": 60 * 512,
        "expected": [
            ("start", 2240, 2240),
            ("confirm", 13824, 13824),
            ("stop", 26624, 26624, "endpoint", 0.9),
        ],
    },
    {
        # …and at 10 ms: START = 60·160 − 8000 = 1600; confirm = end of hop 79 (the 20th S) = 12800; STOP =
        # end of hop 159 (the 70th quiet) = 25600 = speech end 14400 + 70·160. 27200 samples = 42½ frames.
        "name": "seg_conventions_10ms",
        "params": P10,
        "hop": 160,
        "script": [(Q, 60), (S, 30), (Q, 80)],
        "frames": {"rate": 16000, "frame16": 640, "client": 640, "drop": []},
        "total16": 170 * 160,
        "expected": [
            ("start", 1600, 1600),
            ("confirm", 12800, 12800),
            ("stop", 25600, 25600, "endpoint", 0.9),
        ],
    },
    {
        # Native-rate fallback (48 kHz: 40 ms = 1920 client samples, 640 at 16 kHz) with a DROPPED frame
        # after received frame 9 (frames 10.. carry leg_index (i + 1)·1920). Edges map through the frame
        # that CONTAINS them: START 2240 → frame 3 (m 1920), +320·3 → 5760 + 960 = 6720; confirm 13824 →
        # frame 21 (m 13440), +384·3 = 1152 → 22·1920 + 1152 = 43392; STOP 26624 → frame 41 (m 26240) →
        # 42·1920 + 1152 = 81792. (Hops added to a leg index would put the confirm at 41472, a frame early.)
        "name": "seg_native_48k_with_a_dropped_frame",
        "params": P32,
        "hop": 512,
        "script": [(Q, 20), (S, 10), (Q, 30)],
        "frames": {"rate": 48000, "frame16": 640, "client": 1920, "drop": [9]},
        "total16": 60 * 512,
        "expected": [
            ("start", 2240, 6720),
            ("confirm", 13824, 43392),
            ("stop", 26624, 81792, "endpoint", 0.9),
        ],
    },
    {
        # …at 44.1 kHz (40 ms = 1764 client samples; ratio 2.75625): START → 3·1764 + 320·2.75625 (882) =
        # 6174; confirm → 22·1764 + round(1058.4) = 38808 + 1058 = 39866; STOP → 42·1764 + 1058 = 75146.
        "name": "seg_native_44k1_with_a_dropped_frame",
        "params": P32,
        "hop": 512,
        "script": [(Q, 20), (S, 10), (Q, 30)],
        "frames": {"rate": 44100, "frame16": 640, "client": 1764, "drop": [9]},
        "total16": 60 * 512,
        "expected": [
            ("start", 2240, 6174),
            ("confirm", 13824, 39866),
            ("stop", 26624, 75146, "endpoint", 0.9),
        ],
    },
    {
        # A pre-roll before the leg's first sample clamps to it: crossing at hop 5 → 2560 − 8000 < 0 → 0 on
        # both clocks; confirm at hop 11 → 6144; quiet 15..36 → stop 37·512 = 18944.
        "name": "seg_preroll_clamps_to_the_leg_start",
        "params": P32,
        "hop": 512,
        "script": [(Q, 5), (S, 10), (Q, 30)],
        "frames": {"rate": 16000, "frame16": 640, "client": 640, "drop": []},
        "total16": 45 * 512,
        "expected": [
            ("start", 0, 0),
            ("confirm", 6144, 6144),
            ("stop", 18944, 18944, "endpoint", 0.9),
        ],
    },
    {
        # Flush: 15460 real samples = 30 hops + 100. Feeds judge hops 0..29 (start 2240, confirm 13824);
        # flush zero-pads the 100 to hop 30 and force-endpoints at its end 31·512 = 15872, CLAMPED to the
        # last real sample 15460.
        "name": "seg_flush_pads_and_clamps_the_stop",
        "params": P32,
        "hop": 512,
        "script": [(Q, 20), (S, 11)],
        "frames": {"rate": 16000, "frame16": 640, "client": 640, "drop": []},
        "total16": 30 * 512 + 100,
        "flush": True,
        "expected": [
            ("start", 2240, 2240),
            ("confirm", 13824, 13824),
            ("stop", 15460, 15460, "flush", 0.9),
        ],
    },
    {
        # …and a confirmation that lands IN the pad is clamped too: S 24..30 → the 7th S is the padded hop
        # 30 → confirm at 31·512 = 15872 → 15460; the flush stop likewise.
        "name": "seg_flush_clamps_a_confirm_in_the_pad",
        "params": P32,
        "hop": 512,
        "script": [(Q, 24), (S, 7)],
        "frames": {"rate": 16000, "frame16": 640, "client": 640, "drop": []},
        "total16": 30 * 512 + 100,
        "flush": True,
        "expected": [
            ("start", 4288, 4288),
            ("confirm", 15460, 15460),
            ("stop", 15460, 15460, "flush", 0.9),
        ],
    },
    {
        # Wave 1 (Emma): an edge EXACTLY on the first sample of the post-gap frame maps through THAT frame
        # (the containing-frame rule). 48 kHz, 640-sample frames, ONE frame lost after received frame 11 →
        # frame 12 starts at m 7680 with leg_index 13·1920 = 24960. Pre-roll 0, crossing at hop 15 →
        # START = 15·512 = 7680 = frame 12's first sample → leg 24960 (not frame 11's end, 11·1920 + 1920 =
        # 23040). confirm at hop 21 → 11264 → frame 17 (m 10880), +384·3 → 18·1920 + 1152 = 35712; quiet
        # 25..46 → STOP 47·512 = 24064 → frame 37 (m 23680), +384·3 → 38·1920 + 1152 = 74112.
        "name": "seg_post_gap_frame_start_maps_through_that_frame",
        "params": {**P32, "prefix_padding_ms": 0},
        "hop": 512,
        "script": [(Q, 15), (S, 10), (Q, 30)],
        "frames": {"rate": 48000, "frame16": 640, "client": 1920, "drop": [11]},
        "total16": 55 * 512,
        "expected": [
            ("start", 7680, 24960),
            ("confirm", 11264, 35712),
            ("stop", 24064, 74112, "endpoint", 0.9),
        ],
    },
]


# ── the per-model conformance literals (§3.4.1 ⑥; ruling H12) ──
# The first 93 hops (93·512 of the 48 000 samples) of `tests/data/silero_test_3s.wav`, recorded ONCE by
# R98's INDEPENDENT reference loop (`~/.cache/tmp/r98/models_lib.py` `Silero` — upstream `OnnxWrapper`
# minus torch: int16 / 32768 → [64 context + 512] windows, state [2,1,128], sr int64) via
# `record_conformance.py` (session-64 scratch), onnxruntime 1.30.0 + numpy 2.5.3, Python 3.14, emma,
# 2026-10-07. Never regenerated from `voice_vad`'s adapter. Tolerance 1e-5.
# fmt: off
CONFORMANCE_PROBS: dict[str, tuple[float, ...]] = {
    "silero-v6.2": (
        0.208342105, 0.817942977, 0.891195893, 0.996361434, 0.999177814, 0.999947906,
        0.999900639, 0.999774218, 0.999351859, 0.999929249, 0.999834538, 0.99892801,
        0.999912739, 0.999975324, 0.999911189, 0.999963522, 0.999724686, 0.999296486,
        0.999670744, 0.999961376, 0.999919295, 0.999923646, 0.999937773, 0.999807954,
        0.999794602, 0.999934435, 0.999889016, 0.999946237, 0.999868751, 0.999908566,
        0.999946654, 0.999985456, 0.999869943, 0.999951005, 0.999986887, 0.999988675,
        0.999964952, 0.999447942, 0.996697664, 0.998787582, 0.995920181, 0.998688221,
        0.999951005, 0.999964476, 0.999941647, 0.999920607, 0.999548912, 0.99998045,
        0.999975443, 0.999955893, 0.999963641, 0.999765635, 0.999174953, 0.999972343,
        0.999844491, 0.999944806, 0.999866486, 0.999887228, 0.999925137, 0.999480009,
        0.993775368, 0.933934927, 0.57569617, 0.328662515, 0.112767488, 0.0440740585,
        0.0275579691, 0.0209593773, 0.018194139, 0.0190632343, 0.0183052123, 0.0208184123,
        0.0195276141, 0.0161355138, 0.0154183209, 0.0165070295, 0.0193017721, 0.0163480043,
        0.0155114532, 0.019862771, 0.0155979097, 0.0167858601, 0.0250273347, 0.0332494974,
        0.830357909, 0.99737978, 0.999272108, 0.99978435, 0.999797344, 0.999974668,
        0.999975443, 0.999957919, 0.999957323,
    ),
    "silero-v5.1.2": (
        0.465079993, 0.738355696, 0.87628603, 0.957389891, 0.965630174, 0.99540019,
        0.996918917, 0.996883392, 0.996765614, 0.996768415, 0.996922612, 0.996188164,
        0.996710777, 0.999114573, 0.999626637, 0.998836875, 0.994625568, 0.969821632,
        0.992510855, 0.999565125, 0.999591708, 0.999487102, 0.999623239, 0.998674989,
        0.99898541, 0.999217689, 0.999616861, 0.999712765, 0.999671578, 0.999713838,
        0.999747932, 0.999706149, 0.998853445, 0.999407411, 0.999866664, 0.999834657,
        0.999814928, 0.998768985, 0.997022748, 0.977559566, 0.863551736, 0.992631495,
        0.999791682, 0.999702573, 0.999807298, 0.999848306, 0.999611139, 0.999657094,
        0.999692678, 0.999815345, 0.999851108, 0.994488239, 0.998100162, 0.999756575,
        0.999343693, 0.999453366, 0.999365807, 0.99876976, 0.997961044, 0.99758172,
        0.951733947, 0.795799732, 0.614729285, 0.421260715, 0.172974139, 0.0665563941,
        0.0275887251, 0.0131449103, 0.00493332744, 0.00275191665, 0.00251975656, 0.00140735507,
        0.0013807714, 0.00165569782, 0.00130844116, 0.00121793151, 0.0025280416, 0.00237268209,
        0.00279322267, 0.0025369525, 0.0018543601, 0.0011703968, 0.00119027495, 0.000711768866,
        0.597259581, 0.988301396, 0.997229695, 0.997931719, 0.999239445, 0.99950552,
        0.999595821, 0.999459684, 0.999395847,
    ),
}
# fmt: on


# The first second of a leg on SILENCE (§3.4.1 ⑥ "warm-up is a model fact"): the first 31 hops of zero
# input per model, recorded ONCE by the same independent R98 loop (`models_lib.Silero`, int16 zeros) via
# `record_zeros.py` (session-64 scratch, wave 1), onnxruntime 1.30.0 + numpy 2.5.3, Python 3.14, emma,
# 2026-10-07. Never regenerated from the adapter. Tolerance 1e-5.
# fmt: off
FIRST_SECOND_ZERO_PROBS: dict[str, tuple[float, ...]] = {
    "silero-v6.2": (
        0.00166979432, 0.00688385963, 0.00891068578, 0.00785717368, 0.00590658188, 0.0059607327,
        0.00585326552, 0.00564026833, 0.00543138385, 0.00519928336, 0.0050483048, 0.00490275025,
        0.00473588705, 0.0045850873, 0.00444743037, 0.00432762504, 0.00422737002, 0.00414559245,
        0.00407534838, 0.00401338935, 0.00395828485, 0.00390923023, 0.00386565924, 0.00382688642,
        0.00379216671, 0.00376090407, 0.00373259187, 0.00370693207, 0.00368359685, 0.0036624074,
        0.00364306569,
    ),
    "silero-v5.1.2": (
        0.0120120347, 0.00781652331, 0.00542414188, 0.00496998429, 0.00476396084, 0.00403249264,
        0.00326263905, 0.00275838375, 0.00255951285, 0.00243613124, 0.00235822797, 0.00234994292,
        0.00240647793, 0.00246354938, 0.00250440836, 0.00255233049, 0.0026101172, 0.00266420841,
        0.00271183252, 0.00275805593, 0.00280404091, 0.00284829736, 0.00289103389, 0.00293371081,
        0.00297534466, 0.00301599503, 0.00305190682, 0.0030786097, 0.00310394168, 0.00312772393,
        0.00314974785,
    ),
}
# fmt: on
