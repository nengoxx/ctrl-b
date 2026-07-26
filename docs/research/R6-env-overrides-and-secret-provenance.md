# R6 — Env-var overrides for name-keyed config, and env secrets vs a config file the app rewrites

**Date:** 2026-07-26 · **Bought for:** UPDATE_PLAN slice 3 (env overrides) · **Method:** two bounded
Opus 5 (high) passes, primary sources cloned and read (`git clone --depth 1`), plus empirical runs of
pydantic-settings 2.14.2 on this box. Clones deleted after the pass.

**Reference class:** LiteLLM · open-webui · LibreChat · opencode · Continue.dev · AnythingLLM · goose ·
aider (peer class) + Gitea · Grafana · Sentry (the infra tools whose `SECTION__KEY` convention ctrl-b
already copied, included deliberately as the *origin* of our own pattern) + pydantic-settings (our
stack's library, as precedent — we do **not** use it for `Settings`).

**Drove:** the slice-3 design decision (see `UPDATE_PLAN.md` §13 / `DECISIONS.md`).

---

## 1. The two questions

- **Q1 — Addressing.** How does an environment variable address a **named entry** in a map
  (`providers.<name>.<field>`), and what happens when the name cannot survive an env-var name?
- **Q2 — Materialisation + retirement.** When an app accepts secrets from env **and** rewrites its own
  config file from a UI, how is the env-supplied secret kept out of the file? And when an env var's
  path is retired, what happens at boot?

---

## 2. Q1 — how the field addresses named entries

**The one-line answer: the peer class does not do env→path addressing at all. It puts a *reference*
inside the config file and lets the config author name the env var.**

| Project | Env→named-entry addressing? | Mechanism / grammar | Name encoding | Collision | Unknown name / field | Conf. |
|---|---|---|---|---|---|---|
| **LiteLLM** | **No** | `api_key: os.environ/MY_KEY` in `config.yaml`, resolved by a recursive walk — `_check_for_os_environ_vars` (`litellm/proxy/proxy_server.py:4006-4007`) → `get_secret()` | n/a — author names the var | n/a | missing var → `os.environ.get(name)` → **`None`, silent** (`secret_managers/main.py:352`) | VERIFIED |
| **open-webui** | **No** | fixed names; per-connection settings are **positional**: `;`-separated parallel lists `OPENAI_API_BASE_URLS` / `OPENAI_API_KEYS` (`config.py:325-337`), whole map as one JSON blob `OPENAI_API_CONFIGS` keyed by `str(idx)` (`config.py:339-349`) | n/a — index, not name | n/a | bad JSON → `log.warning(...)`; keys outside `range(len(urls))` **filtered out on save** (`routers/openai.py:326`) | VERIFIED |
| **LibreChat** | **No** | `${VAR}` inside `librechat.yaml`; `envVarRegex = /^\${(.+)}$/` (`packages/data-provider/src/utils.ts:1,38-77`) | n/a | n/a | unset → **the literal `${VAR}` is kept**: `return process.env[varName] \|\| trimmed` (utils.ts:51); denylist `isSensitiveEnvVar` refuses infra vars | VERIFIED |
| **opencode** | **No** | `{env:VAR}` / `{file:path}` substitution on the raw config text (`packages/opencode/src/config/variable.ts:36-38`) | n/a | n/a | missing → **empty string, silent** | VERIFIED |
| **Continue.dev** | **No** | `${{ secrets.X }}` / `${{ inputs.X }}` templating | n/a | n/a | unresolved → placeholder kept verbatim | REPORTED |
| **AnythingLLM** | **No** | flat fixed names, one active provider (`LLM_PROVIDER=ollama`, `OLLAMA_BASE_PATH`, …) | n/a | n/a | n/a | REPORTED |
| **goose** | No (flat only) | `Config::get_param`: `env::var(key.to_uppercase())` else top-level YAML key (`crates/goose/src/config/base.rs:733-741`) | n/a | n/a | → `ConfigError::NotFound` | VERIFIED |
| **aider** | name→env-**name generation** only | `--api-key provider=key` → `env_var = f"{provider.strip().upper()}_API_KEY"` (`aider/main.py:601-610`) | uppercase only, **no char substitution** (`some-provider` → `SOME-PROVIDER_API_KEY`) | undefined | bad format → `tool_error` + `return 1` | VERIFIED |
| **Gitea** | **YES — the reference implementation** | `GITEA__<SECTION>__<KEY>` (+ `__FILE`); split on the **first** `__` via `strings.Cut`; section lowercased, key case preserved (`modules/setting/config_env.go:47-96`) | **reversible hex escape** `_0X<hex>_` — *"We will encode a disallowed value as the UTF8 byte string preceded by _0X and followed by _. E.g. _0X2C_ for a '-' and _0X2E_ for '.'"* (config_env.go:43-44) | **last-wins, silent** (`os.Environ()` order, unconditional `key.SetValue`, line 165) | **CREATES both** section and key (`NewSection` 146, `NewKey` 155); no validation, no warning | VERIFIED |
| **Grafana** | **YES, but generate-and-match** | `GF_<SECTION>_<KEY>` — a **single** `_` (`pkg/setting/setting.go:1231-1233`). It never parses the env name: it generates the candidate name for every **known** `(section,key)` and matches, then sorts section prefixes **longest-first** (1065-1067) to disambiguate `GF_AUTH_GOOGLE_` from `GF_AUTH_` | `envNameFromIniName`: `ToUpper`, `.`→`_`, `-`→`_` (1220-1223) — **lossy, many-to-one** | **both collide silently; no handling in code** | unknown key in a **known** section is **CREATED** (1100); unknown section **silently ignored** | VERIFIED |
| **pydantic-settings 2.14.2** | **YES** for `dict[str, Model]` | `<PREFIX><FIELD><D><KEY><D><SUBFIELD>`; splits **left-to-right on the FIRST** delimiters (`sources/providers/env.py:81,298`); a dict annotation accepts **any** key (env.py:251-253) | **NONE** — only `key.lower()` (`sources/utils.py:56-57`) | the env spelling creates a **third, separate** key | **CREATES the entry**; unknown field silently dropped (`extra='ignore'`) or `ValidationError` (`extra='forbid'`) | VERIFIED (source + empirical) |

**Empirical, on this box** (Python 3.14, pydantic-settings 2.14.2, pydantic 2.13.4) — the runs that
settle it:

```
file providers={"emma-speaches": …} + env CTRLB_PROVIDERS__EMMA_SPEACHES__API_KEY=x
  → {"emma_speaches": {...}, "emma-speaches": {...}}      # TWO providers, no warning
env CTRLB_PROVIDERS__TOTALLY_NEW__BASE_URL=http://x       → creates providers["totally_new"]
env CTRLB_PROVIDERS__P1__NO_SUCH_FIELD=z                  → silently dropped (extra='ignore')
env_nested_max_split=2 + …__A__B__API_KEY=x               → {"a": {"api_key": ""}}   # empty provider conjured
case_sensitive=True                                       → {} (you must spell CTRLB_providers__…)
env 'CTRLB_PROVIDERS__qwen/qwen3.5-72b__API_KEY=…'        → works — literal `/` and `.` pass through
```

### Portability (VERIFIED on this box)

- POSIX shell assignment cannot produce `A-B=1`, but `env(1)`, `docker --env` and `os.environ` can.
- **`dash` (`/bin/sh`) strips env vars with invalid names from the environment; `bash` preserves
  them** — `env 'X-Y=1' sh -c 'printenv|grep X-Y'` prints nothing. Any design relying on literal
  dashes in env names breaks under a `sh -c` wrapper (systemd `ExecStart=/bin/sh -c …`, Docker `CMD`
  shell form).

---

## 3. Q2 — env secrets vs a config file the app rewrites

**The one-line answer: nobody solves this with provenance on the value. The projects that are safe
either never write the config file at all, or narrow the write to the keys the request named.**

| Project | UI/API-written store? | Mechanism | Env value persisted? | Conf. |
|---|---|---|---|---|
| **LiteLLM** | yes (DB + `config.yaml`) | `save_config(..., include_env_vars=False)` **pops** `environment_variables` before write; `/config/update` writes **only sections present in the body**; the file stores a *reference* (`os.environ/KEY`) resolved at read | **no**, by default-deny | VERIFIED |
| **Sentry** | yes (options + admin UI) | true provenance: `FLAG_PRIORITIZE_DISK` → `can_update()` returns `OPTION_ON_DISK` → `set()` asserts; UI shows `disabledReason:'diskPriority'`; `FLAG_CREDENTIAL` hides it; `FLAG_NOSTORE` = file-only | **no** — the write is refused | VERIFIED |
| **open-webui 0.10.2** | yes (per-key `config` table) | per-key `Config.upsert()`; namespace carve-out `ENABLE_OAUTH_PERSISTENT_CONFIG=False` makes `oauth.*` non-persistent | **yes** — `seed_defaults()` writes env-derived values into the DB on first boot | VERIFIED |
| **AnythingLLM** | yes — **writes `.env` itself** (`dumpENV`) | no layering, so no hazard; masked values are **dropped**: `!newENVs[key].includes("******")` | n/a (single layer) | VERIFIED |
| **Grafana** | **no** — `/admin/settings` is read-only | no `ini.Save()` anywhere; env applied in memory only | no | VERIFIED |
| **LibreChat** | **no** — `librechat.yaml` is hand-edited | no writer targeting the yaml/.env | no | VERIFIED |
| **Gitea** | partially (DB "system settings") | `environment-to-ini` **materialises `GITEA__*` into `app.ini` at container start, deliberately**; the admin UI never writes `app.ini`, and DB-backed settings are a disjoint key set | yes, by design, at boot | VERIFIED |

**Load-bearing quote — LiteLLM wrote our bug report** (`litellm/proxy/proxy_server.py:3902`):

> Most callers reach `save_config` after `get_config()` merged YAML + OS env into `new_config` … so
> persisting them here would snapshot file/container env vars into a config row that **then shadows
> those sources on every restart**.

The second-order harm they name is worse than the leak: the materialised copy **outranks the env layer
forever after**.

And on narrowing the write (`/config/update`):

> Sections the caller did not send are left untouched — this endpoint never persists pre-existing YAML
> values to DB as a side effect of an unrelated update.

### open-webui's `PersistentConfig` — the closest analogue, and it was deleted

```python
class PersistentConfig(Generic[T]):
    def __init__(self, env_name, config_path, env_value):
        self.config_value = get_config_value(config_path)
        if self.config_value is not None and ENABLE_PERSISTENT_CONFIG:
            …
            self.value = self.config_value          # DB wins over env after first boot
        else:
            self.value = env_value                  # env is a SEED, not an override
```

It kept `env_value` and `config_value` side by side — real provenance — with **DB-wins-after-first-boot**
precedence, and `save()` spliced **one key** into the store rather than dumping a merged document. **As
of 0.10.2 the class is gone**, replaced by a flat `DEFAULT_CONFIG` + per-key `Config` table whose
`seed_defaults()` deliberately writes env-derived values into the DB. What survived the deletion is the
*namespace carve-out*, not the per-value provenance. Cost while it lived: it is the origin of the
"my env var doesn't take effect" complaint class — issue clusters around persistence/env interaction
(#24743 duplicate inserts, #24319 env not parsed, #27061 UI settings ignored). *(REPORTED, moderate
confidence: issue titles + dates retrieved, bodies not opened.)*

### Retired / renamed env vars at boot

| Project | Handling | Hard-fail? | Names the replacement? | Conf. |
|---|---|---|---|---|
| open-webui | silent permanent alias — `os.getenv('WEBUI_SECRET_KEY', os.getenv('WEBUI_JWT_SECRET_KEY',''))` | no | only in a source comment | VERIFIED |
| Gitea | `deprecatedSetting(...)` → `LogStartupProblem(1, log.ERROR, "Deprecation: config option \`[%s].%s\` present, please use \`[%s].%s\` instead because this fallback will be/has been removed in %s")`, rendered as an admin-panel alert; aliases kept ~2–4 minor versions | no | **yes** + removal version | VERIFIED |
| Gitea (moved-to-DB) | `deprecatedSettingDB`: *"present but it won't take effect because it has been moved to admin panel -> config setting"* — **our retired-path case verbatim** | no | yes | VERIFIED |
| **Grafana** | `Logger.Error("Option '[alerting].enabled' cannot be true. Legacy Alerting is removed…"); return fmt.Errorf("invalid setting [alerting].enabled")` | **YES** — the only hard-fail found, and only where continuing would silently disable a subsystem | yes | VERIFIED |
| Grafana (others) | `"[Deprecated] The oauth_auto_login configuration setting is deprecated…"`, `"[Removed] Session setting was removed in v6.2, use remote_cache option instead"` | no | yes | VERIFIED |
| LiteLLM | `# [DEPRECATED]` code comments only; no runtime channel | no | no | VERIFIED |
| **unknown `PREFIX_*` var** | **nobody errors** — all use `os.getenv`/prefix scans that ignore unrecognised names | no | — | VERIFIED (7 repos searched; absence-of-evidence) |

---

## 4. Implications for ctrl-b *(our reading — ages faster than the evidence above)*

1. **Env→path addressing of named entries is a road the peer class did not take, and the two projects
   that did take it both paid for the name problem** — Gitea with a hex escape, Grafana with a lossy
   mapping and no collision handling. Our provider names (`emma-speaches`, `192.168.1.137-9000`) and
   model keys (`qwen/qwen3.5-72b`) are exactly the shapes that break it.
2. **The field's answer to "keep this key out of the config file" is a reference in the file.** It
   costs one resolution point, needs no grammar, and is visible and diffable — the operator can *see*
   that the value comes from the environment, which is the failure mode open-webui's provenance object
   could not deliver.
3. **Every peer that does env→path silently creates unknown entries.** If we ever build it, the one
   thing the field does *not* do — reject a name that is not already in the file — is the part we must
   add, because our known gotcha is that the service crash-loops on a bad config.
4. **Provenance is a Sentry-scale answer.** One peer built it; the closest peer deleted it. For a
   single-user app the cheap fixes (narrow the write; drop masked values rather than restoring them;
   store a reference, not a value) carry the benefit without a new bug class.
5. **A hard-fail on a retired env var is the aggressive end of the field**, but it has a named
   precedent for exactly our shape of case: Grafana fails only where continuing would silently disable
   a subsystem, and a retired *credential* variable is precisely that.

---

## 5. Corrections to premises we held

- The claim that our `.env` is read by **pydantic-settings**, so flipping `extra='forbid'` would make a
  retired `CTRLB_*` var a startup error for free, is **wrong**. `config.py` uses **python-dotenv**'s
  `dotenv_values` to populate `os.environ`, and `Settings` is a plain `BaseModel`; there is no
  pydantic-settings source in the load path, and `extra='forbid'` on our sections would reject
  ordinary unknown YAML keys rather than env vars. *(Raised by the Q2 pass as a "free win"; ruled out
  by the main session against the code.)*
- `.env.example`, `README.md` §Configuration and `DESIGN.md` §9 advertise scalar secret overrides with
  examples (`CTRLB_INFERENCE__CLOUD_KEY`, `CTRLB_STT__KEY`, `CTRLB_TTS__KEY`, `CTRLB_EMBEDDINGS__KEY`)
  that name **fields which never existed**. The one-level form could only ever reach one real
  credential field (`embeddings.api_key`, pre-A11); after A11 it reaches none.

## 6. What was NOT bought

- Home Assistant, Nextcloud, Continue.dev and opencode's *secret* handling (as opposed to variable
  substitution) were not read; Continue.dev and AnythingLLM findings are REPORTED, not VERIFIED.
- Gitea's behaviour under a deliberate escape-vs-literal collision (inferred last-wins, not run);
  Gitea's doc comment says `_0X2C_` for `'-'` but 0x2C is `,` — the comment or the assumption is
  wrong, and no test was found asserting it.
- Sentry's `disabledReason` serializer end-to-end (flag + `can_update` + the UI consumer were read).
- systemd `Environment=` and `docker --env` with a name containing `-` (only `env(1)`/`sh`/`bash`
  tested).
- pydantic-settings `AliasChoices` on a dict field as an explicit per-entry env spelling.
