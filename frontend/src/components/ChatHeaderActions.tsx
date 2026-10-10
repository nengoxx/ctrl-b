import { PrivilegeChip } from "./PrivilegeChip";

// The ONE chat-header action cluster — the `.right` span of the `.sec` header that every chat body renders
// (the kit `AgentTab`, the bespoke `FrontierAgent` and `GachaAgent`). Factored out (D84 §7, the no-visual-
// change step — DOM byte-identical to the inline span it replaces) so shared chat chrome lives in one place
// and no theme body forks it: the theme's contribution is paint, not placement (the GachaAgent ruling).
// SEAM: S9b adds the conversations button HERE, once — a hand-inlined lucide `messages-square` with the §5
// dot — beside the privilege chip.
export function ChatHeaderActions() {
  return (
    <span className="right">
      <PrivilegeChip />
    </span>
  );
}
