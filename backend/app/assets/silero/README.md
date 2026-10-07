# Silero VAD — vendored model files

The relay-owned ear's voice-activity models (Phase 26 / D82, `docs/ASR_PLAN.md` §3.4 + §3.4.1). Loaded by
`app/services/voice_vad.py` (one ONNX Runtime session per model per process); `voice.live.vad_model`
picks one. Both files are the upstream single-file export, **renamed from `silero_vad.onnx`** on vendoring
so the two versions can sit side by side. Their sha256 is pinned by `tests/test_voice_vad_s6i.py`.

| File | Registry key | Upstream tag | Upstream path | sha256 | Size |
|---|---|---|---|---|---|
| `silero_vad_v6.2.onnx` | `silero-v6.2` (default) | `v6.2` (= `v6.2.1`) | `src/silero_vad/data/silero_vad.onnx` | `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3` | 2 327 524 B |
| `silero_vad_v5.1.2.onnx` | `silero-v5.1.2` (A/B) | `v5.1.2` | `src/silero_vad/data/silero_vad.onnx` | `2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f` | 2 327 524 B |

- **Source:** `https://github.com/snakers4/silero-vad` — raw URLs
  `https://raw.githubusercontent.com/snakers4/silero-vad/v6.2/src/silero_vad/data/silero_vad.onnx` and
  `https://raw.githubusercontent.com/snakers4/silero-vad/v5.1.2/src/silero_vad/data/silero_vad.onnx`.
- **Fetched:** 2026-10-07 (copied from R98's measured copies, `~/.cache/tmp/r98/models/`, and re-verified
  byte-for-byte against the upstream raw URLs above the same day — identical sha256).
- **Licence:** MIT, "Copyright (c) 2020-present Silero Team" — `LICENSE` here is upstream's, fetched from tag
  `v6.2` (the same text ships at `v5.1.2`).
- **IO contract (both files):** `input [1, 64 + 512]` float32 @ 16 kHz (64 context samples + one 512-sample
  hop), `state [2, 1, 128]` float32, `sr` int64 → `output [1, 1]` P(speech) + `stateN`.
- **Why two:** v6.2 is the default (R98 §2.3, measured on emma); v5.1.2 stays registered as the replay
  A/B. A swap is a re-calibration (ASR_PLAN §3.4.1 ④/⑤).
