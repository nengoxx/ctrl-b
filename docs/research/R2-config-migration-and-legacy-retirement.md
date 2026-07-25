# R2 — Config-file shape migration: how the legacy reader actually dies

**Date:** 2026-07-25 · **Drove:** the A11/D48 no-legacy-seams review (open) · **Status:** evidence, not
a decision

Field pass over Syncthing, Zigbee2MQTT, Authelia, Gitea, open-webui, Jellyfin, Vaultwarden, OctoPrint,
Nextcloud, Immich, Uptime Kuma (**source read directly**), plus Kubernetes/kubebuilder, Compose,
Traefik, Caddy, Home Assistant ADR-0021, Alembic, Fowler, Azure ACL (**primary docs**). Python
mechanics **empirically verified** on our pins (pydantic 2.13.4, ruamel 0.18.17, Py 3.14.4).

---

## 1. The headline finding

**No established pattern reliably ends with zero legacy-reading code — because almost nobody executes
the contract phase.** The record is unambiguous:

- **Gitea v1.27.0** still ships fallbacks whose own warning says *"will be/has been removed in
  **v1.19.0**"* — eight minor releases past the stated deadline. The hedge "will be/has been" was
  written so the string stays correct after the deadline slips.
- **Authelia v4.39.20** still auto-maps `logs_level` → `log.level`, deprecated in **4.7 (2019)**. All
  43 deprecations spanning 4.7→4.39 are live. Its docs claim the 4.30 set was *"fully removed as per
  our deprecation policy"* — **the code disagrees with the docs.**
- **Vaultwarden** carries `// TODO: After deprecation make it def` unchanged since **2022-02-22**.
- **Docker Compose** gave up: *"It is only informative and you'll receive a warning message that it
  is obsolete if used. Compose always uses the most recent schema… regardless of the `version` field."*

Fowler names the failure mode: *"If the contract phase is not executed you might end up in a worse
state than you started, therefore you need discipline to finish the transition successfully."*
([ParallelChange](https://martinfowler.com/bliki/ParallelChange.html))

**So the useful question isn't "what's the pattern" but "what makes deletion cheap enough to actually
happen."** Two mechanisms do, and both are structural rather than procedural.

## 2. Four strategies in the wild

| Strategy | Who | Rewrites the file? | Version field? |
|---|---|---|---|
| **A. Read-time fold, never write** | Gitea, Authelia, Vaultwarden, Immich | No | No |
| **B. Versioned N→N+1 chain, write back at boot** | Syncthing, Zigbee2MQTT | Yes, once | **Yes** (int) |
| **C. Idempotent detector-migrations, no version** | OctoPrint, Jellyfin, open-webui | Yes | No — per-migration applied-set |
| **D. Split ownership: human file read-only, app writes its own store** | Home Assistant, Vaultwarden, Nextcloud | Only the app's store | n/a |

**The sharpest signal in the survey: Home Assistant uses B *and* D, split by ownership.** It versions
and rewrites the state *it* owns (`.storage/*`, with `VERSION`/`MINOR_VERSION`/`max_readable_version`);
for the file the *human* owns (`configuration.yaml`) it uses read-time compat plus
[ADR-0021](https://github.com/home-assistant/architecture/blob/master/adr/0021-YAML-integration-configuration-deprecation-policy.md)
— deprecation period *"at least 6 months (being 6 release cycles)"*, migration required where
possible, and a repairs-dashboard issue **required**. **Who owns the file determines everything else.**

## 3. What actually enables deletion

### Mechanism 1 — a persisted version marker *plus a declared floor*

Syncthing is the **only** project surveyed that has genuinely deleted migration code, and the only one
with both halves:

```go
const ( OldestHandledVersion = 10; CurrentVersion = 52 )

if cfg.Version > 0 && cfg.Version < OldestHandledVersion {
    slog.Warn("Loaded deprecated configuration version; attempting best effort conversion, but please verify manually", "version", cfg.Version)
}
```

Migrations 1–10 are gone. That deletion was *defensible* only because every config on disk carries a
number, so the code can state a floor and mean it.

**Shape-sniffing migrates fine but produces zero evidence licensing deletion** — "no legacy keys
present" is indistinguishable from "never migrated, just sparse here." That is exactly why
open-webui's folds and Authelia's 43 entries are immortal.

### Mechanism 2 — make the legacy surface so small that leaving it costs nothing

Syncthing's second trick is the best reader-retirement device found, and it serves a no-legacy-seams
rule directly:

```go
DeprecatedUPnPEnabled   bool `json:"-" xml:"upnpEnabled,omitempty"`   // Deprecated: Do not use.
DeprecatedScanOwnership bool `json:"-" xml:"scanOwnership,omitempty"`

func migrateToConfigV37(cfg *Configuration) {
    cfg.Folders[i].SendOwnership = cfg.Folders[i].DeprecatedScanOwnership
    cfg.Folders[i].DeprecatedScanOwnership = false
}
```

`json:"-"` + `omitempty` + zeroed-by-migration ⇒ the old key **parses on read and vanishes on write**,
with **zero downstream branching**. The legacy surface is one struct tag and one migration line.
Jellyfin's variant — a frozen private `OldNetworkConfiguration` class inside the migration file — keeps
the mainline model pristine at the cost of a duplicated class.

### Mechanism 3 — a hard upgrade contract (procedural, and it works)

Nextcloud forbids skipping majors (*"Updates between multiple major versions and downgrades are
unsupported."*), which is what licenses deleting older migration code outright.

### ⚠ The lazy-write-back trap

Migrating in memory at boot but persisting only on the *next user-initiated save* means **a config the
user never saves never settles — so the fold can never be retired at all.** Every strategy-B system
writes back immediately after the chain precisely to force settlement. This is the one place where a
common design and the deletion goal are in direct conflict.

## 4. Constraints specific to hand-edited YAML holding secrets

- **Templating / `!secret` / env-expansion makes write-back structurally unsafe.** Authelia runs
  byte-level filters *before* YAML parsing (`NewExpandEnvFileFilter()`, `NewTemplateFileFilter()`);
  writing the parsed tree back would bake resolved secrets into the file. Same for HA's `!secret` and
  Z2M's `!secret.yaml key`. **A hard architectural constraint** — if a config ever grows `${VAR}`,
  boot-time write-back is off the table.
- **Comment loss is universal; indirection is the universal mitigation.** Nobody in the survey uses a
  comment-preserving library — Z2M, OctoPrint and Immich all use destructive `load`/`dump`. Koenkk
  (Z2M #13339): *"The used YAML library doesn't preserve comments (and it turns out this is very
  difficult to do)."* PyYAML's position: *"Comments are completely discarded down at the scanner level
  by both libyaml and pyyaml."* So everyone converged on indirection — Nextcloud side-cars, Z2M's
  `!secret` (it writes the *pointer* back, not the value), HA's `.storage`, Vaultwarden's
  `.env`-vs-`config.json`. Nextcloud's blunt fallback: write the warning **into** the file.
- **Permissions.** Gitea chmods 0600 on save; Syncthing writes its archive at 0600 and **pinned the
  tempfile-mode assumption with a test**. OctoPrint shows the anti-pattern:
  `permissions |= os.stat(filename).st_mode` **unions** with the existing mode, so requesting 0600 on
  an already-0644 file is a no-op. **Set the mode, don't OR it.** Verified: `os.replace` gives the
  target the *source's* mode (old inode unlinked) — all permission work must happen on the temp file.
- **Atomicity** (LWN 457667): temp on same FS → write → **fsync the temp** → rename → **fsync the
  containing directory**. The dir fsync is still required after a replace — `rename(2)` atomicity is
  about visibility, not durability. Note the split: the **file** fsync needs no OS branch (documented
  on Unix *and* Windows); only the **directory** fsync needs an `os.name != "nt"` gate.
- **Use the stdlib.** `atomicwrites` is archived (2022-07-16); the author's own note: *"Python 3 has
  `os.replace`… which probably do well enough of a job for most usecases."* `safer` has no fsync and
  applies `copymode` *after* writing (the CERT FIO06-C window). **No PyPI library implements "create
  at 0600 with `O_EXCL` before writing secrets"** — CPython, pip, HA and Ansible each hand-roll ~25 lines.

## 5. Python mechanics — verified, with three surprises

- **`Field(deprecated=...)` does NOT warn on validation.** Verified: attribute *access* warns;
  `model_validate({"old_field": 5})` and `model_dump()` do not. It warns *your code*, never the
  operator — useless for "your config.yaml still uses X." Log it yourself in the fold.
- **Multiple `@model_validator(mode="before")` on one model run in REVERSE declaration order.**
  Verified; an unacknowledged v1→v2 change ([pydantic #7434](https://github.com/pydantic/pydantic/discussions/7434)).
  Never rely on source order — merge into one function.
- **A string discriminator rejects legacy files** (no `version` key → `union_tag_not_found`). A
  **callable** `Discriminator` defaulting absent→v1 fixes it *and* gives a free "written by a newer
  build" guard (`union_tag_invalid`) — HA's `max_readable_version` for free.
- **No standard library exists.** `pydantic-versions` (1 star), `pyrmute` (repo 404s), `cadwyn`
  (versions the HTTP boundary, not a file at rest); `dynaconf`/`confuse`/`omegaconf` have no migration
  feature. **Hand-roll it.**
- **Alembic is explicitly the wrong tool**, per its own cookbook: *"it's not in fact advisable in the
  general case to write data migrations that integrate with Alembic's schema versioning model."*
  Borrow only the mechanics: a version marker stored *with* the data, an ordered chain, and **`stamp`**
  — a brand-new config must be stamped at CURRENT, never run through the chain.

## 6. The single-fold argument is not actually contested

Every system above confines version knowledge to a boundary converter. Kubebuilder: *"Mark one version
as the 'hub', and all other versions just define conversion to and from the hub."* Alexis King names
the alternative — **shotgun parsing**, *"whereby parsing and input-validating code is mixed with and
spread across processing code"*; `cfg.get("new", cfg.get("old"))` sprinkled around **is** that.

Two citations settle it. Azure's anti-corruption-layer guidance treats the fold as scaffolding with
scheduled demolition: *"consider whether it's permanent or whether you plan to retire it after you
migrate all legacy functionality."* And Fowler's **Tolerant Reader** — routinely mis-cited as license
to sprinkle fallbacks — actually says: *"**Encapsulate payload reading in a single location**, typically
using a Data Transfer Object wrapper."* Even the tolerance pattern says *one place*.

**Synthesis: tolerant reader at exactly one point, strict parser immediately after, nothing downstream
aware the old shape existed.** That is what `no-legacy-seams-clean-final-code` already mandates.

## 7. Fit to ctrl-b — including one verified live bug

`backend/app/config.py` already implements the recommended architecture: `ruamel.yaml==0.18.17` with
`preserve_quotes`, surgical `deep_set`/`sync_mapping` rather than `model_dump()`, `_write_replace_0600`
doing `O_EXCL|O_NOFOLLOW` at 0600 → `os.replace`, **one** write chokepoint in `edit_config_yaml`, and a
quarantined `_migrate_legacy()` fold. Hardcoding 0600 rather than preserving is the *better* choice for
a secrets file (it self-heals a config degraded to 0664). **Nothing in the research argues for changing
the core.**

### ⚠ VERIFIED LIVE BUG — comment orphaning on delete

`sync_mapping` (~L1660) and `_delete_dotted` (~L1673) both use a bare `del node[k]`. Reproduced on our
pinned ruamel:

```
ca of inference: {'local': '# DEPRECATED legacy slot\n'}
ca of local (nested): {'base_url': '\n  # how many tool calls before we bail out\n'}
```

The comment documenting `inference.max_steps` is stored on `inference.local.base_url` — **inside the
subtree being deleted**, on its last key. So dropping the legacy `inference.local` slot **silently
destroys the operator's documentation for `max_steps`**, a live key the migration never touched. This
sits on the live A11/D48 path. **Fix:** before deleting, re-attach the trailing comment blob to the
preceding key (split first line from the rest), with an explicit branch for index 0. Worth a test
asserting a neighbouring comment survives a key removal.

### Three smaller gaps

1. **No `fsync`.** The docstring calls this deliberate under the closed OS-branch allowlist — but the
   *file-level* fsync needs no OS branch and closes the zero-length-config-after-power-loss hole. A
   design tension worth surfacing, not a silent omission.
2. **`explicit_start` unset** — if `config.yaml` ever begins with `---`, the first UI write silently
   removes it.
3. **`save_settings` dumps via `yaml.safe_dump(model_dump())`**, annihilating every comment. No
   production callers today (tests only) — a loaded gun, not a live wound.

## 8. The two design questions this raises (owner's call)

Both are about **deletability**, not correctness:

1. **Add a persisted version marker, or accept the fold is permanent.** Without one there will never
   be evidence licensing removal, and the Authelia/Gitea outcome is the default. Because our file is
   hand-edited — and Z2M documents *"Do not edit the `version` setting manually"* as a real footgun —
   the marker arguably belongs in **`ctrlb.db`** rather than in `config.yaml`. Jellyfin moved its
   ledger into the DB for exactly this reason. (We already have `schema_version` in the DB; config has
   no marker of any kind.)
2. **Reconsider lazy write-back.** D48's "persist on the next save" is a genuine minority position; a
   config never saved never settles, so the fold can never be retired. Note this is **live for us**:
   both prod and dev `config.yaml` are still legacy-shaped on disk and have been re-migrating in
   memory every boot since A11 landed.

### Two cheap wins regardless

- **Surface deprecations in the UI, not the log** — Gitea's `StartupProblems` → admin banner and HA's
  mandatory repairs issue are the two mechanisms that actually get configs fixed.
- **Record `deprecated-in` as a fact, derive `removed-in` as policy** (Authelia's `Version.NextMajor()`)
  rather than hardcoding removal strings that go stale — Gitea's data shows they do.

Also worth copying: our recorded D48 residual *"a config holding BOTH `providers:` and stale legacy keys
never migrates (legacy ignored, not deleted)"* is exactly Authelia's `errFmtAutoMapKeyExisting` case —
where it emits a **specific warning telling the user to remove the stale key** rather than silently
ignoring it.

## Sources

**Source read directly:** [syncthing](https://github.com/syncthing/syncthing) (`lib/config/migrations.go`,
`config.go`, `lib/osutil/atomic.go`) · [zigbee2mqtt](https://github.com/Koenkk/zigbee2mqtt)
(`lib/util/settingsMigration.ts`, `yaml.ts`) · [authelia](https://github.com/authelia/authelia)
(`internal/configuration/deprecation.go`, `template.go`) · [gitea](https://github.com/go-gitea/gitea)
(`modules/setting/config_provider.go`) · [open-webui](https://github.com/open-webui/open-webui)
(`backend/open_webui/config.py`) · [jellyfin](https://github.com/jellyfin/jellyfin) (`Jellyfin.Server/Migrations/*`)
· vaultwarden `src/config.rs` · OctoPrint `src/octoprint/settings/__init__.py` · Nextcloud
`lib/private/Config.php` · Immich `server/src/utils/config.ts`

**Docs:** [K8s deprecation policy](https://kubernetes.io/docs/reference/using-api/deprecation-policy/) ·
[Kubebuilder hub-and-spoke](https://book.kubebuilder.io/multiversion-tutorial/conversion-concepts) ·
[Compose version](https://docs.docker.com/reference/compose-file/version-and-name/) ·
[Traefik v2→v3](https://doc.traefik.io/traefik/migrate/v2-to-v3-details/) ·
[HA ADR-0021](https://github.com/home-assistant/architecture/blob/master/adr/0021-YAML-integration-configuration-deprecation-policy.md) ·
[HA minor-version](https://developers.home-assistant.io/blog/2023/12/18/config-entry-minor-version/) ·
[Alembic cookbook](https://alembic.sqlalchemy.org/en/latest/cookbook.html) ·
[ParallelChange](https://martinfowler.com/bliki/ParallelChange.html) ·
[TolerantReader](https://martinfowler.com/bliki/TolerantReader.html) ·
[Azure ACL](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer) ·
[Parse don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) ·
[LWN 457667](https://lwn.net/Articles/457667/) ·
[CERT FIO06-C](https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/input-output-fio/fio06-c) ·
[pyyaml #90](https://github.com/yaml/pyyaml/issues/90) ·
[atomicwrites (archived)](https://github.com/untitaker/python-atomicwrites)
