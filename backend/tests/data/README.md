# Test data fixtures

Every other test synthesizes its audio in-test; this directory is the deliberate exception (ASR_PLAN S6-i,
session-64 ruling H12): a VAD model's conformance needs REAL speech, and the owner's audio never enters git
(the L2 privacy rule).

| File | What | Provenance |
|---|---|---|
| `silero_test_3s.wav` | 16 kHz mono PCM16, 48 000 samples (0–3 s) | The first 3 s of `tests/data/test.wav` from `snakers4/silero-vad` at tag `v6.2` (MIT, "Copyright (c) 2020-present Silero Team" — see `app/assets/silero/LICENSE`), URL `https://raw.githubusercontent.com/snakers4/silero-vad/v6.2/tests/data/test.wav` (upstream sha256 `89f17d9c94c4b31eb320f424628bcbc920abaddbee6e2760fd868bfb1d9a2e47`, 1 920 044 B, 60 s), cut with the stdlib `wave` module on 2026-10-07. The cut's sha256: `70959e0d77f387a573c02c8e5d668c0346046b23fe18b8d8023d56668fb85112`. |

The expected per-hop probabilities the conformance test compares against are literals in
`tests/vad_vectors.py`, recorded ONCE by an independent loop (R98's `models_lib.Silero`), never by the
adapter under test.
