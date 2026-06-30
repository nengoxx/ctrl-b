# design/ — source design prototypes & visual specs

Static HTML/JSX design explorations that the shipped **ctrl-b v1.0** UI is built from. These are
**reference only** — never imported by `frontend/`; copy assets, don't link.

## prototypes/
The Claude-Design canvas export (grid launcher + variations + the design-canvas tooling).

- **`index.html`** — grid launcher; open it to browse all variations in phone frames.
- **`Nebula.html`** — standalone concept page.
- **`variations/`** — the theme explorations: `cosmos`, `frontier`, `minimal`, `observatory`,
  `phosphor`, and the two vapor specs:
  - **`vapor.html`** (112 KB) — the **evolved Vapor design = the D7 visual source of truth.**
    Every net-new UI component is a faithful port of this. Open at ~390px.
  - **`vapor-v1.html`** (42 KB) — the earlier Vapor iteration, kept for history. (The grid
    launcher's vapor frame points here — the page it was authored against.)
- **`vapor-preview.html`** — a single-variation phone-frame preview that iframes the 112 KB
  `vapor.html` spec.
- **`vapor-chats/`** — the design back-and-forth (`chat1..6.md`) behind the Vapor language;
  the *why* referenced by [`../docs/VAPOR_PATTERNS.md`](../docs/VAPOR_PATTERNS.md).
- `assets/`, `scraps/`, `uploads/`, `*.jsx` — images + the design-canvas tooling the launcher uses.

> Consolidated 2026-06-30 from the former `prototypes/` + `ctrl-b (Vapor)/` (byte-identical dupes
> dropped; the unique 112 KB evolved vapor promoted to the canonical `vapor.html` slot).
