// Composer prefix routing (Phase 4c). Ports vapor.html's sendMsg() dispatch + editCmd/cmdInto, but
// to the agreed v2 grammar (ARCHITECTURE §"Composer", DECISIONS): one shared composer drives both
// the Fleet and Agent tabs, and on submit the raw text is routed by its leading sigil:
//
//   !<cmd>            → guarded shell escape hatch (run_shell). Phase 5 wires the real exec; here it
//                       routes + stubs so the path is visibly distinct.
//   /<verb> [args]    → slash commands. /local //cloud force the inference backend (replacing the old
//                       k:/o:); /clear starts a fresh thread; /help lists commands.
//   anything else     → natural-language agent chat.
//
// All paths jump to the Agent tab (the chat log lives there). The shell sigil is `!` by default and
// will be configurable in Conf (Phase 7) — kept as a single constant so that wiring is one edit.

import {
  pushSystemNote,
  pushUserEcho,
  sendMessage,
  setSessionMode,
  startNewThread,
  type ChatMode,
} from "../store/chat";
import { setUI } from "../store/ui";

/** The guarded-shell sigil. Configurable in Conf later (Phase 7); the only command prefix (no $/>). */
export const SHELL_SIGIL = "!";

const HELP = [
  "// commands",
  `${SHELL_SIGIL}<cmd>      run a shell command (guarded · lands in Phase 5)`,
  "/local [msg]   force the local inference backend",
  "/cloud [msg]   force the cloud inference backend",
  "/clear         start a new thread",
  "/help          show this list",
  "// anything else is sent to the agent",
].join("\n");

/** Drop a string into the shared composer for tweak-then-run (ports vapor's cmdInto/editCmd). The
 *  textarea is uncontrolled, so write the value + dispatch `input` so its auto-size handler fires. */
export function fillComposer(text: string): void {
  const ta = document.getElementById("cmd-input") as HTMLTextAreaElement | null;
  if (!ta) return;
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  ta.focus();
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
  void sendMessage(text);
}

/** `!<cmd>` — the guarded shell escape hatch. Phase 5 wires `run_shell` + a command bubble; for now
 *  echo the intent and note it isn't live, so the routing is observable without faking execution. */
function routeShell(cmd: string): void {
  if (!cmd) return;
  pushUserEcho(`${SHELL_SIGIL}${cmd}`);
  pushSystemNote(`// shell exec ("${SHELL_SIGIL}") arrives in Phase 5 — not wired yet`);
}

/** `/<verb> [args]` — slash commands. Unknown verbs get a one-line note rather than hitting the agent. */
function routeSlash(text: string): void {
  const sp = text.indexOf(" ");
  const verb = (sp === -1 ? text : text.slice(0, sp)).slice(1).toLowerCase();
  const rest = sp === -1 ? "" : text.slice(sp + 1).trim();

  switch (verb) {
    case "local":
    case "cloud": {
      const mode = verb as ChatMode;
      if (rest) {
        void sendMessage(rest, { mode }); // one-shot: this message only
      } else {
        setSessionMode(mode); // sticky: subsequent messages until changed
        pushSystemNote(`// inference → ${mode}`);
      }
      break;
    }
    case "clear":
      startNewThread();
      break;
    case "help":
      pushSystemNote(HELP);
      break;
    default:
      pushSystemNote(`// unknown command: /${verb} — try /help`);
  }
}
