# R5 — How to STRUCTURE migration code so it doesn't entangle the app

**Date:** 2026-07-26 · **Companion to [R4](./R4-peer-config-migration.md)** (which answered *when* a
migration runs; this answers *how the code is shaped*).
**Commissioned by:** the owner's directive on the A11 disentanglement — *"I want this part of the
project to be clean and able to be maintainable and well designed … make sure that we don't
over-engineer and over-complicate things that will carry technical debt."*
**Method:** three bounded agent passes reading primary source at HEAD (clones deleted). Confidence
markers are the agents' own. **§6 records where the agents disagreed and how it was ruled** — the
recommendations here are not unanimous and should not be read as such.

---

## 1. The headline number: a migration engine is 50–105 lines

VERIFIED by `wc -l`:

| Engine | Lines |
|---|---|
| open-webui's hand-written Alembic glue (`migrations/env.py` 85 + `util.py` 20) | **105** (~30 generic; the rest is SSL/sqlcipher engine construction) |
| LibreChat's entire machinery (`start/migration.js` 44 + `migrations/index.ts` 2) | **46** |
| **our own `db.py::_migrate()`** | **~12** |

> "A working, production migration engine for a project this size is 50–105 lines. Anything larger is
> over-engineering."

Neither project built a framework. open-webui took Alembic off the shelf; LibreChat wrote an explicit
hand-written list and a boot detector.

## 2. The real cost is the FROZEN SCHEMA, not the converter

VERIFIED. Converter sizes look similar — Codex 59, Continue 200, opencode 254 — but:

- **opencode's 254-line converter only compiles because 975 further lines freeze the entire V1
  schema** (`v1/config/config.ts` 192, `provider-options.ts` 227, `provider.ts` 121, `agent.ts` 89, …).
- **Codex's 59 lines carry zero schema debt**, because its aliases ride on the *new* struct.

**Rule this yields: a migration step must operate on RAW DICTS, never on typed models of the old
shape.** Keeping old pydantic models alive to parse the old config is how a 200-line migration becomes
a 1200-line liability.

## 3. Rename ≠ restructure — they want different shapes

- **Rename** → Codex's declarative table + one recursive walker. 5 lines per future rename:
  > ```rust
  > ConfigKeyAlias { table_path: &["agents"], legacy_key: "max_threads",
  >                  canonical_key: "max_concurrent_threads_per_session" },
  > ```
- **Restructure** (nesting/splitting/semantic remap) → one pure function, opencode/Continue style.
  The agent's own mitigation: *"pair it with a write-back that deletes the old keys so the converter
  can be deleted later."*

A11 is a **restructure** (two endpoint blocks → a named catalog + refs from three sections).

## 4. Detection separate from application — LibreChat's best idea

VERIFIED. Boot runs a **pure, side-effect-free** detector returning counts; application is a separate
command. Boot never mutates. And **dry-run defaults to ON** in the signature:

> `async function migrateAgentPermissionsEnhanced({ dryRun = true, batchSize = 100 } = {})`

open-webui does the opposite — no separation, no dry-run, `command.upgrade(cfg, 'head')` at import,
errors swallowed — and boots on a half-migrated DB (R4 §4).

## 5. Where legacy knowledge ACTUALLY accumulates: post-migration repairs

The most important finding in this dossier. open-webui's Alembic step was clean — and then **three
legacy fixups accreted into the normal runtime path anyway**, running unconditionally at every boot:

> ```python
> async def seed_registered_defaults():
>     await Config.rename_prefix('rag.web', 'web')
>     await Config.repair_flattened_dict_configs()
> ```

`repair_flattened_dict_configs()` is ~65 lines driven by `DICT_CONFIG_KEY_ALIASES` — a permanent
12-entry table of legacy-shape knowledge **in the model layer** — and it exists because the config
reshape *didn't fully work*. Plus `migrate_legacy_webhook_config()` in `main.py`.

> "budget for where post-migration repairs will land, because that is where legacy knowledge actually
> accumulates."

**A migration that needs a repair has already lost.** Corrections belong in a new step, never in the
read path.

## 6. ⚠ Where the agents disagreed — and the rulings

| Question | Agent position | Ruling |
|---|---|---|
| **Ordered step registry?** | The Python-patterns agent: *"do not mirror your SQLite `(version, sql)` list … skip the ordered-steps registry until you have three or more migrations"*. The DB-structure agent: take the smallest thing **that gives you an ordered chain**. | **Keep a minimal ordered list.** It is ~8 lines more than a bare function, and it mirrors `db.py`'s existing `MIGRATIONS` — using a *different* shape for config than for DB migrations would itself violate the house "don't duplicate patterns in either direction" rule. But **no framework**: explicit list, no decorators, no directory scan, no discovery, no per-step classes. |
| **Version marker in the file?** | R4 §5① found LibreChat's `version:` is decorative and concluded a marker is not the enabler. The Python-patterns agent recommends a `config_version` int + hard refusal on newer. | **Adopt the marker — this reverses R4 §5① for our case.** See §7; the deciding factor is project-specific and neither agent could have known it. |
| **Boot-time write-back?** | The Python-patterns agent: migrate at the ruamel load boundary and write back immediately. | **Partially rejected.** R4 §4 shows boot-rewrite has the worst track record in the field. We run it from the updater (`install.sh`) and refuse to boot otherwise. The agent's underlying point — *write back immediately, never lazily* — is adopted. |

## 7. The downgrade case (the gap neither R4 nor the original design covered)

Three behaviours observed (VERIFIED where cited):

1. **Detect and refuse, loudly** — Home Assistant, `config_entries.py`:
   > ```python
   > if self.version > handler.VERSION:
   >     self.logger.error("Config entry %s for %s has version %s which is higher than the"
   >                       " current version %s", ...)
   >     return False
   > ```
   → a distinct terminal state `MIGRATION_ERROR`, surfaced in the UI; that integration doesn't load.
   Their `Store` helper does the same with `UnsupportedStorageVersionError` and an explicit
   `max_readable_version` forward-compat contract.
2. **Detect and tolerate inside a declared window** — HA's `minor_version`: a newer *minor* is read
   as-is. Docs: *"a minor version bump is backwards compatible unlike a major version bump which
   causes the integration to fail setup if the user downgrades … without restoring their
   configuration from backup."*
3. **Ignore entirely** — pre-commit, borgmatic, every version-less config: a newer config yields a
   confusing unknown-key error or a silently dropped key.

**Nobody implements down-migration.** No project writes `down()` for a config file. The universal
answer is refuse-or-tolerate plus "restore from backup".

**Why this decides the marker for ctrl-b:** our runbook makes **rollback to the previous tag a
supported operation** (`deploy/linux/README.md §Rollback`). Shape-sniffing cannot detect
config-newer-than-code, so after a rollback the old build would read the new-shape file, find
`providers`/`inference.provider` unknown (sections are `extra="allow"`) and boot with **silently
unconfigured inference**. A `config_version` int turns that into a clear refusal. R4's finding still
holds — *a marker only helps if code branches on it*; LibreChat's doesn't, ours will.

## 8. Python ecosystem: there is no library, and pydantic says don't put it in the model

**No maintained Python library for versioned config-*file* migration exists** (VERIFIED as far as
search allowed; PyPI's search page would not render, so not provably exhaustive). The only candidates
are pydantic-*model* versioning toys: `pyrmute` (58 downloads/month, homepage 404s) and
`stable-pydantic` (12/month, 2 stars). JavaScript has one (sindresorhus `conf`'s semver-keyed
`migrations`); Python does not.

pydantic's maintainers decline to own it, [discussion #3685](https://github.com/pydantic/pydantic/discussions/3685):

> **samuelcolvin:** *"I think this is really hard. I also think in most cases, writing some custom
> logic to do the migration is pretty easy."* … *"In a function somewhere else in the application, and
> call it just before initialising the model."*
> **Viicos:** *"a migration system only makes sense if you are using some kind of DB backend… it should
> probably be implemented in 3rd party libraries."*

**Failure modes of migrating INSIDE the model** (`model_validator(mode="before")`) — all four apply to us:
1. the migrated value is **never persisted**; the file stays old and is re-migrated every boot, forever
   — so the shim can never be deleted;
2. it is **invisible to a round-trip write** — ruamel re-serialises the *document*, not the model, so
   anything the validator "fixed" is silently reverted on the next UI save;
3. it runs on **every** validation, including nested revalidation, so it must be idempotent against
   already-new data;
4. errors surface as a `ValidationError` on an unrelated field, not as "your config is version N".

We already convert raw dicts before `Settings.model_validate` — that is the recommended shape. Keep it.

## 9. Anti-patterns, with named sources

- **Regenerate-from-template destroys comments — ruamel round-trip is NOT sufficient protection.**
  borgmatic's own docs: *"borgmatic config generate replaces any comments you've written in your
  original configuration file with the newest generated comments"*, plus re-adding deleted options
  commented-out and flattening YAML includes. Their mitigation is to refuse in-place overwrite.
  **Rule: mutate the loaded round-trip document in place; never rebuild it from a template.**
- **Per-key destructure-and-delete** — Continue's `migrateSharedConfig.ts`, 209 lines, one block per
  key, whose author wrote *"I'm expecting this code to be removed in the future"* and never did.
- **Expect to meet a broken hand-edited file.** HA treats corrupt user-editable storage as a
  first-class event — renames to `<path>.corrupt.<isotime>` and logs *"This may indicate an unclean
  shutdown, invalid syntax from manual edits, or disk corruption … It is recommended to restore from
  backup"* — explicitly naming manual edits as a cause.
- **Persist through the save path, never by mutating in place.** HA: *"A ConfigEntry object … must
  never be mutated directly by integrations; instead integrations must call async_update_entry."* Only
  a successful return triggers the save, so a migration that fails halfway persists **nothing**.
- **Guard the contract.** HA had to add `isinstance(result, bool)` + *"did not return boolean"* because
  integration authors got the signature wrong often enough to warrant it.

## 10. Implications for ctrl-b *(short; ages fastest)*

1. **Engine ≤ ~40 lines**, mirroring `db.py::_migrate` (§1). Explicit ordered list, no discovery.
2. **Steps take and return raw dicts** (§2). No legacy pydantic models, ever.
3. **`config_version: int` at the top of `config.yaml`**; absent ⇒ 0 ⇒ run everything. Steps stay
   *individually idempotent* anyway (open-webui guards every Alembic step by inspection even though
   Alembic tracks version — belt and braces, §7).
4. **Hard refusal when `config_version > CODE_CONFIG_VERSION`**, naming the fix (§7) — this is what
   makes tag-rollback safe.
5. **Detect ≠ apply** (§4). Boot detects and refuses; `install.sh` applies; `--dry-run` prints the diff.
6. **Mutate the loaded ruamel doc in place** through the existing `edit_config_yaml` chokepoint (§9).
7. **No post-migration repairs in the read path — ever** (§5). A correction is a new step.
8. **No down-migration** (§7). Backup + runbook restore line, matching every project surveyed.

## Sources

- **open-webui** `@HEAD` 2026-07-26: `backend/open_webui/migrations/{env.py,util.py,script.py.mako}`,
  `alembic.ini`, `config.py`, `models/config.py`, `main.py`,
  `migrations/versions/{3ff2c63645b8_…,7b3f2a9c1d4e_…}.py`; issues
  [#24253](https://github.com/open-webui/open-webui/issues/24253),
  [#23134](https://github.com/open-webui/open-webui/issues/23134) (REPORTED — operational pain, not structural).
- **LibreChat** `@HEAD`: `api/server/services/start/migration.js`, `config/migrate-agent-permissions.js`,
  `packages/api/src/agents/migration.ts`, `packages/data-schemas/src/migrations/`,
  `api/server/services/Config/loadCustomConfig.js`, `packages/api/src/app/checks.ts`.
- **opencode** `@HEAD`: `packages/core/src/config.ts`, `packages/core/src/v1/config/migrate.ts` (+ the
  frozen `v1/config/**`), `packages/cli/src/commands/handlers/migrate.ts` (now a 5-line stub).
- **Codex CLI** `@HEAD`: `codex-rs/config/src/key_aliases.rs`, `merge.rs`, `state.rs`, `config_toml.rs`.
- **Continue.dev** `@HEAD`: `packages/config-yaml/src/converter.ts`, `core/config/migrateSharedConfig.ts`,
  `extensions/vscode/src/commands.ts`.
- **Home Assistant**: [`config_entries.py`](https://github.com/home-assistant/core/blob/dev/homeassistant/config_entries.py),
  [`helpers/storage.py`](https://github.com/home-assistant/core/blob/dev/homeassistant/helpers/storage.py),
  [config-flow docs](https://developers.home-assistant.io/docs/config_entries_config_flow_handler/). *(SUPPLEMENT — outside the peer class; admitted because the question is genuinely generic and HA is the most-cited Python precedent for versioned user-config migration.)*
- **pre-commit** [`migrate_config.py`](https://github.com/pre-commit/pre-commit/blob/main/pre_commit/commands/migrate_config.py) (~135 lines, version-less textual rewrite preserving quote style).
- **pydantic** [discussion #3685](https://github.com/pydantic/pydantic/discussions/3685) · **borgmatic**
  [upgrade.md](https://github.com/borgmatic-collective/borgmatic/blob/main/docs/how-to/upgrade.md) ·
  **sindresorhus/conf** · `pyrmute`, `stable-pydantic` on PyPI.

## Known gaps

- PyPI coverage is not provably exhaustive (search page would not render).
- No project implementing **down**-migration for config was found; treat "nobody does it" as strongly
  indicated, not proven.
- No maintainer *regret* comment exists in Codex's or opencode's migration code (grepped in-tree only);
  GitHub issues/PR discussions were not searched, so "no regret" there is **UNVERIFIED**.
- Whether open-webui intends to delete `repair_flattened_dict_configs`/`rename_prefix` — shallow clone,
  no history available.
- The HA PR that introduced `minor_version`; semantics come from current source + docs, not the original rationale.
