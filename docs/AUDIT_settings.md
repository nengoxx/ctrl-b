# Audit — Settings read/write + the config→runtime design (pre-Phase-7a)

> **Status: HISTORICAL (superseded).** This pre-implementation audit shaped Phase 7a; its must-fix
> items (A1/A2) and the runtime-reconfigure seam all landed in 7a–7d (see `TODO.md` Phase 7 +
> `runtime.py`). Kept as the design-rationale record — do not work from it.

**Date:** 2026-05-29 · **Scope:** the `GET/PUT /api/settings` functionality about to be built (7a)
and the *current* config-loading / runtime-wiring design it plugs into. Goal: catch correctness
bugs, scalability traps, and cleanliness issues **before** Conf becomes a write path into
`config.yaml` (which holds the only copy of every secret + the live fleet/agent config).

Verdict: **one latent correctness bug that blocks settings-write the moment agents are involved,
one data-loss edge case that the 7a design must handle, and one architectural seam worth
establishing now so later Conf slices (7c+) don't accrue fragile per-adapter reload code.** None of
the read paths are broken today; the risk is entirely on the new *write* path.

---

## A. Correctness — must fix in 7a

### A1. `save_settings` crashes on any enum-typed field (e.g. a configured agent). **Blocker.**
`save_settings` does `settings.model_dump(mode="python")` then `yaml.safe_dump(...)`. The domain
enums (`Privilege`, `Risk`, `OSType`, `Actor`, `RunState`) are `StrEnum`. `mode="python"` keeps the
**enum member**, and PyYAML's `SafeRepresenter` dispatches on the *exact* type (`Privilege`), finds
no representer (str is registered, the `Privilege` subclass is not), and raises
`RepresenterError: cannot represent an object`.

- **Why it's hidden today:** `Settings.agents` is empty and nothing has persisted settings carrying
  an enum, so `save_settings` has never actually round-tripped one. The first `PUT /api/settings`
  that includes an agent (Phase 7d) — *or any save while `agents[]` is non-empty* — will 500.
- **Fix (in 7a, since PUT calls `save_settings`):** dump with **`mode="json"`** (StrEnum →
  `"confirm"`, datetimes → ISO, etc. — all YAML-safe). Verify nothing in `Settings` round-trips on a
  python-only type. Cheap, and it future-proofs every later section that carries an enum.

### A2. Secret round-trip data loss — masked values must not overwrite real secrets. **Must-have.**
`config.yaml` is the *only* store of SSH passwords + API keys. `mask_secrets` masks on read
(`api_key` → `ab…yz`); there is no inverse on write. A naive PUT that echoes the form back (with the
masked secret unchanged) would **persist `ab…yz` over the real credential** — silent corruption of
SSH/login keys.

- **Fix:** add `unmask_secrets(incoming, stored)` beside `mask_secrets` in `config.py`. Walk both
  trees; for any secret-hinted key whose incoming value is empty **or equals `_mask(stored)`**,
  substitute the stored raw value. A genuinely new (non-mask) string sets the secret.
- **Edge cases to honour:**
  - `_mask` of a ≤4-char or empty secret is `••••`/identical — preserve-on-match still does the
    right thing (treats as unchanged).
  - **List sections break under index-merge** (`mcp_servers`, `agents`, `computers` reorder/insert).
    7a only writes scalars (`inference`, `server`), so a positional walk is safe **here**, but the
    later slices that edit lists must use **dedicated endpoints / full-section replace with explicit
    secret handling**, never the generic scalar merge. Documented as a 7b/7c constraint.
  - Secret detection is **key-substring** (`password|secret|token|key`) → errs on the side of
    masking (a hypothetical `public_key` would be masked). Acceptable (safe direction); a future
    explicit secret-field registry would be more precise.

### A3. Validation errors must map to 422, not 500.
`Settings.model_validate(merged)` raises `pydantic.ValidationError` on a bad value (e.g.
`port:"abc"`). Catch it and return **422** with `e.errors()` so the frontend (`postJSON`/`putJSON`
already surface `detail`) shows field-level messages instead of a stack trace.

---

## B. Design / scalability — the seam to get right now

### B1. Hot-reload is ad hoc and does not scale. **Primary recommendation.**
Settings load once and are shared by reference. Consumers split into two camps:

| Camp | Examples | On a settings change |
|---|---|---|
| **Reads the shared `Settings` live** | `FleetService`, `ServiceService`, `Deps.settings` | In-place top-level update propagates automatically |
| **Captured a sub-config / built a stateful client once** | `InferenceClient` (per-`base_url` cache), `SearxngClient`/`OpenTerminalClient`/`EmbeddingsClient` (cached httpx), `ToolRegistry` + MCP/OpenAPI discovery | Needs an explicit rebuild — *and a fresh one for every new adapter* |

If 7a hand-rebuilds `InferenceClient`, 7c hand-rebuilds searxng/embeddings/open-terminal/MCP, 7b
invalidates fleet caches… that's N bespoke reload branches that are easy to forget and drift out of
sync. **It won't stay clean as features land.**

**Recommendation:** factor the lifespan's *settings → runtime graph* construction into a single
`build_runtime(settings) -> Runtime` (or `reconfigure(app, settings)`), used by **both** startup and
the PUT path:

```
PUT /api/settings:  validate → save → close old clients → build new runtime → atomic swap onto app.state
```

- New adapters are covered **for free** (they're built in `build_runtime`), no per-section reload
  code, no in-place mutation race (see B2).
- **Trade-off:** a save re-runs MCP/OpenAPI discovery (network I/O). Acceptable — saves are rare and
  discovery is already failure-isolated + non-fatal. Optimise later by diffing which sections
  changed and rebuilding only those (the same `Runtime` factory makes that a clean follow-up).
- **For 7a specifically:** only `inference` + `server.poll_seconds` are live-applied, so a *light*
  version (rebuild `InferenceClient`, in-place-update the shared `Settings`) ships the slice — **but
  introduce it behind the `reconfigure()` entry point** so 7c plugs adapters into one place instead
  of growing a second reload path. This is the cheap-now/clean-later move.

### B2. In-place mutation race.
Updating `app.state.settings` field-by-field while a fleet sweep or agent turn reads it can briefly
expose a half-updated object (new `inference`, old `server`). Single-user/low-traffic, so benign in
practice — but `build_runtime` + **atomic rebind** (`app.state.settings = new`) removes it by
construction. Either way, wrap PUT in an `asyncio.Lock` (read-modify-write of the merge isn't atomic;
two racing PUTs could interleave) — cheap insurance.

### B3. `restart_required` honesty.
`server.host`/`server.port` can't rebind the live uvicorn socket; `server.debug` is fixed at app
construction. PUT must **persist** these but return them in a `restart_required` list, and the UI
must show "restart to apply" — otherwise a user changes the port, sees "saved," and is baffled when
nothing happens.

### B4. Status caches serve a stale host/service list for up to `poll_seconds` after an edit.
After a `computers`/`poll_seconds` change, `FleetService._cache`/`ServiceService._cache` keep serving
the old roster until TTL. Minor; **force-invalidate both caches** when PUT touches those sections.
Note for 7b (hosts CRUD), not blocking 7a.

---

## C. Cleanliness / minor

- **C1.** *(Understated here — escalated during implementation, see §E.)* `save_settings` does a full
  `model_dump` → `yaml.safe_dump`, which doesn't just write `null`s: it **strips all comments,
  reorders sections to model-field order, and expands every default**. On a UI-driven config editor
  that's a destructive normalization of the operator's hand-curated file on the *first* save. Fixed
  with a comment-preserving patch writer (§E1).
- **C2.** No backend test exists for the settings round-trip. **Add one** covering: (a) save+reload of
  a config with an `agents[]` entry carrying `privilege` (would have caught A1); (b) mask→unmask
  preserves a real secret when the masked value is echoed back; (c) a new secret value overwrites;
  (d) a bad value → 422. Matches the repo's existing stub-test style.
- **C3.** `mask_secrets`/`unmask_secrets` should live together in `config.py` and be the *single*
  chokepoint every settings response/log line + every write goes through — don't reimplement masking
  in the router.

---

## D. Out-of-scope observations (noted, not for 7a)
- **`events` table grows unbounded** (no retention/pruning). Fine for now; a retention knob is a
  natural Conf → Server setting + a startup prune. Track when the events volume matters.
- **Memory table** (`db.py`) is defined but unused until 7e/vector recall — the `EmbeddingsClient`
  seam is ready; no action now.

---

## E. Found during implementation/verification (not in the static audit)

### E1. The save path destroyed the operator's `config.yaml` formatting. **Fixed.**
The static audit treated `save_settings` normalization as cosmetic (C1). Live testing showed the
truth: the **first PUT rewrote the whole file** — comments gone, sections reordered, every default
expanded (`role: null`, `cmd: {}`, …), strings unquoted. For a Conf tab whose *purpose* is editing
config, that fails the clean/stable bar. (It also briefly hit the owner's real file during testing;
recovered losslessly — reconstructed from the diff + proven byte-equivalent via validated dumps.)

**Fix (owner-approved):** added `ruamel.yaml` (pinned `0.18.10`) + a **patch-based, comment-
preserving writer** (`apply_patch_to_yaml`): the PUT computes the *minimal* changed leaves
(`prune_unchanged`) with secrets unmasked, then edits the existing file in place via a round-trip
load — comments, key order, quoting, and minimal-key style survive; unchanged lines (incl. unchanged
secrets) are never rewritten. The full-dump `save_settings` stays for programmatic/full writes.

### E2. EOL churn on Windows. **Fixed.**
`Path.write_text` translates `\n`→`\r\n` on Windows, so the first save flipped the LF config to CRLF
(every line "changed"). `apply_patch_to_yaml` now detects the file's existing EOL from raw **bytes**
(`read_text` universal-translates and hides it) and writes bytes directly — LF stays LF, CRLF stays
CRLF, new files default LF (repo convention; matters for the Linux/emma deploy too).

### E3. Process-hygiene lesson.
Write-path endpoints must be tested against a **temp config**, never the operator's real
`config.yaml`. The unit tests do this; the live smoke test should have too. Going forward: live
verification of a write endpoint uses a throwaway config + DB via `CTRLB_CONFIG`/`CTRLB_DB`.

---

## Action items — all folded into Phase 7a + **done** (see TODO.md, tests in `tests/test_settings_7a.py`)
1. **A1** — `save_settings` enum-safe (`mode="json"`).  ✔
2. **A2** — `unmask_secrets`; PUT preserves unchanged secrets.  ✔
3. **A3** — 422 on `ValidationError`.  ✔
4. **B1/B2** — single `reconfigure()` seam (single-source `set_*` builders, no lifespan↔reconfigure
   drift) + PUT `asyncio.Lock`. 7c+ extend the same module toward `build_runtime`.  ✔
5. **B3** — `restart_required` in the PUT response + UI note.  ✔
6. **C2** — round-trip tests (enum, secret-preserve, comment-preserve, EOL, 422, live-apply).  ✔
7. **E1/E2** — comment- + EOL-preserving patch writer (`ruamel.yaml`).  ✔
8. **B4** (cache invalidation) — done in `reconfigure`; full host-edit exercise lands with 7b.
