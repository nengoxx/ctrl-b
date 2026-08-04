import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { ChatThread } from "../../components/ChatThread";
import { PrivilegeChip } from "../../components/PrivilegeChip";
import { useAgentChat } from "../../hooks/useAgentChat";
import { fillComposer } from "../../lib/composer";
import { PinnedPlanPanel } from "../../theme-engine/kit/composer/plan/PinnedPlanPanel";
import { usePlanPlacement } from "../../theme-engine/kit/composer/plan/placement";
import { safeRafLoop } from "../../theme-engine/safeRafLoop";
import { useThemeSetting } from "../../theme-engine/settings";
import { GACHA_COPY } from "./copy";
import {
  ORACLE_P_VAR,
  ORACLE_RAMP_VAR,
  oracleProgress,
  oracleProgressValue,
  parsePx,
} from "./oracle";
import { oracleArt, type ResolvedArt } from "./roster";
import { useGachaRoster } from "./useGachaRoster";

// The gacha bespoke AGENT body (D52 / GACHA_PLAN §4.2, G3) — the prototype's `.screen[data-screen="agent"]`,
// injected into DefaultRoot's `agent` body slot by GachaRoot. FrontierAgent is the named precedent and this
// follows it exactly: a bespoke BODY that renders its own art block above the COMPOSED shared `<ChatThread/>`
// (never a fork — `emptyState` is the one inner slot, §15's "shared + reskinned" band). The A4 plan-open
// auto-close lives in <AppEngines/> (§15 rule 5), so swapping the body can never lose it: nothing to carry.
//
// THE ORACLE is the prototype's own header — a 300px art block (the resolver's SCENE art, never a roster
// character: the oracle ROLE is a partitioned pool exactly so a machine's portrait can never be dealt here)
// under a scanline loop, with the operator's name over it. It is deliberately NOT a `.sec` header: the
// prototype's agent screen has no section head, the oracle names the tab, and the round-4 measurement wave
// established that the theme's first block sits FLUSH under the appbar.
//
// The `.sec` HEADER stays, under the art (owner ruling, G3 round 2): it carries the PRIVILEGE CHIP (A1/D16),
// which is a shared chat CONTROL rather than decoration, and shared chat chrome must render, position and
// stack under gacha exactly as it does under every other theme — FrontierAgent is the precedent, down to the
// `.right` slot. It cannot ride the oracle either way: under `data-oracle="fade"` the whole art block ghosts
// to 28% as the thread scrolls over it (M7, below), which would fade a live affordance out of reach.

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

// ── M7 · the fade-on-scroll (§4.2 + the §10.2 recipe) ───────────────────────────────────────────────────
// The kit's scroller. Named here for the same reason ChatThread names it: a body reaches the shell's ONE
// content pane by id, and both must agree on which pane that is.
const SCROLLER_ID = "app-scroll";
// The kit's app bar — an in-flow child of that same scroller, ABOVE the tab bodies, so its height is part of
// the oracle's own offset. Observed (not just read once) for the reason M3 names: it grows and shrinks on its
// own — the TTS toggle appearing, the docked launcher, a display font landing — and none of that resizes the
// pane or the oracle, so neither of the other observed boxes would report it.
const APPBAR_SEL = ".kit-appbar";

/**
 * Drives `--gc-oracle-p` (0→1) from the scroller, and nothing else — opacity, scale and the sharp↔blurred
 * crossfade are all CSS `calc()`s over that one number, so a scroll frame costs one custom-property write
 * and the compositor's own work (§10.2's mechanism ruling: no animated `filter`, no scroll-driven CSS
 * animations — neither is shippable on stable Gecko / under §14.11).
 *
 * The mechanics the plan pins, each visible below:
 *  · PASSIVE listener on `#app-scroll` (ChatThread's own precedent, same pane, same option);
 *  · progress from the oracle's OWN offset, never absolute scrollTop — other tabs share this scroller;
 *  · NO per-frame `getBoundingClientRect` — the offset and the ramp are cached, re-measured on activation,
 *    on a resize of the pane / the oracle / THE APP BAR, and whenever the flow above the oracle changes
 *    (the pinned plan panel appearing or leaving — `hasPinnedPlan`). Both of those last two are
 *    POSITION-only moves that a ResizeObserver cannot report (Codex G3 M3): a plan can arrive inside an
 *    already-streaming message, so `threadLen` never changes, and the bar can re-lay-out without either
 *    observed box changing size. A scroll frame then writes from a base that is one panel too high;
 *  · every remeasure — observer- or dependency-driven — is COALESCED through ONE guarded rAF, so a burst
 *    of observer callbacks costs a single measurement, and it lands after the layout/pin work that
 *    provoked it rather than in the middle of it;
 *  · `active`-gated: a `display: none` body measures all-zero, so a measurement taken while the tab is
 *    hidden would be a lie that only a scroll could correct;
 *  · RE-SYNCED after ChatThread's programmatic bottom-pin — entering a populated thread lands with the
 *    oracle already ghosted behind the log, which is the design (RULED Q8.8), and the sync is what makes it
 *    ARRIVE that way instead of flashing sharp for a frame;
 *  · the property is REMOVED on teardown (the §10.5 switch-out ledger: gacha leaves nothing behind).
 */
function useOracleFade(
  active: boolean,
  enabled: boolean,
  threadLen: number,
  hasPinnedPlan: boolean,
) {
  const oracleRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  // The one imperative handle the second effect needs — it SCHEDULES a remeasure rather than performing one
  // (the coalescing frame below). Held in a ref rather than lifted into state: it is set and cleared by the
  // wiring effect, and a re-sync must call whatever is current.
  const syncRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const el = oracleRef.current;
    const anchor = anchorRef.current;
    const scroller = document.getElementById(SCROLLER_ID);
    if (!el || !anchor || !scroller || !active || !enabled) return;

    // The cached geometry. `base` = the scrollTop at which the oracle's top edge meets the scroller's:
    // measured off the zero-height ANCHOR, which (unlike the oracle itself, which becomes sticky) never
    // moves relative to the flow, so the reading is honest at any scroll position. `ramp` is the tunable,
    // read from its token — parse failure means "no ramp", and the driver then writes nothing.
    let base = 0;
    let ramp: number | null = null;
    let last = "";
    const measure = () => {
      base =
        anchor.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      ramp = parsePx(getComputedStyle(el).getPropertyValue(ORACLE_RAMP_VAR));
    };
    const write = () => {
      if (ramp === null) return;
      const value = oracleProgressValue(oracleProgress(scroller.scrollTop, base, ramp));
      // a sub-perceptual move: don't dirty style
      if (value === last) return;
      last = value;
      el.style.setProperty(ORACLE_P_VAR, value);
    };
    // ONE frame per scroll burst, with the engine's crash guard: `safeRafLoop.start()` is a no-op while a
    // frame is pending (that IS the throttle) and a tick returning `false` ends the loop, so each burst
    // schedules exactly one frame. A throwing tick stops for good and reports once, instead of erroring
    // per frame — the reason an unguarded rAF inside a theme is an anti-pattern here.
    const loop = safeRafLoop(() => {
      write();
      return false;
    });
    const onScroll = () => loop.start();
    // THE REMEASURE FRAME — the second and last loop this hook schedules. Everything that can move the
    // anchor without scrolling it (an observer firing, a plan mounting above, re-activation) goes through
    // `start()`, which is a no-op while a frame is pending: a burst of ResizeObserver callbacks therefore
    // costs ONE measurement, taken a frame later — after the layout work that provoked it has settled.
    const remeasure = safeRafLoop(() => {
      measure();
      write();
      return false;
    });
    syncRef.current = () => remeasure.start();
    // The FIRST measurement is synchronous, unlike every later one: the ramp must be published before the
    // browser paints this mount, or the block would show sharp for a frame in a thread that is already
    // scrolled past it (RULED Q8.8 — entering a populated thread lands ghosted).
    measure();
    write();

    scroller.addEventListener("scroll", onScroll, { passive: true });
    // Re-measure on any resize of the pane, of the block itself, or of the APP BAR above it (the keyboard
    // opening, the bar growing a TTS toggle, a font landing). ResizeObserver reports SIZE, not position —
    // so the one move it structurally cannot see, a pinned plan panel appearing above the oracle, is a
    // DEPENDENCY of the effect below instead.
    const ro = new ResizeObserver(() => remeasure.start());
    ro.observe(scroller);
    ro.observe(el);
    // absent under `appbarMode: minimal`: nothing to watch there, and `--appbar-h` is 0
    const bar = document.querySelector(APPBAR_SEL);
    if (bar) ro.observe(bar);
    return () => {
      syncRef.current = null;
      scroller.removeEventListener("scroll", onScroll);
      ro.disconnect();
      loop.stop();
      remeasure.stop();
      el.style.removeProperty(ORACLE_P_VAR);
    };
  }, [active, enabled]);

  // The RE-SYNC. ChatThread pins the scroller to the bottom on activation (inside a rAF) and on every new
  // message (synchronously); a child's effects run before its parent's, so the frame scheduled HERE always
  // lands after the pin it has to observe. Two deps, one per thing that moves the reading:
  //   · `threadLen` — what moves the PIN (the scroll position changes under us, with no scroll event);
  //   · `hasPinnedPlan` — what moves the ANCHOR (a sticky panel mounting/unmounting above the oracle
  //     displaces the whole flow by its height). It is a separate dep precisely because it is invisible to
  //     both the pin and the observers: `task_plan` can land inside the assistant message that is already
  //     streaming, leaving `threadLen` unchanged (Codex G3 M3).
  // The scheduling itself is the wiring effect's coalescing frame (`safeRafLoop`) — one mechanism for every
  // frame this theme schedules, and the §14.15.1-A rider's crash guard for free (a bare
  // `requestAnimationFrame` in a theme is lint-banned).
  useEffect(() => {
    if (!active || !enabled) return;
    syncRef.current?.();
  }, [active, enabled, threadLen, hasPinnedPlan]);

  return { oracleRef, anchorRef };
}

/** The ORACLE — the prototype's `.oracle` block (theme.css:74-81). Decorative art + a scanline over it, with
 *  the operator's name plate; under the fade mode the whole thing is a sticky BACKDROP the chat scrolls
 *  over (the prototype's own `z: oracle 0 / log 2`), ghosting to 28% as it goes.
 *
 *  TWO stacked copies of the art carry that ghost — the §10.2 mechanism ruling. The sharp copy fades OUT
 *  while a statically-blurred copy fades IN, inside a wrapper whose own opacity walks 1 → 0.28: fading one
 *  sharp copy to .28 while blurring it would mean animating `filter` (Gecko ≈ 10× slower; §14.11 converts
 *  exactly this case into "animate the opacity of a layer"), and crossfading WITHOUT the wrapper's own walk
 *  would end at a fully opaque blur instead of a ghost. Static blur rasterizes once; every per-frame
 *  property is opacity or transform. */
function GachaOracle({
  fade,
  art,
  oracleRef,
  anchorRef,
}: {
  fade: boolean;
  /** The backdrop, already resolved by the body through §5.3's ONE resolver (G5): an `oracle:` pin, else
   *  the owner's `media/gacha/oracle/` drop, else the bundled scene. Both stacked copies paint it — they
   *  are the same surface twice, so they cannot be handed different art. */
  art: ResolvedArt;
  oracleRef: RefObject<HTMLDivElement | null>;
  anchorRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <>
      {/* The measurement anchor: zero-height, never sticky, so its offset is the oracle's TRUE flow
          position at any scroll offset. Rendering it costs one empty div and saves the driver from having
          to reason about a stuck element's own coordinates. */}
      <div className="gc-oracle-anchor" ref={anchorRef} aria-hidden />
      {/* The focal crop rides a custom property, the wallpaper precedent: it belongs to the SURFACE, so both
          stacked copies of the art read it from here rather than each carrying its own. Absent → the
          tokens.css default (the prototype's own crop) stands. */}
      <div
        className="gc-oracle"
        ref={oracleRef}
        style={art.focus === undefined ? undefined : { ["--gc-oracle-pos" as string]: art.focus }}
      >
        {/* The SHARP face. Art + scrim + name plate — the whole surface, because that is the prototype's
            own M7 target. */}
        <div className="gc-oracle-face sharp">
          <img className="gc-oracle-art" src={art.url} alt="" draggable={false} />
          <div className="gc-oracle-name">
            <p className="eyebrow">PRIZE OPERATOR</p>
            <h1>
              Lucky Relay<em>{GACHA_COPY.oracleName}</em>
            </h1>
          </div>
        </div>
        {/* The SOFT face: the same surface again, statically blurred, crossfading in over the sharp one.
            It exists only in the mode that uses it (the `scroll` mode would otherwise carry a permanently
            invisible blurred layer) and is `aria-hidden` in full — it is a ghost of content the sharp face
            already announces, so the tab still has exactly ONE heading in the accessibility tree. */}
        {fade && (
          <div className="gc-oracle-face soft" aria-hidden>
            <img className="gc-oracle-art" src={art.url} alt="" draggable={false} />
            <div className="gc-oracle-name">
              <p className="eyebrow">PRIZE OPERATOR</p>
              <h1>
                Lucky Relay<em>{GACHA_COPY.oracleName}</em>
              </h1>
            </div>
          </div>
        )}
        {/* M6 — the 7s scanline loop. Decorative, and perf/motion-gated in CSS (the prototype's
            `.expensive-effect` class does not exist in this app; §10.3 expresses it as hand-authored
            `body[data-perf="lite"]` / `body[data-motion="reduced"]` rules, the M5 banner-glow precedent).
            ONE layer, above both faces rather than duplicated into each: a second blended AND blurred
            layer is exactly the cost §10.3 refuses, and a 5px blur erases a 1px comb anyway. */}
        <div className="gc-oracle-scan" aria-hidden />
      </div>
    </>
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
  // R6's "Sticky operator art" — the SAME setting GachaRoot stamps as `body[data-oracle]` (a read, not a
  // second source): the attribute drives the CSS, this drives whether the driver runs and whether the ghost
  // copy is in the DOM at all.
  const fade = useThemeSetting<boolean>("gacha", "oracle") ?? false;
  // The oracle's backdrop, through the theme's ONE art seam (G5) — the same shared query the Fleet, the
  // Root's wallpaper and the reel figure read. Resolved HERE, in the body, and handed down: the surface
  // renders what it is given (the GachaFleet convention).
  const roster = useGachaRoster();
  // The pinned panel's PRESENCE — the one piece of flow above the oracle that comes and goes. Derived once
  // and used twice (the mount below, and M7's remeasure dependency), so the driver can never disagree with
  // what is actually rendered.
  const hasPinnedPlan = planPlacement === "pinned" && !!currentPlan && currentPlan.steps.length > 0;
  // M7. The thread's LENGTH (not the array) is what moves ChatThread's bottom-pin, so it is what the
  // re-sync depends on; the panel's presence is what moves the oracle's own offset.
  const { oracleRef, anchorRef } = useOracleFade(active, fade, chat.messages.length, hasPinnedPlan);

  return (
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-agent"
      data-screen-label="02 Agent"
      role="tabpanel"
      aria-labelledby="tabbtn-agent"
    >
      {hasPinnedPlan && <PinnedPlanPanel />}
      <GachaOracle
        fade={fade}
        art={oracleArt(roster)}
        oracleRef={oracleRef}
        anchorRef={anchorRef}
      />
      {/* The kit's own `.sec` header, exactly as AgentTab and FrontierAgent render it (owner ruling, G3
          round 2). The first pass gave the privilege chip a bespoke right-aligned strip of its own, which
          put a shared chat control somewhere it is in no other theme AND parked it in a z-context of its
          own making — the dropdown then opened UNDER the thread. Shared chat chrome renders, positions
          and stacks the same everywhere; the theme's contribution is paint, not placement. */}
      <div className="sec">
        <span className="num">02</span>
        <b>Chat</b>
        <span className="right">
          <PrivilegeChip />
        </span>
      </div>
      <ChatThread active={active} chat={chat} emptyState={<GachaEmptyState />} />
    </div>
  );
}
