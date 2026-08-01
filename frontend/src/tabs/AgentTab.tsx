import { ChatThread } from "../components/ChatThread";
import { PrivilegeChip } from "../components/PrivilegeChip";
import { useAgentChat } from "../hooks/useAgentChat";
import { PinnedPlanPanel } from "../theme-engine/kit/composer/plan/PinnedPlanPanel";
import { usePlanPlacement } from "../theme-engine/kit/composer/plan/placement";

// Agent chat tab (Phase 4a + 4b). The chat LOG itself lives in the reusable `<ChatThread/>` (F4) — this tab
// composes it with the kit plan chrome + the section header. AgentTab owns: the tab wrapper, the `.sec`
// header + PrivilegeChip, and the kit `PinnedPlanPanel` first-in-flow mount rule (DESIGN §12,
// vapor.html:1934). There is NO theme branching left here — D51 V4 moved vapor onto the shared
// `planPlacement` axis (it declares `"pinned"`), so every theme takes the same code path — and V4 phase 2
// deleted the vapor-only in-tab `PinnedPlan` this file used to carry (with its `PlanSteps`/`advanceStep`/
// `editPlan`/`useState` imports; the kit `PinnedPlanPanel` owns that whole job now).

interface Props {
  active: boolean;
}

export function AgentTab({ active }: Props) {
  // All chat state + derivations come from the headless controller (D29 §14.2); the log tree lives in
  // `<ChatThread/>`, which takes this derivation so it isn't paired twice. `currentPlan` drives the plan
  // chrome below. (The A4 plan-open auto-close now lives in <AppEngines/>, §14.5 — a bespoke body that
  // replaces this tab can never lose the reset.)
  const chat = useAgentChat();
  const currentPlan = chat.currentPlan;
  // Plan placement (D30/A4) — ONE code path for every theme since D51 V4 (the `isVapor` gate is gone):
  // `inline` → the pill+sheet in the composer (DefaultRoot owns that composition); `pinned` → the
  // kit-tokened `PinnedPlanPanel` here at the top of the tab (mutually exclusive — inline never mounts a
  // panel, pinned passes the composer NO plan slots). Vapor declares `pinned`.
  const planPlacement = usePlanPlacement();

  return (
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-agent"
      data-screen-label="02 Agent"
      role="tabpanel"
      aria-labelledby="tabbtn-agent"
    >
      {/* The kit PINNED panel renders FIRST in the tab flow — ABOVE the `.sec` header — so its natural
          position ≈ its sticky position (top: --appbar-h + 8). With content (the sec) above it, the panel
          would TRAVEL ~44px between scroll-top (natural) and scrolled (stuck), and no fixed mini-player slot
          can dodge a traveling band (owner eyeball 2026-07-12: the header slid under the player at
          scroll-top). First-in-flow kills the travel: a "pinned" element sits at one spot, always. */}
      {planPlacement === "pinned" && currentPlan && currentPlan.steps.length > 0 && (
        <PinnedPlanPanel />
      )}
      <div className="sec">
        <span className="num">02</span>
        <b>Chat</b>
        <span className="right">
          <PrivilegeChip />
        </span>
      </div>
      <ChatThread active={active} chat={chat} />
    </div>
  );
}
