import { ChatThread } from "../../components/ChatThread";
import { PrivilegeChip } from "../../components/PrivilegeChip";
import { useAgentChat } from "../../hooks/useAgentChat";
import { fillComposer } from "../../lib/composer";
import { PinnedPlanPanel } from "../../theme-engine/kit/composer/plan/PinnedPlanPanel";
import { usePlanPlacement } from "../../theme-engine/kit/composer/plan/placement";
import { useFrontierArt } from "./ownerArt";

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

// Empty-state suggestion chips (theme DATA, not shared code — the M3 suggestion-chip pattern: generic prompts
// that FILL the composer, never auto-send). Fleet-agnostic on purpose (no invented host names). They live
// inside the empty state, so a `/clear` re-shows them for free. Owner-tunable. TWO short chips (owner eyeball
// round 6): the longest ("Wake a rig and start its services") was dropped so both fit ONE row at 390px and the
// whole empty state clears the docked composer without scrolling.
const CHIPS = ["Which rigs are online?", "Any incidents today?"] as const;

// The signature rig-stack watermark. A zero-height sticky PIN (`.fr-rigstack-pin`) anchors it in the viewport
// so it stays put as a living background for the whole scroll of the thread (owner ask — it must not scroll
// away). Inside the pin, the OUTER positioner (`.fr-rigstack`) carries the empty↔watermark transition
// (transform + opacity ONLY, transform-origin top center); the three INNER layers each run the infinite
// `frontier-bob` keyframe — so the recede transform and the bob never share one `transform` (the research-
// confirmed nested-wrapper rule). Decorative → aria-hidden.
//
// Art per LAYER (D53 M2): the owner's `media/frontier/stack/<layer>.png` where they have named one, the
// bundled `stack` partition of art.ts where they have not — resolved by `useFrontierArt`, which reads the
// same shared query the Fleet body does (one request for both bodies).
function Layer({ name, url }: { name: string; url?: string }) {
  if (url === undefined) return null;
  return <div className={`layer ${name}`} style={{ backgroundImage: `url(${url})` }} />;
}

function RigStack() {
  const { stack } = useFrontierArt();
  return (
    <div className="fr-rigstack-pin" aria-hidden>
      <div className="fr-rigstack">
        {/* A layer the owner switched OFF paints nothing at all (Emma's S2 review #2) — the three
            composite, so a retired layer leaves a gap in the picture rather than restoring itself. */}
        <Layer name="base" url={stack.base} />
        <Layer name="mid" url={stack.mid} />
        <Layer name="cube" url={stack.cube} />
      </div>
    </div>
  );
}

// The empty-state hero content — rendered INSIDE `.chat-log` (via ChatThread's `emptyState` slot), so it
// re-appears on `/clear` automatically. The rig-stack sits OUTSIDE the log (behind it). Order (owner eyeball
// round 6): the `<h2>` title sits at the TOP (in the gap under the section header — no big top padding now);
// the `.fr-below` wrapper's padding-top then pushes the hint + chips DOWN below the floating stack, so the
// three read top→bottom as title · stack · hint+chips, and the whole state fits a 390px pane without scroll.
function FrontierEmptyState() {
  return (
    <div className="fr-empty">
      <h2>Frontier Comms</h2>
      <div className="fr-below">
        <p className="fr-hint">Hail the agent to scan, wake, or command any rig.</p>
        <div className="chips">
          {CHIPS.map((q) => (
            <button type="button" className="chip2" key={q} onClick={() => fillComposer(q)}>
              {q}
            </button>
          ))}
        </div>
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
