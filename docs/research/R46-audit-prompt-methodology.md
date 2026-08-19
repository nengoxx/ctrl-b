# R46 — Prompt structure for one-shot adversarial LLM code/design audits

| | |
|---|---|
| **Question** | For the **second-opinion lane** (a frontier model · read-only repo · a written brief · ONE response back), what prompt-structure choices measurably — or by strong field convention — improve real-defect yield and reliability? The owner's specific tension: our briefs are *hyperfocused* (numbered pointed questions · bounded reading list · output contract · forced verdict) and *"giving the model a little bit of freedom to think about other questions that might have not been asked… might help."* Is a **freedom clause / open sweep** beneficial, harmful (anchoring/dilution), or is the **hybrid** (pointed questions + one explicit open sweep) the right form? |
| **Asked for** | [`.claude/skills/second-opinion/SKILL.md`](../../.claude/skills/second-opinion/SKILL.md) — the artifact this pass proposes to amend (§6 is written as an amendment list). |
| **New ground only** | The council pattern (design round → build → diff round → `SendMessage` confirm round), the two reviewer-bias corrections (*Codex over-engineers* · *take the finding, not the fix*), and [[claude-is-final-judge]] are **already established and are NOT re-derived** — this pass only reports where the field **contradicts or refines** them (§7). Prompt-eval harnesses were bought in [R31](./R31-prompt-eval-harnesses.md); §5 here is a thin delta on top of it, not a re-buy. |
| **Date** | 2026-08-19 |
| **Primary sources (read verbatim)** | **Claude Code** local checkout `a371abbe75ffa0d0a3c92290e2bbf56a7ef54367` (2026-04-05) — `src/commands/security-review.ts`, `src/commands/review.ts`, `src/commands/review/reviewRemote.ts`, `src/tools/AgentTool/built-in/verificationAgent.ts`, `src/skills/bundled/simplify.ts`, `src/constants/prompts.ts`, `src/coordinator/coordinatorMode.ts` · **openai/codex** `18937b226524164546e7328a2ed47c0d52536e0a` (2026-08-19) — `codex-rs/prompts/templates/review/rubric.md`, `codex-rs/prompts/src/review_request.rs`, `codex-rs/skills/src/assets/samples/review-agent/SKILL.md`, `.codex/skills/code-review*/SKILL.md`, `.github/codex/labels/codex-*review.md` · **qodo-ai/pr-agent** `6981f4951f44ef80d85a0753ace47a5cfa328592` (2026-08-19) — `pr_agent/settings/pr_reviewer_prompts.toml`, `code_suggestions/pr_code_suggestions_prompts.toml`, `code_suggestions/pr_code_suggestions_reflect_prompts.toml`, `configuration.toml`, `docs/docs/core-abilities/self_reflection.md` |
| **Secondary (fetched 2026-08-19)** | cursor.com/blog/building-bugbot · cursor.com/blog/bugbot-learning · gresearch.com "Building a code review tool: the LLM patterns that actually work" · augmentcode.com "Deep Code Review: Why Recall Beats Precision" · arXiv 2603.18740 (confirmation bias in LLM security review) · arXiv 2604.19049 (Refute-or-Promote) · arXiv 2606.01859 (Go issue-list review) · CodeRabbit/Greptile vendor docs via search |
| **Drove** | (open) the proposed §6 amendments to `second-opinion/SKILL.md` — owner ruling required on the 5 BEHAVIOR-CHANGING items. |
| **Index row** | added. |

Confidence markers: **[V]** = I read the shipped source myself · **[R]** = reported by a secondary source (vendor blog / paper abstract / search summary) · **[U]** = expected but unverified.

---

## 0. TL;DR — the verdict on freedom vs focus

**The tension dissolves once you separate the two things a review brief controls: the SEARCH SPACE
and the OUTPUT FILTER. Every shipped review agent I read keeps the search space WIDE and puts the
discipline on the output filter. Our briefs currently do the opposite — they narrow the search space
(N pointed questions + "do NOT crawl") and leave the filter loose (severities + anti-padding).**

- **0/3 shipped review prompts (Claude Code `/review`, Codex `/review`, pr-agent `/review`) instruct
  the model to answer a closed list of questions.** [V] Codex's shipped review system prompt is
  *nothing but* an 8-criterion **bug-qualification filter** — the hunting instruction is the one-line
  user message *"Review the code changes… Provide prioritized, actionable findings."* [V]
- **Where a list IS enumerated, the shipped prompt explicitly de-anchors it.** Claude Code's
  verification agent: *"These are seeds, not a checklist — pick the ones that fit what you're
  verifying"* and *"**Other change types**: The pattern is always the same … The strategies above are
  **worked examples** for common cases."* [V] That is exactly the hybrid form the owner intuited —
  and it is Anthropic's shipped answer, not a novel idea.
- **The one hard number on framing runs strongly our way.** Telling a reviewer the code is believed
  fine cuts detection **16–93%** (GPT-4o-mini: 97.2% → 3.6%), while framing it as suspect raises the
  false-positive rate by only **0.8–13.6 pp** — *"false negative bias consistently exceeds false
  positive bias across all models."* [R, arXiv 2603.18740] **Adversarial framing is cheap; assurance
  framing is ruinous.** Our briefs' "here is the design we settled on / what is already ruled" section
  is the exact assurance framing that paper measures.
- **The field's answer to "cover more ground" is MORE FOCUSED PASSES, never one fuzzier pass.**
  Claude Code `/simplify` = 3 parallel agents, each with its own numbered checklist, same diff [V];
  openai/codex's own repo review = an orchestrator that fans out *"one subagent per skill"* over 4
  lens skills [V]; `/ultrareview` ships a hunter **fleet** (`BUGHUNTER_FLEET_SIZE` default **5**, max
  20) plus separate **verifier** agents [V].
- **Therefore the recommendation is the hybrid, but with the freedom moved out of the numbered list.**
  Keep the hyperfocus the owner likes; add (a) a standing **seeds-not-a-checklist** clause, (b) a
  final **open sweep** question that is *scoped to the same artifact* and *bounded in size* (so it
  cannot dilute the pointed questions), and (c) a **stop asserting the design is settled**. All three
  are additive. The bigger wins — a verify gate and a recall-first posture — are §6's
  BEHAVIOR-CHANGING items.

**Anti-verdict, stated plainly: I found no evidence that a checklist suppresses out-of-list findings
in a *tool-using* reviewer.** The anchoring evidence I could substantiate is about *judges scoring
against a rubric*, not about *hunters searching a repo* (§4). The case for the freedom clause rests
on convention (§1–§3) and on the framing paper (§3e), not on a measured anchoring effect. §8 says so.

---

## 1. What the shipped artifacts actually look like

### 1.1 Claude Code — `/security-review` (`src/commands/security-review.ts`, pin `a371abb`) [V]

The most structured review prompt Anthropic ships. Its shape, in order:

1. **Role + a hard scope narrowing.** *"This is not a general code review - focus ONLY on security
   implications newly added by this PR. Do not comment on existing security concerns."*
2. **A precision instruction with a number** (line 44): *"MINIMIZE FALSE POSITIVES: Only flag issues
   where you're >80% confident of actual exploitability."*
3. **5 category headings, ~25 bullets** ("Input Validation Vulnerabilities", "Crypto & Secrets
   Management", …) — a hunting checklist, but for **one lens only**.
4. **A 3-phase methodology**: *Repository Context Research → Comparative Analysis → Vulnerability
   Assessment*. Phase 1 is *"Identify existing security frameworks… Look for established secure
   coding patterns… Understand the project's security model"* — i.e. **the reviewer derives the house
   conventions itself before judging**.
5. **A severity rubric (HIGH/MED/LOW) *and* a separate numeric confidence scale** with an explicit
   floor: *"Below 0.7: Don't report (too speculative)."*
6. **A 17-item HARD EXCLUSIONS list and a 12-item PRECEDENTS list** — the negative space. Examples:
   *"A lack of hardening measures. Code is not expected to implement all security best practices,
   only flag concrete vulnerabilities."* · *"Race conditions or timing attacks that are theoretical
   rather than practical… Only report a race condition if it is concretely problematic."* ·
   *"Environment variables and CLI flags are trusted values."*
7. **A two-phase find-then-verify pipeline, spelled out as the last instruction** (lines 190–194):

   > Begin your analysis now. Do this in 3 steps:
   > 1. Use a sub-task to identify vulnerabilities…
   > 2. Then for each vulnerability identified by the above sub-task, create a new sub-task to filter
   >    out false-positives. **Launch these sub-tasks as parallel sub-tasks.**
   > 3. Filter out any vulnerabilities where the sub-task reported a **confidence less than 8**.

**No output cap. No word limit. No "answer these numbered questions".** The only quantity control is
the confidence floor.

### 1.2 Claude Code — the verification agent (`src/tools/AgentTool/built-in/verificationAgent.ts`) [V]

The purest adversarial-reviewer prompt in the checkout, and the closest analogue to our lane.

- **Opening line (adversarial framing, unhedged):** *"You are a verification specialist. Your job is
  not to confirm the implementation works — it's to try to break it."*
- **It names the reviewer's OWN failure modes** — a section we have no analogue for: *"You have two
  documented failure patterns. First, verification avoidance… you read code, narrate what you would
  test, write 'PASS,' and move on. Second, being seduced by the first 80%…"* followed by a
  **RECOGNIZE YOUR OWN RATIONALIZATIONS** list quoting the excuses verbatim (*"The code looks correct
  based on my reading" — reading is not verification. Run it.*).
- **The enumerated strategies are explicitly open-ended.** After 11 change-type strategies:
  *"**Other change types**: The pattern is always the same — (a) figure out how to exercise this
  change directly, (b) check outputs against expectations, (c) try to break it with inputs/conditions
  the implementer didn't test. The strategies above are worked examples for common cases."* And after
  the adversarial probe list: *"These are seeds, not a checklist — pick the ones that fit."*
- **Symmetric gates.** *BEFORE ISSUING PASS*: *"Your report must include at least one adversarial
  probe you ran… If all your checks are 'returns 200' or 'test suite passes,' you have confirmed the
  happy path, not verified correctness."* *BEFORE ISSUING FAIL*: three named excuses to check first —
  **already handled** (defensive code elsewhere), **intentional** (CLAUDE.md/comments/commit message),
  **not actionable** (*"a 'bug' that can't be fixed isn't actionable"*) — with the guard rail *"Don't
  use these as excuses to wave away real issues."*
- **A forced verdict, and hedging is explicitly banned:** *"PARTIAL is for environmental limitations
  only… not for 'I'm unsure whether this is a bug.' If you can run the check, you must decide PASS or
  FAIL."* Plus a machine-parsed literal (`VERDICT: PASS`) and a rejection rule — *"A check without a
  Command run block is not a PASS — it's a skip"* — with a worked **Bad (rejected)** example.
- **The caller is told to spot-check the verifier** (`src/constants/prompts.ts:394`): *"On PASS:
  spot-check it — re-run 2-3 commands from its report… If any PASS lacks a command block or diverges,
  resume the verifier with the specifics."*

### 1.3 Claude Code — `/simplify` and `/ultrareview` (multi-lens, multi-sample) [V]

`src/skills/bundled/simplify.ts`: *"## Phase 2: Launch Three Review Agents in Parallel… Pass each
agent the full diff so it has the complete context."* — Agent 1 **Code Reuse**, Agent 2 **Code
Quality** (7 numbered anti-patterns), Agent 3 **Efficiency** (7 numbered anti-patterns). Aggregation
rule: *"If a finding is a false positive or not worth addressing, note it and move on — **do not argue
with the finding**, just skip it."*

`src/commands/review/reviewRemote.ts`: `/ultrareview` teleports to a cloud "bughunter" run whose only
tuning surface is env vars — `BUGHUNTER_FLEET_SIZE` default **5** (cap 20), `BUGHUNTER_MAX_DURATION`
10 min, `BUGHUNTER_TOTAL_WALLCLOCK` 22 min. A shipped comment proves a *separate verifier tier*
exists: *"120s kills **verifiers** mid-run which causes infinite respawn."* So Anthropic's premium
review product = **a fleet of hunters + a verifier tier + a synthesis step**, budgeted at ~10–20 min.

Note the contrast at the cheap end: the **local** `/review` prompt (`src/commands/review.ts`) is 20
lines of generic prose (*"Analyze the changes and provide a thorough code review"* + 5 focus bullets).
Anthropic does not bother hyperfocusing the cheap path — it hyperfocuses the *lenses* instead.

### 1.4 openai/codex — the `/review` rubric (`codex-rs/prompts/templates/review/rubric.md`, pin `18937b2`) [V]

`review_request.rs` confirms this file is the **system prompt** of the review thread; the user message
is one line naming the target (*"Review the code changes against the base branch '{{base_branch}}'…
Provide prioritized, actionable findings."*). So Codex's `/review` = **open hunting + a hard filter**.

The filter is 8 numbered criteria for *"whether the original author would appreciate the issue being
flagged"*. Three are load-bearing for us:

> 3. Fixing the bug does not demand **a level of rigor that is not present in the rest of the
>    codebase** (e.g. one doesn't need very detailed comments and input validation in a repository of
>    one-off scripts in personal projects)
> 5. **The author of the original PR would likely fix the issue** if they were made aware of it.
> 7. It is not enough to speculate that a change may disrupt another part of the codebase… one must
>    **identify the other parts of the code that are provably affected**.

Plus, on quantity (line 34–36):

> **HOW MANY FINDINGS TO RETURN:** Output all findings that the original author would fix if they knew
> about it. **If there is no finding that a person would definitely love to see and fix, prefer
> outputting no findings. Do not stop at the first qualifying finding. Continue until you've listed
> every qualifying finding.**

And an explicit override channel — *"In many cases, you will encounter other, more specific
guidelines… Those guidelines should be considered to override these general instructions."* Codex is
**designed to take a hyperfocused overlay on top of an open base.**

Output: strict JSON, per-finding `confidence_score` (0.0–1.0) **and** `priority` (P0–P3, defined:
*"[P0] – Drop everything to fix… Only use for universal issues that do not depend on any assumptions
about the inputs"*), plus a forced global verdict `overall_correctness: "patch is correct" | "patch is
incorrect"` with `overall_explanation` (1–3 sentences) and `overall_confidence_score`.

**openai/codex's own repo review** (`.codex/skills/code-review/SKILL.md`) is the multi-lens pattern
again: *"Use subagents to review code using all code-review-\* skills other than this orchestrator.
**One subagent per skill.** … Use xhigh reasoning. **You must return every single issue from every
subagent. You can return an unlimited number of findings.**"* The four lens skills are tiny and
**repo-specific invariants**, not generic categories — e.g. `code-review-context`: *"No unbounded
items - everything injected in the model context must have a bounded size and a hard cap… No items
larger than 10K tokens. Highlight new individual items that can cross >1k tokens as P0."*;
`code-review-breaking-changes`: *"**Do not stop after finding one issue**; analyze all possible ways
breaking changes can happen."*

Codex's shipped **review-agent sample skill** adds the inline verify step and the empty-result
permission: *"Check the relevant tests and call sites **to confirm that each finding is real and
actionable**."* … *"If there are no qualifying findings, say `No findings.` **Do not invent a finding
to fill the result.**"*

### 1.5 qodo-ai/pr-agent (pin `6981f49`) [V]

- **No hunting checklist either.** The policy block is *"Determining what to flag"*, and it is
  **asymmetric by severity**:

  > - For clear bugs and security issues, **be thorough. Do not skip a genuine problem just because
  >   the trigger scenario is narrow.**
  > - For lower-severity concerns, **be certain before flagging.** If you cannot confidently explain
  >   why something is a problem with a concrete scenario, do not flag it.
  > - When confidence is limited but **the potential impact is high** (e.g., data loss, security),
  >   report it **with an explicit note on what remains uncertain**. Otherwise, prefer not reporting
  >   over guessing.

- **A cap exists but is small and UI-driven**: `num_max_findings = 3` (`configuration.toml:112`),
  and the schema says *"An empty list is acceptable if no clear issues are found."*
- **A negative list** in `/improve`: *"DO NOT suggest the following: change packages version · add
  missing import statement · declare undefined variable… · repeat changes already done in the PR
  code"* — plus a `focus_only_on_problems` switch that swaps the whole posture between
  "quality + bugs" and "critical bugs only".
- **Pluggable house lenses**: a `skills_context` block injected as *"Organizational standards and
  review skills (**apply the ones relevant to this PR**)"* — note the built-in permission to ignore
  inapplicable lens items, which is an anchoring guard.
- **A second model call whose only job is to score the first call's findings**
  (`pr_code_suggestions_reflect_prompts.toml`): score 0–10 with a `why`, 0 for wrong,
  *"Be particularly vigilant for suggestions that: Overlook crucial details… Contradict or ignore
  parts of the PR's modifications"*, then `suggestions_score_threshold` filters. The rationale is
  stated in their docs: *"in practice we observe that models often **struggle to simultaneously
  generate high-quality code suggestions and rank them well in a single pass**"*, and *"presenting all
  generated suggestions **simultaneously** provides the model with a comprehensive context, enabling
  it to make more informed decisions compared to evaluating each suggestion individually."*

  (Note the **divergence**: pr-agent scores all findings in ONE follow-up call for cross-finding
  context; Claude Code's `/security-review` fans out **one parallel sub-task per finding**. Both ship.
  For our lane the pr-agent form is the cheap one — one `SendMessage` follow-up.)

### 1.6 Vendor claims, structure only [R]

| Source | Claim |
|---|---|
| Cursor "Building a better Bugbot" | V1 pipeline = *"Run **eight parallel passes with randomized diff order**"* — *"Each pass received a different ordering of the diff, which nudged the model toward different lines of reasoning"* — + *"Majority voting to filter out bugs found during only one pass"*, a *"validator model to catch false positives"*, and category filtering. **Then they replaced it**: the agentic rewrite raised resolution rate 52%→70%; *"the majority voting mechanism—once essential for accuracy—became **less critical** with the dynamic, tool-driven approach"*, and the new failure mode was the agent being **too cautious**, fixed by *"**aggressive prompts that encouraged the agent to investigate every suspicious pattern and err on the side of flagging potential issues**."* |
| Cursor "Bugbot learns" | Learned rules are derived from downvotes, developer replies, and *"comments from human reviewers, which flag issues that Bugbot missed"*; >110k repos, >44k learned rules. I.e. the "already known / don't re-report" list is **accumulated automatically** in the field. |
| CodeRabbit | A **verification agent** that *"generates shell/Python checks (think grep, ast-grep) to confirm an assumption or extract proof from the codebase before posting the comment"*; "Learnings" stored from developer replies; path-based instructions to raise volume on high-risk dirs and lower it elsewhere. |
| Greptile | Per-finding **confidence scores** surfaced to the reader; TREX **executes code** to confirm a bug before surfacing it; severity thresholds as the signal/noise dial. |
| G-Research (practitioner writeup) | *"The first pass captures everything; **the second filters**."* Structured output is *"format control only — Structured output ensures the response format, not its accuracy."* Findings validated against a rules index to stop rule hallucination. Asymmetric recall targets: *"MUST / MUST NOT: 100% recall required / SHOULD: 75% recall."* And the negative result: **open-ended prompts + single-pass review produced trust-destroying false positives in CI.** |
| Augment Code (vendor benchmark) | *"When an agent reads first, the cost of a false positive drops while a missed bug still reaches production."* Their benchmark row: Codex **68% precision / 29% recall**; Augment 65% precision / 55% recall. Treat the numbers as vendor-self-report; the **posture** claim is what matters. |

---

## 2. The one-line answer per axis

| Axis | What the field ships | Verdict for our lane |
|---|---|---|
| **(a) pointed vs open vs hybrid** | 0/3 major review prompts use a closed question list. Codex = pure open + filter. Claude Code = per-lens checklist that **calls itself "seeds, not a checklist"** and adds a generalization clause. pr-agent = policy, not checklist. | **Hybrid — but with the freedom clause OUTSIDE the numbered list**, phrased as "these are seeds/worked examples", plus one bounded open sweep. |
| **(b) forced verdicts + severity rubrics** | Universal. Codex: P0–P3 + `overall_correctness` + two confidence floats. Claude Code: HIGH/MED/LOW + 0.0–1.0 + `VERDICT:` literal. pr-agent: score + effort estimate. **Hedging is separately banned** (*"PARTIAL is for environmental limitations only"*). | **Keep ours; add the explicit anti-hedge sentence and a per-finding confidence.** No evidence that verdicts induce over-flagging; the shipped systems pair verdicts with confidence floors to prevent exactly that. |
| **(c) "already known — do not re-report"** | Strongly precedented, and the field's version is *bigger* than ours: 17 HARD EXCLUSIONS + 12 PRECEDENTS (Claude Code) · a DO-NOT-suggest list (pr-agent) · auto-accumulated learned rules (Cursor/CodeRabbit). Codex's version is scoping: *"pre-existing bugs should not be flagged."* | **Keep — it is the single best-precedented line in our skill.** Upgrade: make the list *durable* (a house exclusions file) rather than retyped per brief. |
| **(d) output caps (~1200 words)** | **Nobody caps the reviewer's total output.** Codex: *"You can return an unlimited number of findings"* / *"Do not stop at the first qualifying finding."* pr-agent caps at 3 for **PR-comment UI reasons**, not quality. Where a cap appears it is a *per-finding* brevity rule (Codex: body = one paragraph, ≤3 lines of code) or a *summary* length. | **Move the cap off the total and onto the finding.** A global word budget is the one structural choice in our skill with **zero field precedent** and a plausible recall cost. |
| **(e) adversarial vs neutral framing** | Anthropic ships hard adversarial framing for the verifier (*"try to break it"*) and neutral-professional for the security review. Cursor moved **toward** aggression (*"err on the side of flagging"*). Codex/pr-agent stay neutral but pair it with "be thorough on real bugs". Paper: assurance framing costs 16–93% of detections; suspicion framing costs 0.8–13.6 pp of FPR. | **Keep "be adversarial"; the real amendment is to stop asserting the design is settled** in the context section (§6 A3). |
| **(f) multi-sample / multi-lens** | Multi-**lens** is the dominant shipped form (3 agents in `/simplify`, 4 lens skills in codex's repo, fleet of 5 in `/ultrareview`). Multi-**sample with voting** was shipped (Bugbot V1, 8 passes) and then **de-emphasized** once the reviewer got tools. And consensus is not truth: *"Ten dedicated agents—including a senior-tier arbiter—unanimously confirmed a … padding oracle"* that did not exist [R, arXiv 2604.19049]. | **Prefer lenses over samples** — which is what our Codex-vs-Opus split already is. **Do not add voting.** §7 records the refinement to the council rule. |
| **(g) two-phase find-then-verify** | The most consistently shipped structure in the whole survey: Claude Code (parallel FP-filter sub-tasks, drop <8) · pr-agent (self-reflect, score 0–10, threshold) · G-Research (*"first pass captures everything; the second filters"*) · CodeRabbit/Greptile (grounding checks / code execution) · `/ultrareview` (separate verifier tier) · Codex (inline *"confirm that each finding is real"*). Kill rates where measured: **~63% of candidates die at gate A, ~42% of survivors at gate B** [R]. | **The single highest-value addition to our skill.** We already own the cheap mechanism — a `SendMessage` follow-up to the same agent, context intact. |

---

## 3. Evidence notes worth keeping

**3e. The framing asymmetry (the strongest single number in this dossier).** [R, arXiv 2603.18740,
abstract + HTML body read 2026-08-19; 250 CVE/patch pairs, 5 framing conditions, 4 models]
*"Framing a change as bug-free reduces vulnerability detection rates by 16–93%"* — GPT-4o-mini falls
from 240/247 (97.2%) neutral to 9/247 (3.6%) under strong bug-free framing (−93.5 pp). Conversely,
*"When patched code is framed as potentially vulnerable, FPRs increase by 0.8–13.6 percentage
points"*, and *"false negative bias consistently exceeds false positive bias across all models."*
Mitigation that worked: *"Debiasing via metadata redaction and **explicit instructions** restores
detection in all interactive cases and 94% of autonomous cases."*

Why this matters to us specifically: our briefs open with *"the context it cannot infer — what is
already locked, what is already ruled, the design we settled on"*. That block is load-bearing for
avoiding wasted findings — but every sentence in it that reads as *"this part is settled/correct"* is
a bug-free frame over that part of the artifact. The fix is not to delete the block; it is to **state
locks as constraints, not as assurances** ("the DB choice is out of scope for this review" ≠ "the DB
layer is sound").

**3g. Adversarial verification kills most candidates — and reasoning alone can't do it.**
[R, arXiv 2604.19049] Stage-gated pipeline: each of the first two stages runs *"two concurrent tracks:
a creative track that argues the candidate is a vulnerability"* and *"an adversarial track that argues
it is not"*; promotion criterion: *"A candidate survives Stage A only if no adversarial agent produces
a **code-grounded refutation** and the creative agent produces a plausible exploitation argument."*
Attrition: Stage A ~63%, Stage B ~42% of survivors; retrospective ~79% kill rate over 171 candidates.
Their headline cautionary tale: *"Ten dedicated agents—including a senior-tier arbiter—unanimously
confirmed a CMS Bleichenbacher padding oracle (CVSS 5.9)"* … *"**One test killed what 80+ agents'
reasoning could not.**"* Their Stage D **Cross-Model Critic** deliberately gets *"minimal context (a
candidate summary and entry points)"* — a de-anchoring choice worth noting against our instinct to
re-pin the whole brief to a confirm round.

**3a. What I could NOT substantiate: checklist anchoring in a hunting reviewer.** The nearest hits:
(i) arXiv 2606.01859 (Go review) reports the **opposite** direction — generating a candidate
**issue-list** and then pruning beats single-primary-issue review (*"28.00% refinement exact match, a
statistically significant gain of +10.85 percentage points over primary-issue review without any
additional context (17.15%)"*), and pruning cuts candidates 7.2 → 3.1 at top-5 *"while retaining
nearly the full benefit"*; (ii) a search-surfaced compliance-audit paper claiming an LLM returned PASS
on 7/7 and 8/8 checks a static scanner failed — that is **rubric-scoring suppression, not
out-of-list-finding suppression**, and I did not read the paper. The honest position: **the anchoring
worry is unproven for our case; the dilution worry is equally unproven.** Both point to the same safe
design — keep the focus, add the freedom *beside* it rather than *inside* it.

---

## 4. LLM-as-judge transfer (bounded) [R]

Only three findings transfer cleanly to a one-shot review brief:

1. **Rubric text shifts score distributions** (anchoring on the scale itself) and small prompt edits
   substantially move judgments — so a severity rubric should **define its levels** (Codex defines P0
   *"only… universal issues that do not depend on any assumptions about the inputs"*) rather than name
   them. Our brief names HIGH/MED/LOW without definitions.
2. **Position bias lives in the decode, not the prompt** — *"attempting to instruct judges out of
   position bias with rubric lines is ineffective"*; the fix is to vary the input order across calls.
   That is the mechanism behind Bugbot V1's randomized diff ordering. For us: if we ever run two
   reviewers on the same artifact, **give them different reading orders**, and don't expect a prompt
   line to fix it.
3. **Judges reward verbosity/hedging cues** (15–30 points of inflated preference for longer outputs at
   constant quality). Relevant because *we* are the judge of the review: a long, well-formatted
   review is not a better review. Our anti-padding clause is well-aimed; keep it.

Instruction-order compliance is model-specific (some models primacy, some recency; Claude models are
reported recency-leaning) [R] — which weakly favours **placing the open sweep last** if we want it
honoured, and strongly favours **not burying the verdict demand in the middle**.

---

## 5. Can we ever measure this? (short, and mostly "no cheaply")

[R31](./R31-prompt-eval-harnesses.md) already establishes that in-class peers ship essentially no
own-prompt eval, and that promptfoo/Langfuse-style harnesses need a callable seam we don't have for a
one-shot review. Delta from this pass:

- **The field's own metric is behavioural, not seeded**: Cursor hill-climbs on **resolution rate** —
  what fraction of flagged bugs the developer actually fixed by merge time (52% → ~80% over the
  product's life) [R]. Martian's 2026 independent benchmark uses the same idea at scale (comments
  developers acted on, across ~300k PRs) [R]. **The analogue we could run for free: record, per Codex
  round, `findings accepted / findings raised`** — we already write that ruling down in the plan docs.
  It is a lagging, situational number, but it is the same number the field optimizes, and it costs one
  line per round.
- **Seeded-defect canaries: no field precedent found** in the peer class for slipping a known bug into
  a real review as a live control. The nearest shipped thing is the *kill-rate* instrumentation of
  §3g. **[U]** — I could not find anyone doing canary-in-a-real-review, and I would not invent it as a
  practice: a canary that the reviewer finds proves little, and one it misses is a single sample.
- **The only cheap true A/B available to us** is a **paired re-run**: same artifact, same model, two
  briefs (current vs amended), diff the finding sets. Expensive in wall-clock (10–40 min each) but
  free of harness work, and it answers exactly one question per run. Recommend it **once**, on the
  first slice after an amendment lands, and not as a standing practice.

---

## 6. Proposed amendments to `.claude/skills/second-opinion/SKILL.md`

Written as an amendment list. **ADDITIVE** = safe, no baseline needed, strictly adds a line to a brief.
**BEHAVIOR-CHANGING** = changes what we ask for or what a round costs; needs the owner's ruling.

### ADDITIVE

**A1. Add a "seeds, not a checklist" clause to §Scoping the prompt (item 3).**
Today item 3 reads *"A numbered list of questions, and 'judge specifically, and be adversarial'."*
Amend to require the list be framed as non-exhaustive, e.g.: *"The numbered questions are the
priorities, not the boundary — they are worked examples of what I am worried about, not a closed set.
Report anything else in this artifact that meets the finding bar."*
**Evidence:** Anthropic ships this exact de-anchoring twice in one prompt — *"These are seeds, not a
checklist"* and *"The strategies above are worked examples for common cases"* (`verificationAgent.ts`
lines 40, 69) [V]. Zero cost, and it is the owner's instinct in the field's own wording.

**A2. Add the bounded open sweep as a NUMBERED, LAST question with its own budget.**
Not a vague "anything else?" — a scoped one: *"N+1. Open sweep: name up to 3 problems in this artifact
that none of the questions above asked about. Same bar as everything else — concrete failure scenario,
specific location. If there are none, write 'none' and stop; do not manufacture one."*
**Evidence:** placing it last suits the reported recency-leaning instruction compliance of Claude
models [R]; capping it at 3 prevents dilution of the pointed questions; the "write none" escape is
Codex's shipped *"If there are no qualifying findings, say `No findings.` Do not invent a finding to
fill the result."* [V]. This is the direct answer to the owner's question, in its safest form.

**A3. Reword the "context it cannot infer" rule: state locks as SCOPE, never as ASSURANCE.**
Add to the brief-discipline bullets: *"Say 'X is out of scope / already ruled' — never 'X is sound',
'X is already correct', or 'we're happy with X'. A settled-sounding frame measurably suppresses
findings in the framed region."*
**Evidence:** bug-free framing cuts detection 16–93% while suspicion framing costs 0.8–13.6 pp of FPR
[R, arXiv 2603.18740]. This is the cheapest high-value line in the whole dossier and it costs us
nothing we actually wanted to say.

**A4. Define the severity levels instead of naming them.**
Our output contract says "severity (HIGH/MED/LOW)". Pin the definitions in the brief, Codex-style —
e.g. HIGH = *a concrete failure that does not depend on assumptions about inputs or environment*;
MED = *real but conditional on a named scenario*; LOW = *defense-in-depth / maintainability*.
**Evidence:** Codex ships definitions for P0–P3 (*"[P0] … Only use for universal issues that do not
depend on any assumptions about the inputs"*) [V]; rubric wording measurably shifts score
distributions in the judge literature [R]. Undefined labels are what produce the "everything is HIGH"
review.

**A5. Require a per-finding confidence and a stated floor.**
Add to the output contract: *"Each finding carries a confidence 0–1. Report nothing below 0.6 unless
the impact class is data loss / security / update-path breakage, in which case report it and mark
explicitly what remains uncertain."*
**Evidence:** the asymmetric-confidence policy is shipped verbatim by pr-agent (*"When confidence is
limited but the potential impact is high (e.g., data loss, security), report it with an explicit note
on what remains uncertain. Otherwise, prefer not reporting over guessing."*) [V] and by Claude Code
(>80% confidence floor, drop <0.7) [V]. It also gives the main seat a triage key it does not have
today.

**A6. Add "no findings is a valid, expected answer".**
Our anti-padding clause covers *sections*, not the *whole review*. Add Codex's line: *"If nothing
qualifies, say so — do not invent a finding to fill the result."*
**Evidence:** shipped in both Codex artifacts (*"prefer outputting no findings"*, *"Do not invent a
finding to fill the result"*) and in pr-agent's schema (*"An empty list is acceptable"*) [V].

**A7. Add a short "reviewer's own rationalizations" block for design audits.**
The Opus-adversarial-lens brief should name the failure modes: *reading instead of checking* (asserting
a mechanism works without opening the file that implements it), *being seduced by the clean design*
(the plan reads well, so the seams are assumed fine), and *reporting the absent instead of the wrong*
(listing what is missing rather than what will break).
**Evidence:** Anthropic ships a two-paragraph named-failure-patterns block plus a RECOGNIZE YOUR OWN
RATIONALIZATIONS list in its verification agent [V]. We ship no analogue.

### BEHAVIOR-CHANGING (owner ruling needed)

**B1. Replace the global ~1200-word cap with a per-finding brevity contract.**
Proposed: no total cap; each finding ≤ one paragraph of body, ≤ 3 lines of quoted code, plus the
verdict section; the anti-padding clause stays. Optionally keep a cap on the *summary/verdict* section
only.
**Evidence:** **no shipped review prompt caps total output.** Codex: *"You can return an unlimited
number of findings… Do not stop at the first qualifying finding"* [V]; its brevity rules are all
per-finding (*"The body should be at most 1 paragraph"*, *"should not include any chunks of code
longer than 3 lines"*) [V]. pr-agent's `num_max_findings = 3` exists to fit a PR comment, not to
improve quality [V]. **Risk:** longer reviews cost main-seat reading time; the owner has explicitly
valued compact output before. **Mitigation:** the per-finding contract + severity floor + confidence
floor already bound the length in practice.

**B2. Add a verify round to the council loop — one `SendMessage`, not a new agent.**
After the review lands and BEFORE the main seat rules: send the same agent its own finding list back
with *"For each finding: try to refute it. Open the file and quote the lines that prove it real, or
withdraw it. A finding you cannot ground in quoted code is withdrawn."* Then rule on survivors.
**Evidence:** this is the most consistently shipped structure in the survey (§2g): Claude Code's
parallel FP-filter sub-tasks with a confidence-8 floor [V], pr-agent's self-reflect-and-score pass
(*"models often struggle to simultaneously generate high-quality code suggestions and rank them well
in a single pass"*) [V], G-Research (*"The first pass captures everything; the second filters"*) [R],
CodeRabbit's grounding checks and Greptile's TREX execution [R]. Measured attrition where reported:
~63% of candidates die at the first adversarial gate [R]. **Cost:** one follow-up per review round
(~60 s, a fraction of a fresh agent — the skill already documents this mechanism for the *agreement*
confirm round; this reuses it one step earlier). **Why it needs a ruling:** it inserts a step into the
council loop the owner locked, and it changes what the main seat receives (a smaller, grounded list
instead of the raw list it currently rules on).

**B3. Turn the bounded reading list into a FLOOR, not a CEILING.**
Today: *"Name the exact files and the order to read them; state 'do NOT crawl the repository'."*
Proposed: *"Read these files, in this order, first. Then follow call sites and tests as far as needed
to confirm each candidate finding is real — but do not survey unrelated subsystems."*
**Evidence:** Codex's shipped review-agent requires exactly this (*"enough surrounding code to
understand each changed path"* · *"Check the relevant tests and call sites to confirm that each
finding is real and actionable"*) [V]; Claude Code's security review makes repository-context research
**Phase 1** before any judging [V]; the whole-repo-context vendors (Greptile/CodeRabbit/Augment)
attribute precision to it [R]. **Risk:** cost. A crawl is what the current rule exists to prevent. The
proposed wording ties the extra reading to *verifying a candidate finding*, which is the expensive
part worth paying for.

**B4. State the precision/recall posture explicitly, per round, and default to recall for design rounds.**
Proposed line in the brief: *"Posture: RECALL-FIRST — I am the filter; a false positive costs me two
minutes, a miss ships."* (or PRECISION-FIRST for a pre-release diff round, where noise is the enemy).
**Evidence:** Anthropic ships an effort dial that makes this trade explicit in the shipped
`/code-review` skill description — *"low/medium: fewer, high-confidence findings; high→max: broader
coverage, **may include uncertain findings**"* [V, this environment's skill listing]; Cursor's arc ran
from restraint to *"err on the side of flagging"* once the reviewer had tools [R]; the recall-first
argument is exactly our situation — *"When an agent reads first, the cost of a false positive drops
while a missed bug still reaches production"* [R]; and one vendor benchmark puts Codex's default
posture at 68% precision / 29% recall [R], i.e. we are hiring the most precision-biased reviewer in
the field and then not asking it to widen. **Why a ruling:** recall-first means more findings the main
seat must rule against, which is real main-seat cost, and it interacts with B1.

**B5. Make the "already known" list a durable house file instead of a retyped paragraph.**
Proposed: a short `docs/` (or skill-local) exclusions list — the standing house precedents a reviewer
should not re-litigate (single-user tailnet threat model, `!`-shell defaults OFF by design, no public
bind, YAML+SQLite split, no-legacy-seams rule, "bug fixes stay minimal", …) — pasted into every review
brief, with the per-round known-findings list appended.
**Evidence:** Claude Code ships 17 HARD EXCLUSIONS + 12 PRECEDENTS as a *fixed* block in the prompt
[V]; pr-agent ships a fixed DO-NOT-suggest list plus injected org standards [V]; Cursor/CodeRabbit
accumulate learned rules automatically from feedback [R]. Our skill already calls the known-findings
line *"the single highest-leverage line in the brief"* — this makes the durable half of it stop
depending on the main seat's memory. **Why a ruling:** it is a new artifact to maintain, and a stale
exclusions file would suppress real findings — the exact failure mode the framing paper warns about.

---

## 7. Corrections and refinements to premises our skill currently asserts

1. **"Codex over-engineers" — refined, not contradicted, and partly self-inflicted.** Codex's *own*
   shipped review rubric contains the correction: *"Fixing the bug does not demand a level of rigor
   that is not present in the rest of the codebase"* and *"The author … would likely fix the issue if
   they were made aware of it"* [V]. But that rubric is the system prompt of `codex exec`'s **`/review`
   mode only** — `review_request.rs` shows it is loaded from `templates/review/rubric.md` for review
   threads. **When we run `codex exec` with our own prompt, we do not get it.** Some of the
   over-engineering we correct for by hand is a calibration layer we are bypassing. *Cheap fix, and it
   is ADDITIVE: paste those two qualification criteria into our review prompts verbatim.*
2. **The council rule's "three-way agreement" is not evidence of correctness.** *"Ten dedicated
   agents—including a senior-tier arbiter—unanimously confirmed a CMS Bleichenbacher padding oracle"*
   that did not exist; *"One test killed what 80+ agents' reasoning could not"* [R, arXiv 2604.19049].
   The rule is still right as a **process** gate (it forces disagreements to be ruled on, and it
   caught two HIGH design holes on A11) — but agreement should never upgrade a finding's truth value.
   The dossier's operational form of this: **ground findings in quoted code (B2), don't count votes.**
3. **"Bound the reading — do NOT crawl"** is a cost rule that the field would call a recall rule
   against itself. Every serious reviewer in the survey reads *beyond* the diff, and Codex's own
   review agent is instructed to check call sites *specifically to confirm findings are real*. B3
   proposes the smallest wording change that keeps the cost control and buys the verification.
4. **The ~1200-word cap has no precedent anywhere in the survey** (B1). It is the one structural
   choice in our skill that the field contradicts unanimously rather than merely differing on.
5. **"ONE agent per audit scope" survives intact and is well-supported** — but the field's reason is
   different from ours. We adopted it for cost; Anthropic and OpenAI both fan out *many* agents over
   *different lenses* on the same artifact (3 in `/simplify`, 4 in codex's repo review, 5 in the
   `/ultrareview` fleet). The invariant that actually matters, and that our skill already states, is
   **"two reviewers must not re-tread the same ground — give them different lenses and tell each what
   the other covers."** No change needed; the rationale can be strengthened.
6. **Nothing in the field contradicts "take the finding, not the fix."** pr-agent's aggregation rule
   even echoes it from the other side: *"If a finding is a false positive or not worth addressing,
   note it and move on — do not argue with the finding, just skip it"* [V].

---

## 8. What I could not determine

- **No measured evidence that a checklist suppresses out-of-list findings in a tool-using code
  reviewer.** I looked; the closest hits are rubric-scoring suppression (a different mechanism) and a
  paper pointing the *other* way (issue-list generation beats single-issue review, +10.85 pp). The
  freedom-clause recommendation therefore rests on shipped convention + the framing paper, **not** on
  a measured anchoring effect. If the owner wants that specific question settled, only the paired
  re-run in §5 can settle it, and only for one artifact.
- **The `/code-review` skill's own prompt** (the one available in this session, with the low→ultra
  effort dial) is **not in the local checkout** — it moved to the plugin marketplace
  (`createMovedToPluginCommand`) and the plugin cache on this machine holds only `frontend-design`. I
  quoted its **description string** [V] but never read its body. Likewise `/ultrareview`'s
  hunter/verifier prompts run server-side (`run_hunt.sh` in the cloud image); only the env-var surface
  and the existence of a verifier tier are verifiable here.
- **No numbers for any of the structure choices in isolation.** Every vendor number I found is a
  whole-product delta (Bugbot 52%→70% resolution across an architecture rewrite; Refute-or-Promote's
  kill rates against no stated control). None isolates "added a verify pass" or "removed the cap".
- **CodeRabbit's and Greptile's actual prompts** are closed; the blog page I fetched returned only
  article titles, so their rows in §1.6 are search-summary-grade [R] and should not carry weight
  beyond "a verification/grounding step exists".
- **Whether an open sweep dilutes a pointed brief** — unmeasured in the field and unmeasurable cheaply
  here. A2's cap-at-3 + "same bar" wording is a hedge against it, not a proof it doesn't happen.
- **Anthropic's internal bughunter prompt structure** (how the 5 fleet members differ from each other —
  lenses? seeds? identical?) is not observable from the client. If they are identical samples, that
  would be the field's one live multi-sample deployment; if they are lenses, the §2f verdict gets
  stronger. Unknown. **[U]**
