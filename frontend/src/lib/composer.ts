// Composer prefix routing (Phase 4c). Ports vapor.html's sendMsg() dispatch + editCmd/cmdInto, but
// to the agreed v2 grammar (ARCHITECTURE §"Composer", DECISIONS): one shared composer drives both
// the Fleet and Agent tabs, and on submit the raw text is routed by its leading sigil:
//
//   !<cmd>            → guarded shell escape hatch (run_shell). Phase 5 wires the real exec; here it
//                       routes + stubs so the path is visibly distinct.
//   /<verb> [args]    → slash commands. /local //cloud force the inference backend (replacing the old
//                       k:/o:); /clear starts a fresh thread; /help lists commands. A /verb that
//                       matches a discovered skill invokes it for that message (4.5, user-invoked).
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
import { setUI } from "../store/ui";
import { PRIVILEGE_VALUES, privilegeLabel, type Privilege } from "./privilege";

/** The guarded-shell sigil. Configurable in Conf later (Phase 7); the only command prefix (no $/>). */
export const SHELL_SIGIL = "!";

/** Names of discovered skills, so `/skill-name` routes as an invocation rather than "unknown command"
 *  (4.5). Loaded lazily from `GET /api/skills` and refreshed each time the composer module is used;
 *  the set is best-effort — an unknown `/verb` still falls through to the unknown-command note. */
const knownSkills = new Set<string>();

export async function loadSkills(): Promise<void> {
  try {
    const res = await fetch("/api/skills");
    if (!res.ok) return;
    const skills = (await res.json()) as { name: string }[];
    knownSkills.clear();
    for (const s of skills) knownSkills.add(s.name);
  } catch {
    /* best-effort — leave the set as-is */
  }
}
void loadSkills();

/** Configured agent names, so `/agent <name>` can validate + the default is known (7d). Best-effort,
 *  same as the skills set; an unknown name still routes (the backend resolves gracefully). */
const knownAgents = new Set<string>();
let defaultAgent = "default";

export async function loadAgents(): Promise<void> {
  try {
    const res = await fetch("/api/agents");
    if (!res.ok) return;
    const data = (await res.json()) as { agents: string[]; default: string };
    knownAgents.clear();
    for (const n of data.agents) knownAgents.add(n);
    defaultAgent = data.default || "default";
  } catch {
    /* best-effort */
  }
}
void loadAgents();

const HELP = [
  "// commands",
  `${SHELL_SIGIL}<cmd>      run a shell command on the backend host (guarded)`,
  "/local [msg]   force the local inference backend",
  "/cloud [msg]   force the cloud inference backend",
  "/agent [name]  switch the active agent (bare = back to default)",
  "/privilege [lvl] set the session privilege (read|confirm|auto_low|full; bare = agent default)",
  "/compact [note] summarize older turns to free up context (note steers the summary)",
  "/clear         start a new thread",
  "/<skill> [task] run a task with a skill active",
  "/help          show this list",
  "// anything else is sent to the agent",
].join("\n");

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
  void sendMessage(text, { raw: text });
}

/** `!<cmd>` — the guarded shell escape hatch (Phase 5). Runs `run_shell` on the backend host via
 *  `/api/exec`; the result persists into the thread and renders as a command bubble (store/chat). */
function routeShell(cmd: string): void {
  if (!cmd) return;
  void runShell(cmd);
}

/** `/<verb> [args]` — slash commands. Unknown verbs get a one-line note rather than hitting the agent. */
function routeSlash(text: string): void {
  const sp = text.indexOf(" ");
  const verb = (sp === -1 ? text : text.slice(0, sp)).slice(1).toLowerCase();
  const rest = sp === -1 ? "" : text.slice(sp + 1).trim();
  // The RAW composer line (WITH the `/prefix`) for a D41 Stop-harvest — the server stores only the
  // stripped `rest`, so a queued `/cloud do X` must restore `/cloud do X`, not `do X`.
  const raw = text;

  switch (verb) {
    case "local":
    case "cloud": {
      const mode = verb; // narrowed to "local" | "cloud" by the switch cases
      if (rest) {
        void sendMessage(rest, { mode, raw }); // one-shot: this message only
      } else {
        setSessionMode(mode); // sticky: subsequent messages until changed
        pushSystemNote(`// inference → ${mode}`);
      }
      break;
    }
    case "agent": {
      // `/agent <name>` sets a sticky session agent; bare `/agent` resets to the default. The name
      // is validated against the configured set (best-effort) — an unknown one still routes, the
      // backend resolves gracefully, but we warn so a typo is visible.
      const name = rest.split(/\s+/)[0] || "";
      if (!name) {
        setSessionAgent(null);
        pushSystemNote(`// agent → ${defaultAgent} (default)`);
      } else {
        setSessionAgent(name);
        const known = knownAgents.has(name);
        pushSystemNote(
          known
            ? `// agent → ${name}`
            : `// agent → ${name} (not configured — will fall back to default)`,
        );
      }
      break;
    }
    case "privilege":
    case "priv": {
      // `/privilege <level>` sets a sticky session override; bare (or `default`/`clear`) resets to
      // the agent's own privilege. Accepts `read` as an alias for `readonly`. Unknown → warn, no-op.
      const raw = rest.split(/\s+/)[0]?.toLowerCase() ?? "";
      if (!raw || raw === "default" || raw === "clear") {
        setSessionPrivilege(null);
        pushSystemNote("// privilege → agent default");
      } else {
        const lvl = (raw === "read" ? "readonly" : raw) as Privilege;
        if (PRIVILEGE_VALUES.has(lvl)) {
          setSessionPrivilege(lvl);
          pushSystemNote(`// privilege → ${privilegeLabel(lvl)}`);
        } else {
          pushSystemNote(`// unknown level: ${raw} — try read · confirm · auto_low · full`);
        }
      }
      break;
    }
    case "clear":
      startNewThread();
      break;
    case "compact":
      // Everything after `/compact` is a free-text steer for the summarizer (D42); bare → null.
      void compactThread(rest || null);
      break;
    case "help":
      pushSystemNote(HELP);
      break;
    default:
      if (knownSkills.has(verb)) {
        // /skill-name <task> → run the task with that skill explicitly active (user-invoked, 4.5).
        if (rest) void sendMessage(rest, { skills: [verb], raw });
        else pushSystemNote(`// /${verb} needs a task: /${verb} <what to do>`);
      } else {
        pushSystemNote(`// unknown command: /${verb} — try /help`);
      }
  }
}
