# R4 — How peer agent-chat apps migrate a config shape (and how the legacy reader dies)

**Date:** 2026-07-26 · **Reference class:** peer projects only (per [README §Reference class](./README.md)) —
open-webui · LibreChat · AnythingLLM · opencode · Codex CLI · Kilo Code · Continue.dev · LiteLLM.
**Commissioned by:** the owner's ruling on the A11/D48 migration (HANDOFF fix-list item 7): *"is
boot-time the right moment for the whole thing, and how is the cleanup of the old config made part of
the system rather than a leftover?"*
**Method:** four bounded agent passes, each reading primary source at HEAD (clones deleted after).
Confidence markers are the agents' own: VERIFIED = source read · REPORTED = secondary · UNVERIFIED.
**Supersedes the off-class half of [R2](./R2-config-migration-and-legacy-retirement.md)** (Syncthing /
Authelia / Gitea): R2's *mechanics* stand, but its reference class was generic infra and two of its
headline conclusions do not survive contact with the peer class — see §5.

---

## 1. The headline finding

**Every project whose config is a hand-edited FILE converges on the same rule:**

> Read the old keys in memory, forever. Do **not** rewrite the user's file as a side effect of
> loading it. Write only on (a) an explicit user action, or (b) a one-shot whole-*format* change.

That is opencode, Codex CLI and Kilo Code — the three closest structural peers to us — arrived at
independently. LiteLLM reached the same place from the other direction. The projects that *do*
migrate at startup (open-webui, AnythingLLM) are migrating a **database**, not a hand-edited file,
and both have paid for it (§4).

⚠ **This does not settle our case**, because the constraint driving that rule is *"thousands of users
hold files we cannot see"*. We have **two** configs (prod + dev), both the owner's. See §6.

---

## 2. When it runs — the actual spread

| Project | What migrates | Trigger | Writes the user's file? |
|---|---|---|---|
| opencode | v0→v1 config keys | every load | **No** — pure in-memory function (VERIFIED) |
| opencode | TOML→JSON (whole format) | boot, once | **Yes** — writes new, `unlink`s old, no backup (VERIFIED) |
| Codex CLI | renamed keys | every load | **No** — `key_aliases.rs` table (VERIFIED) |
| Kilo Code | v5 extension → v7 | **opt-in wizard**, first run | **No** — reads legacy, writes only new config (VERIFIED) |
| Continue.dev | config.json → config.yaml | **user command** (CodeLens) | Writes a **new** file; leaves the old intact (VERIFIED) |
| Continue.dev | shared settings | boot, in place | **Was yes → now no** (VERIFIED, see §4) |
| LibreChat | `librechat.yaml` | **never** — read-only file | **No** (VERIFIED) |
| LibreChat | Mongo permissions | **detect** at boot, **execute** by npm command | n/a (DB) |
| open-webui | DB schema | **import-time side effect** of `config.py` | n/a (DB) |
| AnythingLLM | DB schema | `prisma migrate deploy` before the app process | n/a (DB) |
| AnythingLLM | `.env` | **every settings write** in production | **Yes** — and lossily (§4) |
| LiteLLM | model shape | **never** — reshape specced, declined | **No** (VERIFIED) |

**Nobody backs the file up. Nobody versions the file. Nobody warns at runtime about a deprecated key.**
(VERIFIED across opencode/Codex/Kilo; LibreChat's `version:` is decorative, §5.)

---

## 3. Mechanisms worth stealing

### 3a. Unknown keys are a HARD ERROR — Codex CLI
`codex-rs/config/src/strict_config.rs` → `format!("unknown configuration field \`{ignored_path}\`")`,
surfaced as `io::ErrorKind::InvalidData`. Deliberately-dead keys stay declared so they don't trip it:

> ```rust
> /// Deprecated: ignored.
> #[schemars(skip)]
> pub js_repl_node_path: Option<AbsolutePathBuf>,
> ```

This is the inverse of our defect (b): our sections are `extra="allow"`, so a stale key is accepted
and silently ignored. Codex proves the strict default is liveable **provided** retired keys are
explicitly declared-and-ignored rather than deleted from the schema.

### 3b. Format-preserving writes that NO-OP when nothing changed — Codex CLI
`codex-rs/core/src/config/edit.rs` round-trips `toml_edit::DocumentMut` and then:

> `if !mutated { return Ok(()); }`

then `write_atomically(&write_paths.write_path, &document.doc.to_string())`. We already have the
comment-preserving round-trip (ruamel) and the atomic 0600 replace; the cheap missing piece is the
**no-op guard** — never touch the file when the edit changed nothing.

### 3c. Fresh-vs-upgrade needs no version marker — Continue.dev
`core/util/paths.ts:119` — the discriminator is **presence of the legacy artifact**:

> ```ts
> const needsCreation = !exists && !fs.existsSync(getConfigJsonPath());
> if (needsCreation || isEmpty) { fs.writeFileSync(p, YAML.stringify(defaultConfig)); … }
> ```

Fresh install (no legacy file) → default new-shape config materialised. Upgrade (legacy present) →
no default written, legacy reader runs, user keeps working untouched.

### 3d. …or idempotent existence checks instead of a stamp — open-webui
`grep -rn "stamp" backend/` returns **zero hits**. A brand-new DB runs all 48 revisions from base;
safety comes from per-migration guards (`if name not in existing_tables`). Stated as policy:

> "Database migrations now skip tables, indexes, and columns that already exist … so upgrades succeed
> even when parts of the schema were manually or partially created beforehand." (CHANGELOG:394)

### 3e. Detect at boot, execute on command, dry-run by default — LibreChat
`api/server/index.js:347` `await checkMigrations();` runs **detectors only**; the writes live behind
`npm run migrate:agent-permissions`. The banner is explicit:

> `IMPORTANT: AGENT PERMISSIONS MIGRATION REQUIRED` … `Please run the following command to migrate
> your agents:` … `npm run migrate:agent-permissions` … `npm run migrate:agent-permissions:dry-run`

and the script signature defaults to safety: `async function migrateAgentPermissionsEnhanced({ dryRun = true, … })`.
Detection is **data-driven and idempotent** (select rows lacking an ACL row), so a fresh install
finds nothing and stays silent — no marker required.

### 3f. Quarantine legacy in its own package, track completion OUTSIDE the file — Kilo Code
Legacy handling lives in a dedicated `packages/kilo-vscode/src/legacy-migration/` rather than spread
through the loader, and migration completion is persisted **outside** the config, in
`MIGRATION_STATUS_KEY = "kilo.legacyMigrationStatus"` (`"completed" | "completed_with_errors" | "skipped"`).

---

## 4. Where the field got burned — the cautionary evidence

**Continue.dev built a boot-time in-place rewriter and neutered it within two months.** VERIFIED:
`migrateSharedConfig.ts` originally ended `editConfigJson(() => config);`; commit `0160b30a`
(2025-03-25) deleted that line. It now strips keys into a local variable and discards them. The file
still opens:

> "I'm disabling this rule for the entire file under the assumption that this is a one-time migration
> script. I'm expecting this code to be removed in the future."

~18 months later it is still there — and the docs still claim it rewrites config.json, which is now
**false**. *A one-shot migration that quietly becomes permanent is the default outcome, not the edge case.*

**open-webui swallows migration failures and boots half-migrated.** VERIFIED, `config.py:74`:

> ```python
> except Exception as e:
>     log.exception(f'Error running migrations: {e}')      # no re-raise, no exit
> ```

Their changelog records this class biting twice: *"a circular import issue that caused schema updates
to fail silently"* and *"allow the migration to complete fully without interruption … may result in
data integrity issues."* This is precisely the owner's "issue machine".

**open-webui's reshape spawned permanent boot-time repair code.** The config blob→per-key migration
(`3ff2c63645b8`) shipped with a flattening defect. The fix is not another migration — it is
`Config.repair_flattened_dict_configs()` plus `Config.rename_prefix('rag.web', 'web')`, running on
**every boot, forever**, outside alembic. The same reshape *dropped* the old table's `version` column,
so config now has no marker of its own, and the preserved `config_old` table is **never dropped**.

**AnythingLLM rewrites `.env` on every settings save — losslessly is not the word.** `dumpENV()`
rebuilds the file from a hardcoded ~40-key allowlist and overwrites in place
(`fs.writeFileSync(envPath, envResult, { flag: "w" })`). Any hand-added key not on the allowlist is
**silently dropped**; no backup, no atomic replace, no explicit mode. *This is the exact failure class
we removed from our own writer this session.*

**opencode deleted a legacy read path and reverted it the next day.** `6566ede9` renamed
`reference`→`references` and dropped the old key; `90fb32be` restored it, leaving this in opencode's
own config:

> ```jsonc
> // TODO: flip back to `references` once a release containing the v1 `reference` migration ships.
> // The release pipeline runs the latest published opencode against this file, which only knows `reference`.
> ```

**The lesson is precise: the dangerous step is not writing the migration — it is deleting the legacy
READER while any config in the wild is still old-shape.**

---

## 5. Two R2 conclusions that do not survive the peer class

**① "Add a persisted version marker" is not the deletion-enabler R2 framed it as.** LibreChat has
exactly that field, and it is **decorative**: `CONFIG_VERSION` appears 3 times in the repo — the enum
definition and the two lines of a single `logger.info`. Nothing branches on it; no migration is
selected by it; a stale value never blocks or changes parsing. What actually enforces schema evolution
there is `configSchema.strict()` — hard-fail on unknown keys (i.e. §3a, not the marker). Codex,
opencode, Kilo and Continue have **no version field at all**. (VERIFIED.)

**② "Essentially nobody deletes migration code" is false in this class — three did.**

| Project | What was deleted | Size | What licensed it |
|---|---|---|---|
| open-webui | the whole peewee migration layer (18 files, handler, wrappers, both deps) | **−1673** | a **floor version**: *"Peewee migrations are no longer needed for any version >= 0.3.6"* |
| LibreChat | deprecated Project model + `isCollaborative` | **+94 / −817** | superseded by ACL permissions, ~8 months after the migration shipped |
| Kilo Code | the entire pre-v7 extension `src/` tree | wholesale | rearchitecture; legacy reachable only via the opt-in wizard |

None of the three used a config-file version marker to justify it. Two used a **floor/superseded-by**
argument; one used rearchitecture.

---

## 6. Implications for ctrl-b *(short, and ages fastest — see README)*

Our situation differs from every project above in the way that matters: **we have exactly two configs
(prod + dev), both owner-owned, and we can inspect both.** The field's rule (§1) exists because those
projects cannot see their users' files and therefore can never prove convergence. We can — which is
the one condition under which the owner's *"migrate once, then the extra code dies"* ruling is
actually safe, and it is a condition none of them have.

What the evidence changes, or should be weighed against, in the current plan:

1. **The riskiest step is deleting the legacy reader, not writing the fold** (opencode's revert).
   Sequencing that as a *separate, later* step — after both configs are verified converged — is what
   makes it safe. Deletion and migration should not ship together.
2. **Boot-time in-place rewrite is the pattern with the worst track record here** (Continue neutered
   it; open-webui boots half-migrated on failure; AnythingLLM's auto-rewrite is lossy). If we keep it,
   the failure policy must be the opposite of open-webui's: **fail loud, refuse to boot** — LibreChat
   and AnythingLLM both refuse rather than degrade, LibreChat with an explicit
   `CONFIG_BYPASS_VALIDATION=true` escape hatch.
3. **A version marker is optional; a discriminator is not.** §3c (presence of the legacy artifact) or
   §3d (idempotent guards) both solve fresh-vs-upgrade without one, and our fold already *is* a
   shape-sniffer — which is the discriminator.
4. **Codex's strict-unknown-keys (§3a) is a direct fix for our defect (b)** — the silent
   `extra="allow"` swallow — and its declared-but-ignored pattern is how retired keys stay safe.
5. **Codex's no-op guard (§3b)** is a cheap addition to our existing chokepoint.
6. **If the fold must survive**, Kilo's §3f (own package + status tracked outside the config) is the
   shape that keeps it from metastasising the way open-webui's did.

---

## Sources

All read at HEAD, 2026-07-26, unless dated otherwise.

- **open-webui** `@ecd48e2f7` (v0.10.2): `backend/open_webui/config.py`, `env.py`, `main.py`,
  `migrations/versions/3ff2c63645b8_reshape_config_to_per_key_rows.py`, `7e5b5dc7342b_init.py`,
  `models/config.py`, `CHANGELOG.md`; deletion commit `2c2d06c31b463a87d4ece2a4eb4c1d2f73cd3980`
  (2026-05-12, v0.9.6).
- **LibreChat** (`CONFIG_VERSION = '1.3.13'`): `api/server/services/Config/loadCustomConfig.js`,
  `api/server/index.js`, `api/server/services/start/migration.js`, `packages/api/src/app/checks.ts`,
  `packages/api/src/agents/migration.ts`, `config/migrate-agent-permissions.js`,
  `packages/data-provider/src/config.ts`; deletion commit `58f128bee` (2026-02-13, #11773).
- **AnythingLLM**: `docker/docker-entrypoint.sh`, `server/utils/helpers/updateENV.js`,
  `server/utils/database/index.js`, `server/endpoints/system.js`, `server/prisma/seed.js`,
  `server/__tests__/utils/helpers/azureOpenAiModelPref.test.js`; orphaning commit `a126b5f5a` (2023-09-28).
- **opencode** (`dev`): `packages/core/src/config.ts`, `packages/core/src/v1/config/migrate.ts`,
  `packages/opencode/src/config/config.ts`; commits `6566ede9` (#31539) and `90fb32be` (#31659).
- **Codex CLI** (`main`): `codex-rs/config/src/key_aliases.rs`, `strict_config.rs`,
  `loader/layer_io.rs`, `config_toml.rs`, `codex-rs/core/src/config/edit.rs`,
  `codex-rs/tui/src/app/startup_prompts.rs`.
- **Kilo Code** (`main`, v7): `packages/kilo-vscode/src/legacy-migration/migration-service.ts`,
  `packages/kilo-vscode/src/kilo-provider/handlers/migration.ts`,
  `packages/opencode/src/kilocode/modes-migrator.ts`, `packages/core/src/v1/config/migrate.ts`.
- **Continue.dev** (`main` @ 2026-07-21): `packages/config-yaml/src/converter.ts`,
  `extensions/vscode/src/commands.ts`, `core/config/profile/doLoadConfig.ts`,
  `core/config/migrateSharedConfig.ts`, `core/util/paths.ts`,
  `extensions/vscode/src/lang-server/codeLens/providers/ConfigJsonConverterCodeLensProvider.ts`;
  commits `fcdc63ef` (2025-01-06), `eb8f9b15` (2025-01-24), `0160b30a` (2025-03-25).
- **LiteLLM** (`main`): `litellm/proxy/proxy_config.yaml`, `litellm/proxy/_types.py`,
  `litellm/proxy/proxy_server.py`; GitHub Discussion #1000 (REPORTED).

## Known gaps

- Codex CLI's historical `config.json`/`config.yaml` → `config.toml` transition: **no reader exists in
  the Rust tree** (VERIFIED by absence), but whether a converter ever shipped and was later removed is
  UNVERIFIED — the changelog is a pointer to the releases page and commit search returned nothing.
- Pre-v7 Kilo Code source is not on the remote; the `.roomodes`→`.kilocodemodes` rename code is
  REPORTED (fork lineage + `ModesMigrator`'s legacy path list), not read.
- Whether any AnythingLLM Prisma migration does a *data-shape* transform vs pure DDL — 41 migration
  dirs listed, individual `migration.sql` files not read.
- The exact peewee-era startup log text (open-webui) — peewee_migrate internals not read.
- Continue: whether JetBrains/CLI surfaces carry the same CodeLens/toast; only the VS Code path was read.
