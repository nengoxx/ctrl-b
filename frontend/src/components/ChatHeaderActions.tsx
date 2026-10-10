import { flattenThreads, headerDot, useThreads, type ThreadDot } from "../hooks/useThreads";
import { useChatSlice, useViewHome } from "../store/chat";
import { openConversationsSheet, useConversationsSheetOpen } from "../store/conversationsSheet";
import { Glyph } from "./icons";
import { PrivilegeChip } from "./PrivilegeChip";

// The ONE chat-header action cluster — the `.right` span of the `.sec` header that every chat body renders
// (the kit `AgentTab`, the bespoke `FrontierAgent` and `GachaAgent`). Factored out (D84 §7) so shared chat
// chrome lives in one place and no theme body forks it: the theme's contribution is paint, not placement
// (the GachaAgent ruling). It holds the CONVERSATIONS button (S9b) and, at the right edge, the privilege
// chip (its DOM untouched).

/** What the button says about its dot (§5) — the state in words, for the accessible name. */
const DOT_WORDS: Record<ThreadDot, string> = {
  "needs-you": "one needs you",
  running: "a reply is running",
  unread: "unread",
};

export function ChatHeaderActions() {
  return (
    <span className="right">
      <ConversationsButton />
      <PrivilegeChip />
    </span>
  );
}

/** The conversations button (D84 §7): a hand-inlined lucide `messages-square`, opening the per-home sheet
 *  (`ConversationsSheet`, mounted once at the root). It ALWAYS opens the view's HOME's sheet, whoever
 *  answers (R36), and is disabled while the home is UNKNOWN (`useViewHome` = null) — no surface runs
 *  against a home this device cannot name. The §5 DOT: the strongest state among the home's OTHER
 *  conversations, from `['threads', home]` — enabled here, sheet closed, because the dot needs it.
 *  SEAM (S10): the `thread` frame consumer will invalidate that key live; until then the bridge's stale
 *  bus and a focus refetch are its freshness. */
function ConversationsButton() {
  const home = useViewHome();
  const openId = useChatSlice((s) => s.threadId);
  const open = useConversationsSheetOpen();
  const { data } = useThreads(home ?? "", { enabled: home !== null });
  const dot = home === null ? null : headerDot(flattenThreads(data), openId);
  return (
    <button
      type="button"
      className="cvs-btn"
      aria-label={dot ? `Conversations — ${DOT_WORDS[dot]}` : "Conversations"}
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={home === null}
      onClick={openConversationsSheet}
    >
      <Glyph size={16}>
        <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2z" />
        <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
      </Glyph>
      {dot && <span className="cvs-dot" data-state={dot} aria-hidden />}
    </button>
  );
}
