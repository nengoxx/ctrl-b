# ATTACHMENTS_PLAN — composer attachments (ROADMAP A8)

**Status: DESIGN v2.3 (2026-09-01) — COUNCIL-CLOSED + OWNER-RATIFIED + the same-day UX
amendments Emma-checked.** v2.2 = the ratified council close (§11; transport B unanimous; the
§0b-2 overrule: bubble image display IS v1). v2.3 adds the owner's composer-UX rulings (quiet
clip · in-composer thumbnails · the S5 expand slice) + the Emma amendment round's fixes (§11
tail). **BUILD IN PROGRESS: S0 ✅ (`756996b` + the HEIC check: camera = JPEG) · S1 building ·
R62 (composer grammar) in flight — it pins the §7 layout + S5 behavior before the S3/S5 briefs.**

Evidence: [`research/R61-chat-attachments-field.md`](./research/R61-chat-attachments-field.md) +
[`R54`](./research/R54-crop-upload-client.md)/[`R55`](./research/R55-media-upload-backend.md) +
[`R53`](./research/R53-truncated-reads-and-destructive-guards.md). Owner rulings from the
2026-09-01 design talk (§0a). On conflict, DECISIONS wins. Council record: §11.

---

## §0a Goal + the owner's rulings (2026-09-01, prose)

Attach files to a chat message from the composer — an attach button beside the mic — so the agent
can see phone photos/screenshots and read documents. ROADMAP A8 rules the FE shape: attach is core
composer **chrome in every variant** (mic precedent), behavior in the headless `useComposer()`.

1. **Scope = images + text files + PDFs.** NOT configs/logs (the owner asks the agent to read those
   itself). Phone photos, screenshots, `.txt`, PDFs.
2. **No embeddings/RAG.** Whole-content injection (Hermes precedent; R61: only multi-user apps
   build retrieval).
3. **Files PERSIST somewhere the model can come back to** — "check the file again", "remember this
   file from a couple turns ago". Durable per-thread files, not transient payload.
4. **No-vision = minimal machinery.** No probing, no composer gates, no capability adapters. The
   organizational fallback is the owner's: route to a vision-capable provider (OpenRouter) when
   vision matters.
5. **Both worlds**: local llama.cpp (qwen3.6-max) and cloud (OpenRouter now, A13 Codex later);
   small local models must cope.
6. Standing rules: everything tunable · typed-action for new execution paths · least-future-debt ·
   extend-not-migrate.

## §0b OWNER-RATIFIED 2026-09-01 (the S0 gate is OPEN)

1. **Transport B — RATIFIED** (council-unanimous; §3).
2. **Bubble image display is IN v1 — the main seat's no-GET-route conservatism OVERRULED** (owner:
   "I want this feature to be complete"; single-user, the owner uploaded the bytes). The serving
   route is a pattern reuse of the D65 media mount, not a new surface class — §7/§8 carry the
   design.
3. **PDF bounds SOFT — RATIFIED**, with the owner's framing made binding: the model must know
   exactly what it read and where the cap sits — the §4.2 marker always names lines-shown/total
   and the paged continuation.
4. **`max_inline_chars` 16k — RATIFIED**, conditional on the paged `read_attachment` letting the
   agent reach the whole file (it does: §4.4's D64 contract).

## §1 What we REUSE vs BUILD (map corrected by the council)

| Seam | Where | Reused for |
|---|---|---|
| Message-has-parts union | `domain/conversation.py` (additive part type, JSON column) | `AttachmentPart` — no migration |
| One assembly point | `session.py:_assemble` | the array-content branch |
| Media persist pipeline | `core/media.py` admission predicates + atomic ladder + `.part` staging (D65) | **directory-parameterised reuse** — the attachment store is NOT a second implementation (council M9/E9), and its write route extends the §2.7 test pins |
| Paged tool reads | D64 (`offset`/`limit`, past-EOF refusal, marker names the next call) | `read_attachment`'s contract AND the injection framing (§4.2) |
| InvocationContext plumbing | the D64 `RecallState` precedent | the NEW `thread_id: str | None` field (§4.4) — fails closed when absent |
| Headless composer | `useComposer()` + mic gate precedent; `ComposerSlots` | attach button + staging state |
| FE image libs | `lib/imageProbe` + `lib/imageExport` (R54 q0.85 worker) | attachment downscale — not the gallery's `useImageJob` machine (different lifecycle; council-confirmed sound) |
| Thread deletion | `conversation.py:79 delete()`; automations' turn-marker discipline | retention hook (any future user-facing delete endpoint must take the turn marker — E-sound) |
| Config tunables | `config.py`; unified-object precedent | the `attachments:` block |

**Corrections vs v1 (council):** `normalize_system_messages` is called ONCE per call at
`inference.py:1381/:1514`, *before* `_resolve_chain` — it is NOT per-hop; the strip lives inside
`attempt(entry)` instead (§5). And "compacted turns render a stub" was impossible as written —
`_assemble` reads `include_compacted=False`, so compacted parts are absent; §4.5 has the real
mechanism.

**New machinery (the complete list):** the staging/claim transport (§3) · `AttachmentPart` + the
assembly branch + the per-turn data-URL cache · the per-hop strip (~2 files + one resolver field) ·
`read_attachment` + `InvocationContext.thread_id` · PDF extraction (pypdf, new dep) · `useAttachments`
FE hook + chips + one bubble-renderer branch · steer-path claim · config block + SECURITY_MODEL entry.

## §2 Data shape + storage

- **`AttachmentPart`** on the user `Message`:
  `{type:"attachment", kind:"image"|"text"|"pdf", name, mime, path, bytes, width?, height?,
  inline_chars?}` — `name` is the EXACT stored (collision-suffixed) name; `path` store-relative;
  **never inline data** (R61's anti-pattern). **Persist the FACTS, price at estimate time**
  (confirm N1): `inline_chars` is the extracted length, a fact; the estimator arm prices
  `min(inline_chars, cfg.max_inline_chars)` and `cfg.image_tokens` at READ, so retuning a knob
  never leaves stale baked prices on old rows. **The server constructs every `AttachmentPart`**
  at claim — the client sends only opaque ids (E2).
- **The store:** `$CTRLB_HOME/attachments/{thread_id}/{name}` + one flat `staging/` dir. Writes go
  through the directory-parameterised media persist pipeline (admission predicate, sniff, atomic
  ladder). **Kinds & admission:** images = magic-byte sniff (PNG/JPEG/GIF/WebP; SVG is NOT an
  image); PDF = `%PDF-` signature; text CANNOT be byte-authenticated → explicit extension/MIME
  allowlist + bounded strict UTF-8 decode (decode failure = refusal) (E-sweep). PDFs store the
  original + an extracted-text sidecar.
- **Dereference hardening (E9):** one attachment bare-name predicate (reusing the media rules);
  open only regular files (`lstat`, no symlinks); verify the resolved parent is exactly the
  resolved thread directory. The server resolves paths from ITS OWN stored refs only.
- **Retention:** thread delete removes the thread's dir; boot sweep removes (a) staged files older
  than `staging_orphan_hours` and (b) store dirs whose thread row is gone — and MUST preserve
  younger unclaimed staging (a first chat POST may not have arrived yet) (E-sound).

## §3 Transport — RULED: B, id-addressed staging + claim-by-rename (council-unanimous)

**The shape:** `PUT /api/attachments/staging/{filename}` (raw body; the filename rides the path —
the D65 convention — and the **bare-name predicate runs at mint, before any byte streams** (O-conf):
a refusable name never costs a 10 MB write). The server mints and returns an opaque
`attachment_id` + the sniffed kind + the admitted **candidate** name — the FINAL collision-suffixed
name is resolved at claim, when the thread exists (E-conf NEW 2). Bytes land in `staging/` via the
streamed-counter ladder (413 mid-body, R55) → `ChatRequest.attachments: [attachment_id]` → the
chat POST (which creates the thread as it does today, `agent.py:1128`) **claims** each id:
validates unclaimed + young, `os.replace`s into `{thread_id}/`, then writes the message. The claim
path is the ONLY writer into `{thread_id}/` — test-pinned (O-conf). Same-filesystem rename; the
D65 ladder verbatim; no client-named paths anywhere.

**Crash window (E-conf NEW 1, accepted + reconciled, no rollback machinery):** rename-then-insert
means a crash between the two leaves an unreferenced file inside a LIVE thread dir (and the retry
correctly refuses the consumed id). The boot sweep therefore also reclaims files inside live
thread dirs that no persisted `AttachmentPart` references, age-bounded so it can never race a
claim in flight — the D65 "dangling names self-heal" philosophy, one sweep arm + one test.

**Why not A (inline base64):** killed on evidence, not taste — five 10 MiB files ≈ 67 MB of JSON
parsed in RAM *before* any validation runs; no request-body cap exists anywhere in the stack
(uvicorn config checked), so A has NO pre-parse admission boundary, and a crash between disk fold
and SQLite commit needs the same orphan sweep B has — A's "atomicity" was not real (E3, 0.98).

**Why not thread-addressed PUT (v1's B):** the thread doesn't exist until the chat POST creates it
(`agent.py:1128`; the FE never pre-creates) — thread-PUT forces eager creation and an
empty-thread-orphan class (O-M5, E1). Id-addressed staging removes thread identity from the upload
entirely — which also pre-builds the landing a future `share_target` needs.

**Claim contract (E2):** ids are server-minted random hex — unguessable, never client-authored; a
claim of a consumed/expired id **refuses** (409, naming the fix: re-attach the file). A chat-POST
retry after a lost response therefore refuses rather than double-claiming — the same accepted
lost-response class the media manager recorded (W10); recorded residual, not machinery.
**Steers (E7):** send-while-streaming is a supported path — `SteerEntry` grows the id list and the
drain claims them in its existing persist transaction; attachments are NEVER silently dropped from
a steer.

## §4 Feeding the model

- **4.1 Images:** at assembly, image parts on user turns render as
  `{type:"image_url", image_url:{url:"data:…;base64,…"}}` beside the text part (the 7/7 field
  shape). Client downscale caps real payloads (§6). Two bounds the council added: a **per-assembled-
  request image ceiling** (`max_images_per_request` — history accumulation is otherwise unbounded;
  oldest degrade to the §4.5 stub first) and a **per-turn revision-keyed data-URL cache** (plain
  dict on the session, dropped at turn end — `_assemble` runs every loop iteration and would
  otherwise re-read + re-encode tens of MB per call; E5). Estimator: `AttachmentPart` arm pricing
  the persisted facts at read (§2; `attachments.image_tokens`, default 1000). Codex's resize
  notice adopted (one developer-role line naming original→sent dimensions). The ceiling's
  oldest-first degrade churns the assembled prefix when it binds — RULED an accepted residual with
  a telemetry trigger, §10 (O-conf N2).
- **4.2 Text files:** injected inline in the user turn, framed as **tool OUTPUT in the D64 marker
  convention** — `read_attachment("notes.txt") → lines 1–200 of 900; continue from offset 201:` +
  content — NOT as prose narrating a call ("Called the X tool with…"): a small model shown a
  tool call rendered as text learns to imitate text, and mismatched synthetic args teach a call
  shape that 400s (O-M7; supersedes v1's opencode-transcript form — same zero-new-vocabulary goal,
  no imitation surface). Truncation at `max_inline_chars` with the visible marker naming the paged
  call.
- **4.3 PDFs:** original stored; text extracted ONCE at claim (pypdf, new justified dep) in
  `asyncio.to_thread`, bounded by `max_pdf_pages` + `max_extracted_chars` — **soft bounds,
  documented honestly** (they stop iteration, they cannot kill one pathological `extract_text`
  call; §0b-3). Extraction failure (scanned/image-only) → sidecar holds an honest one-liner; the
  original is kept; OCR out of scope. The sidecar then IS a text file — one §4.2 code path.
- **4.4 `read_attachment` (ruling #3's mechanism):** typed registry tool, read-only, LOW risk.
  Confinement = the NEW server-owned `InvocationContext.thread_id` (D64-precedent plumbing through
  `ActionService.invoke` + the session/automation construction sites; **fails closed when absent**;
  never a model-supplied argument — O-M6/E8 verbatim-convergent). Name-addressed against the exact
  stored names; D64 paged contract; PDF reads resolve to the sidecar. **Called with no `name` it
  returns the thread's attachment manifest** (name · kind · size) — the discovery affordance that
  makes post-compaction and resumed-session re-reads possible (O-H2).
- **4.5 History + compaction:** attachments re-send by default (`resend: true`; 7/7 field —
  Anthropic docs: dropping history images breaks follow-ups). With resend OFF, or beyond the §4.1
  ceiling, the part renders as a stub naming the file and that `read_attachment` re-opens it.
  **Compaction (the real mechanism — v1's was impossible):** the summarizer's transcript renders a
  bounded **attachment manifest line per folded message** (exact stored names + kinds) and the
  summary template instructs preserving those names verbatim — so the identity survives the fold
  and the re-read path stays alive; bytes are never resent from compacted turns (O-H2 + E6,
  convergent). `estimate_tokens` gains the `AttachmentPart` arm (H3).

## §5 No-vision — the strip, placed where failover actually happens

The strip lives **inside `attempt(entry)`** in both `complete` and `stream_chat` — the only place
the serving endpoint is known (the v1 chokepoint claim was wrong; §1). `_ChainEntry` IS
`ResolvedTarget` (`inference.py:733`) and `attempt`'s `_open` already merges per-endpoint
`call_kwargs` — the strip is one more derived key there, no new plumbing (O-conf). Name it
`drop_unsupported_modalities`, NOT `strip` — that name already means the D46 reasoning-param retry
in the same function (O-conf rider). Discipline (E4): the
normalized message list is the immutable source; each hop derives a fresh list (strip = a filtered
COPY when the hop's model lacks image input; never mutate the shared/cached head dicts — the
`normalize_system_messages` non-mutation rule verbatim). So a non-vision fallback never receives
image parts, and a vision fallback after a non-vision primary still gets the real images.
**Pinned by a two-hop test in both capability directions.**

Capability = **`input_modalities: list[str] | None` on the model catalog entry** (not a `vision`
bool — the bool guarantees sibling bools; the list is the external convention: OpenRouter's
`architecture.input_modalities`, opencode/goose catalogs; O-M4), plumbed as one additive frozen
field onto `ResolvedTarget`. `None`/absent → text-only (conservative default). The stripped-image
stub is opencode's instruction **verbatim** — `ERROR: Cannot read "x.jpg" (this model does not
support image input). Inform the user.` — the model tells the owner, which is also the honest
answer to "does attribution record the drop": `SourceInfo` stays untouched (O-M8).

## §6 Config (`attachments:` block — all tunables)

`max_files_per_message: 10` · `max_file_mb: 10` · `image_max_dimension: 2048` ·
`image_quality: 0.85` · `max_inline_chars: 16000` (§0b-4) · `image_tokens: 1000` ·
`max_images_per_request: 10` · `resend: true` · `staging_orphan_hours: 24` ·
`max_pdf_pages` / `max_extracted_chars`. Decode guard ≥64 MP (Honor 20). Field-clustered numbers
(R61 §9.1), not inventions.

## §7 Frontend

- `useComposer()` grows staging state; `useAttachments` owns pick/admit/downscale/PUT (reusing the
  libs, §1); chips with thumbnail (local file) + status + remove; per-file failure rows never block
  the send of healthy files; paste + drag-drop with the `items` fallback; every variant renders
  attach (A8 chrome ruling).
- **The mic auto-send path is pinned (E-amend b):** `useDictation` bypasses `useComposer().send()`
  and calls `runComposer` directly, then clears the draft — staged attachment ids MUST ride that
  auto-sent message (or steer) exactly as they ride a button send, and clear WITH it, never
  orphaned in staging; an explicit S3 test covers the dictation-auto-send-with-staged-files path.
- **Docked-sheet geometry is an EXPLICIT S3 ruling, not "parity" (E-amend LEFT-OFF 1):** the sheet
  variant embeds the mic inside `.field` with the tall send outside it, so "clip beside mic/send"
  and "thumbnails riding the field" do not uniquely place either there — the S3 brief carries a
  ruled sheet placement (informed by R62), and the owner eyeballs it in S6.
- **The owner's UX ruling (2026-09-01, second talk — binds S3's presentation):** the attach
  affordance is a **clip icon beside the mic/send** (Telegram's placement) — and styled QUIET
  (owner, third talk): Telegram's gray clip is the reference, "not a full icon like the mic or
  send is … nothing flashy, just something clean" — a muted/ghost treatment, visually subordinate
  to the action pair. Staged images show as **thumbnails riding the growing composer** with text
  entry continuing beneath — the owner keeps typing OR dictating with attachments staged (the mic
  is never blocked by staged files); send ships caption + attachments as **ONE message**. The
  layout is **OWNER-RULED on R62's evidence (2026-09-01): grammar ② — the in-composer
  horizontally-scrolling thumbnail RAIL** (Signal/LLM-peer shape; the composer grows exactly as it
  does for multi-line text, the rail rides above the field). The Telegram caption modal is
  explicitly NOT wanted; Telegram contributes only the clip's quiet icon STYLE and the expand
  button. R62's steals ride along: named per-file refusals + a per-chip hint when the current
  model can't see images.
- **The expand affordance is IN-PHASE (owner, third talk — promoted from the recorded candidate):**
  the Telegram-style control that appears once the draft fills a couple of lines. **The LINE
  composer is the primary target** ("the line composer has very little space"); the other variants
  get it if the seam is genuinely shared — never a per-variant fork. The current grow-upward-
  keeping-the-buttons-at-the-bottom behavior stays the baseline. What the control actually DOES —
  Telegram's may be true fullscreen or just a taller field; the owner hasn't tried it — is exactly
  R62's question 7; the owner rules on the behavior after the evidence lands. Built as its own
  slice (§9 S5) after the attachment FE.
- **Attachment-only sends are legal** (both lenses' sweep: today `text` min_length=1 + an FE
  empty-text early return make the send-a-photo flow a 422): with staged ids, empty text is
  allowed; the server injects R61's `ATTACHMENT_ONLY_TEXT` ("Please refer to the attached
  file(s).") as the wire text part, titles the thread from filenames, and memory-recall seeding
  uses the filename surrogate (E-audit).
- **One `AttachmentPart` bubble-renderer branch** (E11, widened by the §0b-2 overrule): IMAGE
  parts render the actual image in the bubble (`<img src="/api/attachments/{thread_id}/{name}">`,
  lazy, CSS-bounded; tap → full-size via the existing overlay + `useOverlayBackGuard` primitives);
  text/PDF parts render the name/kind/size chip. **The GET route** reuses the D65 media mount's
  serving pattern (`api/media.py`: lookup + ETag response, the disabled-404 discipline): stored
  attachments are immutable once claimed, so plain strong caching, no `?rev` needed. Pre-send
  chips keep their local-file previews as before.
- **Recorded, NOT v1:** Android `share_target` with files (0/7 peers; the staging shape is its
  ready landing) · crop-before-send. *(Post-send image previews were promoted INTO v1 by the
  §0b-2 overrule; the old exclusion is superseded.)* **HEIC — S0 check RAN 2026-09-01: the Honor
  20's camera photos arrive as JPEG** (a camera shot admitted + decoded through the media picker;
  a HEIC source refuses by name at the R54 probe) — the refusal copy covers foreign files only,
  the primary device is unaffected (O-sweep closed).

## §8 Security (SECURITY_MODEL gets a §2.7-sibling entry)

Store confinement per §2 (bare-name predicate · no symlinks · resolved-parent check — the media
rules reused, no second sanitizer) · server-minted ids only · magic-byte sniff, SVG excluded ·
text = allowlist + strict decode (serving rules below — stored bytes are never ACTIVE content) ·
no remote-URL fetching by construction · `read_attachment` read-only + thread-confined + fail-closed ·
the staging PUT is non-safelisted (§2.7 verbatim) and its no-CORS negatives extend the existing
D65 test pins (O-M9) · **the GET route serves ONLY sniffed image types inline** (SVG unreachable
by construction — never admitted as an image); text/PDF serve with `X-Content-Type-Options:
nosniff` + `Content-Disposition: attachment` (inert, never active content); the route is
read-only, thread-dir-confined through the same §2 dereference rules · pypdf bounds honest per
§0b-3 · FTS/session-search does NOT index attachment names or content — accepted under the
no-RAG ruling, stated (E-audit).

## §9 Slices (standing cadence per slice)

- **S0** docs: D-entry · SECURITY_MODEL · ROADMAP/TODO rows · the HEIC device check — **✅ DONE
  2026-09-01** (`756996b` + the check: NOT HEIC, camera = JPEG).
- **S1** backend store + staging/claim transport + `AttachmentPart` + retention/sweep + steer-claim.
  Tests: traversal/symlink/oversize/sniff/decode refusals · mint-time name refusal (pre-stream) ·
  claim races (consumed id, expired id, two devices) · claim-is-the-only-writer pin · the
  unreferenced-file-in-live-dir reconcile (crash window) · sweep age bounds.
- **S2** model feed: assembly branch + per-turn cache + assembled ceiling + **the estimator arm
  (explicit item + test — it silently degrades every long thread if skipped; O-sweep)** + the
  per-hop strip (**two-direction two-hop test**) + `read_attachment` + `InvocationContext.thread_id`
  + compaction manifest + resize notice.
- **S3** FE: `useAttachments` + chips + the bubble branch (image display + tap-to-full-size) +
  the GET serving route (+ tests: image inline w/ sniffed type · text/pdf nosniff+disposition ·
  confinement refusals · 404 on unclaimed/missing) + attachment-only sends + variants parity —
  incl. the RULED docked-sheet placement (§7) and the dictation-auto-send-with-staged-files test
  (§7's mic pin) — + e2e.
- **S4** PDF extraction sidecar + failure copy.
- **S5** the composer expand affordance (owner-promoted 2026-09-01): R62-informed + owner-ruled
  behavior; line composer first, quiet trigger control per the §7 styling ruling. **The seam is
  already shared (E-amend c):** `useComposerChrome` owns auto-grow for all three variants, so the
  expansion behavior extends THAT hook while only LineComposer renders the initial affordance —
  no per-variant fork exists to write.
- **S6** owner device round: phone pick/paste/send/re-read · attachment-only photo send · vision on
  OpenRouter · no-vision on qwen (expect the in-band ERROR) · a real PDF · a compacted-thread
  re-read via the manifest · the expand control on the phone's line composer.

## §10 Recorded residuals (accepted, not machinery)

Lost-response chat retry refuses consumed claims (the W10-class residual) · PDF bounds soft ·
FTS blind to attachments · pypdf is the one new dep · **prefix-cache
churn when `max_images_per_request` binds** (O-conf N2: oldest-first degrade mutates the assembled
front once per image-adding turn past the ceiling; bounded, and OBSERVABLE — per-call
`cached_tokens` is already persisted (D62/ACA-18); if telemetry shows real churn, the recorded
refinement is a fold-boundary-aligned degrade so the front changes in jumps) · claim-time (not
write-time) thread confinement — a rule, not a directory property; held by the claim-only-writer
test pin (§3).

## §11 Council record (2026-09-01)

**Cadence:** main-seat draft v1 → two parallel independent lenses — Emma lane (sol high, blind,
`--ignore-rules`; correctness/edge/failure/security lens) + one adversarial Opus 5 high agent
(architecture/right-sizing/aging/small-model lens) — different briefed lenses, R46 structure
(scope-not-assurance, seeds+open sweep, severity definitions, recall-first). **Both verdicts: BUILD
WITH CHANGES. Both independently ruled transport B.** Load-bearing findings main-seat-verified in
code before acceptance (strip call sites `inference.py:1381/:1514` pre-chain · estimator arms ·
`include_compacted=False` · lazy thread creation `agent.py:1128`).

| # | Finding (lens) | Disposition |
|---|---|---|
| O-H1/E4 | strip chokepoint not per-hop; shared list mutation across hops | ACCEPTED, convergent — §5 rewritten (inside `attempt`, fresh derived list, two-hop test) |
| O-H2/E6 | compacted-stub impossible; identity lost in fold; tool unreachable after compaction | ACCEPTED, convergent — §4.5 manifest + no-arg manifest read (§4.4) |
| O-H3 | inline expansion invisible to estimator | ACCEPTED — cost persisted at claim; estimator arm; explicit S2 item |
| O-M5 vs E1 | staging shape CONFLICT: flat id-addressed (Opus) vs thread pre-creation (Emma) | **RULED: id-addressed** — server-minted ids answer Emma's confinement HIGH without the empty-thread orphan class; E2's claim/idempotency contract layered on top |
| E2 | claim identity/idempotency underspecified | ACCEPTED — §3 contract (opaque ids, server-built parts, refuse-on-consumed = recorded residual) |
| E3 | A has no pre-parse admission boundary; atomicity not real | ACCEPTED — A killed on evidence (§3) |
| E5 | unbounded per-iteration image re-read | ACCEPTED — per-request ceiling + per-turn revision-keyed cache (bounded, no cache service) |
| E7 | steer path silently drops attachments | ACCEPTED — `SteerEntry` carries ids; drain claims (§3) |
| O-M6/E8 | `InvocationContext` has no thread id | ACCEPTED, verbatim-convergent — server-owned optional field, fail-closed (§4.4) |
| E9/O-M9 | second sanitizer / second store implementation | ACCEPTED — directory-parameterised media pipeline + extended §2.7 pins (§1/§2/§8); also the aging hedge (future promote-to-art = rename) |
| O-M4 | `vision: bool` wrong grain | ACCEPTED — `input_modalities` list, external convention (§5) |
| O-M7 | synthetic call-transcript teaches small models a wrong convention | ACCEPTED — D64-marker OUTPUT framing (§4.2) |
| O-M8 | stub wording; attribution question | ACCEPTED — opencode ERROR verbatim; `SourceInfo` untouched (§5) |
| E10 | PDF compute bound unenforceable; claim-time blocking | ACCEPTED AS RULED — to_thread + soft bounds honest (§0b-3); worker process REJECTED (machinery ruling) |
| E11 | no bubble renderer for the part | ACCEPTED — §7 branch |
| Both sweeps | attachment-only sends impossible today | ACCEPTED — §7 (`ATTACHMENT_ONLY_TEXT`, filename title/recall surrogate) |
| O-sweep | HEIC unknown on the primary device | ACCEPTED — check moved to S0 |
| O-L10 | small inline default | ACCEPTED — 16k (§0b-4) |
| O-aging | two byte stores w/ no path between | HEDGED via E9/O-M9 reuse; promote-to-art recorded as future rename |

**Confirm rounds (2026-09-01, both same-session/context-intact):**
- **Opus lens: BUILD AS DESIGNED** — every finding verified resolved (H1 "lands on a better seam
  than I proposed": `_ChainEntry` = `ResolvedTarget`, the `call_kwargs` merge); the M5 conflict
  ruling sanity-checked CONFIRMED (nothing material of the confinement concern survives
  server-minted ids). Riders folded: `drop_unsupported_modalities` naming · mint-time name
  predicate · claim-only-writer pin. New: **N1** (persisted `est_tokens` bakes live tunables —
  ACCEPTED as prescribed, facts-only §2) · **N2** (ceiling degrade churns the prefix front —
  ACCEPTED AS RESIDUAL with the `cached_tokens` telemetry trigger + recorded refinement, §10).
- **Emma lane: RESOLVED WITH NEW FINDINGS** — all 12 findings + the consumer audit verified
  resolved line-by-line. New: **NEW 1 HIGH** (claim rename cannot sit inside the SQLite message
  transaction; crash window leaves an unreferenced file in a live dir the v2 sweep missed —
  ACCEPTED: the sweep's referenced-set arm, §3) · **NEW 2 MED** (staging metadata carrier
  unspecified + mint-time final-name promise impossible — ACCEPTED: filename in the PUT path,
  candidate-name-at-mint / final-name-at-claim, §3).
- **Main-seat close:** all four confirm-round findings folded (this revision); Emma's
  micro-confirm on the NEW 1/NEW 2 folds returned **RESOLVED · RESOLVED · CLOSED**; both lenses'
  verdicts stand.
- **The UX amendment round (2026-09-01, same day):** the owner's second/third talks added the §7
  composer rulings + promoted the expand slice (S5). Emma re-checked the deltas against the
  composer code: **(a) §8 serving contradiction — fixed** (stale "no serving in v1" wording) ·
  **(b) the mic auto-send bypass** (`useDictation` → `runComposer` directly) **— pinned in §7 +
  an S3 test** · (c) the expand seam CONFIRMED shared (`useComposerChrome` owns auto-grow for all
  three variants) · (d) HEIC result consistent · LEFT-OFF 1: docked-sheet clip/thumb geometry —
  now an explicit S3 ruling, not "parity" · LEFT-OFF 2: stale status header — fixed (v2.3).
- **S1 AS-BUILT (2026-09-01, `fce822e` — Opus from the pinned brief; full gate green 6/6, BE
  2,002→2,068, 66 new tests):** `core/attachments.py` + the staging route + the claim seam +
  retention/sweeps, with `core/media.py` parameterised (one persist pipeline, `StoreWriteError`,
  shared `admit_filename`) — the M9/E9 reuse mandate held. **Main-seat audit: all 11 declared
  deviations ACCEPTED** — headline: the claim lands by `os.link`+`os.unlink` (exclusive-claim; the
  plan §3's `os.replace` shorthand would have CLOBBERED the collision suffix — §3 stands corrected
  by this record) · text MIME from the extension table, never the client's header · drain-refused
  attachment-only steers persist no message · one age rule for claim and both sweep arms. **The
  builder's weak-pin discovery CONFIRMED by the main seat** (the D65 route-table loop matched 0
  routes under this FastAPI — `app.routes` holds wrapper objects) and **FIXED in place**
  (OpenAPI-paths assertion, this commit). **§10 gains two instances of the accepted
  unreferenced-file class:** a 415-after-move claim sniff, and `claim_all`'s
  refusal-not-move atomicity. **Recorded for the S1 Emma round (OWED — paused on the owner's
  budget directive):** a new thread created by a send whose claim then refuses lingers empty (the
  retry mints a second thread) — LOW, rule fix-or-accept there.
- **Owner ratification (2026-09-01, prose):** all four §0b calls ruled same day — B ratified ·
  **bubble image display IN v1 (overruling the main seat's no-GET-route call**; the route is a
  D65-mount pattern reuse and the §8 serving rules carry the hardening — ruled by the main seat
  as NOT requiring a fresh council round: same reviewed class, additive read-only surface,
  recorded here) · PDF soft bounds with the cap always model-visible · 16k conditional on the
  paged reach (satisfied). Design CLOSED at v2.2.
- **S1 EMMA-LANE ROUND (2026-09-01, second session — blind sol high, `--ignore-rules`, over
  `fce822e`+`adfddf6` against §2/§3/§8/§9-S1; R46 brief with the known-findings list, the
  recorded LOW as an explicit question-10 ruling ask, bounded open sweep): VERDICT — SHIP WITH
  FIXES.** Recorded verbatim-faithful; **NOTHING ruled or built** (the owner's ~98%-usage
  directive: no fix wave, hand off — the fix wave is the NEXT session's first move).
  - **MED-1 (conf 0.99, reviewer-REPRODUCED):** boot retention escapes `$CTRLB_HOME` through a
    SYMLINKED attachments root — `sweep_thread_dirs()` never rejects the root itself as a
    symlink, so old regular files under an unrecognized child dir of the link target are deleted
    as dead-thread data (her repro: `removed=1` on an outside victim). Fix: fail closed in both
    sweep functions AND thread-delete cleanup when the root or a required ancestor is a
    symlink/non-directory; ancestor-symlink test. (`core/attachments.py:590-620`)
  - **MED-2 (conf 0.94):** deleting/harvesting a steer WHILE its attachments are being claimed
    can still persist the cancelled message + files — `_drain_steers()` snapshots the queue, then
    awaits multi-file claims (scans/fsyncs/strict decodes of 10 MiB files widen the previously
    accepted sub-ms persist race); no ownership re-check before the insert, `commit()` count
    ignored. Fix: immediately before the transaction, revalidate each entry is still owned by the
    same queue, excluding harvested/deleted entries; already-claimed files stay in the accepted
    unreferenced-file sweep class. (`services/agent/session.py:1919-1962`, `api/agent.py:1105-1114`)
  - **LOW-3 (conf 0.96):** the repaired OpenAPI pin is real for schema-visible POSTs but not the
    whole "no POST/no multipart" property — multipart stays in the allowed-method set on PUT, an
    `include_in_schema=False` POST is absent from OpenAPI, and the source-token check reads only
    the two current files. Fix: recursively inspect included router routes; reject POST +
    multipart request-body declarations under both guarded prefixes.
    (`test_media_write_d65.py:674-694`, `test_attachments_d68.py:708-732`)
  - **LOW-4 (conf 0.91):** the claim-is-the-only-writer pin greps other modules for the literal
    `thread_dir(` — `attachments_root(home) / thread_id` or a re-derived path writes into a
    thread dir with the pin green; post-claim alternate writers uncovered. Fix: pin ALL
    attachment-root path construction/imports to the store module. (`test_attachments_d68.py:650-676`)
  - **Question-10 RULING: FIX (LOW)** — delete the newly created thread when its initial claim
    refuses: track `created_here`; in the `StoreWriteError` branch call the existing
    `ThreadRepo.delete()` before returning the 409 (which also immediately reclaims a partially
    refused batch's already-moved files). Existing-thread lost-response retries untouched.
  - **Sound checks (explicit):** claim exclusivity correct under BOTH race orderings (one staging
    unlink wins; the loser removes its own target) · collision landing no-clobber (cross-fs
    `os.link` = unhandled EXDEV/500 but staging intact, no target created; normal layout is one
    filesystem) · both boot-sweep data sources correct (all threads incl. archived; paths from
    persisted parts; DB failure skips + preserves) · PUT admission pre-open, streamed counting,
    sniff/decode refusal, `finally` cleanup sound; encoded slashes 404, dot/backslash/non-NFC/
    reserved/absolute names refused · `AttachmentPart` facts-only + additive, old rows round-trip ·
    steer coalescing preserves ids per entry; a partially refused claim degrades to text+notice ·
    the media refactor preserves the old create/replace ladder + error semantics; `probe_gif`
    separate, media adopts no GIF · focused suites 127 green (1 pre-existing Starlette
    deprecation warning). **Open sweep: none.**
