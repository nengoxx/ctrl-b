import { ChatThread } from "../../components/ChatThread";
import { PrivilegeChip } from "../../components/PrivilegeChip";
import { useAgentChat } from "../../hooks/useAgentChat";
import { fillComposer } from "../../lib/composer";
import { PinnedPlanPanel } from "../../theme-engine/kit/composer/plan/PinnedPlanPanel";
import { usePlanPlacement } from "../../theme-engine/kit/composer/plan/placement";
import { ART } from "./art";
import { GACHA_COPY } from "./copy";

// The gacha bespoke AGENT body (D52 / GACHA_PLAN §4.2, G3) — the prototype's `.screen[data-screen="agent"]`,
// injected into DefaultRoot's `agent` body slot by GachaRoot. FrontierAgent is the named precedent and this
// follows it exactly: a bespoke BODY that renders its own art block above the COMPOSED shared `<ChatThread/>`
// (never a fork — `emptyState` is the one inner slot, §15's "shared + reskinned" band). The A4 plan-open
// auto-close lives in <AppEngines/> (§15 rule 5), so swapping the body can never lose it: nothing to carry.
//
// THE ORACLE is the prototype's own header — a 300px art block (the resolver's SCENE art, never a roster
// character: `ART.oracle` is a partitioned slot exactly so a machine's portrait can never be dealt here)
// under a scanline loop, with the operator's name over it. It is deliberately NOT a `.sec` header: the
// prototype's agent screen has no section head, the oracle names the tab, and the round-4 measurement wave
// established that the theme's first block sits FLUSH under the appbar.
//
// What the `.sec` head still owed is the PRIVILEGE CHIP (A1/D16) — a real control, not decoration. It cannot
// ride the oracle: under `data-oracle="fade"` the whole art block ghosts to 28% as the thread scrolls over it
// (M7, below), which would fade a functional affordance out of reach. So it takes its own slim row between
// the art and the log — the same place in the flow a `.sec` head would have been, carrying only what the
// prototype's design has no answer for.

/** Empty-state suggestion chips (theme DATA, the frontier/M3 pattern: generic prompts that FILL the composer,
 *  never auto-send). Fleet-agnostic — no invented machine names — and ASCII, because gacha's shipped font is
 *  a FROZEN subset of `copy.ts` (a Japanese chip here would need a documented `fonts:gacha` regen for two
 *  strings the prototype never wrote; the oracle's own name carries the theme's Japanese). */
const CHIPS = ["Which units are awake?", "Any incidents today?"] as const;

// The empty state renders INSIDE `.chat-log` (ChatThread's `emptyState` slot), so `/clear` re-shows it for
// free. NO heading, unlike frontier's: the oracle block above is permanently on screen and already carries
// the tab's `<h1>` — a second title would say the same thing twice, 40px apart.
function GachaEmptyState() {
  return (
    <div className="gc-empty">
      <p className="gc-empty-hint">Ask the operator to scan, wake, or command any unit.</p>
      <div className="chips">
        {CHIPS.map((q) => (
          <button type="button" className="gc-chip" key={q} onClick={() => fillComposer(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The ORACLE — the prototype's `.oracle` block (theme.css:74-81). Decorative art + a scanline over it, with
 *  the operator's name plate; the whole thing is one sticky BACKDROP the chat scrolls over (M7). */
function GachaOracle() {
  return (
    <div className="gc-oracle">
      <img className="gc-oracle-art" src={ART.oracle} alt="" draggable={false} />
      {/* M6 — the 7s scanline loop. Decorative, and perf/motion-gated in CSS (the prototype's
          `.expensive-effect` class does not exist in this app; §10.3 expresses it as hand-authored
          `body[data-perf="lite"]` / `body[data-motion="reduced"]` rules, the M5 banner-glow precedent). */}
      <div className="gc-oracle-scan" aria-hidden />
      <div className="gc-oracle-name">
        <p className="eyebrow">PRIZE OPERATOR</p>
        <h1>
          Lucky Relay<em>{GACHA_COPY.oracleName}</em>
        </h1>
      </div>
    </div>
  );
}

export function GachaAgent({ active }: { active: boolean }) {
  // The caller owns the `useAgentChat()` derivation (ChatThread's contract) — the body needs it anyway for
  // the plan gate, so this avoids a second O(n) pairing.
  const chat = useAgentChat();
  const currentPlan = chat.currentPlan;
  // Plan placement (D30/A4), one code path for every theme: `pinned` → the kit `PinnedPlanPanel` FIRST in
  // flow (the AgentTab rule: content above a pinned element makes it travel between scroll-top and stuck);
  // `inline` → the composer pill+sheet, which DefaultRoot owns. gacha declares `inline`.
  const planPlacement = usePlanPlacement();

  return (
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-agent"
      data-screen-label="02 Agent"
      role="tabpanel"
      aria-labelledby="tabbtn-agent"
    >
      {planPlacement === "pinned" && currentPlan && currentPlan.steps.length > 0 && (
        <PinnedPlanPanel />
      )}
      <GachaOracle />
      <div className="gc-agent-bar">
        <PrivilegeChip />
      </div>
      <ChatThread active={active} chat={chat} emptyState={<GachaEmptyState />} />
    </div>
  );
}
