import {
  type ComponentType,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { MiniPlayer } from "../../components/MiniPlayer";
import { NavHome, NavMenu } from "../../components/NavMenu";
import { PromptModal } from "../../components/PromptModal";
import { SwUpdatePrompt } from "../../components/SwUpdatePrompt";
import { Toasts } from "../../components/Toasts";
import { useSections } from "../../hooks/useSections";
import { getGroupScrollTarget } from "../../store/groupScroll";
import { prefetchOnIdle } from "../../lib/prefetch";
import { AgentTab } from "../../tabs/AgentTab";
import { AgentsTabLazy } from "../../tabs/AgentsTab.lazy";
import { ConfTabLazy, preloadConfTab } from "../../tabs/ConfTab.lazy";
import { UtilsTab } from "../../tabs/UtilsTab";
import { useScrollKeep } from "../scrollKeep";
import type { TabDef, TabId } from "../types";
import { KitAppBar, KitTtsFlash } from "./AppBar";
import { mergeComposerSlots } from "./composer/mergeSlots";
import { kitPlanComposerSlots } from "./composer/plan";
import { usePlanPlacement } from "./composer/plan/placement";
import { ThemedComposer, useComposerLayout } from "./composer/ThemedComposer";
import { kitToolsMenuSlots } from "./composer/toolsMenu";
import type { ComposerSlots } from "./composer/types";
import { KitFleet } from "./Fleet";
import { KitBackground } from "./KitBackground";
import { KitNavBar } from "./NavBar";
import { appbarShown, type AppbarMode } from "../../store/ui";

// The Kit's DEFAULT root scaffold (D29 §14.4 / D35 §F0) — the standard appbar + scrolling sections +
// floating composer + bottom-nav layout, used by reskin themes (minimal/phosphor) so a theme's `Root` is
// just `<DefaultRoot/>` + a `tokens.css`. It owns the theme-agnostic LAYOUT plumbing: the `.kit` dvh flex
// column, the `.kit-main` positioning context (the composer floats over the scroller so content shows in the
// gaps around it), the generalized lazy-body latch, per-section scroll restoration, lazy-chunk prefetch, and
// the `--appbar-h`/`--composer-h` measurements.
//
// Section bodies (D35's "eager DATA, lazy COMPONENTS" ruling): this module owns the id→body DEFAULT map in
// component space (`DEFAULT_BODIES`) and mounts bodies DATA-DRIVEN from `useSections().sections` — every
// non-hosted section stays keep-mounted and `active`-gated (NEVER conditional-rendered on layout grounds),
// exactly as the old hardwired four were. A theme injects per-theme body OVERRIDES via the `bodies` prop
// (cosmos: `bodies={{ fleet: CosmosFleet }}`), which merges over the defaults — this replaces + generalizes
// the old one-off `Fleet` prop. Curated layout presets recompose WHERE sections live: an on-bar section
// renders in the tab bar, an off-bar one in the floating `<NavMenu/>`, and a HOSTED section (utils→conf)
// renders inside its host body (ConfTab) rather than standalone here (the mount loop skips it).
//
// `appbarMode` is a STRUCTURAL toggle (it changes what's rendered) → an explicit prop the theme passes down.
// It's the GLOBAL `ui.appbarMode` lever (all themes share it); each theme's Root reads it (`useUISlice`) and
// hands it here. Cosmetic settings never reach here — they're token/attr-driven (e.g. minimal's `density`
// → body[data-density]).

interface Props {
  /** The chrome/nav mode (the GLOBAL `ui.appbarMode` lever; the theme reads it + passes it here).
   *  `visible` = appbar + tab bar; `off` = no appbar, tab bar only; `minimal` = no appbar in layout + no
   *  tab bar, navigation via the floating `<NavMenu/>`. */
  appbarMode?: AppbarMode;
  /** Per-theme section-body OVERRIDES (D35 §F0), merged over `DEFAULT_BODIES` by section id — the theme's
   *  bespoke surfaces (cosmos's orbital Fleet, frontier's Agent). Eager data / lazy components: a theme's
   *  bodies always co-load with its lazy Root chunk, so they need no extra code-split. Omitted → all Kit
   *  defaults. Replaces + generalizes the old single-purpose `Fleet` prop. */
  bodies?: Partial<Record<TabId, ComponentType<{ active: boolean }>>>;
  /** Composer ADDONS composed into the variant — the FEATURE axis (D30). Since A4, DefaultRoot OWNS the
   *  inline plan composition and (A6) the tools/skills menu, so a theme passes neither here; this prop is
   *  the theme's OWN addon seam, unused by any theme today. It is MERGED with the Kit's addons (it used to
   *  be dropped whenever the plan was inline — see the merge below), and lands last in the controls row. */
  composerSlots?: ComposerSlots;
  /** The appbar brand-subtitle slot (D30 slot composition), threaded to KitAppBar — the theme's OWN
   *  subtitle (frontier's live rig count, gacha's Japanese line). What a theme fills here shows only when
   *  the owner turns the synced "Bar subtitle" switch on (`ui.appbarSubtitleVisible`, default OFF — the
   *  G6.3 icon + title only ruling is the resting state); the kit's old "dashboard" default is retired for
   *  good, so a theme that omits this renders nothing in EITHER state. */
  brandMeta?: ReactNode;
  /** The appbar brand-MARK slot (D51 §4.1), threaded to KitAppBar — the theme's leading brand mark (vapor's
   *  gradient-ring lozenge). Omitted → the Kit default (its accent dot). */
  brandMark?: ReactNode;
  /** The appbar brand-TEXT slot (D52 / GACHA_PLAN §4.3), threaded to KitAppBar — the theme's own wordmark
   *  (gacha's katakana). Omitted → the Kit default (the literal `ctrl·b`). */
  brandText?: ReactNode;
  /** Whether this theme participates in the SHARED kit background layer (the Kit Art System / Codex A3).
   *  Default TRUE: a theme that has no full-bleed scenery of its own simply gets it. A theme that DOES —
   *  cosmos's starfield, frontier's map, gacha's wallpaper — passes `false`, because full-app scenery is
   *  exclusive by default (§A5): the shared background XOR the theme's own, never both competing.
   *
   *  A PROP rather than a ThemeDef flag or a CSS trick, deliberately: "the theme does not mount the layer"
   *  is the semantic, nothing else computes on the capability, and a registry read from here would risk
   *  the registry→VaporRoot→DefaultRoot import cycle (resolve.ts). A future bespoke Root that does not use
   *  DefaultRoot simply chooses whether to render `<KitBackground/>` itself. */
  kitBackground?: boolean;
}

// The Kit's DEFAULT id→body map (component space — this is the "lazy COMPONENTS" home the pure `tabs.ts`
// deliberately can't hold). fleet→the Kit device list, agent/utils→their tabs, conf→the lazy Conf chunk
// (the mount loop wraps a `lazy`-flagged body in ErrorBoundary+Suspense). A theme's `bodies` prop overrides
// entries by id.
const DEFAULT_BODIES: Record<TabId, ComponentType<{ active: boolean }>> = {
  fleet: KitFleet,
  agent: AgentTab,
  utils: UtilsTab,
  conf: ConfTabLazy,
  // D70 §8.4 — the agents gallery, code-split like Conf (it carries the agent form plus the media
  // library machinery). No idle PREFETCH: Conf's is warmed because it is the section every owner
  // opens; this one is reached deliberately from the nav menu.
  agents: AgentsTabLazy,
};

export function DefaultRoot({
  appbarMode = "visible",
  bodies,
  composerSlots,
  brandMeta,
  brandMark,
  brandText,
  kitBackground = true,
}: Props) {
  // The headless sections controller (D35): the full section list (mount loop), the resolved layout, the
  // on-/off-bar/hosted partitions, the active section, and the shared `navigate` chokepoint. `active` is
  // aliased to `tab` (the body-mount vocabulary); `layout` (the SECTION layout) is aliased to
  // `sectionLayout` to disambiguate from the COMPOSER layout local below.
  const {
    sections,
    bar,
    hosted,
    menu,
    layout: sectionLayout,
    placementKey,
    active: tab,
    navigate,
    hasComposer: showComposer,
  } = useSections();
  // The composer VARIANT is the STYLE axis (D30) — a user-selectable Surface resolved from the active
  // theme's `composer` setting (registry lookup, fallback-safe). Read the layout once here so the
  // `--composer-h` effect can key on it (re-measure on a live swap) and pass it down (one subscription).
  const composerLayout = useComposerLayout();
  // Composer ADDON composition (D30). DefaultRoot owns it for every variant, and it's a real MERGE
  // (`mergeComposerSlots`) since A6 — the old "when inline, a theme-passed `composerSlots` is silently
  // dropped" limitation is GONE. Three contributors, in `controlsStart` order (first = leading edge):
  //   1. the tools/skills MENU (A6) — Kit chrome, always composed, at the controls leading edge;
  //   2. the inline PLAN pill+sheet (A4) — only under the `inline` placement axis; under `pinned` the plan
  //      renders as AgentTab's PinnedPlanPanel instead and contributes nothing here;
  //   3. the theme's own `composerSlots` prop — the theme-addon seam, unused by any theme today.
  // DefaultRoot renders NO pinned panel — that's AgentTab's.
  const planPlacement = usePlanPlacement();
  const composerAddons = useMemo(
    () =>
      mergeComposerSlots(
        kitToolsMenuSlots,
        planPlacement === "inline" ? kitPlanComposerSlots : undefined,
        composerSlots,
      ),
    [planPlacement, composerSlots],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  const bodyMap = { ...DEFAULT_BODIES, ...bodies };

  // Which sections have a tab BUTTON in the DOM right now (D70 §8.4a MED-3): a `role="tabpanel"` may only
  // point `aria-labelledby` at an element that exists, and an off-bar section has no `#tabbtn-<id>` at all
  // (every layout for the agents gallery under its `button` placement; conf in 2-tab; everything under
  // `minimal`). Off-bar panels take a stable `aria-label` from `def.lbl` instead.
  const onBar = new Set(bar.map((d) => d.id));

  // Generalized lazy latch (was the Conf-only flag): a per-section mounted map, seeded so eager sections are
  // always mounted and a `lazy` section is mounted only if it's the active one. It flips strictly false→true
  // the first time a lazy section becomes active, then stays mounted (drafts survive). `sections` is a
  // stable per-theme array (a theme switch remounts this Root, reseeding), so it's a safe dep.
  const [mounted, setMounted] = useState<Partial<Record<TabId, boolean>>>(() => {
    const seed: Partial<Record<TabId, boolean>> = {};
    for (const def of sections) if (def.lazy) seed[def.id] = def.id === tab;
    return seed;
  });
  useEffect(() => {
    const def = sections.find((d) => d.id === tab);
    if (def?.lazy && !mounted[tab]) setMounted((prev) => ({ ...prev, [tab]: true }));
  }, [tab, sections, mounted]);

  // Layout coercion (D35): if the active section is HOSTED under the resolved layout (boot with a stale
  // persisted tab, or a live layout switch while a hosted section is active, or any programmatic navigate
  // that bypassed useSections), route through `navigate` — the same chokepoint that lands on the host AND
  // arms the scroll-to-group handoff. Keyed on [tab, sectionLayout, placementKey] (the identity-stable
  // inputs); `hosted`/`navigate` are fresh each render but only ACT when `hosted[tab]` is set, so re-running
  // is harmless. `placementKey` is the D70 §8.4a addition: a satellite's placement can flip to `conf` while
  // the owner is STANDING on it under an unchanged preset id, and that flip must land in Conf + scroll to
  // the group exactly as a layout switch does (relocation resets local state — the D35 ratified trade).
  useEffect(() => {
    if (hosted[tab]) navigate(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sectionLayout, placementKey]);

  // Keep the scroller's position across a theme-Root remount (a skin pick rebuilds this whole tree —
  // scrollKeep restores the old Root's position in the mount layout-effect, before the VT snapshot).
  const restoredScrollRef = useScrollKeep(scrollRef);

  // PER-SECTION SCROLL RESTORATION (owner ask, 2026-08-06: "switching to settings always jumps to the top").
  // Every section body shares ONE scroller (`#app-scroll`) — a section switch swaps which body is visible
  // underneath it, so a position is only meaningful together with the section it was taken in. This ref is
  // that map: the ScrollRestoration/bfcache pattern, at the reset effect's existing chokepoint rather than
  // beside it.
  //
  // Fed by a PASSIVE listener rather than captured at switch time, deliberately: by the time an effect runs
  // the DOM has already swapped bodies, so the scroller's live `scrollTop` no longer belongs to the section
  // being left (and may already have been CLAMPED by the browser to a shorter body). The listener records
  // continuously, so the last value written for a section is always one taken while that section was up.
  //
  // A REF, not a module slot and not persistence: a pixel offset is meaningless on another device or in a
  // later session, and it is equally meaningless against re-shaped content — so the map is scoped to this
  // Root instance, which means a THEME switch drops it for free (a different skin lays every body out
  // differently). `useScrollKeep` still carries the ACTIVE section's position across that switch, which is
  // the Gate-B behaviour and is unchanged here.
  const tabScrollRef = useRef<Partial<Record<TabId, number>>>({});

  // A LAYOUT switch (D35 presets) re-shapes the page under the same section ids — utils becomes a group
  // INSIDE Conf, sections leave the bar for the menu — so every stored offset is an offset into a document
  // that no longer exists. Dropping the map is the honest answer (the next switch lands at the top, the
  // pre-restoration behaviour); keeping it would scroll to an arbitrary point of the new shape. Declared
  // BEFORE the restore effect so that on a commit which changes both, the clear is what the restore sees.
  //
  // A SATELLITE PLACEMENT flip does the same reshaping under an UNCHANGED preset id (D70 §8.4a MED-1) — the
  // gallery becomes a group inside Conf, which lengthens Conf's document and empties the gallery's own — so
  // the clear keys on the placement too. `placementKey` is a stable SEMANTIC string ("agents:conf"), never a
  // freshly-allocated object: an object dep would clear the map on every render and silently retire the
  // whole per-section restoration.
  useEffect(() => {
    tabScrollRef.current = {};
  }, [sectionLayout, placementKey]);

  // Restore the content pane to this section's last position on a section switch — 0 for a section not yet
  // visited, which is the previous reset-to-top behaviour and what a fresh boot always gets. A stored offset
  // taller than the new content needs no special case: `scrollTo` clamps to the scroller's own range.
  //
  // The three SKIPS are the reset effect's, unchanged in meaning:
  //   · Agent scrolls itself (ChatThread sticks its thread to the bottom) — so it is neither restored NOR
  //     recorded; a value nothing reads would be dead data.
  //   · a pending scroll-to-group handoff WINS (a coerced hosted navigate): this parent effect runs AFTER
  //     the host body's child effect, so without the skip it would cancel the group scroll. Read via the
  //     getState peek, not a subscription.
  //   · the ONE mount-run that follows a scrollKeep restore (a theme switch, not a section switch) — the
  //     position is already correct in the DOM. The listener below still attaches, so the restored value
  //     lands in the fresh map as soon as the scroller moves.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restoredScrollRef.current) {
      restoredScrollRef.current = false;
    } else if (tab !== "agent" && !getGroupScrollTarget()) {
      el.scrollTo(0, tabScrollRef.current[tab] ?? 0);
    }
    if (tab === "agent") return;
    // Re-attached per section so the handler can never attribute a position to the wrong one, and reading
    // `scrollTop` live (not a captured value) so the entry it writes is whatever the scroller actually
    // holds at that moment.
    const onScroll = () => {
      tabScrollRef.current[tab] = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
    // `restoredScrollRef` is a stable ref (lint can't see through the custom hook) — a dep for hygiene only.
  }, [tab, restoredScrollRef]);

  // Expose the sticky appbar height as `--appbar-h` so the Agent plan tab pins just below it. When the
  // appbar is hidden there's no `.kit-appbar` node → pin content at the top (0), not a stale height.
  useEffect(() => {
    const bar = scrollRef.current?.querySelector<HTMLElement>(".kit-appbar");
    if (!bar) {
      document.documentElement.style.setProperty("--appbar-h", "0px");
      return;
    }
    const set = () =>
      document.documentElement.style.setProperty("--appbar-h", `${bar.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [appbarMode]);

  // Expose the CONTENT PANE's height as `--kit-pane-h` — the third measured shell box, published exactly
  // like the two around it and for the same class of reason: a layer that must fill the visible pane has
  // no other way to know how tall it is. `--app-h` is the visual viewport (it includes the nav bar, which
  // is a flex sibling of this box), and the nav's height is a function of the bar mode, the safe-area
  // inset and the tab count — so "app height minus a constant" is not a thing that can be written down.
  // The one consumer today is the `full` agent backdrop (D70 §8.3a): an absolutely-positioned descendant
  // contributes to the SCROLLER's scrollable overflow, so a layer sized to anything bigger than the pane
  // makes an empty agent tab scrollable by the difference (measured: 104px = the appbar + the tab bar).
  // `.kit-main` rather than `.kit-scroll`, which is that box's own `inset: 0` child — same number, and the
  // observed node then does not change identity with the scroller.
  useEffect(() => {
    const pane = mainRef.current;
    if (!pane) return;
    const set = () =>
      document.documentElement.style.setProperty("--kit-pane-h", `${pane.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(pane);
    return () => ro.disconnect();
  }, []);

  // The composer floats OVER the scrolling content (so the content shows in the gaps around it). Measure
  // its height → `--composer-h` so the scroller pads its bottom enough for the last content to scroll clear
  // (the textarea auto-grows, so a ResizeObserver keeps the padding in sync). 0 when no composer.
  useEffect(() => {
    const root = document.documentElement;
    const comp = showComposer ? mainRef.current?.querySelector<HTMLElement>(".kit-composer") : null;
    if (!comp) {
      root.style.setProperty("--composer-h", "0px");
      return;
    }
    const set = () => root.style.setProperty("--composer-h", `${comp.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(comp);
    return () => ro.disconnect();
    // `showComposer` fully captures composer mount/unmount; the node is identical across composer-bearing
    // sections (fleet↔agent), so it needn't re-run on `tab`. `composerLayout` IS a dep (EDGE #10): a live
    // variant swap remounts the composer node, so the observer must re-attach to the new node.
  }, [showComposer, composerLayout]);

  // Warm the Conf chunk after first paint so the first Conf click is typically zero-wait. Conf-specific:
  // Conf is the one lazy section, and `TabDef` (pure data) holds no preload thunk — generalizing to any
  // lazy def would need a per-id thunk registry (D35's deferred "option B"), so this stays targeted.
  useEffect(() => {
    const cancel = prefetchOnIdle(preloadConfTab);
    return cancel;
  }, []);

  const prefetch = useCallback((t: string): void => {
    if (t === "conf") void preloadConfTab();
  }, []);

  // No `.no-composer` padding hook here: the Kit shell is an in-flow flex column, so a hidden composer is
  // simply an absent flex child (the column reflows) — no bottom-padding bookkeeping needed (that hook is
  // vapor-only, in VaporRoot).

  return (
    <div className="kit">
      {/* The shared owner background (the Kit Art System), FIRST so it sits behind the shell. It renders
          nothing unless this theme participates AND the owner has both dropped an image in and left the
          Appearance switch on — so an empty folder leaves the shell byte-identical. */}
      {kitBackground && <KitBackground />}
      {/* `.kit-main` is the positioning context: the scroller fills it, the composer floats over it (so
          the content scrolls behind the composer and shows in the gaps around it). The nav bar stays an
          in-flow bar below. Per-tab CSS hooks: `body[data-tab]` (ui.ts) — cosmos/frontier tune the Fleet
          edge-scrims through it. */}
      <div
        className={
          "kit-main" +
          (showComposer ? " has-composer" : "") +
          // Clear (transparent) appbar: mark `.kit-main` so kit.css can null its `::before` top scrim — that
          // flat `--bg` haze right below the null-painted bar otherwise reads as a shadow band (item 6).
          (appbarMode === "transparent" ? " appbar-clear" : "")
        }
        ref={mainRef}
      >
        <div className="kit-scroll" id="app-scroll" ref={scrollRef}>
          {appbarShown(appbarMode) && (
            <KitAppBar
              brandMeta={brandMeta}
              brandMark={brandMark}
              brandText={brandText}
              appbarMode={appbarMode}
            />
          )}
          {/* Data-driven body mount (D35): every non-hosted section stays keep-mounted + `active`-gated;
              hosted sections (utils→conf) render inside their host body, not here. A `lazy` body mounts only
              after first activation (the latch) and wraps in ErrorBoundary+Suspense. Index in the FULL list
              drives the fallback's `.sec` number. */}
          {sections.map((def, index) => {
            if (def.id in hosted) return null; // hosted → rendered inside its host (ConfTab), not standalone
            const Body = bodyMap[def.id];
            if (!Body) return null; // defensive: a section with no registered body (future custom id)
            const active = tab === def.id;
            if (def.lazy) {
              if (!mounted[def.id]) return null; // not yet latched
              return (
                <ErrorBoundary
                  key={def.id}
                  fallback={(e, r) => lazyErrorFallback(def, index, onBar.has(def.id), e, r)}
                >
                  <Suspense
                    fallback={<LazyLoading def={def} index={index} onBar={onBar.has(def.id)} />}
                  >
                    <Body active={active} />
                  </Suspense>
                </ErrorBoundary>
              );
            }
            return <Body key={def.id} active={active} />;
          })}
        </div>
        <MiniPlayer />
        {showComposer && <ThemedComposer layout={composerLayout} {...composerAddons} />}
      </div>
      {/* Nav (D35 §F0 + the 2026-07-12 docking rule): the in-flow tab bar shows whenever there's an
          appbar-bearing layout (visible/transparent/off) — everything but `minimal`. The nav menu DOCKS to the
          chrome that exists — under `visible`/`transparent` a bar is present (`appbarShown`), so KitAppBar
          renders the docked trailing action and the FLOATING launcher mounts only when there's NO bar to dock
          into (`off`/`minimal`) and a section is off-bar-and-unhosted. In 2-tab visible/transparent the docked
          button + tab bar coexist; in `minimal` the bar is gone and the menu carries all nav. */}
      {appbarMode !== "minimal" && <KitNavBar onPrefetch={prefetch} />}
      {!appbarShown(appbarMode) && menu.length > 0 && <NavMenu />}
      {/* Nav-home quick-jump (F0 follow-up): a top-LEFT companion to the floating orbit menu. It OWNS its
          visibility (minimal-only + self-hides on the primary section) given the chrome mode, so it mounts
          unconditionally here — the single source for "when is the home button shown". */}
      <NavHome appbarMode={appbarMode} />
      {/* The auto-TTS echo mounts UNCONDITIONALLY (not inside KitAppBar): the Conf tab's TTS switch must
          flash it even under `off`/`minimal` where no bar renders. Anchored via --appbar-h (0 when the
          bar is hidden → it sits at the viewport top-right). */}
      <KitTtsFlash />
      <Toasts />
      <ConfirmDialog />
      <PromptModal />
      <SwUpdatePrompt />
    </div>
  );
}

// Suspense fallback for a lazy section's chunk — mirrors the real section header (`.sec` num + label) so
// there's no layout shift. Parameterized from the def (label = `def.lbl`) + its index in the full section
// list (the `.sec` number), keeping the exact DOM shape of the old Conf-specific placeholder.
//
// `onBar` decides the panel's LABELLING (D70 §8.4a MED-3): `aria-labelledby` names the tab button, so it is
// only correct while that button exists — an off-bar section's panel would otherwise point at nothing at
// all. The label text is identical either way (`def.lbl` is what the button renders), so nothing changes
// for a screen reader beyond the reference resolving.
function LazyLoading({ def, index, onBar }: { def: TabDef; index: number; onBar: boolean }) {
  const num = String(index + 1).padStart(2, "0");
  return (
    <div
      className="tab active"
      id={`tab-${def.id}`}
      data-screen-label={`${num} ${def.lbl}`}
      role="tabpanel"
      aria-labelledby={onBar ? `tabbtn-${def.id}` : undefined}
      aria-label={onBar ? undefined : def.lbl}
    >
      <div className="sec">
        <span className="num">{num}</span>
        <b>{def.lbl}</b>
        <span className="right">// loading…</span>
      </div>
    </div>
  );
}

// Error fallback for a lazy section chunk (most common: a stale chunk URL after a deploy → 404). React.lazy
// caches its rejection, so only a reload recovers — the button does exactly that. Parameterized like
// `LazyLoading`.
function lazyErrorFallback(
  def: TabDef,
  index: number,
  onBar: boolean,
  error: Error,
  reload: () => void,
) {
  const num = String(index + 1).padStart(2, "0");
  return (
    <div
      className="tab active"
      id={`tab-${def.id}`}
      data-screen-label={`${num} ${def.lbl}`}
      role="tabpanel"
      aria-labelledby={onBar ? `tabbtn-${def.id}` : undefined}
      aria-label={onBar ? undefined : def.lbl}
    >
      <div className="sec">
        <span className="num">{num}</span>
        <b>{def.lbl}</b>
        <span className="right">// failed to load</span>
      </div>
      <div className="no-svc" style={{ padding: "16px 14px" }}>
        // {error.message || "unknown error"}
        <br />
        <button className="conf-save" style={{ marginTop: 12 }} onClick={reload}>
          Reload page
        </button>
      </div>
    </div>
  );
}
