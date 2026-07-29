// Composer prefix routing (Phase 4c). Ports vapor.html's sendMsg() dispatch + editCmd/cmdInto, but
// to the agreed v2 grammar (ARCHITECTURE §"Composer", DECISIONS): one shared composer drives both
// the Fleet and Agent tabs, and on submit the raw text is routed by its leading sigil:
//
//   !<cmd>            → the guarded local-shell escape hatch (Phase 5, BUILT). Routes to
//                       `store/chat.runShell`, which POSTs `/api/exec`; the backend runs it on the
//                       host and persists a tool_call + result pair into the thread, so it renders
//                       as a command bubble and the agent sees it next turn. Handles disabled
//                       (403), thread-busy (409) and queued-as-a-steer (202, D41).
//   /<verb> [args]    → slash commands. /<provider> forces the inference backend (A11/D48 — one verb
//                       per configured provider, replacing the old /local //cloud); /clear starts a
//                       fresh thread; /help lists commands. A /verb that matches a discovered skill
//                       invokes it for that message (4.5, user-invoked).
//   anything else     → natural-language agent chat.
//
// All paths jump to the Agent tab (the chat log lives there). The shell sigil is `!` by default and
// will be configurable in Conf (Phase 7) — kept as a single constant so that wiring is one edit.

import {
  compactThread,
  pushSystemNote,
  runShell,
  sendMessage,
  setSessionAgent,
  setSessionMode,
  setSessionPrivilege,
  startNewThread,
} from "../store/chat";
import { setDraft } from "../store/composer";
import { clearComposerScope, takeComposerScope } from "../store/composerScope";
import { createStore } from "../store/createStore";
import { setUI } from "../store/ui";
import { PRIVILEGE_LEVELS, PRIVILEGE_VALUES, privilegeLabel, type Privilege } from "./privilege";

/** The guarded-shell sigil. Configurable in Conf later (Phase 7); the only command prefix (no $/>). */
export const SHELL_SIGIL = "!";

// The three loaded verb sets below are module state that the UI now READS (the A2 suggest popover), so they
// ride the shared dep-free `createStore` binding (D23) — same pattern as `lib/audioController`. The sets stay
// private (routing owns them); what's published is a monotonic VERSION so a subscriber can re-derive. A
// version, not the sets: `getCompletions` builds a fresh array per call, and a `getSnapshot` returning a fresh
// array loops forever (createStore's snapshot contract) — so the subscriber re-derives instead of reading.
const { emit: emitVerbs, useStore: useVerbStore } = createStore();
let verbsVersion = 0;

function verbsChanged(): void {
  verbsVersion++;
  emitVerbs();
}

/** Bumped whenever a loader installs a new skills/agents/providers set — a re-derive trigger for the UI. */
export function useVerbsVersion(): number {
  return useVerbStore(() => verbsVersion);
}

/** Names of discovered skills, so `/skill-name` routes as an invocation rather than "unknown command"
 *  (4.5). Loaded lazily from `GET /api/skills` and refreshed each time the composer module is used;
 *  the set is best-effort — an unknown `/verb` still falls through to the unknown-command note.
 *
 *  Keyed LOWERCASE → the CANONICAL name, because skill names are free-form (the backend reads them from
 *  the skill's frontmatter/dir name, no case folding) while routing lowercases the verb it parses: a
 *  case-sensitive set means `/OpsAssist` could never route, and a completion could insert a name the
 *  router then rejects. The map resolves the verb and hands the CANONICAL name to the backend. */
const knownSkills = new Map<string, string>();

// Each loader is fired from several places (module import, CRUD invalidations, settings saves), so two
// can be in flight at once. A per-loader generation counter, captured at call start and re-checked
// before the install, keeps the NEWEST-STARTED response authoritative — without it a slow earlier
// response lands last and overwrites the fresher set (v1.3.1 Codex review).
let skillsGen = 0;

/** The discovered skill names, for the composer tools/skills MENU (A6). A COPY — the Set itself stays
 *  private (routing owns it), so a UI read can never mutate the routing source. Pair with
 *  `useVerbsVersion()` for reactivity: a loader install bumps the version, the caller re-derives. */
export function getKnownSkills(): string[] {
  return [...knownSkills.values()];
}

export async function loadSkills(): Promise<void> {
  const gen = ++skillsGen;
  try {
    const res = await fetch("/api/skills");
    if (!res.ok) return;
    const skills = (await res.json()) as { name: string }[];
    if (gen !== skillsGen) return; // a newer load started → it owns the set
    knownSkills.clear();
    for (const s of skills) knownSkills.set(s.name.toLowerCase(), s.name);
    verbsChanged();
  } catch {
    /* best-effort — leave the set as-is */
  }
}
void loadSkills();

/** Configured agent names, so `/agent <name>` can validate + the default is known (7d). Best-effort,
 *  same as the skills set; an unknown name still routes (the backend resolves gracefully).
 *
 *  A plain Set for the same reason as the providers one: `GET /api/agents` lists only folders that
 *  EQUAL their own slug (`backend/app/config.py` `list_agent_names`: `_slug(p.name) == p.name`, with
 *  `_slug` = lowercase + non-alphanumerics → `-`), so every listed name is lowercase and whitespace-free.
 *  A mixed-case `/agent Ops` genuinely isn't configured, and the "will fall back to default" warning
 *  below is the correct answer rather than a lookup miss. */
const knownAgents = new Set<string>();
let defaultAgent = "default";
let agentsGen = 0;

/** The configured SPECIALIST agent names (the `default`/root agent is not among them — `GET /api/agents`
 *  reports it separately). Same copy-not-the-Set contract as `getKnownSkills`. */
export function getKnownAgents(): string[] {
  return [...knownAgents];
}

/** The resolved default agent's slug — what "no agent pick" means, for labelling the menu's default row. */
export function getDefaultAgent(): string {
  return defaultAgent;
}

export async function loadAgents(): Promise<void> {
  const gen = ++agentsGen;
  try {
    const res = await fetch("/api/agents");
    if (!res.ok) return;
    const data = (await res.json()) as { agents: string[]; default: string };
    if (gen !== agentsGen) return; // a newer load started → it owns the set
    knownAgents.clear();
    for (const n of data.agents) knownAgents.add(n);
    defaultAgent = data.default || "default";
    verbsChanged();
  } catch {
    /* best-effort */
  }
}
void loadAgents();

/** Composer-routable provider names (A11/D48 C7), so `/<provider>` forces that inference backend.
 *  Loaded from `GET /api/providers` (`verbs` — the backend already applies the in-chain / sole-model
 *  and skill-shadow / reserved-name rules), refreshed on every settings save (useSaveSettings). The
 *  set is best-effort; an unknown `/verb` still falls through to the unknown-command note.
 *
 *  A plain Set (not the skills map): a provider name IS its slug — `backend/app/config.py`
 *  `_PROVIDER_SLUG_RE = ^[a-z0-9][a-z0-9_+.-]{0,31}$`, enforced as a pydantic field_validator on the
 *  `providers` map, so a non-lowercase or whitespace-bearing key 422s the config load and the settings
 *  PUT. Membership against the lowercased verb is therefore exact by construction. */
const knownProviders = new Set<string>();
let providersGen = 0;

export async function loadProviders(): Promise<void> {
  const gen = ++providersGen;
  try {
    const res = await fetch("/api/providers");
    if (!res.ok) return;
    const data = (await res.json()) as { verbs?: string[] };
    if (gen !== providersGen) return; // a newer load started → it owns the set
    knownProviders.clear();
    for (const v of data.verbs ?? []) knownProviders.add(v);
    verbsChanged();
  } catch {
    /* best-effort — leave the set as-is */
  }
}
void loadProviders();

/** One built-in slash verb: its dispatch, its `/help` line, and (via `getCompletions`) its suggestion. */
interface BuiltinVerb {
  verb: string;
  /** Extra spellings routing to the SAME handler — routable, but not offered as completions. */
  aliases?: string[];
  /** The `/help` argument hint, e.g. `[name]`. */
  args?: string;
  help: string;
  /** `rest` = everything after the verb, trimmed. */
  run: (rest: string) => void;
}

/** The built-in verbs — ONE table driving dispatch (`routeSlash`), the `/help` listing, and the composer's
 *  first-token suggestions, so the three can't drift. Adding a verb is one row. Skills and providers are
 *  DISCOVERED (the sets above), so they stay out of the table and keep their own dynamic `/help` lines. */
const BUILTIN_VERBS: readonly BuiltinVerb[] = [
  {
    verb: "agent",
    args: "[name]",
    help: "switch the active agent (bare = back to default)",
    run: (rest) => {
      // `/agent <name>` sets a sticky session agent; bare `/agent` resets to the default. The name
      // is validated against the configured set (best-effort) — an unknown one still routes, the
      // backend resolves gracefully, but we warn so a typo is visible.
      const name = rest.split(/\s+/)[0] || "";
      if (!name) {
        setSessionAgent(null);
        pushSystemNote(`// agent → ${defaultAgent} (default)`);
        return;
      }
      setSessionAgent(name);
      pushSystemNote(
        knownAgents.has(name)
          ? `// agent → ${name}`
          : `// agent → ${name} (not configured — will fall back to default)`,
      );
    },
  },
  {
    verb: "privilege",
    aliases: ["priv"],
    args: "[lvl]",
    help: "set the session privilege (read|confirm|auto_low|full; bare = agent default)",
    run: (rest) => {
      // `/privilege <level>` sets a sticky session override; bare (or `default`/`clear`) resets to
      // the agent's own privilege. Accepts `read` as an alias for `readonly`. Unknown → warn, no-op.
      const word = rest.split(/\s+/)[0]?.toLowerCase() ?? "";
      if (!word || word === "default" || word === "clear") {
        setSessionPrivilege(null);
        pushSystemNote("// privilege → agent default");
        return;
      }
      const lvl = (word === "read" ? "readonly" : word) as Privilege;
      if (PRIVILEGE_VALUES.has(lvl)) {
        setSessionPrivilege(lvl);
        pushSystemNote(`// privilege → ${privilegeLabel(lvl)}`);
      } else {
        pushSystemNote(`// unknown level: ${word} — try read · confirm · auto_low · full`);
      }
    },
  },
  {
    verb: "compact",
    args: "[note]",
    help: "summarize older turns to free up context (note steers the summary)",
    // Everything after `/compact` is a free-text steer for the summarizer (D42); bare → null.
    run: (rest) => void compactThread(rest || null),
  },
  { verb: "clear", help: "start a new thread", run: () => startNewThread() },
  { verb: "help", help: "show this list", run: () => pushSystemNote(helpText()) },
];

/** Verb (and alias) → its table row. The routing lookup AND the "is this name already a built-in?"
 *  shadow test the completion filters use. */
const BUILTIN_BY_VERB = new Map<string, BuiltinVerb>();
for (const b of BUILTIN_VERBS) {
  BUILTIN_BY_VERB.set(b.verb, b);
  for (const a of b.aliases ?? []) BUILTIN_BY_VERB.set(a, b);
}

/** The `/help` listing — built live so the configured `/<provider>` verbs show by name (cheap: the
 *  set is tiny). Falls back to a generic pointer when none are loaded yet. */
function helpText(): string {
  const provs = [...knownProviders];
  const providerLine = provs.length
    ? `/<provider>    force an inference backend — ${provs.map((p) => `/${p}`).join(" · ")}`
    : "/<provider>    force an inference backend (see Conf → Providers)";
  return [
    "// commands",
    `${SHELL_SIGIL}<cmd>      run a shell command on the backend host (guarded)`,
    providerLine,
    // one line per built-in, column-aligned like the hand-written lines around it
    ...BUILTIN_VERBS.map(
      (b) => `${`/${b.verb}${b.args ? ` ${b.args}` : ""}`.padEnd(14)} ${b.help}`,
    ),
    "/<skill> [task] run a task with a skill active",
    "// anything else is sent to the agent",
  ].join("\n");
}

/** Drop a string into the shared composer for tweak-then-run (ports vapor's cmdInto/editCmd). The
 *  textareas are controlled off the draft store (F28) — write through `setDraft` so `send()`, which
 *  reads the store, transmits the injected text (a direct `.value` write is swallowed by React's
 *  value-tracker and leaves the store stale). The `#cmd-input` id is kept for focus only. */
export function fillComposer(text: string): void {
  setDraft(text);
  document.getElementById("cmd-input")?.focus();
}

/** Route + run one composer submission. Returns nothing; all effects go through the chat/ui stores. */
export function runComposer(raw: string): void {
  const text = raw.trim();
  if (!text) return;
  setUI({ tab: "agent" }); // the chat log lives on the Agent tab — every route lands there

  if (text.startsWith(SHELL_SIGIL)) {
    routeShell(text.slice(SHELL_SIGIL.length).trim());
    return;
  }
  if (text.startsWith("/")) {
    routeSlash(text);
    return;
  }
  // Plain NL send. `raw` == `text` here (no prefix), but pass it explicitly so a queued steer restores
  // the exact line on Stop (D41 §6) — the raw-line map is keyed uniformly for every send path.
  // A6: this is the message the tools/skills menu armed, so its one-shot scope rides along and is SPENT
  // here (`take` = read + clear). Absent fields are omitted rather than passed empty so the call shape is
  // unchanged when nothing is armed.
  const scope = takeComposerScope();
  void sendMessage(text, {
    raw: text,
    ...(scope.agent ? { agent: scope.agent } : {}),
    ...(scope.skills.length ? { skills: scope.skills } : {}),
  });
}

/** `!<cmd>` — the guarded shell escape hatch (Phase 5, built). Runs `run_shell` on the backend host via
 *  `/api/exec`; the result persists into the thread and renders as a command bubble (store/chat). */
function routeShell(cmd: string): void {
  if (!cmd) return;
  void runShell(cmd);
}

/** A slash line split at its FIRST whitespace run — ONE tokenizer for `routeSlash` AND `getCompletions`
 *  (they used to disagree: completions split on `\s+`, routing only on an ASCII space, so `/agent\tre`
 *  suggested agents and then routed as an unknown command). Both fields are VERBATIM — `verb` is not
 *  lowercased and `after` keeps its leading whitespace, because the two callers need different things:
 *  routing wants the trimmed remainder, completions need to know whether a second token has started. */
function splitSlashLine(text: string): { verb: string; after: string } {
  const at = text.search(/\s/);
  return at === -1
    ? { verb: text.slice(1), after: "" }
    : { verb: text.slice(1, at), after: text.slice(at) };
}

/** `/<verb> [args]` — slash commands. Unknown verbs get a one-line note rather than hitting the agent. */
function routeSlash(text: string): void {
  const { verb: typed, after } = splitSlashLine(text);
  const verb = typed.toLowerCase();
  const rest = after.trim();
  // The RAW composer line (WITH the `/prefix`) for a D41 Stop-harvest — the server stores only the
  // stripped `rest`, so a queued `/cloud do X` must restore `/cloud do X`, not `do X`.
  const raw = text;

  // Precedence (D48 C7): built-ins > skills > providers. A skill and a provider sharing a name → the
  // skill wins (the backend also drops the shadowed provider from `verbs`). `getCompletions` offers the
  // same three tiers in the same order off the same sources.
  const builtin = BUILTIN_BY_VERB.get(verb);
  const skill = knownSkills.get(verb);
  if (builtin) {
    builtin.run(rest);
  } else if (skill !== undefined) {
    // /skill-name <task> → run the task with that skill explicitly active (user-invoked, 4.5). The
    // CANONICAL name goes to the backend, not the lowercased verb — a skill's name is free-form and is
    // also its lookup key server-side (`resolve_skills` matches by exact name).
    // A6: an EXPLICIT slash-routed send WINS over the tools/skills menu — the arming is dropped, not
    // merged (the owner just routed this message by hand). Same at the provider branch below; a verb that
    // sends NO message (/help, /clear, /agent…) leaves the arming alone — it's still for the next message.
    if (rest) {
      clearComposerScope();
      void sendMessage(rest, { skills: [skill], raw });
    } else pushSystemNote(`// /${skill} needs a task: /${skill} <what to do>`);
  } else if (knownProviders.has(verb)) {
    // /<provider> [msg] → force that inference backend. With args = one-shot; bare = sticky.
    if (rest) {
      clearComposerScope();
      void sendMessage(rest, { mode: verb, raw });
    } else {
      setSessionMode(verb);
      pushSystemNote(`// inference → ${verb}`);
    }
  } else {
    pushSystemNote(`// unknown command: /${verb} — try /help`);
  }
}

// ── composer autocomplete (A2) ───────────────────────────────────────────────────────────────────────
// The GRAMMAR half of the suggest popover: one pure function over the draft, so the popover, its tests and
// `routeSlash` can never disagree about what a `/verb` means. Behaviour (open/close, keys, accept) is the
// headless `hooks/useComposerSuggest`; presentation is `kit/composer/SuggestPopover`.

export type CompletionKind = "builtin" | "skill" | "provider" | "agent" | "privilege";

export interface Completion {
  /** What the row shows — the bare name, no sigil. */
  value: string;
  kind: CompletionKind;
  /** The text REPLACING the token being typed (a first token keeps its `/`). */
  insert: string;
}

/** Completions for the token at the END of `draft`. Empty unless the draft's FIRST token is a `/verb` —
 *  `!shell` and plain agent chat never suggest. First token → built-ins > skills > providers (routing
 *  precedence, shadowed names dropped since they'd never route); `/agent <tab>` → configured agent names;
 *  `/privilege <tab>` (or its `/priv` alias) → the shared privilege ladder. Pure: no state, no effects.
 *
 *  A fully-typed candidate is still LISTED (it may share a prefix with a longer one — `clear` beside
 *  `clear-cache`); "there is nothing to accept, so Enter belongs to the send handler" is a KEY rule and
 *  lives with the other keys, in `useComposerSuggest`. */
export function getCompletions(draft: string): Completion[] {
  const text = draft.replace(/^\s+/, "");
  if (!text.startsWith("/")) return [];
  const { verb, after } = splitSlashLine(text);

  // Only a name that is ONE grammar token can be offered: the tokenizer splits at the first whitespace,
  // so a `My Skill` row would insert a line routing as the verb `my`. Skill names are free-form
  // server-side (SKILL.md frontmatter, no slug check), so the guard is real, not defensive.
  const typable = (n: string) => !/\s/.test(n);

  // FIRST token — nothing typed after the verb yet.
  if (!after) {
    const prefix = verb.toLowerCase();
    const hit = (n: string) => n.toLowerCase().startsWith(prefix);
    const shadowed = (n: string) => BUILTIN_BY_VERB.has(n.toLowerCase());
    const mk = (value: string, kind: CompletionKind): Completion => ({
      value,
      kind,
      insert: `/${value}`,
    });
    return [
      ...BUILTIN_VERBS.filter((b) => hit(b.verb)).map((b) => mk(b.verb, "builtin")),
      ...[...knownSkills.values()]
        .filter((n) => typable(n) && hit(n) && !shadowed(n))
        .map((n) => mk(n, "skill")),
      ...[...knownProviders]
        .filter((n) => hit(n) && !shadowed(n) && !knownSkills.has(n.toLowerCase()))
        .map((n) => mk(n, "provider")),
    ];
  }

  // SECOND token — the run after that first whitespace. Whitespace INSIDE it means a third token has
  // started, and no verb takes more than one completable argument.
  const token = after.replace(/^\s+/, "");
  if (!typable(token)) return [];
  const lower = token.toLowerCase();
  const head = verb.toLowerCase();
  const hit = (n: string) => n.toLowerCase().startsWith(lower);
  const mk = (value: string, kind: CompletionKind): Completion => ({ value, kind, insert: value });
  if (head === "agent") return [...knownAgents].filter(hit).map((n) => mk(n, "agent"));
  if (BUILTIN_BY_VERB.get(head)?.verb === "privilege") {
    return PRIVILEGE_LEVELS.filter((l) => hit(l.val)).map((l) => mk(l.val, "privilege"));
  }
  return [];
}
