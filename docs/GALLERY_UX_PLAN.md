# Gallery UX Plan — the galleries' UI/UX refinement (ROADMAP J1)

> **Status (2026-10-07): ✏️ OWNER-ASKED · NOTHING DESIGNED · NOTHING BUILT.** This file is the plan-of-record STUB
> for a **dedicated design session** — it states the problem, what the owner wants, the scope, the method and the
> constraints precisely enough that a fresh session (the owner's parallel Fable seat in the `ctrl-b-opus` tmux unit,
> 2026-10-07 onward) can resume it **from this file alone**, while the main seat finishes the ASR release (Phase 26).
> **The owner's timeline:** the ASR plan FINISHED this week; J1 and [J2](./CONFIG_DEBLOAT_PLAN.md) DESIGNED + PLANNED
> for later implementation. The two are separate sessions — J2 is the configuration de-bloat and is NOT this file.

## 0. How to read this

§1 the problem in the owner's words · §2 what the owner wants (the goals and the floor) · §3 the scope inventory
(every surface, file, and doc) · §4 the method (research-first → inventory → the owner's tweak list → council →
slices) · §5 constraints and locked decisions · §6 starting evidence · §7 open questions for the owner · §8 working
rules for the parallel session. When the design is ruled, this file becomes the plan (status line, §4's ladder, a
council record §9) exactly like `MEDIA_MANAGER_PLAN.md` did.

## 1. The problem (owner, 2026-10-07, verbatim where quoted)

- *"I think we should dedicate a whole session just to refine a little bit of the UI and user experience for the
  gallery — not just for the agent gallery, but for the galleries in general, the image galleries for the background
  and the themes, etc. They're not bad, but I think that we could refine them a little bit more."*
- *"That would warrant maybe a couple researches in how to actually design the UI for user experience."*
- *"There's a lot of small things that I would like to tweak here and there. Also in the agent editor and things that
  have very dense configurations and controls."*
- The trigger: the agent gallery's first-paint size flash (ISS-68, fixed `7b13b85`) and its consistency audit
  (`~/.cache/tmp/ctrlb-session63/audit-gallery.md` §B — a real inventory of the same concept styled twice), which showed
  the gallery had grown by accretion. The owner then named the two things that WILL grow with every imported card —
  **avatar weight** (a tile loads the stored image; no thumbnail variant exists) and **findability** (no search, filter
  or sort) — as *"real concerns"* (ROADMAP **H4**). Virtualization is NOT the problem and is not wanted (a handful of
  agents renders cheaply; the gallery's "no virtualization" design stands).

## 2. What the owner wants

**Goals:** galleries that feel designed as one system — the same tile, selection mark, primary/default mark, empty and
loading states, header controls (search · filter · sort), and density rules everywhere an image or an agent is picked
or browsed; a tile path that stays light at fifty cards (thumbnails); dense forms (the agent editor first) that
disclose progressively instead of presenting every field at once. *Refinement*, not a redesign: the owner's "not bad".
**The floor (the minimum the session must deliver):** the owner's own tweak list (collected in §7 at the session's
start) folded into one coherent design, with every surface in §3 inventoried against the research findings and each
divergence either unified or RULED as deliberate (recorded).
**Non-goals:** new galleries; new themes (THEME POPULATION CLOSED); a virtualized list; touching the media WRITE path
(MEDIA_MANAGER_PLAN's authority — serving a thumbnail variant is a size axis on the serving path, not a new store).

## 3. Scope inventory (the surfaces; read each before designing)

| Surface | Files | Governing doc |
|---|---|---|
| The agent gallery (cards, pills, actions row, detail surface) | `frontend/src/tabs/AgentsTab.tsx` · kit.css `.agal-*` (~L8680–8890) · `themes/gacha/gacha.css` (`.agal-default` fill window) | ROLEPLAY_PLAN §8.4 (the showcase), §15.12 (the export fallback divergence) |
| The agent editor (dense form) | `frontend/src/components/AgentsEditor.tsx` (873 lines) · `AgentArtRow.tsx` | ROLEPLAY_PLAN §4 (AgentDef) |
| The media galleries — per-destination libraries, the picker, the item detail, crop + focal | `frontend/src/components/media/` (`GalleryModal` · `LibraryGrid` · `LibraryPicker` · `ItemDetail` · `SectionCard` · `UploadRow` · `CropModal` · `FramingSheet`) · kit.css `.mgal-*` | **MEDIA_MANAGER_PLAN** (D65: libraries, crop, focal, drag) · MEDIA_PLAN (D53: namespaces, roles, kinds, serving) |
| The theme-art consumers (backgrounds, gacha art, the three-state backdrop) | `hooks/useAgentArt.ts` · `useActiveBackdrop` · gacha's showcase | GACHA_PLAN §7 · THEME_ENGINE §14 · MEDIA_PLAN §13 (the D65 amendment) |
| The Appearance / theme controls that pick art (overlaps J2) | `ConfTab.tsx` Appearance group (`Shared background` ~L3569 · `Agent backdrop` ~L3599 · `App icon backdrop` ~L3690) | THEME_ENGINE · D59 |

## 4. Method (the session's ladder — each rung its own commit)

1. **Research first — buy the findings once, into `docs/research/`** (one Opus lane each, the dossier conventions in
   its README; peer class = opencode / Claude Code / Codex / open-webui / LibreChat / SillyTavern / RisuAI / the OS
   photo pickers and app galleries): **R-a** gallery/picker UX in the peer class — card density, selection vs primary
   marks, empty/loading/skeleton states, search + filter + sort placement, tile sizing + thumbnail variants
   (`srcset`/size axis on a serving path), the "one tile recipe" question; **R-b** progressive disclosure for DENSE
   forms — advanced sections, per-field help, grouping, what the field does with 30+ fields on a phone (the agent editor
   is the subject). Read `docs/research/README.md` and the existing R54–R59 (the media manager's own research) and R28
   before commissioning — do not re-buy.
2. **The inventory** (one read-only Opus audit, file:line): every surface in §3 against R-a/R-b — the same concept
   styled or behaving twice, every tile recipe, every header control, every empty state, every mark; start from
   `audit-gallery.md` §B (the agent gallery is done) and the MEDIA_MANAGER_PLAN's as-built §12.
3. **The owner's tweak list** (§7 → filled by the owner at the session start, one line each, phone in hand) folded in.
4. **The design** (the main seat, prose, in THIS file): the unified tile + header + marks vocabulary; the thumbnail
   variant's serving contract (size axis, cache headers, which roles get one); the search/filter/sort row; the editor's
   disclosure structure; each divergence either unified or ruled deliberate. Name the pattern per choice (R-a/R-b).
5. **Design council** — blind Opus ∥ Emma (the dual-reviewer rule), ground-or-withdraw, rulings recorded in §9.
6. **The slice ladder** (S0…Sn, each reviewed by Opus ∥ Emma on a frozen diff; CSS-first, then the serving variant,
   then the editor). Written here before the first slice is built.

## 5. Constraints and locked decisions (do not relitigate)

- **D31** Swappable Surfaces: tokens vs Surface vs bespoke — a reskin is tokens only; gacha is the bespoke exception;
  VAPOR_PATTERNS governs net-new UI. **THEME_ENGINE §14.11**: transform/opacity only, motion gated.
- **D65 / MEDIA_MANAGER_PLAN** is the authority on the media write path, libraries, "which image is live"; **D53 /
  MEDIA_PLAN** on namespaces/roles/kinds/serving. A thumbnail variant extends serving; it never adds a store.
- **No legacy seams, no migration without the load-boundary fold + write-back** (UPDATE_PLAN) if any config SHAPE
  moves. **Shape to extend, not to migrate** (CLAUDE.md) for any new per-destination field.
- The agent gallery stays **un-virtualized** (ROLEPLAY_PLAN §8.4; the owner, 2026-10-07). `content-visibility` is kept;
  every grid holding it uses `minmax(0, 1fr)` (ISS-68's standing fact).
- One source of truth per concept (the ISS-68 D2 slice set the precedent: `lib/agentSubtitle.ts`, `rosterNames()`,
  the shared `.badge.chosen` selector).

## 6. Starting evidence

`~/.cache/tmp/ctrlb-session63/audit-gallery.md` (copy its §B/§C into `docs/research/` as the inventory's seed if the
scratch dir is gone) · ISSUES **ISS-68** (the as-built record) · ROADMAP **H4** · MEDIA_MANAGER_PLAN §6.2 (the Back
pattern's home) + §12 (as-built) · R54–R59 · GACHA_PLAN §7 (the alt-fleet layouts, the showcase).

## 7. Open questions for the owner (fill at the session start)

1. The tweak list — one line per thing, per surface (agent gallery · agent editor · backgrounds gallery · theme art ·
   gacha showcase), phone in hand.
2. Search/filter/sort: which first? (A name filter alone covers "find someone" at 20–50 cards.)
3. Thumbnails: acceptable tile size on the phone (the media manager's crop step already produces the square; is a
   ~256 px variant per avatar enough?), and whether backgrounds (landscape) get one too.
4. The agent editor: which fields are "every day" vs "advanced" — the owner sorts, the design discloses.

## 8. Working rules for the parallel session (two sessions, one tree — session 62's verified facts)

Commit BY PATH (`git add -- <paths>`); `git status` before touching a shared doc (HANDOFF, ISSUES, ROADMAP, QUALITY);
ISSUES/HANDOFF row conflicts resolve by keeping both edits; iterate code in a worktree
(`git worktree add ~/.cache/tmp/ctrlb-wt<N> -b <branch> main`) so the dev backend's `--reload` restarts once at the
merge; one scratch dir per session (`~/.cache/tmp/ctrlb-session<N>/`), one `clones/` subdir per research lane; never
restart the dev units under the other session's test without saying so. The ASR session owns `voice_live.py`, the
voice adapter, `useDictation`, `pcmCapture` and ASR_PLAN — J1 touches none of them.
