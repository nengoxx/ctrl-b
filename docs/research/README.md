# Field research — the consolidated findings database

**Purpose: buy a research finding once.** Deep field passes (how do 5–10 established projects
actually solve problem X) are expensive. Without a home they get re-bought every time the topic
resurfaces, and the nuances — the ones that change a design — are the first thing lost.

## What lives here vs `../RESEARCH.md`

| | Scope |
|---|---|
| [`../RESEARCH.md`](../RESEARCH.md) | **Our own dependency choices.** Library/version pins + the rationale behind them (React/Vite/FastAPI/pyright…), backing `DECISIONS.md`. |
| **`docs/research/` (here)** | **How the field solves a problem.** Sourced dossiers on external projects' designs — read *before* locking a D-entry that touches the same problem. |

A dossier here is **evidence**, not a decision. Decisions live in `DECISIONS.md`; a dossier is what
a decision cites. When a dossier drives a D-entry, link it from the decision and link the decision
back from the dossier's header.

## Conventions

- **One dossier per problem**, named `R<n>-<slug>.md`. Add a row to the index below.
- **Cite primary sources** — source files and official docs over blog posts. Quote the load-bearing
  lines verbatim; a paraphrase decays into folklore.
- **Mark confidence.** Separate *verified* (read the source / probed the endpoint) from *reported*
  (secondary source) from *unverified* (expected but not checked). A dossier that hides its gaps is
  worse than no dossier — the next reader can't tell what still needs buying.
- **Date every finding.** Upstream projects move; a 2026 finding about a fast-moving repo is a
  starting point, not a fact. Record the date in the header and re-verify before relying on a
  finding older than a couple of releases.
- **Record what was *wrong*.** Corrections to premises we held (see R1's note on goose's
  `GOOSE_LEAD_MODEL`) are among the most valuable entries — they stop a stale belief recirculating.
- **Keep the implications section short and separate** from the evidence. Evidence ages slowly;
  our reading of it ages fast.

## Reference class — WHO to research (owner, 2026-07-25)

**Research peer projects in THIS domain first.** ctrl-b is a self-hosted agent-chat app, so the
reference class is: **opencode · Claude Code · Codex CLI · Kilo Code · Hermes agent · open-webui ·
AnythingLLM · LibreChat · Continue.dev · aider · goose · LiteLLM**. *(open-claw: general reference
only — the owner does not want its decisions leaned on.)*

Generic infrastructure tooling (Kubernetes, nginx, systemd, Terraform, Home Assistant, Syncthing…)
is **out of the reference class unless the question is genuinely generic**, and even then it's a
supplement, not the body of the pass. R2/R3 over-reached into it — the findings are sound but were
not what was asked for, and they cost far more than a focused pass would have.

When a question is "how do apps like ours do X", say so in the brief and name the projects.

## Cost discipline

These passes are token-expensive. The rules that make them worth it:

1. **One agent per bounded question**, and the brief says *do not spawn further subagents* — an
   unbounded research tree fans out geometrically and blows the session budget (learned the hard
   way, 2026-07-25).
2. **Search here first.** If a dossier covers the question, read it instead of re-running the pass.
3. **Write the dossier in the same session the research lands**, while the findings are in context.
   A finding that never reaches this folder was bought for nothing.

## Index

| Dossier | Topic | Date | Drove |
|---|---|---|---|
| [R1](./R1-model-selection-and-capability.md) | Model/provider selection from the chat surface · endpoint capability discovery · per-message attribution | 2026-07-25 | D48 call ① (verb scoping); the ROADMAP model-picker entry |
| [R2](./R2-config-migration-and-legacy-retirement.md) | Config-file shape migration · how legacy readers actually get deleted · atomic secret-file writes · pydantic/ruamel mechanics | 2026-07-25 | The A11/D48 no-legacy-seams review (open) — incl. a verified live comment-orphaning bug |
| [R3](./R3-warning-scoping-and-capability-fields.md) | Where a role-specific warning belongs (declaration vs reference site) · declared capability vs wire dialect · warning-fatigue literature | 2026-07-25 | The api_mode advisory fix (✅ `4d839d1`) + the `openai/tts` question. **Partial — provider auto-naming not bought; moot since the owner ruled `<host>-<service>`, no derivation** |
| [R4](./R4-peer-config-migration.md) | **Peer-class**: *when* a config-shape migration runs, whether the user's hand-edited file is ever rewritten, and how the legacy reader actually gets deleted — 8 projects | 2026-07-26 | The A11/D48 migration design (fix-list item 7). **Supersedes R2's off-class half — it overturns two R2 conclusions (§5)** |
| [R5](./R5-migration-code-structure.md) | **How to STRUCTURE migration code** so it doesn't entangle the app: real engine line counts · frozen-schema debt · detect-vs-apply · the downgrade case · why no Python library exists | 2026-07-26 | The A11 disentanglement design. **§6 records agent disagreements + rulings; §7 reverses R4 §5① on the version marker for our case** |
