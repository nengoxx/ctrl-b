import { ChatThread } from "../../components/ChatThread";
import { PrivilegeChip } from "../../components/PrivilegeChip";
import { useAgentChat } from "../../hooks/useAgentChat";
import { fillComposer } from "../../lib/composer";
import { PinnedPlanPanel } from "../../theme-engine/kit/composer/plan/PinnedPlanPanel";
import { usePlanPlacement } from "../../theme-engine/kit/composer/plan/placement";
import { ART } from "./art";

// The frontier bespoke Agent body (F4, §2) — injected into DefaultRoot's `agent` body slot (FrontierRoot
// passes it). It COMPOSES the shared `<ChatThread/>` (never forks it — §15's "shared + reskinned" band); the
// bespoke part is the backdrop: the 3-layer bobbing rig-stack that reads as a centered hero in the empty
// state and RECEDES to a dim living-background watermark once the thread has messages (§14.13 #8 applied over
// time). All of that recede/reverse is CSS-only, driven by the `data-thread` attribute below — a `/clear`
// empties the store (startNewThread) so the reversal is free (no JS transition bookkeeping).
//
// Parity with the default AgentTab: it renders the SAME `.sec` header + PrivilegeChip (functionality parity,
// the F3 Reboot precedent) and honors the `planPlacement` setting — `pinned` mounts the kit `PinnedPlanPanel`
// FIRST in flow (the AgentTab rule + rationale). The A4 `usePlanOpenAutoClose` reset lives in <AppEngines/>
// (§14.5 / §15 rule 5), so a body swap can never lose it — nothing to carry here.

// Empty-state suggestion chips (theme DATA, not shared code — the M3 suggestion-chip pattern: 3–5 generic
// prompts that FILL the composer, never auto-send). Fleet-agnostic on purpose (no invented host names). They
// live inside the empty state, so a `/clear` re-shows them for free. Owner-tunable.
const CHIPS = [
  "Which rigs are online?",
  "Any incidents today?",
  "Wake a rig and start its services",
] as const;

// The signature rig-stack watermark. OUTER positioner carries the empty↔watermark transition (transform +
// opacity ONLY, transform-origin top center); the three INNER layers each run the infinite `frontier-bob`
// keyframe — so the recede transform and the bob never share one `transform` (the research-confirmed nested-
// wrapper rule). Decorative → aria-hidden. Art from the `stack` partition of art.ts.
function RigStack() {
  return (
    <div className="fr-rigstack" aria-hidden>
      <div className="layer base" style={{ backgroundImage: `url(${ART.stack.base})` }} />
      <div className="layer mid" style={{ backgroundImage: `url(${ART.stack.mid})` }} />
      <div className="layer cube" style={{ backgroundImage: `url(${ART.stack.cube})` }} />
    </div>
  );
}

// The empty-state hero content — rendered INSIDE `.chat-log` (via ChatThread's `emptyState` slot), so it
// re-appears on `/clear` automatically. The rig-stack sits OUTSIDE the log (behind it); `.fr-empty`'s top
// padding clears the absolutely-positioned stack so the two read as one centered hero (stack above title).
function FrontierEmptyState() {
  return (
    <div className="fr-empty">
      <h2>Frontier Comms</h2>
      <p className="fr-hint">Hail the agent to scan, wake, or command any rig.</p>
      <div className="chips">
        {CHIPS.map((q) => (
          <button type="button" className="chip2" key={q} onClick={() => fillComposer(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FrontierAgent({ active }: { active: boolean }) {
  // The caller owns the `useAgentChat()` derivation (ChatThread's contract) — a body needs it anyway for the
  // thread-state attr + plan gate, so this avoids a second O(n) pairing.
  const chat = useAgentChat();
  const currentPlan = chat.currentPlan;
  // Plan placement (D30/A4). frontier is NEVER vapor, so no `isVapor` gate here (unlike AgentTab): `pinned`
  // → the kit `PinnedPlanPanel` mounted FIRST in flow; `inline` → the composer pill+sheet (DefaultRoot owns
  // that composition, passing the composer NO plan slots here).
  const planPlacement = usePlanPlacement();

  return (
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-agent"
      data-screen-label="02 comms"
      role="tabpanel"
      aria-labelledby="tabbtn-agent"
      // CSS alone drives the recede/reverse off this attr (empty = hero, active = watermark).
      data-thread={chat.messages.length ? "active" : "empty"}
    >
      <RigStack />
      {/* The kit PINNED panel renders FIRST in the tab flow — ABOVE the `.sec` header — so its natural
          position ≈ its sticky position (the AgentTab first-in-flow rule: content above a pinned element makes
          it TRAVEL between scroll-top and scrolled; first-in-flow kills the travel). */}
      {planPlacement === "pinned" && currentPlan && currentPlan.steps.length > 0 && (
        <PinnedPlanPanel />
      )}
      <div className="sec">
        <span className="num">02</span>
        <b>Comms</b>
        <span className="right">
          <PrivilegeChip />
        </span>
      </div>
      <ChatThread active={active} chat={chat} emptyState={<FrontierEmptyState />} />
    </div>
  );
}
