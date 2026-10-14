# R104 — Where peer projects put the USER GUIDE, and how the README links it (2026-10-14)

**Date:** 2026-10-14 · **Session:** 78 · **Commissioned by** the owner's question: README vs a separate user guide (grow the README, or link a guide? one file or a folder? what structure?). **Status:** evidence only, nothing decided. One Opus 5.5 lane, no subagents. **Method:** GitHub API reads of each peer's README, default branch, and docs-source tree. I opened the docs-source directories and the key pages raw. Web fetches covered GitHub's README guidance, Diátaxis and the Claude Code docs.

**Confidence legend:** **V** = verified (I opened the repo file or page today) · **R** = reported (inferred from a config file or secondary signal, the page itself not read) · **U** = unverified (expected, not checked).

---

## §1 Per-project evidence

### 1a. Where the guide lives and how the README links it

| Project | User guide lives in | Generator | README → guide link shape | Conf. |
|---|---|---|---|---|
| **open-webui** | Separate repo `open-webui/docs`, served at docs.openwebui.com | Docusaurus (`docusaurus.config.ts`, `sidebars.ts`) | Inline links throughout, plus feature bullets that each link a docs page: "For more information, be sure to check out our [Open WebUI Documentation](https://docs.openwebui.com/)." · "Want to learn more about Open WebUI's features? Check out our [Open WebUI documentation](https://docs.openwebui.com/features) for a comprehensive overview!" The README keeps install + a short Troubleshooting stub that points to `/troubleshooting/`. | V |
| **LibreChat** | Separate repo `LibreChat-AI/librechat.ai`, under `content/docs/` | "Built with Next.js and Fumadocs" (repo description) | A docs badge, plus a Features list where each bullet links its page (`/docs/features/agents`, `/docs/features/fork`…). Then: "[For a thorough review of our features, see our docs here](https://docs.librechat.ai/)". A Resources section repeats "**Documentation:** [librechat.ai/docs](https://librechat.ai/docs)". | V |
| **SillyTavern** | Separate repo `SillyTavern/SillyTavern-Docs`, at docs.sillytavern.app | Retype (`retype.yml`) | One sentence near the top: "We have a [Documentation website](https://docs.sillytavern.app/) to answer most of your questions and help you get started." The Installation section has four per-OS links into the site. | V |
| **AnythingLLM** | Separate repo `Mintplex-Labs/anythingllm-docs`, at docs.anythingllm.com | Next.js `pages/` + `theme.config.tsx` (looks like Nextra) | A docs badge, plus "Cool Features" bullets that each link a docs page (`/features/memories`, `/scheduled-jobs/overview`…). | V (generator R) |
| **opencode** | In-repo: `packages/web/src/content/docs/*.mdx`, served at opencode.ai/docs | Astro (`astro.config.mjs`); Starlight U | One section, `### Documentation`: "For more info on how to configure OpenCode, [**head over to our docs**](https://opencode.ai/docs)." | V |
| **Claude Code** | Not in the public repo; the docs site is code.claude.com/docs | U (MDX components such as `<Tabs>`/`<Accordion>`; looks like Mintlify) | One line: "**Learn more in the [official documentation](https://code.claude.com/docs/en/overview)**." Plus a setup link: "For more installation options, uninstall steps, and troubleshooting, see the [setup documentation]…" | V |
| **Codex CLI** | developers.openai.com/codex (not in the repo). The in-repo `docs/*.md` are now **stubs**, e.g. `docs/getting-started.md`: "For an overview of Codex CLI features, see [this documentation](https://developers.openai.com/codex/cli/features…)" | closed | A `## Docs` bullet list: Codex Documentation · Contributing · Installing & building · Open source fund | V |
| **aider** | In-repo: `aider/website/docs/`, served at aider.chat | Jekyll (`_config.yml`, `_layouts`) | Each Features heading **is** a link to its page (`### [Voice-to-code](https://aider.chat/docs/usage/voice.html)`). Then `## More Information` → `### Documentation`: "Installation Guide", "Usage Guide"… | V |
| **goose** | In-repo: `documentation/docs/`, served at goose-docs.ai | Docusaurus | `# Quick links` (Quickstart · Installation · Tutorials · Documentation) + `## Need help?` (Diagnostics & Reporting · **Known Issues**) | V |
| **Continue** | In-repo: `docs/`, served at docs.continue.dev | `docs.json` (Mintlify's config format) | Badge + `## Documentation`: "To learn how to configure Continue, how it works, and how to customize it, check out the [Continue Docs](https://docs.continue.dev)." | V (generator R) |
| **Hermes agent** | In-repo: `website/docs/` (Docusaurus), at hermes-agent.nousresearch.com/docs | Docusaurus | Badge + "📖 **[Full documentation →]**" + a **`## Documentation` table, page \| what**: "All documentation lives at **hermes-agent.nousresearch.com/docs**:" then rows such as "[Configuration](…/user-guide/configuration) \| Config file, providers, models, all options" and "[Memory](…/user-guide/features/memory) \| Persistent memory, user profiles, best practices" | V |
| **LiteLLM** | Separate repo `BerriAI/litellm-docs` ("The official LiteLLM docs repository"), at docs.litellm.ai. The main repo has no `docs/` dir today. | Docusaurus (`docusaurus.config.js`) | "[**Jump to LiteLLM Proxy (LLM Gateway) Docs**]" + "**Docs: …**" links after each feature block. The README is 714 lines, mostly a provider-support table. | V |
| *Home Assistant* (suppl.) | Separate repo `home-assistant/home-assistant.io` ("User documentation"). Developer docs are a **different site**, developers.home-assistant.io. | Jekyll (`_config.yml`; an `astro/` dir is also present, U) | The README is 33 lines: "Check out home-assistant.io for a demo, installation instructions, tutorials and documentation." | V |
| *Gitea* (suppl.) | docs.gitea.com, source in a separate repo `gitea.com/gitea/docs` | U | `## Documentation`: "You can find comprehensive documentation on our official documentation website… It includes installation, administration, usage, development, contributing guides". Developer docs stay **in-repo** (`docs/development.md`, `docs/build-setup.md`). The README also has a `## FAQ` that points to the docs FAQ. | V |
| *Jellyfin* (suppl.) | Separate repo `jellyfin/jellyfin.org` ("Project website, blog, and user documentation") | Docusaurus | "For further details, please see [our documentation page](https://jellyfin.org/docs/)". The rest of the README is **server development**. | V |

### 1b. The guide's structure, config reference, user/dev split, and edge cases

| Project | Top-level structure | Config-key reference | User vs dev split | FAQ / Troubleshooting / Limits | Conf. |
|---|---|---|---|---|---|
| open-webui | `getting-started/` · **`features/`** (one dir per feature: `chat-conversations`, `workspace`, `notes`, `channels`…) · `tutorials/` · **`reference/`** (`env-configuration.mdx`, `api-endpoints.md`, `database-schema.md`) · `troubleshooting/` · `faq.mdx` · `security/` | **Hand-written**: `env-configuration.mdx`, **8,961 lines**, "a comprehensive reference for all available environment variables, providing their types, default values, and descriptions". It carries a **version stamp**: "This page is up-to-date with Open WebUI release version v0.11.1". A **drift script**, `scripts/scan-missing-env-vars.py`, AST-parses the source for `os.environ[...]` to find undocumented vars. | Contributing lives inside the same site (`contributing.mdx`) | Both a `troubleshooting/` dir and `faq.mdx` | V |
| LibreChat | `quick_start/` · **`features/`** (38 pages, one per feature: `agents`, `fork`, `memory`, `artifacts`, `temporary_chat`…) · `configuration/` (`dotenv`, `librechat_yaml/`, `stt_tts`…) · `user_guides/` · `development/` · `local/` · `remote/` | **Hand-written** pages per config file (`dotenv.mdx`, the `librechat_yaml/` subtree) | `development/` sits in the same site | FAQ U | V |
| SillyTavern | `Installation/` · **`Usage/`** (`Characters/`, `Chatting/`, `worldinfo.md`, `personas.md`, `macros.md`, `quick-start.md`, `faq.md`, `update.md`) · `Administration/` · `For_Contributors/` · `extensions/` | Hand (`Usage/User_Settings`, `Common-Settings.md`) | `For_Contributors/` in the same site | `Usage/faq.md` | V |
| AnythingLLM | Flat-ish: `features/`, `agent/`, `scheduled-jobs/`, `chat-ui.mdx`, `configuration.mdx`, `installation-docker/`… **Single-symptom troubleshooting pages at top level**: `agent-not-using-tools.mdx`, `fetch-failed-on-upload.mdx`, `ollama-connection-troubleshooting.mdx` | Hand (`configuration.mdx`) | Contribute page in the same site | One page per symptom | V |
| opencode | **Flat, one page per feature**: `agents`, `tools`, `themes`, `keybinds`, `permissions`, `mcp-servers`, `models`, `config`, `troubleshooting`, `web`, `tui`… | `config.mdx` is hand-written, but it points at a **published JSON Schema**: "The server/runtime config schema is defined in **`opencode.ai/config.json`**… Your editor should be able to validate and autocomplete based on the schema." | Contributing in the repo `CONTRIBUTING.md` | `troubleshooting.mdx` | V (whether the schema is generated: U) |
| Claude Code | Overview → "Next steps" lists Quickstart · Memory · Common workflows · best practices · **Settings** · **Troubleshooting** (plus a separate `troubleshoot-install`) | A Settings page plus a CLI reference (contents not read) | Agent SDK is a separate section | A Troubleshooting page plus a dedicated install-troubleshooting page | V (nav) / U (pages) |
| Codex CLI | Site: config-basic · config-advanced · config-reference (from the stub `docs/config.md`) | **Generated JSON Schema**: "We generate a JSON Schema for `~/.codex/config.toml` from the `ConfigToml` type and commit it at `codex-rs/core/config.schema.json` for editor integration… regenerate the schema: `just write-config-schema`" (`codex-rs/core/src/config/schema.md`). Whether the site's config-reference page is built from it: U. | Dev docs stay in the repo (`docs/contributing.md`, `docs/install.md` "Installing & building") | U | V |
| aider | `docs/usage/` (one page per feature: `voice`, `images-urls`, `modes`, `commands`, `watch`, `tips`…) · `docs/config/` (`options.md`, `aider_conf.md`, `dotenv.md`, `api-keys.md`) · `troubleshooting.md` + `troubleshooting/` · `faq.md` | **Generated** with `cog` from the argparse definitions, inside the markdown: `options.md` = "<!--[[[cog from aider.args import get_md_help; cog.out(get_md_help()) ]]]-->". `aider_conf.md` builds its sample YAML the same way (`get_sample_yaml`). Prose sits around the generated block. | n/a (single site) | `troubleshooting.md` + `faq.md` | V |
| goose | `getting-started/` · `quickstart` · `guides/` (one per task or feature: `sessions`, `recipes`, `config-files`, `environment-variables`, `logs`…) · `tutorials/` · `mcp/` · **`troubleshooting/`** (`known-issues.md`, `diagnostics-and-reporting.md`) · `goose-architecture/` | Hand (`guides/config-files.md`, `guides/environment-variables.md`) | `goose-architecture/` in the same site | `known-issues.md`: "goose, like any system, may run into occasional issues. This guide provides solutions for common problems." | V |
| Continue | Tabs → groups. Each feature (Agent, Chat, Autocomplete, Edit) repeats **one page template**: `quick-start` · `how-it-works` · `model-setup` · `how-to-customize` · `context-selection`. Then `customize/` and `reference/` | Hand (`reference.mdx`, `reference/`) | n/a | `troubleshooting.mdx` + `faqs.mdx` | V |
| Hermes | **`user-guide/`** (`cli`, `configuration`, `sessions`, `security`, `features/`, `messaging/`; also a page named **`which-file-does-what.md`**) · **`developer-guide/`** · `getting-started/` · `guides/` · `integrations/` · **`reference/`** (`environment-variables`, `slash-commands`, `tools-reference`, `cli-commands`, `faq`) | **Hand table**, `reference/environment-variables.md`, "Complete reference of all environment variables used by Hermes Agent". *Catalogs* are generated (`website/scripts/generate-skill-docs.py`, `extract-skills.py`, `extract-plugins.py`), but config is not. | **Explicit sibling dirs**: `user-guide/` vs `developer-guide/` | `reference/faq.md` | V |
| LiteLLM | (separate repo; tree not walked) | U | U | U | U |
| Gitea (suppl.) | "installation, administration, usage, development" | Hand **config cheat sheet**, plus an **annotated example file** as the exhaustive key list: "See [app.example.ini] or [configuration documentation] (administration/config-cheat-sheet)" | Dev docs in-repo `docs/`, user docs off-repo | README `## FAQ` → "more FAQs are listed in [FAQ documentation]" | V |

### 1c. Generic guidance

- **GitHub, "About READMEs"** [V]: "A README should only contain information necessary for developers to get started using and contributing to your project. Longer documentation is best suited for wikis." Its list of typical contents: "What the project does · Why the project is useful · How users can get started with the project · Where users can get help · Who maintains and contributes". Also: "any content beyond 500 KiB will be truncated."
- **Diátaxis** (diataxis.fr/start-here) [V]: "A tutorial is a lesson, that takes a student by the hand through a learning experience." · "A how-to guide addresses a real-world goal or problem" · "Reference guides contain the technical description - facts - that a user needs in order to do things correctly" · "Explanatory guides provide context and background." · "Each has a different purpose, and needs to be written in a different way." · "Crossing or blurring the boundaries described in the map is at the heart of a vast number of problems in documentation."

## §2 Patterns (counts over the 12 peers + 3 supplements; LiteLLM's internals are excluded where unread)

1. **The README never holds the user guide.** 15/15 keep usage docs out of the README. The README carries pitch, install and a doc link. The longest is LiteLLM's (714 lines), and its bulk is a provider table, not a guide.
2. **The guide is a multi-page folder, never one file.** 15/15. None uses a single `USER_GUIDE.md`. Codex's in-repo `docs/` is a folder of per-topic files, and even its stubs are one file per topic.
3. **Where the source lives:**
   - In the main repo: 5/12 peers (opencode, aider, goose, Continue, Hermes).
   - A separate docs repo: 5/12 (open-webui, LibreChat, SillyTavern, AnythingLLM, LiteLLM), plus all 3 supplements.
   - Closed: 2/12 (Claude Code, Codex).
   - All 12 publish a docs **site**. 0/15 use a GitHub wiki, even where `has_wiki=true`. The generator varies: Docusaurus ×5 (OWUI, goose, Hermes, LiteLLM, Jellyfin), Jekyll ×2, Retype, Fumadocs, Nextra (R), Mintlify (R), Astro.
4. **How the README links the guide**, in four shapes:
   - (a) **one "Documentation" line or section**: opencode, Continue, SillyTavern, Claude Code, Gitea, Jellyfin, HA = 7;
   - (b) **feature bullets that each link their page**: aider, LibreChat, AnythingLLM, open-webui, LiteLLM = 5;
   - (c) **a page | what table**: Hermes = 1;
   - (d) **a quick-links list**: goose, Codex = 2.
   - Several combine (b) with (a).
5. **Top-level structure is feature-per-page plus a separate reference.**
   - A features or usage section with one page (or dir) per feature: 9/12 (OWUI `features/`, LibreChat `features/`, ST `Usage/`, aider `usage/`, opencode flat pages, Hermes `user-guide/features/`, goose `guides/`, AnythingLLM, Continue).
   - A distinct reference area (config, commands, env vars): OWUI, Hermes, aider `config/`, Continue, Codex = at least 5.
   - Continue alone uses a **fixed per-feature template** (quick-start / how-it-works / model-setup / how-to-customize). That is Diátaxis applied per feature.
6. **The config-key reference is mostly hand-written.**
   - Hand-written: OWUI (with a drift scanner), LibreChat, Hermes, goose, Continue, Gitea (with an annotated example file) = 6.
   - Generated from the code's schema: aider (cog from argparse, prose around it) and Codex (JSON Schema from the config type) = 2. opencode publishes a schema (generation U).
   - So **generation is the minority practice**. Where it exists, it serves editor validation (Codex, opencode) or keeps a flag list in sync (aider). Nobody publishes a generated page with no prose around it.
7. **Edge cases get their own place everywhere.** 11/12 verified peers have a Troubleshooting and/or FAQ page (Codex U):
   - goose: a **Known Issues** page;
   - AnythingLLM: one page per symptom;
   - Claude Code: a separate install-troubleshooting page.
   - None has a page titled "Known limitations"; limits sit inside the feature pages or the FAQ (U for Claude Code).
8. **User and developer docs are separated.**
   - By directory: Hermes `user-guide/` vs `developer-guide/`; LibreChat `development/`; ST `For_Contributors/`.
   - By site: Home Assistant.
   - By location: Gitea and Codex keep dev docs in the repo `docs/` and user docs on the site.

## §3 Premises that are wrong

- **"Peers grow the README."** No peer does. Growing the README to cover every feature and edge case would make ctrl-b an outlier. It would also break GitHub's own guidance ("Longer documentation is best suited for wikis").
- **"A separate user guide means a docs site or a separate repo."** That is the norm for projects with many users, but 5/12 peers keep the guide source as plain markdown folders **in the main repo**. Nothing about the convention requires a generator. GitHub renders a `docs/user-guide/` folder of `.md` files as-is, and a generator can be added later over the same folder without moving files (goose, Hermes and Continue all build their sites from such a folder).
- **"Peers generate the config reference from the schema."** That is the minority practice (2/12, maybe 3). The common pattern is a **hand-written reference** kept honest by a check: OWUI's scanner, Gitea's example file, aider's cog. Generating from our Pydantic model would produce names, types and defaults only, because `backend/app/config.py` has **0 `description=`** across its ~178 `Field(...)`s; the explanations live in comments and in `config.example.yaml` (700 lines).
- **"One USER_GUIDE.md is simpler."** No peer ships one. At the scope the owner wants ("every feature, nuance, edge case"), one file across ~10 surfaces would pass the size where every peer splits. Splitting also gives each surface its own linkable URL, which shape (b) relies on.

## §4 NOT BOUGHT

- LiteLLM's docs tree (`BerriAI/litellm-docs`) was not walked.
- Claude Code's Settings and Troubleshooting page *contents*, and its generator (Mintlify suspected), were not checked.
- I did not check whether Codex's site config-reference is built from `config.schema.json`, whether opencode's `config.json` is generated, or whether LibreChat and goose have FAQ pages.
- AnythingLLM's generator (Nextra) and Continue's (Mintlify) are inferred from their config files only.
- I did not read the tutorial, how-to and reference pages of the Diátaxis site, beyond the start-here definitions.
- Kilo Code was not covered; it is in the README's reference class but not in this brief.

---

## §5 Implications for ctrl-b (short; main seat rules)

1. **Layout: a folder.** `docs/user-guide/README.md` (the index) plus one page per surface, kept in the main repo as plain markdown with no generator. This is the 5/12 in-repo pattern, and a site can be built over it later without moving anything. It also keeps user docs apart from the ~50 design and plan docs in `docs/`, following the Hermes `user-guide/` vs `developer-guide/` split.
2. **The README's linking shape.** Add a `## Using ctrl-b` section with a **page | what table**, as Hermes does. Also make each "What it does" bullet link its guide page, as aider and LibreChat do. The README's `## Configuration` chapter (lines 216–336) shrinks to the essentials plus a link, and the existing "Documentation map" stays, relabelled as developer docs.
3. **Section skeleton:**
   - `getting-started.md`: first run, installing the PWA on the phone, HTTPS for the mic;
   - `fleet.md`, `chat.md`, `voice-and-calls.md`;
   - `agents.md` + `characters-and-lorebooks.md`;
   - `media.md`, `themes.md`, `conf.md` (the Conf tab), `automations.md`;
   - `configuration-reference.md`;
   - `troubleshooting.md` (symptom → fix, with a **Known limits** section, after goose's Known Issues).

   Each feature page uses one Continue-style template: *What it is · How to use it (tasks) · Settings that affect it (→ reference) · Edge cases & limits*.
4. **The config reference.** Write it by hand, section by section, from the Pydantic classes. `config.example.yaml` stays the exhaustive annotated key list, as Gitea does with `app.example.ini`. Add a **drift test** in OWUI's spirit: walk `Config`'s `model_fields` recursively and assert each dotted key appears in `config.example.yaml` or the reference page. Do not generate the page from `config.py`: it has no field descriptions, so a generated page would hold no explanations.
