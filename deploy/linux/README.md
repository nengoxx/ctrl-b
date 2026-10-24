# emma deploy — runbook

Deploy the **ctrl-b dashboard** as **two isolated instances** + the **Claude Code remote agent** onto
**emma** (Ubuntu 26.04, tailnet `emma` / `100.109.206.88`). Topology + rationale: **DECISIONS.md D32
(amended 2026-07-09 — trunk-based, workspace/runtime split)** and `../../docs/DEPLOY_EMMA.md`.

## Topology (D32, amended) — two fully isolated instances, one repo, one branch

| | **PROD** (daily driver) | **DEV** (sandbox) |
|---|---|---|
| Code tree | `~/apps/ctrl-b` — the deployed **RUNTIME**: clean, **sparse**, **tag-pinned** clone (only `backend`+`frontend`+`deploy` + root files); pulls GitHub. **Never developed on.** | `~/github/ctrl-b` — the **WORKSPACE**: full clone pinned to **`main`** (the only branch); where **ALL development happens** |
| Data root | `~/.ctrl-b` (real config + db + memories/skills/agents) | `~/.ctrl-b-dev` (own copy; seeded from prod once) |
| Backend | `uvicorn :5433` serving built `dist` | `uvicorn :5434 --reload` |
| Frontend | built into `dist` (built aside, swapped at cutover) | Vite `:5173` HMR → `/api` → `:5434` |
| Ingress | **Tailscale Serve HTTPS :443** (mic works) **+ direct `http://emma:5433`** (LAN+tailnet — owner waiver 2026-07-10, SECURITY_MODEL §2.1; no mic over HTTP) | `http://emma:5173` (Vite, HTTP, no mic) **+ the optional Serve door `https://emma.<tailnet>.ts.net:8443` → `127.0.0.1:5434`** (the dev backend serving the workspace's *built* `dist/` — mic works; `docs/HTTPS_TAILSCALE.md` §Optional). The SPA mounts only if `frontend/dist` existed when the dev unit started (`main.py`), so after the first `npm run build` restart `ctrl-b-dashboard-dev` |
| Units | `ctrl-b-dashboard.service` (boot) | `ctrl-b-dashboard-dev.service` + `ctrl-b-dashboard-dev-web.service` — **ON-DEMAND** (owner amendment 2026-07-10): `systemctl --user start` them when iterating, stop when done |

**Branch model (trunk-based):** ONE branch, **`main`** — always releasable (held by the git hooks + CI, which
run on every push). **Immutable annotated tags `vX.Y.Z`** mark releases; prod checks out a tag, never a branch.
There is **no `dev` branch** — "dev" names only the *instance* above.

**The workspace invariant: `~/github/ctrl-b` never leaves `main`.** The dev instance live-serves it, so a
checkout there flips the running app and tangles agent WIP. Every other checkout — a hotfix cut at a tag, a
prod-bug repro on release code, a second simultaneous writer — gets a **throwaway sibling worktree** via
`tools/add-dev-worktree.sh <name> [branch] [base]`, removed when done.

## Files (tidy layout)
```
deploy/
├── bootstrap.py              # local-checkout→emma orchestrator (the entry point you run)
├── README.md                 # "pick a target" overview (linux / windows / manual)
├── linux/                    # this Linux/systemd kit
│   ├── README.md             # this runbook
│   ├── install.sh            # [prod|dev] — build + enable ONE instance from the tree it's in
│   │                         #   prod also: DB snapshot pre-cutover + aside-built dist swap
│   ├── update.sh             # <tag> — the standing release/update runner (preflight → re-pin → install.sh)
│   ├── serve-https.sh        # Tailscale Serve HTTPS :443 → :5433 (prod)
│   ├── run.sh                # manual foreground runner (no systemd)
│   └── systemd/              # the user units (rendered to ~/.config/systemd/user/ by install.sh)
│       ├── ctrl-b-dashboard.service          # PROD backend (:5433, ~/.ctrl-b) — boot
│       ├── ctrl-b-dashboard-dev.service      # DEV backend (:5434 --reload, ~/.ctrl-b-dev) — on-demand
│       ├── ctrl-b-dashboard-dev-web.service  # DEV Vite (:5173 → :5434) — on-demand
│       └── ctrl-b-agent@.service             # TEMPLATE: the ALWAYS-ON Claude agents — instances
│                                             #   @fable → tmux ctrl-b-fable (claude-fable-5-1, high) ← MAIN seat (2026-07-28)
│                                             #   @opus  → tmux ctrl-b-opus  (claude-opus-5-5, high)  ← workforce
│                                             #   (explicit owner-tested pins, ~/.claude/settings.json)
└── windows/                  # the double-click Windows kit (setup/start/autostart)

../tools/                     # dev launchers (NOT deploy): start-claude.sh (Linux), claude-{fable,opus}.{ps1,cmd} (Windows), add-dev-worktree.sh
```
`bootstrap.py` (orchestrator) is at `deploy/`; the Linux install/serve helpers + `systemd/` units are flat in
`deploy/linux/`. The Claude-agent launchers live in repo-root `tools/`. *(There is no layout migration script —
nothing on emma moves: the existing `~/github/ctrl-b` checkout IS the workspace; prod is a fresh clone at
`~/apps/ctrl-b`.)*

## Deploy — two paths

### A) Automated, one command from a checkout that has `config.yaml` + SSH to the target (recommended)
```bash
# from the repo root  (Bash tool needs dangerouslyDisableSandbox for LAN)
backend/.venv/bin/python deploy/bootstrap.py --dry-run     # preview the plan
backend/.venv/bin/python deploy/bootstrap.py               # prod: prereqs→config→prod-tree→install→https
backend/.venv/bin/python deploy/bootstrap.py --with-dev    # + the DEV instance AND the agent services
backend/.venv/bin/python deploy/bootstrap.py --claude-env  # + migrate the Claude Code memory/settings
#   --no-prereqs        skip sudo (you ran them)      --no-serve  skip Tailscale Serve
#   --overwrite-config  force-replace the target's config.yaml (timestamped backup taken first)
```
*(On a Windows checkout the interpreter is `backend\.venv\Scripts\python.exe` — the form the original
v1.0.0 deploy ran, when the workspace still lived on corsair. Everything else is identical: the script
resolves all paths against the TARGET user's `$HOME` and is OS-agnostic.)*

Reads SSH creds from `config.yaml`; never prints the password; idempotent; writes only without `--dry-run`.
**Config note:** after the first deploy the **target's** `~/.ctrl-b/config.yaml` is the canonical, living copy
(the app rewrites it; you edit it via the settings UI) — re-runs leave it alone unless you pass
`--overwrite-config`.

### B) Manual, on emma
```bash
sudo apt install -y tmux sqlite3 && sudo tailscale set --operator="$USER"   # prereqs
scp config.yaml emma:~/.ctrl-b/config.yaml                    # the secret (first deploy only)
git clone --filter=blob:none --sparse <origin-url> ~/apps/ctrl-b \
  && git -C ~/apps/ctrl-b sparse-checkout set backend frontend deploy       # prod tree (first deploy only)
cd ~/apps/ctrl-b   && CTRLB_HOME=~/.ctrl-b     bash deploy/linux/install.sh prod
bash deploy/linux/serve-https.sh                                    # HTTPS on the tailnet
cd ~/github/ctrl-b && CTRLB_HOME=~/.ctrl-b-dev bash deploy/linux/install.sh dev   # optional sandbox
```

## After install
```bash
systemctl --user status ctrl-b-dashboard          # prod: active (running)
curl -s localhost:5433/api/health                 # {"status":"ok",...}
systemctl --user status ctrl-b-agent@fable ctrl-b-agent@opus   # the two boot agents: active (exited)
tmux attach -t ctrl-b-fable                       # attach an agent (or ctrl-b-opus; Ctrl-b d detaches)
# dev instance — ON-DEMAND, start only when iterating:
systemctl --user start ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web
curl -s localhost:5434/api/health                 # dev backend; UI at http://emma:5173
systemctl --user stop ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web    # when done
```

## Inference tuning (owner `config.yaml` — D40/D42/D43)
These are optional per-endpoint knobs the owner sets on the local llama.cpp (and cloud) endpoint in
`~/.ctrl-b/config.yaml` (`inference.local` / `inference.cloud`, or a `fallbacks[]` row — same object).
They apply at the next turn (no restart; a settings PUT rebuilds the inference client). None are
required for a working install, but each fixes a real degradation on this box:
- **`max_concurrent_requests: 1`** (Slice 4/D40) — the owner's llama.cpp serves one model with 1–2
  NON-queuing slots, so overlapping turns/subagents/the summarizer would error at llama-server. Set it
  to the real slot count so ctrl-b queues app-side instead.
- **`context_window: <tokens>`** (Slice 6/D42) — the size of the model's usable context, driving the
  fraction-of-window compaction trigger. **For local llama.cpp you can usually leave it blank** — the
  window is auto-probed from `GET /props` (`default_generation_settings.n_ctx`). Set it explicitly to
  override the probe (config wins; upward overrides allowed), and **cloud endpoints MUST set it
  manually** (OpenAI-style APIs expose no window field, so there is nothing to probe). With neither, the
  trigger falls back to the absolute `agent.compaction.threshold_tokens`.
  **⚠ Router-mode llama-server (the owner's vault setup, `role: "router"` with model autoload) CANNOT
  be probed** — its `/props` reports `n_ctx: 0` at the router layer (the real window lives per model
  instance behind it; a non-positive probe value is treated as no-probe since 2026-07-20). On such an
  endpoint set `context_window` explicitly — it also restores the summarizer's pre-emptive overflow
  guard, which is skipped when no window is known.
- **Context anchoring needs telemetry flags** (Slice 6/D42) — the anchored context estimator prices
  compaction off the backend's real total-prompt count. It only sees that count when the endpoint
  reports it: `extra_body: { return_progress: true }` on a local llama.cpp (streaming `prompt_progress`;
  already in `config.example.yaml`) / `extra_body: { stream_options: { include_usage: true } }` on
  cloud. Without them the estimator silently falls back to the char/4 heuristic — the server logs a
  one-time `context anchoring inactive …` INFO naming the exact remedy.
- **`api_mode: <openai|llamacpp|openrouter|none>`** (D45; named `reasoning_dialect` for a few hours on
  2026-07-20, renamed by D46) — which API wire shape each `inference.*` endpoint speaks. It drives the
  reasoning translation **and** the derived `max_tokens_field` (unset = `max_completion_tokens` on
  `openai`, `max_tokens` elsewhere; set the field explicitly to override). It is never auto-detected from
  `base_url`. **This is opt-in on an existing install and that is the one thing
  to remember here: `config.example.yaml` is the EXAMPLE, `config.yaml` is the LIVE file** — it is
  gitignored, an upgrade never rewrites it, so an endpoint you configured before D45 keeps the
  back-compat default `openai`. On a llama.cpp endpoint that default makes every agent's
  `reasoning_effort` / `reasoning_tokens` a silent **no-op** (llama-server never reads `reasoning_effort`),
  so add `api_mode: llamacpp` to your `inference.local` block by hand. The server logs a startup
  **WARNING** naming the endpoint and the exact key to set whenever it sees a default-mode endpoint
  with a loopback/private/LAN/non-web-port `base_url` (advisory only — nothing branches on it). Related:
  on the `openai` mode, effort `off` is sent as OpenAI's `none` and no longer carries llama.cpp's
  `chat_template_kwargs`, so an `off` agent on a still-default llama.cpp endpoint loses the template lever
  until you set the mode.
- **Reasoning support is per-MODEL, and the server learns it (D46).** `api_mode` gets the wire SHAPE
  right; which efforts a given *model* accepts is a different question (OpenRouter publishes
  `reasoning.supported_efforts` per model — of 339 models only 22 accept `max`, and many lack
  `none`/`minimal`). If a provider 400s on the reasoning controls, the server logs a **WARNING** naming
  the endpoint, model, stripped keys and the provider's own message, retries that one request **once**
  without them, and remembers the demotion for that endpoint+model — so you pay the failed attempt once,
  not every turn. It is never silent (the LiteLLM `drop_params` anti-pattern) and it never strips anything
  but reasoning keys. A settings change that rebuilds the inference client clears the memory.
- **`inference.retry_attempts: <n>`** (Slice 7/D43) — the CHAT-STREAM same-endpoint retry budget for
  genuinely-**transient** failures only (429 / 503 / `Retry-After` / a busy llama.cpp slot). Default **2**:
  a busy-but-alive server is retried in place (a visible `// retrying…` note, backoff 2s×2ⁿ capped 30s, a
  larger `Retry-After` wins) BEFORE hopping to a fallback, keeping the conversation on the same model. A
  dead endpoint (connection-refused/timeout) never matches → straight next-hop as before. Set **`0`** to
  disable retries globally, or override per endpoint with a `retry_attempts:` on that `inference.local` /
  `inference.cloud` / `fallbacks[]` row (unset = inherit, `0` = disable for that endpoint). `complete()`
  (summarizer) and voice keep straight next-hop.
- **Failure-fallback model routing** (Slice 7/D43) — an optional `agent.defaults.routing` block escalates
  to a designated smarter `lead` model after the worker model hard-fails `failure_threshold` turns in a
  row, for `fallback_turns` turns, then returns to the worker (a visible `// lead model…` / `// back to
  the worker model` note each way). Structural triggers only (crash/stall/exhaustion — never wrong
  answers); YAML-only, off by default. See `config.example.yaml` `agent.defaults.routing`. The D18/D40
  endpoint failover chain runs unchanged underneath — routing only picks who is asked FIRST.
- **Disable llama.cpp context-shift so overflow surfaces** (Slice 6/D42 residual) — the reactive
  overflow backstop (force-compact + re-stream on a prompt-too-long error) only fires if llama-server
  actually *returns* the overflow error. With context-shift enabled, llama-server silently truncates the
  oldest tokens instead of erroring, muting the backstop. Recent llama.cpp builds disable context-shift
  by DEFAULT (overflow errors surface — good); on a build/config where it is on, pass
  **`--no-context-shift`** to `llama-server` (older flag name; newer builds use `--context-shift` to
  *enable* it — verify against your build's `llama-server --help`).

## The ASR engines (Phase 26 — `parakeet-live` / `parakeet-clip`, machine-wide, never `install.sh`'s)
> **What serves traffic TODAY (verified 2026-10-14, `main` @ `9f405de2` / prod v1.7.11):** only
> **`parakeet-clip`**, and only for **dev** (dev's `voice.stt` points at it; prod v1.7.11 predates the clip
> door's decode and still sends push-to-talk to `emma-speaches`). **`parakeet-live` is installed for S7b ("the
> flip") and serves nothing until then:** the live ear — calls and streaming dictation, on BOTH instances — is
> still the **Speaches realtime WebSocket** (`services/voice_live.py` `realtime_url` dials `{base_url}/realtime`),
> which parakeet-server cannot serve. **Do not point `voice.live` at `parakeet-live` before v1.7.12** — and a
> blank `voice.live.provider` resolves like `voice.stt`, so on an install whose `voice.stt` is `parakeet-clip`
> pin `voice.live.provider` to the Speaches provider explicitly (dev's config does), or calls fail. The
> Speaches + PocketTTS units are documented in §The voice backends below.

After S7b, live voice's ear and the clip door (push-to-talk + the whole-clip dictation fallback) transcribe on
**two `parakeet-server` processes** (`mudler/parakeet.cpp` **v0.5.0**, MIT; weights
`nvidia/parakeet-tdt-0.6b-v3`, CC-BY-4.0) — ASR_PLAN §3.7 / D82, set up in S9 on 2026-10-07. They are
**machine-wide user units shared by dev, prod and anything else on the box** (R18/R19), exactly like
PocketTTS and Speaches:
- **`install.sh` and `update.sh` never render, enable, start, stop or restart them** (R19), and a
  §Rollback never stops them (other consumers). Every step here is by hand.
- **Speaches stays up** (R18): this phase never stops `speaches.service` (:9000) — it is the rollback
  target for v1.7.12 (ASR_PLAN §8.3). Whether it keeps running afterwards is the owner's later call.

| Unit | Port | Door (ctrl-b provider) | Threads | Bind |
|---|---|---|---|---|
| `parakeet-live.service` | **9010** | `voice.live` — `parakeet-live` (**from v1.7.12 / S7b — idle today**) | 4 | 0.0.0.0 |
| `parakeet-clip.service` | **9011** | `voice.stt` — `parakeet-clip` (dev today; prod at v1.7.12) | 4 | 0.0.0.0 |

- **Bind 0.0.0.0** per R10 (LAN trust, like Speaches :9000 — SECURITY_MODEL §2.1). No key exists; the
  engines take only WAV and expose transcription + `/health`.
- **Clone:** `~/github/parakeet.cpp` at tag `v0.5.0` = `1bfbebfaaf493866f49597cd3b7901959d395c60`
  (ggml submodule `e705c5fe…`, v0.13.0; the configure step applies upstream's in-tree ggml patches, so
  `git status` shows ` m third_party/ggml` — expected).
- **Binary:** the source build `build/examples/server/parakeet-server` (`GGML_NATIVE=ON` ⇒ `-march=native`,
  Zen 4 AVX-512; it links `build/third_party/ggml/src/libggml*.so` by rpath, so the whole `build/` stays).
  sha256 `68176570239c9924b56d95930a4e93b86aa588833c03fd168ece45d4156c1aa1`; it prints
  `parakeet-server 0.0.1` (a source build carries no version stamp — the tag is the identity). The
  portable release binary sits beside it for the H8 comparison: `build-release/parakeet-v0.5.0-bin-linux-cpu-x64/`
  (tarball sha256 `636a9fc48ac023096037790f9b77d7e5043b200dd6399ec0438bd648c35d79b9`, prints `0.5.0`); the
  S9 bake-off decides which one `ExecStart` runs.
- **Model:** `~/github/parakeet.cpp/models/tdt-0.6b-v3-f16.gguf` (gitignored) — 1 441 046 400 B,
  sha256 `8ba47343e1e919895aca90e099150a01ed203ee0942d8ed31e27295efc5abb22`, from
  `huggingface.co/mudler/parakeet-cpp-gguf` rev `741158ae71e64ef5c89385862c18f777d07a97a1`. Units pass
  the **path**, never the alias (no fetch at start). Loaded before the socket binds and never unloaded —
  resident by construction (R10 a); `/health` answers only once it is loaded (~1 s).
- **Memory:** ~1.4–1.6 GB RSS each (MemoryPeak 1.52 GB idle → 1.56/1.61 GB after a request).
- **Concurrency:** each process serialises inference on one mutex and parks extra requests (never
  refuses). ctrl-b gates app-side with `max_concurrent_requests: 1` per provider — **per ctrl-b process**,
  so a dev test call and a prod call on the same engine queue on that mutex; it shows as `asr_ms` in T9.

Both unit files (`~/.config/systemd/user/`, PocketTTS's shape; only the door/port differ):
```ini
[Unit]
Description=parakeet.cpp v0.5.0 parakeet-server — ctrl-b ASR engine, the live door (:9010, CPU)
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/emma/github/parakeet.cpp
Environment=PARAKEET_DEVICE=cpu
ExecStart=/home/emma/github/parakeet.cpp/build/examples/server/parakeet-server --model /home/emma/github/parakeet.cpp/models/tdt-0.6b-v3-f16.gguf --host 0.0.0.0 --port 9010 --threads 4
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```
(`parakeet-clip.service`: `the clip door (:9011, CPU)` and `--port 9011`.)

```bash
# install from scratch (what S9 ran)
git clone --recursive --branch v0.5.0 https://github.com/mudler/parakeet.cpp ~/github/parakeet.cpp
cd ~/github/parakeet.cpp
curl -sSL --fail -o models/tdt-0.6b-v3-f16.gguf.part \
  https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/741158ae71e64ef5c89385862c18f777d07a97a1/tdt-0.6b-v3-f16.gguf
sha256sum models/tdt-0.6b-v3-f16.gguf.part   # MUST be 8ba47343…abb22 — else delete it and stop
mv models/tdt-0.6b-v3-f16.gguf.part models/tdt-0.6b-v3-f16.gguf
cmake -B build -DCMAKE_BUILD_TYPE=Release -DPARAKEET_BUILD_TESTS=OFF -DGGML_NATIVE=ON
cmake --build build -j 16
# write the two unit files above, then:
systemctl --user daemon-reload && systemctl --user enable --now parakeet-live parakeet-clip

# health (NOT under /v1) — {"status":"ok"} on both
curl -s 127.0.0.1:9010/health; curl -s 127.0.0.1:9011/health
# a real transcription (WAV only; any rate; anything else is a 400) — {"text":"…"}
curl -sS -F file=@some.wav http://127.0.0.1:9011/v1/audio/transcriptions
systemctl --user show parakeet-live parakeet-clip -p MemoryPeak

# start / stop / restart (ctrl-b falls over to the chain's next hop while one is down)
systemctl --user restart parakeet-live parakeet-clip
# logs — the journal holds the listen line (port + model path) and errors only: parakeet-server has
# no access log and no level flag (R10 b, ruled). Per-request evidence = ctrl-b's T9 trail lines.
journalctl --user -u parakeet-live -u parakeet-clip -n 50
```

**Update the engine** (a new tag, only after the owner has tried it — the tested-pin policy): clone the
new tag BESIDE the old one (`~/github/parakeet.cpp-vX.Y.Z`), build it, put the model in its `models/`
(`cp` the verified file, or download + `sha256sum` whatever file the new release names), point both units'
`WorkingDirectory`/`ExecStart`/`--model` at it, `daemon-reload`, restart
both, re-run the health + transcription checks. Rollback = point them back and restart; delete the old
clone only once the new one has served real traffic.

**Remove entirely** (the reverse of the install — repoint ctrl-b's `voice.live` / `voice.stt` away from
the `parakeet-*` providers FIRST, on dev and prod, or those doors fall straight to their fallbacks):
```bash
systemctl --user disable --now parakeet-live parakeet-clip
rm ~/.config/systemd/user/parakeet-live.service ~/.config/systemd/user/parakeet-clip.service
systemctl --user daemon-reload
rm -rf ~/github/parakeet.cpp        # clone + build + build-release + the 1.4 GB model
```

**ctrl-b's providers** (`providers:` in `config.yaml`; `ProviderCfg`). `base_url` ends in `/v1` (the
SDK appends `/audio/transcriptions`); the model name is cosmetic — the server never reads `model`
(nor `language`/`vad_filter`/`hotwords`, which are accepted and ignored), but one catalog entry lets a
section omit `model`. Distinct ports ⇒ distinct D40 gates. Paste into dev now, prod at v1.7.12:
```yaml
providers:
  parakeet-live:
    base_url: http://127.0.0.1:9010/v1
    api_mode: openai
    max_concurrent_requests: 1
    models:
      parakeet-tdt-0.6b-v3: {}
  parakeet-clip:
    base_url: http://127.0.0.1:9011/v1
    api_mode: openai
    max_concurrent_requests: 1
    models:
      parakeet-tdt-0.6b-v3: {}
```

**Prod at v1.7.12** (ASR_PLAN §8.2.2 — the ONE config move, symmetric with §8.3's rollback):
```bash
curl -s 127.0.0.1:9010/health; curl -s 127.0.0.1:9011/health     # both {"status":"ok"}
systemctl --user stop ctrl-b-dashboard
cp -p ~/.ctrl-b/config.yaml ~/.ctrl-b/backups/config.yaml.$(date -u +%Y%m%dT%H%M%SZ).pre-v1.7.12
# edit ~/.ctrl-b/config.yaml: add the two providers above, then
#   voice.live: provider: parakeet-live · fallbacks: [{provider: parakeet-clip}] · timeout_s: 10
#   voice.stt:  provider: parakeet-clip · fallbacks: [{provider: vault-speaches}]   (drop its `model:`)
#   voice.tts:  fallbacks: [{provider: vault-alltalk}]                               (R8: Kokoro leaves)
bash ~/apps/ctrl-b/deploy/linux/update.sh v1.7.12                 # installs, starts, health-checks
# verify: a dictation · a call · a push-to-talk clip · a TTS failover; T1 lines in the journal
```
**Rollback off v1.7.12** (§8.3): `systemctl --user start speaches` if it was ever stopped + wait for its
`/health` → stop `ctrl-b-dashboard` → restore `config.yaml.<UTCstamp>.pre-v1.7.12` → `update.sh v1.7.11`
→ verify. The engines stay up.

## The voice backends (Speaches · PocketTTS — machine-wide, never `install.sh`'s)
Like the parakeet units these are **user units shared by dev and prod**; `install.sh`/`update.sh` never touch
them, a §Rollback never stops them, and a reinstall of the box must recreate them by hand. TTS chain on both
instances today: **`emma-pockettts` → `emma-speaches` → `vault-alltalk`** (provider names in `config.yaml`).

- **Speaches (:9000) — the live ear until v1.7.12, a TTS fallback, the v1.7.12 rollback target.** A local
  fork, `~/github/speaches` @ **`fd4b956`** ("honour `turn_detection.prefix_padding_ms` as a slice-start
  pre-roll" — what `voice.live.prefix_padding_ms` needs; its `master` is 4 commits ahead of its `origin/master`).
  Unit `speaches.service` (`ExecStart=%h/.local/bin/speaches-serve`, `WorkingDirectory=%h/github/speaches`)
  with **two drop-ins that live OUTSIDE every repo** under `~/.config/systemd/user/speaches.service.d/`:
  `10-emma-amd-cpu.conf` (CPU-only ONNX/Whisper: excludes the TensorRT/CUDA providers,
  `WHISPER__INFERENCE_DEVICE=cpu`, `int8`, 8 threads, 1 worker) and **`20-loopback-url.conf`
  (`LOOPBACK_HOST_URL=http://127.0.0.1:9000`)** — the realtime path needs this one (the failure without it is
  recorded in LIVE_VOICE_PLAN §7-S0). Health: `curl -s 127.0.0.1:9000/health`. Logs: `journalctl --user -u speaches`.
- **PocketTTS (:8890) — the TTS primary.** `pockettts.service` (`~/github/PocketTTS.cpp/pocket-tts --server …
  --port 8890`, voices under `~/.local/share/tts/voices/pocket`). It listens on **`0.0.0.0:8890`** since
  2026-10-22 (`ss -ltnp`): the loopback bind was a local commit on `~/github/PocketTTS.cpp`, reverted as
  `84f2a13`; upstream binds every interface and has no `--host` flag (the bind is compiled in). Both instances
  on this box reach it over loopback, and the LAN + tailnet reach it like the other engines (the owner waiver,
  `docs/SECURITY_MODEL.md` §2.1, ISS-106). It pads every clip with silence, which
  `voice.tts.trim_silence` (default on) trims server-side. (`pockettts-official.service`, :8892, is a separate,
  disabled experiment — not in either chain.) Logs: `journalctl --user -u pockettts`.

## The Claude agent services (development continues ON the box)
The agents are first-class always-on services (owner decisions 2026-07-09 + 2026-07-10): the TEMPLATE
unit **`ctrl-b-agent@.service`** is enabled by `install.sh dev` as **two boot instances** —
`ctrl-b-agent@fable` (tmux **`ctrl-b-fable`**, model **`claude-fable-5-1`**, effort high — **the MAIN seat
since 2026-07-28**: designs, supervises, rules, audits) and `ctrl-b-agent@opus` (tmux **`ctrl-b-opus`**, model
**`claude-opus-5-5`**, effort high — the subagent workforce + an interactive session when wanted). The ids are
**explicit, owner-tested pins** in `~/.claude/settings.json` (`env.ANTHROPIC_DEFAULT_FABLE_MODEL` /
`env.ANTHROPIC_DEFAULT_OPUS_MODEL`): `tools/start-claude.sh` passes the bare `fable`/`opus` alias and Claude Code
resolves it through those keys (ISS-100, 2026-10-15) — bump them there, only after the owner has tested a new
version (CLAUDE.md); a running session keeps its model until it restarts. Without the pins, Claude Code falls back
to its own latest Fable/Opus. **Both
run with `--permission-mode bypassPermissions` by default** (`PERM` in `start-claude.sh`). Each ensures its tmux session exists, running
`claude --remote-control` in the **workspace** — attach over SSH or drive from claude.ai/code. On boot
the launcher **waits for claude.ai to answer before EVERY claude launch** (first start and each crash
relaunch alike; `curl -sI` every 10 s, no time limit — an HTTP 403 counts as reachable) — the remote-control
channel registers at claude startup and does NOT retry, so an offline start would come up invisible to
the claude app (post-reboot finding 2026-07-10; ISS-119, 2026-10-24: the old bounded, pre-loop wait
launched offline after a power outage). Reachability does not prove registration — a session that is up
but not in the app still needs a manual restart (ISS-119's recorded limit). Skipped gracefully if the `claude` CLI isn't installed yet.
- **One writer at a time.** Both sessions share the one workspace tree — use one agent per task; a
  genuinely SIMULTANEOUS second writer takes its own worktree (`tools/add-dev-worktree.sh`), same as before.
- **Effort/permission overrides (no edits to tracked files; the model is fixed per instance — `MODEL` there
  is ignored):** `~/.config/ctrl-b/agent.env` (shared, e.g. `EFFORT=medium`, `PERM=…` to tighten the
  permission mode) or `agent-fable.env`/`agent-opus.env` (per-instance, wins) — then `systemctl --user restart
  ctrl-b-agent@<i>`. **Never set `PATH` in these files** — it overrides the unit's `Environment=PATH` and
  `claude` stops resolving.
- Manual/extra sessions: `tools/start-claude.sh [session] [dir] [opus|fable|<model-id>]` (default `opus`).
- Crash-recovery of `claude` is the `while true` loop inside tmux; `systemctl --user restart
  ctrl-b-agent@<i>` recreates that instance's session from scratch (the other instance is untouched —
  KillMode=process + a targeted per-session ExecStop).
- Full names attach directly (`tmux attach -t ctrl-b-fable`); only a *shortened* `-t ctrl-b` is ambiguous
  (prefix of both) — scripts use exact-match `=` for safety.
- **First boot on a fresh workspace clone** (seen on the v1.0.0 deploy): the claude CLI stops at its
  one-time interactive *"Is this a project you trust?"* prompt inside each tmux session — attach and
  confirm once per project; trust persists, so the units/loops never ask again.

## Framework migration (`--claude-env`) — the dev environment, not just the app
Most of the Claude Code dev framework **travels in the repo** (`.agents/skills/`, the `.claude/settings.json`
hooks, `.githooks/`, `CLAUDE.md`/`AGENTS.md`/`docs/`) — it's on the box the moment the workspace clones. The
per-machine remainder is what `bootstrap.py --claude-env` moves:
- **Project memory** → the target's `~/.claude/projects/<slug>/memory` (slug = the workspace path,
  separators → dashes). **Skip-if-present** — after the first migration the target's memory is canonical.
- **User-global `settings.json`** — missing keys are added from the local one (model/effort/permission
  defaults); keys the target already has are never overwritten.
- **NOT copied, by design:** auth/credentials (log `claude` in on the box once — already done on emma),
  session transcripts (memory is their distillate; `docs/HANDOFF.md` re-orients a fresh session), and
  `.claude/settings.local.json` (machine-local permission grants re-accrue naturally).

## Release (promote to production) — the standing END-TO-END procedure
Trunk-based release-by-tag: prod only ever moves by checking out a **new immutable tag** — never by
editing `~/apps/ctrl-b` in place, never from a branch. Every step below is explicit so an agent can
run it cold:

```bash
cd ~/github/ctrl-b                          # 0) always from the workspace (main) — never the prod tree
# 1) PICK the sha — the latest main commit that is VERIFIED: gate green (the pre-push hook ran the
#    full gate; CI is green on that sha) AND eyeballed on the dev instance (start the on-demand pair
#    while testing, stop after). A sha you checked — not "whatever HEAD is now".
git log --oneline -5
gh run list --branch main --limit 1         # CI conclusion for HEAD must be success
# 2) VERSION by semver: incompatible/breaking → vX+1.0.0 · new feature → vX.Y+1.0 · fix-only → vX.Y.Z+1
# 3) TAG + PUSH — the tag push triggers the CI RELEASE GATE (full gate + Playwright e2e on Linux):
git tag -a vX.Y.Z <sha> -m "one-line release notes"
git push origin vX.Y.Z
#    NOTE: .githooks/pre-push is unconditional — the TAG push runs the full local gate too (~4 min;
#    use a fresh folder per task, TMPDIR=/home/emma/.cache/tmp/<task>, removed after; since ISS-99 the
#    backend suite leaves nothing behind, so this is advice, not a requirement). A "hung" tag push is
#    almost certainly the gate, not the network.
# 4) WAIT for the release gate — NEVER re-pin on red or pending:
gh run watch $(gh run list --limit 5 --json databaseId,headBranch \
  --jq '[.[]|select(.headBranch=="vX.Y.Z")][0].databaseId') --exit-status
# 5) RE-PIN prod (install.sh = deps → dist built aside → DB snapshot → sub-second stop/swap/start;
#    any pre-cutover failure leaves the running service untouched):
cd ~/apps/ctrl-b && git fetch --tags --quiet && git checkout vX.Y.Z && bash deploy/linux/install.sh prod
# 6) VERIFY — prod is on the tag and healthy:
git -C ~/apps/ctrl-b describe --tags --exact-match    # must print vX.Y.Z
curl -s -m5 localhost:5433/api/health                 # {"status":"ok",...} — its "version" is derived from
                                                      # the git tag at install time (hatch-vcs), so on prod it
                                                      # must equal X.Y.Z; the describe line cross-checks the tree
curl -sI -m5 localhost:5433/icon-192.png | grep -i 'content-type: image/png'   # D55/SYS-19: a root dist file
                                                      # answered as text/html means the SPA fallback ate it —
                                                      # a failure no status-code check can see (it 200s)
# then spot-check https://emma.<tailnet>.ts.net on a device. Anything wrong → Rollback (below).
# 7) DEVICES — each one shows "// new version available" (with **refresh**) on its NEXT app load; tapping
#    refresh reloads every open ctrl-b tab. Nothing polls, so an installed PWA left open learns of the
#    release only when it is reloaded or reopened (components/SwUpdatePrompt.tsx).
```
**Config-shape migration (UPDATE_PLAN).** From the release that carries `providers:`, the config is
migrated **by `install.sh` at the cutover** — with the service verifiably stopped — not lazily on some
later write. **On a run that actually rewrites the config** it first writes timestamped 0600 copies of
everything it is about to touch — `~/.ctrl-b/backups/config.yaml.<UTCstamp>`, plus
`~/.ctrl-b/backups/<agent>--agent.yaml.<UTCstamp>` for every agent file it rewrites, all under ONE stamp
(one run = one backup set) — and prints the paths (an already-stamped config that needs nothing gets no
copy — `config_migration/__init__.py` `apply`; these copies are never pruned). The new build also
**refuses to start** on a config it cannot migrate or load (exit 78, terminal — the unit will not retry),
naming the one command that fixes it in the journal.
**Rolling back across a release that moved the config shape REQUIRES the config restore first** (§Rollback
→ CONFIG). What a tag revert alone does depends on the tag you go back to: a **runner-era** tag (v1.3.0 or
later) **refuses** a config stamped by a newer build — its installer's preflight exits 78 before the cutover,
so prod stays as it was (down, after a failed update) until the backup set is put back; a **pre-runner** tag (v1.2.1 or older) has no check, tolerates
unknown keys and boots "healthy" with **zero providers** once the file uses `providers:` — chat and voice
silently dead.

**Steps 5–6 in one command** — `update.sh` does the tag checks, the CI gate, the compatibility
precheck and its own health verification around `install.sh`, and reports exactly what state prod is in
if anything fails:
```bash
bash ~/apps/ctrl-b/deploy/linux/update.sh vX.Y.Z          # --force only for an unverifiable CI state
```
Its CI gate **fails closed**: `gh` missing or not authenticated on the prod box, no push-event run found for the
tag + its commit, or any conclusion but `success` → it refuses (exit 1) unless you pass `--force`
(`update.sh` step 4). So `gh` must be installed **and logged in** on the box that runs it.
> **THE FIRST TIME, IT IS NOT THERE YET.** `update.sh` ships *in* the release that introduces it, so the
> currently-deployed tag has no copy of it. For that one release, run the updater straight out of the
> tag being deployed:
> ```bash
> git -C ~/apps/ctrl-b fetch --tags
> git -C ~/apps/ctrl-b show vX.Y.Z:deploy/linux/update.sh | bash -s -- vX.Y.Z
> ```
> From the next release onward the plain command above works, because the file is then on disk.
> **The same form is the RECOVERY PATH whenever the deployed updater itself is broken** — proven
> 2026-07-28: v1.3.0's on-disk `update.sh` refused every stamped config (the marker-comment bug,
> fixed in `0f87652`), so v1.3.2 was cut over by running the FIXED script straight out of the new
> tag. "The file is on disk" only helps when the on-disk copy works; when it doesn't, deploy the
> fix-carrying tag with the bootstrap form and prod lands a working updater again. (v1.3.1 is
> tagged but was never deployed — it carries the bug; don't roll back onto it.)

**For a v1.3.0+ previous tag, `update.sh v(prev)` IS the rollback** — it prints the restore when one is
needed: when the config on disk is newer than `v(prev)` reads, it refuses (exit 78) and prints the exact
`cp -p` lines for every file of the right backup set (config and agent files of one stamp), then "re-run
this same command"; do them and re-run. **For a pre-runner previous tag (v1.2.1 or older) it is NOT**:
that build's `install.sh` swallows a failed stop and has no health gate, so the updater refuses to drive
it and prints the manual sequence instead. Use **§Rollback** below.

**The updater that runs is the one in the tree you are LEAVING.** `update.sh` checks out the new tag
while it runs, but the copy executing is the one that was on disk when you started it — the previous
release's. So a fix to the updater protects the update AFTER the release that ships it. For the first
release after v1.7.12 that bumps `backend/app/config_migration/VERSION` (the only kind of release whose
failure report can need a config restore), run the updater with the bootstrap form above —
`git -C ~/apps/ctrl-b show vX.Y.Z:deploy/linux/update.sh | bash -s -- vX.Y.Z` — so the ISS-90 report
(UPDATE_PLAN §18) is the one that runs.

The manual sequence below remains the explicit fallback and is what `update.sh` orchestrates.
**Tags are immutable** — never re-point one; a bad release gets `vX.Y.Z+1` (or roll back). The
workspace is untouched throughout (no checkout, no merge — promotion is a push of a tag).

## Hotfix — worktree at the tag, never a checkout in the workspace
```bash
bash ~/github/ctrl-b/tools/add-dev-worktree.sh hotfix fix/vX.Y.Z+1 vX.Y.Z   # throwaway tree AT the release tag
cd ~/github/ctrl-b-hotfix        # fix → commit → verify (hooks run the gate)
git tag -a vX.Y.Z+1 -m "hotfix: ..." && git push origin fix/vX.Y.Z+1 vX.Y.Z+1   # branch push = CI; tag = release gate
#   → WAIT for the tag's release-gate run to go green (Release step 4) before re-pinning
cd ~/apps/ctrl-b && git fetch --tags && git checkout vX.Y.Z+1 && bash deploy/linux/install.sh prod
# NON-OPTIONAL last step — land the fix on main and PROVE it, then clean up:
cd ~/github/ctrl-b && git cherry-pick <fix-sha> && git push   # (or merge the branch)
git merge-base --is-ancestor <fix-sha-on-main> main && echo "fix is on main ✓"
git worktree remove ~/github/ctrl-b-hotfix && git push origin --delete fix/vX.Y.Z+1
```

## Rollback
**Execute top to bottom.** The order is the safety property: an earlier draft of this section listed the
code revert first and only afterwards said the config restore had to precede it — a cold operator
following it starts the old build on a config it cannot read: a pre-runner tag (v1.2.1 or older) boots
"healthy" with **zero providers** (chat and voice silently dead), and a runner-era tag (v1.3.0+) refuses
at its preflight (exit 78) and prod stays as it was. Skip a step only when the decision line says it does
not apply to you. **What `update.sh` decides for you, and what it does not:**
- **After a FAILED update**, its report names the exact backups to restore (config and agent files of one
  stamp) — including a half-finished migration (agent files rewritten, the config commit not reached),
  which the migrator's own run record names exactly — or says the tag revert alone is enough, or that it
  cannot tell.
- **`update.sh <any tag>`** — `update.sh v(prev)` included (v1.3.0+ tags) — refuses (exit 78) and prints the
  set to put back on BOTH: a config SHAPE newer than the tag reads, and an open run record (a half-finished
  migration, whose shape did not move). Do it, then re-run the same command. (A half-finished migration
  left by a migrator from before the run records — every backup on this box today — cannot be detected;
  no step pending on prod touches agent files, so none can exist.)
- **Step 3 (DATA)** is always your decision; neither one restores the database.
Step 2 below is the manual method both point at when they cannot decide (an unreadable marker, an unknown
previous version, no qualifying backup).

```bash
# 1. STOP, and confirm it actually stopped. Nothing below may run against a live writer.
systemctl --user stop ctrl-b-dashboard
systemctl --user is-active ctrl-b-dashboard        # must print: inactive  (or: failed)

# 2. CONFIG — MANDATORY when the config on disk is at a shape the older tag cannot read (the manual
#    method; `update.sh` prints the same restore, already decided, when it can — see above).
#    Decide: compare the config's marker with the shape the older tag understands:
grep -m1 '^config_version:' ~/.ctrl-b/config.yaml  # N, or no line = 0. Anything but a plain integer: stop, fix it by hand
git -C ~/apps/ctrl-b show v(prev):backend/app/config_migration/VERSION   # M; no such file = a pre-runner tag = 0
#    N <= M → skip to step 3 — UNLESS an OPEN run record exists (below): then restore ITS set first.
#    N > M → restore the BACKUP SET taken by the update you are undoing:
ls ~/.ctrl-b/backups/*.run 2>/dev/null              # an OPEN run record = a migration that rewrote agent files
#    and never committed. Its lines are `backups/<file><TAB><live path>` (relative to ~/.ctrl-b): put
#    back EVERY listed file (cp -p ~/.ctrl-b/backups/<file> ~/.ctrl-b/<live path>), then CLOSE it — the
#    record's state is its NAME, so it never reopens: update.sh's printed restore ends with the guarded
#    line `cmp -s <b1> <l1> && cmp -s <b2> <l2> … && mv <record> <record>.resolved` (it renames only when
#    every file is back); if you skip it, the next update.sh sees every file back and renames it itself.
#    The four names: `.run` open · `.run.committed` finished · `.run.superseded` a later run committed
#    over it (its set is still the pre-state for a rollback, ISS-114 — when update.sh offers it, its restore
#    ends with the same guarded line, and once its set is back it is renamed `.run.resolved` too, so it is
#    never offered again) · `.run.resolved` closed without a commit. Deliberately fixing FORWARD instead of restoring (you accept the half-written agent files)?
#    `mv ~/.ctrl-b/backups/<record> ~/.ctrl-b/backups/<record>.resolved` — the manual escape; a re-run of
#    the migration over that state loses data step 5 would have derived (ISS-114). An EMPTY or truncated
#    record (a crash between its creation and its fsync) is "broken" and blocks until that same `mv`.
ls ~/.ctrl-b/backups/                              # the migration's sets: config.yaml.<UTCstamp> + <agent>--agent.yaml.<UTCstamp>
#    The set to restore = the NEWEST stamp whose file is named EXACTLY config.yaml.<YYYYmmddTHHMMSSZ>
#    or config.yaml.<YYYYmmddTHHMMSSZ>-<N> (two migrations in one second number their files -2, -3…;
#    take the highest N of that stamp, per file; anything else after the Z — hand copies like
#    config.yaml.<stamp>.manual or config.yaml.manual-… — never qualifies) AND whose own
#    `config_version:` is M or below (grep it). Then put back ALL files of that
#    one stamp — the config AND every <agent>--agent.yaml.<same stamp> — never the config alone (a
#    config-only restore leaves agent files in the new shape; re-running the migration then does NOT
#    repair them — ISS-114):
cp -p ~/.ctrl-b/backups/config.yaml.<UTCstamp> ~/.ctrl-b/config.yaml                      # keeps 0600
cp -p ~/.ctrl-b/backups/<agent>--agent.yaml.<UTCstamp> ~/.ctrl-b/agents/<agent>/agent.yaml   # one line per agent file
grep -m1 '^config_version:' ~/.ctrl-b/config.yaml  # must now show M or less, or no line at all
#    This discards every config or agent edit made after that stamp. No qualifying file → do not
#    improvise: the older tag cannot read this config; fix forward instead.

# 3. DATA — only if the bad release's DB migrations mangled the database. DB snapshots are named in
#    LOCAL time (ctrlb-YYYYmmdd-HHMMSS.db.gz), config backups in UTC (…<YYYYmmddTHHMMSS>Z): convert
#    before matching a snapshot to the update you are undoing.
rm -f ~/.ctrl-b/ctrlb.db-wal ~/.ctrl-b/ctrlb.db-shm     # stale sidecars MUST go (WAL mismatch = corruption)
gunzip -c ~/.ctrl-b/backups/ctrlb-<ts>.db.gz > ~/.ctrl-b/ctrlb.db
sqlite3 ~/.ctrl-b/ctrlb.db 'PRAGMA integrity_check;'    # must print: ok

# 4. CODE — one checkout, one install, now that config and data are what the old build expects:
cd ~/apps/ctrl-b && git checkout v(prev) && bash deploy/linux/install.sh prod

# 5. VERIFY BY HAND — a tag before v1.3.0 cannot self-verify (no health gate in its installer):
curl -s -m5 localhost:5433/api/health                   # {"status":"ok","version":"(prev)",...}
systemctl --user is-active ctrl-b-dashboard             # active
# then open the dashboard on a device before calling it done.
```

**First release (v1.0.0) has no previous tag** — rollback there is
`systemctl --user disable --now ctrl-b-dashboard` (or fix forward with v1.0.1).

**Rolling back PAST v1.5.1 (D55) strands the service worker.** Any tag before v1.5.1 serves `sw.js` as
`text/html` again, and a browser will not update a registered worker from a non-JS MIME — the worker
installed by v1.5.1+ stays live on every device until site data is cleared there by hand. Roll back TO
v1.5.1 (or fix forward); go deeper only accepting that device-side cleanup.

**DB** schema compatibility across a rollback is guaranteed by the **expand/contract policy** (D32
amendment): destructive DB migrations land at the earliest one release after the code stopped using the
old shape. It does NOT cover `config.yaml`: the migrator refuses a newer stamp by design, and a config
rollback = restore the run's backup set (step 2; UPDATE_PLAN §6/§18).

**GitHub down at promote time?** Prod can fetch the tag straight from the workspace over the filesystem:
`git -C ~/apps/ctrl-b fetch ~/github/ctrl-b 'refs/tags/*:refs/tags/*'` — same commit, LAN-only.

## Backups — what is kept, what is not, and a manual snapshot
**Automatic.** (1) `install.sh prod` snapshots `~/.ctrl-b/ctrlb.db` before every cutover with SQLite's
online backup (`sqlite3 .backup` — WAL-safe; a plain `cp` of a live WAL database is not), checks it with
`PRAGMA integrity_check`, gzips it to `~/.ctrl-b/backups/ctrlb-YYYYmmdd-HHMMSS.db.gz`, and **keeps the newest
10** (`CTRLB_BACKUP_KEEP=<n>` overrides). Prod only, and only when `ctrlb.db` exists; **dev never takes a
snapshot.** (2) The config migration writes `~/.ctrl-b/backups/config.yaml.<UTCstamp>` — plus
`~/.ctrl-b/backups/<agent>--agent.yaml.<UTCstamp>` for every agent file it rewrites, under the same stamp —
(0600, fsync'd) only on a run that actually rewrites the config; those are never pruned (a second run in
the same UTC second numbers its files `….<UTCstamp>-2`). A run that rewrites agent files also leaves its
**run record** `config.yaml.<UTCstamp>[-N].run` beside them (0600; renamed `….run.committed` when the run
commits, `….run.superseded` when a later run commits over an unfinished one, `….run.resolved` when it is
closed without a commit — by `update.sh` once every listed file is back, or by the operator's `mv`; the
state is the NAME, never a sibling file — §Rollback step 2). Two migrations at once (a manual `--apply`
during an update) are outside this contract. The bare `config.yaml.<UTCstamp>[-N]` name and the `.run*`
suffixes are reserved for the migration: `update.sh` and §Rollback step 2 find the
set to restore by that exact name, so a **manual copy must NOT use it** — give it a suffix, as the
example below does (`….manual`).

> ⚠ **The prune glob is `ctrlb-*.db.gz`** (`install.sh`, the `ls -1t "$BKD"/ctrlb-*.db.gz | tail -n +11 | xargs rm`
> line), so a hand-made snapshot whose name starts with `ctrlb-` — e.g. `ctrlb-manual-pre-v1.7.10-….db.gz`,
> which this box holds — **is pruned with the automatic ones** ([ISS-93](../../docs/ISSUES.md), open). Name
> manual copies so they do not match, e.g. `manual-ctrlb-….db.gz`.

**Not backed up at all:** everything else in the data root — `media/`, `calls/`, `lorebooks/`, `agents/`,
`skills/`, `attachments/`, `SOUL.md`, and `memories/` (which has its own local git history, D26). A §Rollback
restores SQLite and the config only.

**A manual snapshot, any time** (safe while the service runs):
```bash
sqlite3 ~/.ctrl-b/ctrlb.db ".backup '$HOME/.ctrl-b/backups/manual-$(date +%Y%m%d-%H%M%S).db'"
cp -p ~/.ctrl-b/config.yaml ~/.ctrl-b/backups/config.yaml.$(date -u +%Y%m%dT%H%M%SZ).manual
tar -C ~/.ctrl-b -czf ~/ctrl-b-data-$(date +%F).tgz media calls lorebooks agents skills memories attachments
```

## Logs
Every unit writes to the **user journal**; the app keeps no log file of its own (one stderr handler,
`logging.basicConfig` in `app/main.py`).
```bash
journalctl --user -u ctrl-b-dashboard -f                    # PROD backend: uvicorn + the app log + any start refusal
journalctl --user -u ctrl-b-dashboard-dev -f                # DEV backend (see the --reload note below)
journalctl --user -u ctrl-b-dashboard-dev-web -f            # DEV Vite :5173
journalctl --user -u pockettts -u speaches -n 50            # the voice backends (§The voice backends)
journalctl --user -u parakeet-live -u parakeet-clip -n 50   # the ASR engines: listen line + errors only (§The ASR engines)
journalctl --user -u ctrl-b-agent@fable -u ctrl-b-agent@opus  # only the launcher's start line — see below
```
- **A refused start (exit 78)** — a config this build cannot migrate or load: the unit stops in `failed`
  (`RestartPreventExitStatus=78`, no retry loop) and the journal says why (for a needed migration, the command to
  run; for a bad value, the key). During a
  release `install.sh` prints those journal lines itself (§Release, §If something fails).
- **DEV `--reload` after a `git pull` that changes the config shape:** the reload worker refuses, but the
  reloader parent keeps running, so `systemctl --user status ctrl-b-dashboard-dev` reads **`active
  (running)`** while the port is dead, and the refusal is **only in this journal**. A restart turns it into a
  visible `failed` (78); to fix it, stop both dev units and run `install.sh dev`, which migrates the dev config.
  Prod has no `--reload`, so this cannot happen there.
- **The agents:** each `ctrl-b-agent@<i>` is a oneshot that starts a tmux session, so its journal holds only the
  launcher's lines. What `claude` prints lives in the session: `tmux attach -t ctrl-b-fable` (or `ctrl-b-opus`).
- **More detail from the app:** `server.debug: true` raises the `app` logger to DEBUG (the root logger stays at
  INFO), which adds the fleet monitor's per-tick presence line. It is read once at startup, so restart the unit
  (Conf flags it "restart to apply").

**What the app writes to disk itself** is not a log but data, under `$CTRLB_HOME`: the action/event history in
`ctrlb.db` (`GET /api/events`), and — only while `voice.live.debug` is on — the **call trails** under
`$CTRLB_HOME/calls/` (a call's `<call_id>.jsonl` at the top, live dictations in `dictation/`, push-to-talk clips
in `clip/`, the browser's playback probe in `mouth/`; calls, dictations and clips each keep a `<call_id>-<leg>.wav`
recording beside the trail, the playback probe none; the newest
`voice.live.trail_keep` (default 20) per folder are kept). What a trail holds:
[`docs/user-guide/voice-and-calls.md`](../../docs/user-guide/voice-and-calls.md#edge-cases--limits). Trails and
recordings are not backed up (§Backups).

## Script reference
Each script's arguments, environment overrides and refusals, from its source. The procedures that drive them
are §Release, §Rollback and §Deploy above; this section does not repeat them.

**`deploy/linux/install.sh [prod|dev]`** — run ON the box, from the tree it installs (default `prod`; anything
else prints the usage and exits 2). Builds and enables ONE instance; idempotent.
- **Env overrides:** `REPO` (the tree; default `~/apps/ctrl-b` for prod, `~/github/ctrl-b` for dev) ·
  `CTRLB_HOME` (default `~/.ctrl-b` / `~/.ctrl-b-dev`) · `CTRLB_BACKUP_KEEP` (prod DB snapshots kept, default 10 —
  §Backups) · `SYSTEMD_USER_DIR` (where the units are rendered, default `~/.config/systemd/user`; for
  rehearsals only — `systemctl` still talks to the real user manager).
- **The lock:** `$CTRLB_HOME/.deploy.lock`, taken with `flock -n` (package `util-linux`); a second install or
  update for the same instance exits 1 "already running". `update.sh` holds it and hands it down.
- **Refusals (exit 1; the running service is untouched unless noted):** a missing prerequisite (`flock`
  from `util-linux`, `git`, `python3` ≥ 3.14, `node`, `npm`; `tmux` for dev; on prod with an existing
  `ctrlb.db`, `sqlite3` for the snapshot) · no `$CTRLB_HOME/config.yaml` (dev seeds one from
  `~/.ctrl-b` the first time) · `python -m app.config_migration --check` fails, before the frontend build (the
  CLI itself exits 78 for a config this build cannot migrate, 1 for an environmental failure; `install.sh`
  exits 1 either way) · **dev:** `ctrl-b-dashboard-dev` is anything but `inactive`/`failed` (stop both dev
  units first) · a `CTRLB_<SECTION>__<KEY>=` in a dashboard unit's `Environment=`, including a `systemctl --user
  edit` drop-in (an `EnvironmentFile=` is not scanned) · **prod:** the service does not reach `inactive`/`failed`
  within 10 s of the stop (the stop was already sent, so prod may be down) · **prod health gate** (45 s, after the cutover — prod is then on the new code):
  `/api/health` must answer `status: ok`, from a `pid` equal to the unit's `MainPID`, with a `version` equal to
  the checked-out tag; otherwise it exits 1 naming what it saw (and, for a dead service, §Rollback). The pid
  check is skipped with a warning when the response carries no `pid` (an older build), and the version check
  when the tree is not at an exact tag ("liveness only").
- Dev without the `claude` CLI installs the dashboard units only (re-run after installing `claude` to add the
  agents). Dev never snapshots the DB and never builds `dist`.

**`deploy/linux/update.sh <tag> [--force]`** — PROD only; the standing release runner (§Release). `--force` is
read as the second argument only.
- **Env overrides:** `REPO` (must resolve to `~/apps/ctrl-b`, else refused) · `CTRLB_HOME` (default `~/.ctrl-b`).
- **Refuses:** a tree that is not `~/apps/ctrl-b` · `CTRLB_CONFIG` set · a `.env` in the prod tree · local
  changes in the prod tree · the lock held · a tag missing on origin · a CI release gate it cannot verify as
  `success` (`gh` missing or not logged in, no push-event run for the tag and its commit, any other conclusion)
  unless `--force` — the gate is looked up **per tag** (`gh run list --branch <tag>`), so an old tag's run never
  falls out of the window · a tag whose tree cannot be read, or whose `config_migration/VERSION` blob is not
  local in the blob:none prod clone (it names the `git fetch` to run) · a malformed `config_version:` line on
  disk, a damaged VERSION in the tag, a tag that cannot read the config's shape on disk (it prints the exact
  restore, then "re-run this same command"), an OPEN run record of the migrator (a migration that rewrote agent
  files and never committed — it prints the record's set, then "re-run this same command"), or an unstamped
  config already carrying `providers:` against a pre-migration tag (exit 78) · a tag that predates the safe installer (it prints the manual sequence instead —
  §Rollback).
- **Exit codes:** 0 updated and verified, or **already serving the tag** (the tree is at it, the unit is
  `active`, and `/api/health` reports the tag's version from the unit's `MainPID` → "✓ already at <tag> and
  serving it — nothing to update") · 1 refused or failed · 2 usage · 78 config incompatible with the tag.
- **A retry:** when the tree is already at the tag but the service is not serving it (a previous run of this
  update did not finish, or the service is down — it claims neither), it prints "-- retrying <tag> … you came
  from <from> per the git reflog" and takes `<from>` from the newest reflog checkout hop away from another
  commit (after a CHAIN of failed updates that is the last failed target, which the banner warns about); no
  reflog entry → the version you came from is "unknown" and the report says so. The failure report's tree line
  then reads "tree: at <tag> (not moved by this run; …)".
- **The report** (on success, the rollback hint; on a failure after `install.sh` ran, the observed unit state,
  the tree, the installer's exit code, then the rollback advice) is decided by ONE predicate: a restore is
  needed when the config's shape NOW is above what `<from>` reads, or when an OPEN run record exists (a
  migration that rewrote agent files and never committed — the migrator's own record, so no clock or reflog is
  involved; step 5 refuses on it too, on any tag). Otherwise the tag revert alone is enough, and it says so with
  the shapes. When a restore is needed it prints the whole backup set of one stamp — `cp -p` per file, config
  and agent files, every path shell-quoted — from the open record's exact list, or the set picked by shape,
  labelled "taken during this run" or "taken earlier" with its date and shape (a same-second collision's `-N`
  files count, the highest suffix per file); when a superseded record holds the real pre-state behind that set,
  its list is printed instead. A record that is malformed or names a missing backup, or no qualifying backup,
  prints a "stop here" line instead of the checkout. It also CLOSES records whose files prove them closed, by
  renaming them (under the deploy lock): every file back → `.run.resolved`; the live config already above the
  record's shape (a crash right after the commit) → `.run.committed`; every failure
  report also says "if <from> itself never finished deploying, go back further" (a chain of failed updates); for a partial migration it says to put the whole set back first (re-running the migration
  does not repair that state — [ISS-114](../../docs/ISSUES.md)). An unreadable marker or an unknown `<from>` is
  reported as unknown, never as "revert alone". The full rule: UPDATE_PLAN §18.

**`deploy/bootstrap.py`** — the FIRST-deploy orchestrator, run from a checkout that holds `config.yaml`, with
`backend/.venv/bin/python` (it imports paramiko + PyYAML). Its flags are listed under §Deploy A
(`--dry-run` · `--no-prereqs` · `--no-serve` · `--with-dev` · `--claude-env` · `--overwrite-config`). They are
plain membership tests on the command line, so a misspelt flag is **ignored silently** — check the printed plan
(`--dry-run` connects to nothing). The target is `computers.emma` in `config.yaml`, else the first host with
`os_type: linux` and an `ip`. On a failed `install.sh prod` it exits with that script's code. Re-running it on a
deployed box is an unguarded release ([ISS-94](../../docs/ISSUES.md), §Fresh machine vs. emma).

**`deploy/linux/serve-https.sh`** — no arguments: `tailscale serve --bg --https=443 5433` (prod), then prints
`tailscale serve status`. Refuses (exit 1) when `tailscale` is missing or not connected; if `serve` needs
privileges, run `sudo tailscale set --operator="$USER"` once. Its commented dev line names `5173`, but the live
dev door is `:8443 → 5434` ([`docs/HTTPS_TAILSCALE.md`](../../docs/HTTPS_TAILSCALE.md#optional--https-for-the-dev-stack-too);
[ISS-97](../../docs/ISSUES.md) ③). Off: §Stop / remove.

**`deploy/linux/run.sh [prod|dev]`** — a foreground runner without systemd, from any directory (paths resolve
from the script). `prod`: `npm ci` if `node_modules` is missing, `npm run build`, then uvicorn on
`127.0.0.1:5433`; `dev`: uvicorn `127.0.0.1:5433 --reload` + Vite `:5173`. Both pass the same
`--ws-ping-interval 5 --ws-ping-timeout 5` as the units. Needs `backend/.venv`; the data root is `CTRLB_HOME`
if set, else the repo root. It binds `:5433`, the port prod's unit holds on emma. Usage error → exit 2.

**`tools/start-claude.sh [session] [dir] [model]`** — what each `ctrl-b-agent@<i>` unit runs
(`ctrl-b-<i>`, the workspace, `<i>`); by hand it starts an extra session. Defaults: session `ctrl-b`, dir
`~/github/ctrl-b`, model `opus` (`fable` | `opus` | a full model id; the aliases resolve through the pins in
`~/.claude/settings.json`). **Env:** `EFFORT` (default `high`) · `PERM` (default `bypassPermissions`) ·
`MODEL` (used only when no third argument is given, so never by the units). A session that already exists is
left alone (exit 0, with an attach hint). The per-instance overrides file is §The Claude agent services.

## Fresh machine vs. emma (the installer handles both)
The scripts are **portable** — every path resolves against the target user's `$HOME` and the systemd units are
**templates** (`__REPO__`/`__CTRLB_HOME__`/`__NPM__`/`__NODEBIN__`/`__HOME__`/`__TMUX__` — all six rendered at
`install.sh:227-228`) that `install.sh` renders to real paths, so this works for
any user/host, not just `emma`.
- **emma (workspace already exists):** `bootstrap.py` was the FIRST-deploy tool — the existing `~/github/ctrl-b`
  stays put (fetched + fast-forwarded when clean); prod is cloned fresh at `~/apps/ctrl-b`.
  > ⚠ **Re-running `bootstrap.py` on a box that is already deployed is an UNGUARDED release** ([ISS-94](../../docs/ISSUES.md),
  > open): on an existing sparse prod tree its step 2 fetches and checks out the **highest `v*` tag by semver**
  > (`bootstrap.py` `ensure_prod_tree`) and step 3 runs `install.sh prod` — none of `update.sh`'s refusals run
  > (no tag-on-origin check, no CI release-gate check, no config-compatibility precheck), so it would land
  > whatever the newest tag is, red or known-bad (v1.3.1, above). **To move a deployed prod, always use
  > §Release / `update.sh`.**
- **clean Linux box (nothing checked out):** just run `bootstrap.py` — it learns the GitHub URL from the local
  checkout and **clones** the prod tree (and the workspace with `--with-dev`).
- **Prereqs on a fresh box:** `bootstrap.py` step 0 installs `git`+`tmux`+`sqlite3`+`python3-venv`, enables linger, sets the
  tailscale operator (apt/Ubuntu). It does **not** install Python/Node (versions matter) — `install.sh` checks
  for `git` / `python3` ≥3.14 / `node` / `npm` (+ `sqlite3` when there's a DB to snapshot) and **fails loudly
  with the exact install hint** if any is missing. On a non-apt distro, install git+tmux+sqlite3 yourself and
  pass `--no-prereqs`.

## If something fails (debug / finish manually)
Every step is **idempotent** — fix the cause and re-run `bootstrap.py`; completed steps no-op. On failure it
prints where it stopped + an actionable hint. Any pre-cutover failure in `install.sh prod` (build, DB snapshot,
integrity check) leaves the running service **untouched**. To finish by hand on the box:
```bash
systemctl --user status ctrl-b-dashboard                 # is the prod service up?
journalctl --user -u ctrl-b-dashboard -n 50 --no-pager   # why did it fail to start?
curl -s localhost:5433/api/health                        # backend reachable?
cd ~/apps/ctrl-b && CTRLB_HOME=~/.ctrl-b bash deploy/linux/install.sh prod   # re-run install
ls ~/.config/systemd/user/ctrl-b-dashboard.service       # was the unit rendered? (no __REPO__ placeholders)
```
Common causes: missing prereq (install.sh names it), `~/.ctrl-b/config.yaml` absent (SFTP/scp it), user-linger
off (`sudo loginctl enable-linger $USER`), or `tailscale serve` needing the operator
(`sudo tailscale set --operator=$USER`).

## ⚠️ Cautions
- Both instances can **shut down / reboot fleet hosts** (DEV seeds prod's fleet config). Do NOT trigger
  shutdown/reboot actions while testing — DEV is isolated for *data*, not for the real machines it controls.
- Don't modify emma's system/MCP config beyond the prereqs. The DEV backend binds **127.0.0.1**; PROD
  binds **0.0.0.0** (owner waiver 2026-07-10 — direct `http://emma:5433`; SECURITY_MODEL §2.1).
- **Known waiver:** the DEV Vite server listens on **0.0.0.0:5173** (plain HTTP) so the phone can reach it
  over the tailnet — that also makes it LAN-visible. Deliberate for a trusted home LAN; the **DEV backend**
  binds loopback only — but Vite proxies `/api` (WebSocket included), so the dev API is LAN-reachable through
  :5173 while the pair runs (SECURITY_MODEL §2.1), and prod's sole **HTTPS / secure-context (mic)** ingress is Tailscale Serve — but note
  **PROD itself is LAN + tailnet reachable** on plain `http://emma:5433` by the same waiver (unit line
  `--host 0.0.0.0`), so Serve is not prod's only ingress.
- `~/github/ctrl-b` is the **workspace** — where the agent(s) develop; it stays on `main` (the invariant).
  **PROD (`~/apps/ctrl-b`) is never developed on** — no agent, no commits; it only ever checks out released
  tags. One canonical GitHub `main`.
- `config.yaml` holds SSH/API secrets — 0600, never commit it, never echo it. The target's copy is canonical
  after first deploy (see the `--overwrite-config` note).

## Stop / remove
```bash
systemctl --user disable --now ctrl-b-dashboard ctrl-b-dashboard-dev ctrl-b-dashboard-dev-web \
  ctrl-b-agent@fable ctrl-b-agent@opus
tailscale serve --https=443 off                  # remove the HTTPS proxy
tmux kill-session -t '=ctrl-b-fable'             # stop a session by hand (the units' ExecStop does this too)
```
