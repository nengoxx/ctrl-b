import { useState } from "react";

import { ChatThread } from "../components/ChatThread";
import { PlanSteps } from "../components/PlanSteps";
import { PrivilegeChip } from "../components/PrivilegeChip";
import { useAgentChat } from "../hooks/useAgentChat";
import { advanceStep } from "../lib/plan";
import { editPlan } from "../store/chat";
import { PinnedPlanPanel } from "../theme-engine/kit/composer/plan/PinnedPlanPanel";
import { usePlanPlacement } from "../theme-engine/kit/composer/plan/placement";
import type { Plan } from "../types";

// Agent chat tab (Phase 4a + 4b). The chat LOG itself lives in the reusable `<ChatThread/>` (F4) — this tab
// composes it with the kit plan chrome + the section header. AgentTab owns: the tab wrapper, the `.sec`
// header + PrivilegeChip, and the kit `PinnedPlanPanel` first-in-flow mount rule (DESIGN §12,
// vapor.html:1934). There is NO theme branching left here — D51 V4 moved vapor onto the shared
// `planPlacement` axis (it declares `"pinned"`), so every theme takes the same code path.

/** DEAD SINCE D51 V4 — kept, unreferenced, for the pivot's follow-up DELETE commit (port ≠ delete, plan §3
 *  V4 / R16: a failed owner eyeball must be able to revert the port alone). It was VAPOR-ONLY (D30): the
 *  in-tab pinned plan, a minimized tab hanging from the top of the chat that dropped the checklist down when
 *  tapped, styled by extras.css's `.plan-pin`/`.plan-drop`. Vapor now renders the kit `PinnedPlanPanel`
 *  below like every other theme, via `planPlacement: "pinned"`. Exported ONLY so `noUnusedLocals` tolerates
 *  the corpse until the delete commit takes it (and its `.plan-pin-wrap` CSS with it). Do not use. */
export function PinnedPlan({ plan }: { plan: Plan }) {
  const total = plan.steps.length;
  const done = plan.steps.filter((s) => s.status === "done").length;
  const [open, setOpen] = useState(false);
  // Clicking a step's dot advances its status (pending → active → done → pending), persists, and the
  // agent sees it next turn (4-plan-edit). Three states so the owner can mark a step "in progress"
  // (active, the lit look) before "done" (✓), matching the states the agent sets itself. EXACTLY ONE
  // step is active at a time (the agent's own invariant): tapping a step to `active` demotes any other
  // active step back to pending — so a manual edit can't leave two steps lit as the current one.
  const cycle = (i: number) => void editPlan(advanceStep(plan.steps, i));
  return (
    <div className="plan-pin">
      <div className="plan-pin-wrap">
        <button
          type="button"
          className={"plan-pin-head" + (open ? " open" : "")}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className="plan-title">plan</span>
          <span className="plan-count">
            {done}/{total}
          </span>
          <span className="chev" aria-hidden>
            ▾
          </span>
        </button>
        {open && (
          <div className="plan-drop">
            <PlanSteps plan={plan} onCycle={cycle} />
          </div>
        )}
      </div>
    </div>
  );
}

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
