import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { BottomSheet, type SheetDetent } from "../../components/BottomSheet";
import { useFleet } from "../../hooks/useFleet";
import {
  runViewTransition,
  skipActiveViewTransition,
  viewTransitionsActive,
} from "../../lib/viewTransition";
import { useGachaReelRunning } from "../../store/gachaReel";
import { setPlanSheetOpen } from "../../store/planSheet";
import { getSheetSnap, setSheetSnap } from "../../store/sheetSnap";
import { useKitBackgroundArt } from "../../theme-engine/kit/ownerArt";
import { useThemeSetting } from "../../theme-engine/settings";
import type { Host } from "../../types";
import { GachaArtShowcase } from "./GachaArtShowcase";
import { GachaBanner, type BannerSlide } from "./GachaBanner";
import { GachaHostDetail } from "./GachaHostDetail";
import { GachaStarDefs } from "./GachaStar";
import { HERO_KEY, HOST_KEY_PREFIX, SCENE_KEY_PREFIX } from "./carousel";
import {
  CLOSE_DOSSIER_LABEL,
  cardShapes,
  counterText,
  pickAnnounce,
  pickRibbonHost,
  pityText,
  queryResolved,
  rateText,
  resolvePick,
  tapAction,
  tapGrammarFor,
  toBannerMode,
  wakeAnnounce,
  type FleetTap,
} from "./fleet";
import { fleetSurface } from "./fleetSurface";
import { artForHost, bannerScenes, wideArtForHost } from "./roster";
import { MAX_STARS, starsFor, toStarMode } from "./stars";
import { useGachaRoster } from "./useGachaRoster";

// The gacha bespoke FLEET (D52 / GACHA_PLAN §6) — the prototype's capsule-arcade fleet screen, injected into
// DefaultRoot's `fleet` body slot by GachaRoot (the cosmos/frontier/vapor precedent). A PURE CONSUMER of the
// headless `useFleet` controller: the same hosts/services data every other Fleet renders, presented as a
// pickup banner over a capsule track.
//
// The body owns the DERIVATIONS the two surfaces must agree on — the roster assignment (§5.3's one shared
// resolver), the star mode, the online count — and hands each surface the resolved values. That is what keeps
// a host's promo slide and its capsule card showing the same character with the same rarity.
//
// Since GACHA_PLAN §12.6 E0 the TRACK BODY is a Surface variant (`fleetSurface.ts` → `GachaTrack` today,
// poster/cover at E1/E2) and this component is everything AROUND it: the derivations above, the dossier, the
// View-Transition morph machinery, the art showcase, the banner and the one "open this machine" seam. That
// boundary is the §12.6 sizing rule — a layout replaces only what it draws, so the three can never disagree
// about the fleet, and a layout swap re-renders the track while the sheet it may have open stands.

/** The dossier sheet's persisted detent — a stable key into the shared, theme-agnostic `sheetSnap` store,
 *  with a module-level setter so `onSnapChange` keeps a constant identity per the prop's contract (the
 *  cosmos/frontier precedent). */
const SHEET_KEY = "gacha-host-detail";
const persistSheetSnap = (snap: SheetDetent) => setSheetSnap(SHEET_KEY, snap);

/** The kit's ONE content pane, named here for the reason `GachaAgent` and `ChatThread` name it: a body
 *  reaches the shell's scroller by id, and every reader must agree on which pane that is. */
const SCROLLER_ID = "app-scroll";

export function GachaFleet({ active }: { active: boolean }) {
  const {
    hosts,
    svcByHost,
    busy,
    run,
    hasData,
    isLoading,
    error,
    svcHasData,
    svcLoading,
    svcError,
  } = useFleet();
  const starMode = toStarMode(useThemeSetting<string>("gacha", "starMode"));
  // THE PICKUP BANNER's FORM (§12.6 ruling 6). Read ONCE, here, for the same reason `starMode` is: the
  // banner is built in this body and handed to whichever layout is drawing (ruling 7's slot), so this is
  // the one place that can decide whether it exists at all. `on`/`minimal` are a CSS difference the Root's
  // `data-gc-banner` stamp carries; `off` is this component's, and it is a real UNMOUNT rather than a
  // hidden node — GachaBanner's autoplay loop has no hidden-gate, so a CSS hide would leave a carousel
  // ticking, re-rendering and announcing behind `display: none`.
  const bannerMode = toBannerMode(useThemeSetting<string>("gacha", "banner"));
  // The roster the theme resolves against (§5.2's read path): the owner's media folders when they hold
  // anything, the bundled set otherwise. One query, shared with the Root/reel/Agent by its key.
  const roster = useGachaRoster();
  // The SHARED kit background — the same value the Root feeds the fleet backdrop's ladder. It reaches the
  // carousel for ONE case now (owner ruling 2026-08-26, "W5"): the first slide falls back to the backdrop's
  // own resolution when the banner pool is empty, and that resolution includes the kit rung. In every other
  // state the two surfaces are independent — the backdrop moves with a kit drop and the carousel does not,
  // which REVERSES §5.3's old "both must show one picture" reading of this screen.
  // Its own query is the kit one, deduped by TanStack against every other kit-art consumer.
  const kitBackground = useKitBackgroundArt();

  const onlineCount = hosts.filter((h) => h.status?.online).length;
  // The pity pill's input (owner 2026-08-06): ONLINE SERVICES fleet-wide, the service-level twin of the
  // host count above — same live map the dossier rows read, so the two can never disagree.
  //
  // Summed THROUGH THE CURRENT HOSTS, not over the whole map (Codex G6.4 MED-2): the two queries poll
  // independently, so between a machine leaving the fleet and the next services answer its rows are still
  // in the cache — and a fleet-wide count that walked every map value would keep counting services on a
  // host the track no longer shows.
  const onlineServices = hosts.reduce(
    (n, h) => n + (svcByHost.get(h.id) ?? []).filter((s) => s.status?.online).length,
    0,
  );
  // §6.3's loading semantics, shared by the rate pill and (G1's track) the counter: an unresolved fleet
  // reads as a held value, never as a confident "0".
  const resolved = queryResolved(isLoading, error, hasData);
  // …and the pity pill needs BOTH pollers to have answered (Codex G6.4 MED-2). Its number is a sum over
  // hosts × their services, so either query still in flight makes a printed `0` a claim the app cannot
  // back — and the hosts one typically lands first, which is exactly when the pill was asserting it.
  const svcResolved = resolved && queryResolved(svcLoading, svcError, svcHasData);

  // The card geometry (the main seat's Q8.10 ruling): host[0] featured, the rest in 3/4 pairs, a trailing
  // odd host wide. A pure function of the COUNT, so a poll can never re-shuffle the track's shape.
  const shapes = cardShapes(hosts.length);

  // THE `NEW` RIBBON DEMO (G6 item iv). One machine wears it; the pick is made once and STICKS until that
  // machine leaves the fleet. State + an effect rather than a render-time roll, for two reasons: rendering
  // is not allowed to be random (a re-render would move the ribbon, and it would differ between the two
  // passes of StrictMode), and "sticks until the host is gone" is exactly the shape of a reducer over the
  // live id list. `pickRibbonHost` owns the rule and is unit-tested with an injected `rand`; the effect is
  // a no-op on every poll that keeps the machine, so this settles instead of looping.
  //
  // The pick is DRAWN OUTSIDE the state updater and remembered in a ref (Codex G6 F5). A `setState(prev =>
  // …)` updater must be a PURE function of `prev` — React may call it more than once for the same update
  // (StrictMode calls it twice by design, and a re-render can replay it) — and `pickRibbonHost` rolls a
  // random number when it has to choose, so as an updater it could roll a DIFFERENT machine per call. The
  // ref makes the effect itself the idempotent thing instead: the second StrictMode run reads back the
  // pick the first one stored, sees no change, and doesn't even set state.
  const [ribbonHost, setRibbonHost] = useState<string | null>(null);
  const ribbonRef = useRef<string | null>(null);
  useEffect(() => {
    const next = pickRibbonHost(
      hosts.map((h) => h.id),
      ribbonRef.current,
    );
    if (next !== ribbonRef.current) {
      ribbonRef.current = next;
      setRibbonHost(next);
    }
  }, [hosts]);

  // ── THE UNIT DOSSIER (G2). The seam the capsule cards and the promo slides have shared since G1 now has
  //    its destination: one selected host id, one sheet. COMPONENT state rather than a store (the frontier/
  //    cosmos selection stores exist because their maps and grids select each other two ways — here nothing
  //    outside this body reads the selection, and a store would be state living further from its only user).
  const [selected, setSelected] = useState<string | null>(null);
  // ── SELECT-THEN-ACT (§12.6 rulings 2-4) — the ALT layouts' selection, a SIBLING of the dossier's own.
  //    Component state for the same reason `selected` above is: nothing outside this body reads it, and it
  //    is emphatically NOT `store/fleet.ts#featured` (an INDEX, auto-cycled every 6 s with an 8 s hold —
  //    a poster selection that silently jumped to another machine after eight seconds, skipping every
  //    sleeping one, would be wrong on both counts).
  //
  //    NULL IS "the owner has not picked yet", never "nothing is selected": the VIEW resolves the value
  //    (`resolvedPick` below) and that resolution is never written back, so the first machine is selected
  //    at boot without a state write.
  const [pickedId, setPickedId] = useState<string | null>(null);
  // Which machines have a WAKE REQUEST in flight. Distinct from `busy`, which is per-HOST and cannot say
  // WHICH action (R25 §Q1b) — this is the single fact that licenses a `WAKING` chip, and a machine leaves
  // it the moment its request settles. The card then reads the SERVER's word again: only a hosts poll may
  // flip it online (ruling 4 — `useActions` gives wake no optimism by design, and this adds none).
  //
  // A SET, not one slot (Codex E1 LOW-4). Two wakes can genuinely overlap — wake A, and while its request
  // is still pending select and wake B — and a single slot made A's chip drop to SLEEPING the instant B
  // was dispatched, which is a false negative about a request that is still in the air.
  const [waking, setWaking] = useState<ReadonlySet<string>>(() => new Set());
  // The fleet's ONE live region (ruling 3). gacha had none; select-then-act needs one because its only
  // feedback is a transform and a data block below the fold.
  //
  // The SEQUENCE is what makes a repeat announceable (Codex E1 LOW-5): setting the same string twice is a
  // React bail-out — no re-render, no DOM mutation, and a polite region only speaks when its content
  // CHANGES. So a retry of the same failed wake was silent. The counter rides in the same state object so
  // text and seq can never disagree, and the region renders it as a keyed child (below).
  const [live, setLive] = useState<{ text: string; seq: number }>({ text: "", seq: 0 });
  const announce = useCallback(
    (text: string) => setLive((prev) => ({ text, seq: prev.seq + 1 })),
    [],
  );
  // Whether THIS open is being carried by the M3 morph — handed to the sheet as `enterInstant`. A morph
  // needs the dossier mounted AT REST inside the update callback (see BottomSheet's prop doc); every other
  // open keeps the primitive's slide-up.
  const [morphOpen, setMorphOpen] = useState(false);
  // Whether the sheet is OPEN, as a ref — for `openHostDossier`, which runs from a click handler and has
  // to tell an open dossier apart from one that is merely still on screen easing out (the two need
  // different `dossier-rar` naming; see the lingering-badge note in that callback). It is a ref and not
  // the `sheetOpen` value because putting that in the callback's deps would hand every capsule card and
  // promo slide a fresh handler identity on every open and close, for one boolean read; the layout effect
  // that stamps `body[data-sheet]` writes it, so it is current before any click can land.
  const sheetOpenRef = useRef(false);
  // The reel owns the screen while it sweeps (§6.4/F3): the banner already refuses input, and the capsule
  // track must too — a dossier opening behind five full-width slats is a tap the user never sees land.
  const reeling = useGachaReelRunning();
  // THE OPEN GENERATION (Codex G2 HIGH). `startViewTransition`'s update callback is ASYNC by spec — it runs
  // at the next rendering opportunity, and a SECOND call skips the first, so callbacks can land out of order
  // or after the intent that queued them is void (a rapid A→B tap, a close, the tab going away, unmount).
  // Every intent takes a ticket; a morph callback applies its selection only while it still holds the
  // current one. It ALWAYS un-names its own portrait either way — a stray `view-transition-name` would
  // dup-skip the next transition entirely (the viewTransition.ts warning).
  const gen = useRef(0);
  // THE CAPSULE→DOSSIER IMAGE MORPH (M3's image half, owner-pulled from G4 at the G2 eyeball). The tapped
  // portrait is view-transition-named for THIS transition only: stamped BEFORE `startViewTransition` (the
  // OLD capture happens after the call, at the next rendering step, and must see it) and cleared INSIDE the
  // update callback — after the old capture, before the new one — so the new state has exactly one
  // `capsule-shell`, the dossier avatar. One named node per capture is the whole contract: two would make
  // the browser skip the transition outright (the viewTransition.ts warning).
  //
  // A dossier that is ALREADY on screen — a SWAP, or one still easing out from a close — carries that name
  // from the CSS rule the `detail` stamp switches on, so it would be the second node in the old capture.
  // Suppressing it inline for the capture window (and restoring it in the callback, where it is the
  // destination) is what lets a swap morph too: old = the tapped card alone, new = the avatar alone.
  //
  // Opens that stay PLAIN: a promo slide (no portrait to morph from) and anything on an engine/motion
  // setting where no transition will run at all — there the sheet's own slide-up is the entrance.
  // The morph's DOM PREPARATION — the stamped card + the suppressed avatar — has exactly ONE owner
  // (Codex M3-confirm M1). A stale callback is GUARANTEED to run even after its transition is skipped,
  // and unguarded it would strip the styles a NEWER intent just re-applied to the very same nodes (taps
  // can reuse both the avatar and the card). So: every new intent cleans the pending prep synchronously
  // and takes ownership; a callback restores only while it still holds it.
  const prep = useRef<{
    card: HTMLElement;
    avatar: HTMLElement | null;
    badge: HTMLElement | null;
  } | null>(null);
  const cleanMorphPrep = useCallback(() => {
    const p = prep.current;
    if (!p) return;
    prep.current = null;
    p.card.style.removeProperty("view-transition-name");
    p.avatar?.style.removeProperty("view-transition-name");
    p.badge?.style.removeProperty("view-transition-name");
    // …and end the superseded transition outright: a PLAIN open starts no transition of its own, so
    // without this the old one would capture the plainly-opened dossier as its morph destination.
    // SCOPED to the kind this body starts here (G4 S1): the prep it is cleaning belongs to a `detail`
    // morph, and nothing else's flight is this function's business.
    skipActiveViewTransition("detail");
  }, []);

  // ── THE ART SHOWCASE (owner request 2026-08-02) — the dossier PORTRAIT, full screen. Two pieces of
  //    state, held here because this is where the sheet, the morph machinery and the tap-outside listener
  //    already live: WHETHER the overlay is up, and WHICH entrance carried it (`morph` = a View Transition
  //    is flying the portrait; `fade` = the plain path, where the CSS opacity entrance stands in). Null is
  //    closed — one variable, so "open" and "how it opened" can never disagree.
  const [showArt, setShowArt] = useState<"morph" | "fade" | null>(null);
  // THE SHOWCASE GENERATION — the dossier's `gen` discipline above, applied to this layer (Codex G2-close
  // M1). Its two transitions carry the same async hazard: the update callback runs at the next rendering
  // opportunity, so by the time it lands the intent that queued it may be void — the dossier closed, its
  // host left the fleet, the tab changed, another machine was opened. Unguarded, a stale OPEN callback
  // would suppress an avatar React has since re-used for a DIFFERENT dossier (and set the overlay back up
  // over it), and a stale CLOSE callback would dismiss a NEWER showcase. Every intent takes a ticket and
  // applies nothing without it.
  const artGen = useRef(0);
  // The showcase's OWN inline suppression of the dossier avatar, with its own single owner — the mirror of
  // `prep` above (same prep-OBJECT identity, so a stale callback can tell "mine" from "the one a newer
  // intent just applied"), and deliberately not folded into it: the two suppress the same node for
  // opposite reasons. A morph hides the avatar for ONE capture; the showcase hides it for as long as the
  // art is up, because the full-screen image is carrying the `capsule-shell` name in the meantime. A stray
  // suppression left behind would give the NEXT dossier morph no destination at all, so every path that
  // can close the art — the overlay's own dismissals, a dossier close, a host leaving the fleet, leaving
  // the tab, an open of another dossier, unmount — goes through `releaseArtName` under that identity rule.
  const artPrep = useRef<{ avatar: HTMLElement } | null>(null);
  const releaseArtName = useCallback(() => {
    const p = artPrep.current;
    if (!p) return;
    artPrep.current = null;
    p.avatar.style.removeProperty("view-transition-name");
  }, []);
  // Whether the NEXT unmount of the overlay should hand focus back to the portrait (M2). Set only by the
  // art's own dismissal — where the dossier demonstrably stays — and cleared by every teardown, because a
  // dossier on its way out keeps its content mounted for the sheet's 420 ms exit slide: the portrait is
  // still findable there, and focusing it would park focus on a node about to be detached (from which it
  // silently falls to <body>, defeating the BottomSheet's own claimed-focus restore). A ref rather than a
  // prop, because the overlay's cleanup closes over the LAST RENDER's props and must read this live.
  const artReturnFocus = useRef(false);
  /** Take the art down with NO transition of its own — the teardown paths, where the dossier itself is
   *  going away and there is nothing left to morph back into. It also ENDS the transition this body still
   *  owns (L1): unmounting the overlay stops the LIVE DOM, but a settling reverse morph keeps painting its
   *  `::view-transition-*` pseudos over the whole page for the rest of its flight — including over a tab
   *  reel that started in the same commit.
   *
   *  "OWNS" is now literal (G4 S1, the §10.1 VT-probe finding). This runs on the tab-leave teardown, and
   *  the commit that leaves the tab is the SAME one the navigation transition just started — so an
   *  unscoped skip ended `tab` instead, killing M2 outright every time the user left the fleet. Both of
   *  this body's own kinds are named because both can be the one in flight here: `showcase` when the art's
   *  own morph is still settling, `detail` when a capsule morph's callback has already run (its prep
   *  cleared, so `cleanMorphPrep` above no longer reaches it). */
  const dropShowcase = useCallback(() => {
    artGen.current++; // any callback still in flight is now void
    artReturnFocus.current = false;
    releaseArtName();
    setShowArt(null);
    skipActiveViewTransition("detail", "showcase");
  }, [releaseArtName]);

  const openHostDossier = useCallback(
    (hostId: string, morphImg?: HTMLElement | null) => {
      if (reeling) return;
      // Every open takes a ticket, morph or not: a plain open must also void a morph still in flight.
      const mine = ++gen.current;
      cleanMorphPrep();
      // …and it takes the art down with it. Unreachable by pointer today (the showcase covers the cards
      // it would be tapped on), but this is the line that keeps the avatar's suppression single-owned:
      // without it a capsule morph would strip a name the showcase is still relying on.
      dropShowcase();
      if (!morphImg || !viewTransitionsActive()) {
        setMorphOpen(false);
        setSelected(hostId);
        return;
      }
      const avatar = document.querySelector<HTMLElement>(".gc-dossier .avatar");
      avatar?.style.setProperty("view-transition-name", "none");
      // THE LINGERING BADGE (Codex G6.4 review, MED). The rarity lozenge is named by CSS for every
      // `detail` flight (gacha.css), which is right for the two shapes that block was written for: a
      // fresh open (no old copy) and a SWAP (both captures hold it at the SAME rect, so mirroring the
      // hold keeps it lit). A REOPEN DURING THE EXIT is a third shape: the closing sheet stays mounted
      // for its 420 ms slide, so its badge is still in the old capture — but DISPLACED down the screen
      // with the sheet, and `gacha-rar-out` keeps it opaque for 73% of 560 ms. The group would fly that
      // stale badge across the page toward the new one, ahead of the portrait it belongs to.
      // So the old copy is un-named for exactly that case, on the same ownership terms as the avatar
      // above: `sheetOpen` false + a dossier still in the DOM IS the lingering-exit state (a swap has it
      // true and keeps the mirrored hold it was designed for).
      const badge = sheetOpenRef.current
        ? null
        : document.querySelector<HTMLElement>(".gc-dossier .art-rar");
      badge?.style.setProperty("view-transition-name", "none");
      morphImg.style.setProperty("view-transition-name", "capsule-shell");
      const myPrep = { card: morphImg, avatar, badge };
      prep.current = myPrep;
      runViewTransition(() => {
        // Restore ONLY while still the owner — a newer intent may have cleaned and RE-STAMPED these
        // same nodes, and the stale callback must not undo its work (M1). Ownership lost ⇒ the newer
        // intent already restored (or re-claimed) them; nothing here is leaked.
        if (prep.current === myPrep) {
          prep.current = null;
          morphImg.style.removeProperty("view-transition-name");
          avatar?.style.removeProperty("view-transition-name");
          // …and the badge gets its CSS name back for the NEW capture, where it is the destination the
          // held-back `gacha-rar-in` fades up (React re-uses this node for the incoming dossier).
          badge?.style.removeProperty("view-transition-name");
        }
        if (gen.current !== mine) return; // a newer intent (or a close / tab change) owns the dossier now
        setMorphOpen(true);
        setSelected(hostId);
      }, "detail");
    },
    [reeling, cleanMorphPrep, dropShowcase],
  );
  // Drop a selection whose machine has left the fleet (a config edit, a removal) so the sheet can never
  // reference a gone host — the cosmos/frontier precedent.
  //
  // For the ALT layouts' pick this effect only NORMALIZES the stored value (Codex E1 LOW-3): the render
  // path resolves a vanished id for itself, synchronously, so there is never a committed frame with no
  // selection. Before that split, `pickedId ?? hosts[0]?.id` let a non-null-but-gone id win until this
  // passive effect ran — one commit with no `aria-pressed` slice, no registry, and a tap in that window
  // selecting instead of acting. The effect stays because state that names a machine the fleet no longer
  // has is still wrong to keep. A wake whose machine went away is pruned on the same terms: its request
  // will still settle, but there is nothing left to light.
  useEffect(() => {
    if (selected && !hosts.some((h) => h.id === selected)) {
      gen.current++;
      cleanMorphPrep();
      dropShowcase();
      setMorphOpen(false);
      setSelected(null);
    }
    // COMPARE-AND-CLEAR, through a FUNCTIONAL setter (Codex E2-confirm M1). This effect is passive, so it
    // runs one commit after the poll that changed `hosts` — and a cover's deferred promote can commit a
    // NEW selection inside that window. Reading `pickedId` out of this closure and clearing
    // unconditionally then threw the accepted value away: the seam had already returned `true`, so the
    // ceremony went on to announce a machine the state no longer held. The updater reads what the state
    // ACTUALLY holds now and clears only if THAT is the gone one, so a newer commit survives untouched.
    setPickedId((prev) => (prev !== null && !hosts.some((h) => h.id === prev) ? null : prev));
    setWaking((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((id) => hosts.some((h) => h.id === id)));
      return next.size === prev.size ? prev : next; // identity-stable when nothing was pruned
    });
  }, [selected, pickedId, hosts, cleanMorphPrep, dropShowcase]);

  // THE RESOLVED PICK — the one value both the render and the router read (ruling 2, hardened at the E1
  // review). "The stored pick if the fleet still has it, else the first machine": derived here, in render,
  // so no committed frame can disagree with it and `tapAction` can never route against a selection the
  // poster is not showing.
  const resolvedPick = resolvePick(pickedId, hosts);
  // WHICH TAP TABLE is in force (§12.6 ruling 9 + the E2 main-seat ruling). The cover keeps the ORIGINAL
  // select-then-act grammar — a cut-in always promotes — while capsule and poster carry the owner's
  // third-walk narrowing. The routing stays HERE either way; only the table changes.
  //
  // Read through the SURFACE's own resolver, never a second read of the raw setting: `useVariantId`
  // validates against the registry and degrades an unknown/stale id to `capsule`, and `tapGrammarFor`
  // degrades the same id to capsule's grammar — so the layout that renders and the table that routes can
  // never disagree about a value neither of them recognizes.
  const layoutId = fleetSurface.useVariantId();
  const grammar = tapGrammarFor(layoutId);

  // ── THE GEOMETRY RESET (§12.6 ruling 6's ⚖ clause) ────────────────────────────────────────────────
  // The shell restores a per-section SCROLL OFFSET (DefaultRoot's `tabScrollRef`), and a pixel offset is
  // only meaningful against the content it was taken in. Switching layout re-shapes the fleet body
  // entirely, and switching the banner adds or removes up to 232px ABOVE everything else — so a stored
  // offset restores into content that is no longer there, which is Codex's MED against this slice.
  //
  // The fix is gacha-local by ruling: this body knows its own geometry changed; the shell does not, and
  // teaching it would mean an engine-wide seam for one theme's setting. So the fleet simply lands at the
  // TOP after a change, which is the honest answer for a page that has been re-laid-out.
  //
  // TWO THINGS MAKE IT NON-OBVIOUS, and both are load-bearing:
  //   · IT WAITS FOR THE TAB, AND IT COMPARES AGAINST THE GEOMETRY LAST SHOWN. Both settings live in
  //     Conf, so the change almost always lands while the fleet is hidden — and `#app-scroll` is ONE
  //     shared scroller, so resetting it then would yank the Conf page the owner is reading to the top
  //     and record that as Conf's own position. The state is therefore the LAST GEOMETRY THIS BODY WAS
  //     SEEN IN, not a dirty flag: ruling 6 resets when the geometry the offset was taken against no
  //     longer matches, and a flag answers a different question ("did anything happen while hidden?").
  //     They differ on the net-zero round trip — leave for Conf, flip the banner, flip it back, return —
  //     where the offset is still valid and a flag would have thrown it away for nothing (Codex E3 LOW).
  //   · IT RUNS IN A MICROTASK. Effects flush child-first, so this one runs BEFORE DefaultRoot's own
  //     restore effect on the very commit that shows the fleet again — a plain call here would be
  //     overwritten by the stale offset it exists to discard. A microtask queued from inside the flush
  //     runs after the whole flush and still before paint, so the reset lands last and never flickers.
  //     That ordering is pinned by a REAL-SHELL test, not by this comment: mounted beside a synthetic
  //     scroller the two orderings are indistinguishable.
  const geomKey = `${layoutId}/${bannerMode}`;
  const shownGeomRef = useRef(geomKey);
  useEffect(() => {
    // While hidden the last SHOWN geometry stands — whatever the settings do in the meantime, this body
    // is not on screen and the shared scroller is not its to move.
    if (!active) return;
    if (shownGeomRef.current === geomKey) return;
    shownGeomRef.current = geomKey;
    queueMicrotask(() => document.getElementById(SCROLLER_ID)?.scrollTo(0, 0));
  }, [geomKey, active]);

  // ── THE TAP ROUTER's execution (rulings 3 + 4). The DECISION is `tapAction`, a pure function with its own
  //    table of tests; this is the half that has to touch the world, and it is here rather than in a layout
  //    so all three layouts route identically and none of them can invent a second wake path.
  const onTapHost = useCallback(
    (hostId: string, morphImg?: HTMLElement | null): FleetTap | null => {
      // Liveness from the CURRENT render (the council clause): a machine that woke between the two taps
      // must OPEN, not be woken again — so this reads `hosts`, never a value captured at tap one.
      const host = hosts.find((h) => h.id === hostId);
      if (!host) return null; // the machine left between render and click
      const action = tapAction(resolvedPick, hostId, !!host.status?.online, grammar);
      if (action === "select") {
        // Under `act-first` only a SLEEPING machine can land here (the owner's third-walk amendment), and
        // it is the only tap whose whole outcome is off-screen — a transform plus a registry below the
        // fold — which is why it is the one selection that announces. It lands IMMEDIATELY: the poster's
        // selection has no theatre to wait for.
        //
        // Under `select-first` the router only DECIDES: a cover's selection IS a ceremony, so the layout
        // that runs the ceremony commits it — through `onCommitSelect`, on its own beat, inside the page
        // fold that hides the swap (Codex E2 HIGH-1: re-routing at that beat could turn a promote into a
        // wake). A SELECTION THAT IS DRAMATIZED IS COMMITTED BY ITS DRAMA; this branch is what the tap
        // MEANT, and the seam below is where it takes effect. The layout narrates for the same reason.
        if (grammar === "act-first") {
          setPickedId(hostId);
          announce(pickAnnounce(host, starsFor((host.services ?? []).length, starMode)));
        }
        return "select";
      }
      if (action === "open") {
        // The open SELECTS too (the amendment's "and that tap also selects it, so the registry follows" —
        // the cosmos one-tap select-and-open precedent). Deliberately NOT announced: the dossier is a
        // focus-trapping sheet that names the machine itself, so a live-region sentence would be the
        // second thing saying it.
        setPickedId(hostId);
        // THE MORPH IS AVAILABLE TO EVERY LAYOUT (owner ruling, dev-unit walk — §12.6 ruling 5②'s
        // "capsule-only" is AMENDED). That clause's stated basis was only that a morph clone sourced from
        // a sheared clip-path had never been SEEN; the owner has now asked to see it, so the layout hands
        // over its own portrait and this seam simply passes it on.
        //
        // Nothing else changes: `openHostDossier` still owns the generations, the prep ownership, the
        // avatar suppression and `enterInstant`, so there is one morph implementation and no layout can
        // grow a second. A layout that passes nothing (or a machine with no art) gets the plain open it
        // always got — the fallback lives in that function, not in each caller.
        openHostDossier(hostId, morphImg);
        return "open";
      }
      // WAKE. A synchronous busy guard, because `busy` is per-host: a second wake fired into an action
      // already in flight would be a duplicate request, not a retry. (The pre-existing `useFleetActions`
      // overlap race is a recorded standing item across all five fleets, deliberately not rewritten here.)
      if (busy.has(hostId)) return null;
      setWaking((prev) => (prev.has(hostId) ? prev : new Set(prev).add(hostId)));
      // Same split as the select above: the cover's develop ceremony speaks its own sentence at its own
      // first beat (`coverDevelopAnnounce`), so this body stays quiet under that grammar rather than
      // announcing the same request twice in two different wordings.
      if (grammar === "act-first") announce(wakeAnnounce(host.name));
      // The SAME seam the dossier's Wake button calls — no new execution path, no UI confirm (D8: the
      // registry decides, and `wake_host` is risk=LOW with no `confirm`). Settled either way, so a failed
      // request cannot leave a machine lit as waking forever; `run` reports its own outcome as a toast.
      // Only THIS host leaves the set, so an overlapping wake on another machine is untouched.
      const done = () =>
        setWaking((prev) => {
          if (!prev.has(hostId)) return prev;
          const next = new Set(prev);
          next.delete(hostId);
          return next;
        });
      void run("wake", host).then(done, done);
      return "wake";
    },
    [hosts, resolvedPick, grammar, starMode, busy, run, openHostDossier, announce],
  );
  // ── THE DEFERRED SELECT's COMMIT (Codex E2 HIGH-1). The narrow, select-ONLY counterpart to the router
  //    above: a layout whose selection is a ceremony calls this on the beat where the swap should land,
  //    and it can do exactly one thing. There is no `tapAction` here on purpose — re-routing at that beat
  //    is the defect this exists to make unreachable, because a poll that removes the old hero in the
  //    meantime makes the tapped machine the selection, and the router would then read the same gesture
  //    as a wake. Liveness is not even read: the decision was made at the tap, and the only question left
  //    is whether the machine is still here to be selected.
  const onCommitSelect = useCallback(
    (hostId: string): boolean => {
      if (!hosts.some((h) => h.id === hostId)) return false; // it left mid-ceremony; nothing to commit
      setPickedId(hostId);
      return true;
    },
    [hosts],
  );
  // Leaving the tab (or unmounting) CLOSES the dossier — the M3-confirm ruling: a nav tap is "outside"
  // under the owner's tap-outside wording, so the click listener already closes on pointer navigation;
  // clearing here makes keyboard/programmatic navigation behave identically instead of resurrecting the
  // sheet on return. It also voids any morph still in flight (its callback would otherwise re-open a
  // dossier over a screen the user has already left).
  useEffect(() => {
    // The ref OBJECT is stable, so capturing it keeps the cleanup off a stale `.current` read.
    const ticket = gen;
    if (!active) {
      ticket.current++;
      cleanMorphPrep();
      dropShowcase();
      setMorphOpen(false);
      setSelected(null);
      // …and the alt layouts' selection with it (ruling 2, the same branch), plus the live region: a
      // sentence left standing would be re-announced by some ATs on return to a tab whose selection has
      // just been reset. The wake FLIGHT is not cleared here — the request is still in the air, and its
      // own settle handler owns that flag.
      setPickedId(null);
      announce("");
    }
    const artTicket = artGen;
    return () => {
      ticket.current++;
      // The art layer's suppression outlives React's own cleanup order otherwise: the avatar is going
      // away with us, but the REF must not keep pointing at a detached node for a remount to inherit —
      // and its ticket must move so a callback landing after this can apply nothing.
      artTicket.current++;
      artReturnFocus.current = false;
      releaseArtName();
    };
  }, [active, cleanMorphPrep, dropShowcase, releaseArtName, announce]);

  const selIndex = selected ? hosts.findIndex((h) => h.id === selected) : -1;
  const selHost = selIndex >= 0 ? hosts[selIndex] : null;
  const sheetOpen = active && !!selHost;
  const titleId = useId();
  // Retain the last selection through the slide-OUT so the sheet doesn't blank while it eases closed
  // (`selected` → null the instant it starts). Keyed on the host OBJECT, which TanStack's structural
  // sharing keeps stable across no-change polls, so this settles rather than looping.
  const [shown, setShown] = useState<{ host: Host; index: number } | null>(null);
  useEffect(() => {
    if (selHost) setShown({ host: selHost, index: selIndex });
  }, [selHost, selIndex]);
  // `body[data-sheet=open]` is the kit's own sheet-open composer yield (kit.css, K1) — the STAMP stays
  // host-owned, so the theme that owns the sheet sets it. LAYOUT effects, both of these (Codex
  // M3-confirm M2): a morph open commits inside a View Transition's update callback, and the new-state
  // capture can land before passive effects run — a passive stamp/collapse would let the snapshot catch
  // the composer (or the plan sheet) still un-yielded and ghost it through the root cross-fade.
  useLayoutEffect(() => {
    // …the same fact into the ref the openers read (see its declaration): written HERE so it lands in the
    // same commit as the stamp and can never disagree with it.
    sheetOpenRef.current = sheetOpen;
    if (typeof document === "undefined") return;
    if (sheetOpen) document.body.dataset.sheet = "open";
    else delete document.body.dataset.sheet;
    return () => {
      delete document.body.dataset.sheet;
    };
  }, [sheetOpen]);
  // Collapse the composer's plan sheet when the dossier opens (D30) — otherwise it pokes out above it.
  useLayoutEffect(() => {
    if (sheetOpen) setPlanSheetOpen(false);
  }, [sheetOpen]);
  const closeDossier = useCallback(() => {
    gen.current++; // a pending morph must not re-open what the user just dismissed
    cleanMorphPrep();
    // the art stands ON the dossier: it cannot outlive it
    dropShowcase();
    setMorphOpen(false);
    setSelected(null);
  }, [cleanMorphPrep, dropShowcase]);

  // ── THE SHOWCASE's OPEN/CLOSE, on the SAME View-Transition machinery as the capsule morph (the owner's
  //    G2 precedent), stamped `showcase` so gacha.css can time this flight on its own terms.
  //
  //    The naming dance is the EXACT MIRROR of `openHostDossier`'s swap trick, one link further along the
  //    chain. There the tapped card is the FROM and the avatar the TO; here the avatar is the FROM and the
  //    full-screen image the TO. Both are named by CSS under the `showcase` stamp (gacha.css), so the only
  //    imperative move is the one CSS cannot express — suppressing the avatar for the NEW capture, where
  //    it is still mounted under an opaque overlay and would otherwise be a second `capsule-shell` (two in
  //    one capture = the browser skips the whole transition).
  //
  //    That suppression then STAYS for as long as the art is up, which is what makes the close a real
  //    reverse morph with no extra machinery: the old capture sees the full-screen image named and the
  //    avatar suppressed; the callback unmounts the image and releases the avatar; the new capture sees
  //    exactly one `capsule-shell` again — the portrait it flies back into.
  //
  //    Both legs commit INSIDE the update callback (`runViewTransition` flushSyncs), because the browser
  //    captures the new state one frame later: an overlay mounted by a passive effect would not be there
  //    for it (the same law the sheet's `enterInstant` exists to satisfy).
  //
  //    NOTHING is prepared before the call on either leg — the old capture's name comes from CSS — so a
  //    stale callback owns no DOM to clean: it simply does nothing at all. That is the whole ownership
  //    story here, and it is why the ticket check comes FIRST rather than after a restore step.
  const openShowcase = useCallback(() => {
    // already up (the portrait is behind it): never start a second transition
    if (showArt) return;
    const mine = ++artGen.current;
    if (!viewTransitionsActive()) {
      // no transition to carry it: the CSS entrance stands in
      setShowArt("fade");
      return;
    }
    const avatar = document.querySelector<HTMLElement>(".gc-dossier .avatar");
    runViewTransition(() => {
      // Void intent: touch NOTHING. The avatar this closed over may now belong to a different machine's
      // dossier (React re-uses the node across a swap) — suppressing it would leave that dossier's own
      // morph without a destination, and re-raising the overlay would put the art back over a screen the
      // user has moved on from.
      if (artGen.current !== mine) return;
      if (avatar?.isConnected) {
        avatar.style.setProperty("view-transition-name", "none");
        artPrep.current = { avatar };
      }
      setShowArt("morph");
    }, "showcase");
  }, [showArt]);
  const closeShowcase = useCallback(() => {
    if (!showArt) return; // a second dismissal would start a second transition, skipping the first
    const mine = ++artGen.current;
    // The dossier is demonstrably staying (this is the ART's own dismissal), so the portrait gets its
    // focus back when the overlay unmounts.
    artReturnFocus.current = true;
    if (!viewTransitionsActive()) {
      releaseArtName();
      setShowArt(null);
      return;
    }
    const myPrep = artPrep.current;
    runViewTransition(() => {
      // Release only what is still OURS: a teardown may have released it already, or a newer showcase may
      // have re-suppressed the very same avatar — stripping that would put two `capsule-shell` nodes in
      // its own closing capture.
      if (myPrep && artPrep.current === myPrep) {
        artPrep.current = null;
        myPrep.avatar.style.removeProperty("view-transition-name");
      }
      if (artGen.current !== mine) return; // a teardown, or a newer showcase, owns this layer now
      setShowArt(null);
    }, "showcase");
  }, [showArt, releaseArtName]);
  /** Hand focus back to the portrait — called by the overlay as it unmounts, and honoured only for the
   *  art's OWN dismissal (see `artReturnFocus`). Stable, and reads refs + live DOM, because the caller is
   *  a cleanup function holding the previous render's closure. */
  const restoreArtFocus = useCallback(() => {
    if (!artReturnFocus.current) return;
    artReturnFocus.current = false;
    const btn = document.querySelector<HTMLElement>(".gc-dossier .gc-art-btn");
    if (btn?.isConnected) btn.focus({ preventScroll: true });
  }, []);
  // TAP-OUTSIDE DISMISS (owner ruling 2026-08-02). The primitive's own catcher stays OFF: it is a
  // full-screen button, so it would eat the capsule tap that SWAPS the dossier before it ever reached the
  // card. This is the same dismissal expressed as a document listener that names its exemptions — the
  // sheet itself, a capsule card, a promo slide's hit area — and closes on anything else.
  //
  // Three deliberate choices:
  //   · CLICK, not pointerdown: a pointerdown listener would dismiss on the first touch of a page SCROLL
  //     or a banner swipe, which is a gesture, not a tap.
  //   · the exemptions are why the OPENING tap can never close the sheet it just opened — every opener is
  //     a card or a promo, so it is exempt by construction; no timestamp guard, nothing to tune.
  //   · `defaultPrevented` is respected (the BottomSheet Escape convention): the banner marks the
  //     synthetic click a finished DRAG produces, and that click must not double as a dismissal.
  // The carousel's own controls (dots, prev/next) are NOT exempt — under the owner's wording they are
  // outside, so tapping one closes the dossier and moves the strip. Flagged for the eyeball round.
  useEffect(() => {
    if (!sheetOpen) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      // The sheet, the two things that OPEN one — and any layer standing ABOVE it: the dossier's own
      // shutdown button raises the shared ConfirmDialog, and its portrait raises the art showcase.
      // Dismissing the sheet under a surface it spawned (on the tap that dismisses THAT surface, no
      // less) would be the wrong reading of "outside". Same cooperative posture the primitive's Escape
      // handler takes toward a layer above it.
      // `.gc-host-hit` is the SEMANTIC exemption (GACHA_PLAN §12.6 ruling 5①), replacing the hardcoded
      // `.gc-card` this list used to name: every control that opens or SELECTS a machine wears it — the
      // capsule card, the banner's promo hit, a poster slice — so a new fleet layout is exempt by
      // construction. Without it the second tap of select-then-act would dismiss the dossier on the very
      // click that opened it. `.gc-slide-hit` STAYS beside it, and is not redundant: the hero and scene
      // slides render that class on an inert `div` which names no machine and therefore carries no
      // `gc-host-hit` — dropping it would newly close the dossier on a tap in the banner's copy block,
      // which is a behavior change this slice is not making.
      if (
        target?.closest(
          ".bs-root, .gc-host-hit, .gc-slide-hit, .gc-art-view, .modal-backdrop, .pm-backdrop",
        )
      )
        return;
      closeDossier();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [sheetOpen, closeDossier]);
  // The LIVE selection while open (so polls update the sheet), the retained one through the slide-out.
  const detail = selHost ? { host: selHost, index: selIndex } : shown;
  // ONE resolution of the dossier's art, read by the portrait and by the showcase it opens (§5.3's one
  // shared resolver): the enlarged image is by construction the same entry the portrait was cropping.
  const detailArt = detail ? artForHost(roster, detail.index) : null;

  // The §6.4 slide set, in its ruled order: the fixed first slide, then the rest of the banner SCENES,
  // then ONE promo per host — online AND sleeping (the ruled membership; a sleeping promo renders dimmed,
  // which keeps its click useful: open the dossier, then wake).
  //
  // THE FIRST SLIDE IS DEALT, not pinned (owner ruling 2026-08-26, "W5"): it wears the frozen hero copy —
  // that dressing is fixed and is why its key is the fixed `HERO_KEY` — but its ART is the banner pool's
  // first usable member, exactly like every slide after it. `bannerScenes` owns that split, and the whole
  // MEMBER rides down rather than a bare url, so an owner's framing point on a banner image reaches the
  // slide that paints it (the role is `framable`, and `GachaBanner` hands `art.focus` to `FocalImg`).
  //
  // The body composes the list because it is the one place that knows all three sources. The scenes are
  // the roster's `scenes` — the owner's `media/gacha/banner/` drops, else the bundled set — and they are
  // a SEPARATE pool from the entries, which is what keeps a scene from ever being dealt to a machine as
  // its capsule portrait (the art.ts partition rule, now enforced by the role folders themselves).
  const { lead, rest } = bannerScenes(roster, kitBackground);
  const slides: BannerSlide[] = [
    { kind: "hero", key: HERO_KEY, art: lead },
    ...rest.map((scene, i) => ({
      kind: "scene" as const,
      key: SCENE_KEY_PREFIX + scene.name,
      name: scene.name,
      position: i,
      art: scene,
    })),
    ...hosts.map((host, i) => ({
      kind: "promo" as const,
      // NAMESPACED, like the scenes above: a bare host id would share the key space with the hero's own
      // key, so a machine named `hero` collides with the fixed slide.
      key: HOST_KEY_PREFIX + host.id,
      host,
      art: wideArtForHost(roster, i),
      online: !!host.status?.online,
    })),
  ];

  return (
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-fleet"
      data-screen-label="01 Fleet"
      role="tabpanel"
      aria-labelledby="tabbtn-fleet"
    >
      {/* The card stars' carve filter def (R19) — mounted HERE because the card row is the one carved
          surface, and the def must live exactly as long as any card can (see GachaStarDefs). */}
      <GachaStarDefs />

      {/* THE TRACK BODY — the one region a fleet LAYOUT replaces (§12.6: capsule today, poster/cover at
          E1/E2). The resolution happens HERE, inside the body, and not at the Root: everything above and
          below this line is state this component owns — the dossier, the morph generations, the showcase,
          the banner — so a layout swap must re-render the track and leave the rest standing. `Themed`
          subscribes for itself, so a swap doesn't even re-render GachaFleet.
          Every prop is a RESOLVED value (the §12.6 sizing rule): no derivation moves into a layout, so the
          three cannot drift from each other. `artForHost` rides down as a lookup because the roster query
          belongs to the derivations up here — it is the same entry the promo slide and the dossier use. */}
      <fleetSurface.Themed
        hosts={hosts}
        error={error}
        isLoading={isLoading}
        reeling={reeling}
        shapes={shapes}
        starMode={starMode}
        ribbonHost={ribbonHost}
        // THE BANNER AS A SLOT (§12.6 ruling 7). ONE instance, built here because this is the body that
        // knows the three slide sources — handed to whichever layout is drawing, which seats it where its
        // own composition wants it (capsule/poster: first in scroll flow, exactly where this component used
        // to mount it; cover: the strapline). Reparenting across a layout switch REMOUNTS it, which is the
        // ruling's accepted cost — the banner's timers are unmount-clean, and that is the tested part.
        //
        // …and under `banner: off` the slot is `null` — the same unmount, reached the same way. Every
        // layout gets it for free, including the cover, whose strapline seat simply has nothing in it.
        // The derivations feeding the banner (the slide set, the two pills) still run: they are cheap and
        // §12.6 ruling 12 says so explicitly — "don't clean up".
        banner={
          bannerMode === "off" ? null : (
            <GachaBanner
              slides={slides}
              active={active}
              rate={rateText(MAX_STARS[starMode], onlineCount, resolved)}
              pity={pityText(onlineServices, svcResolved)}
              onOpenHost={openHostDossier}
            />
          )
        }
        art={(i) => artForHost(roster, i)}
        counter={counterText(onlineCount, hosts.length, resolved)}
        onOpenHost={openHostDossier}
        // The selection RESOLVED in the view (ruling 2) — never written back to state, so host[0] is
        // selected at boot without a write and a vanished pick re-derives in the SAME commit that
        // removed it. The router reads this identical value, so the two can never disagree.
        picked={resolvedPick}
        onTapHost={onTapHost}
        onCommitSelect={onCommitSelect}
        busy={busy}
        waking={waking}
        // The fleet's live region stays THIS component's; a layout that dramatizes a request on its own
        // beats borrows the voice (see the prop's contract). Stable identity, so a ceremony beat's closure
        // over it is safe.
        announce={announce}
      />

      {/* THE FLEET's ONE LIVE REGION (ruling 3). gacha had none until E1, and select-then-act is why it
          needs one: a selection's only feedback is a transform on the slice and a data block below the
          fold, and a wake's is a 900 ms ceremony — none of which reaches anyone who cannot see it. It is
          mounted UNCONDITIONALLY (an aria-live region has to exist before its text changes, or the first
          message is silently missed) and under every layout, because it belongs to the fleet body rather
          than to whichever variant is drawing. `role="status"` carries the polite live semantics; the
          redundant `aria-live` is the belt every other region in the app wears. */}
      <div className="gc-live" role="status" aria-live="polite">
        {/* KEYED ON THE SEQUENCE, not on the text. A polite region announces when its content CHANGES, and
            writing the same string twice changes nothing — React bails out before the DOM is even touched,
            so a retry of the same failed wake was silent. A keyed child makes every announcement a real
            node swap, which is a mutation the AT can see. */}
        <span key={live.seq}>{live.text}</span>
      </div>

      {/* THE UNIT DOSSIER — the shared C3 primitive, skinned by gacha.css into the theme's one light
          surface. `catchOutside={false}` (the owner-ruled precedent): the track stays interactive, so
          tapping another capsule SWAPS the dossier instead of costing a close-then-open; flick-down,
          Escape or a tap on the sr-only close still dismiss it. The prototype's 520 ms spring is the
          shared 420 ms lifecycle here (the §4.9 ledger's accepted deviation). */}
      <BottomSheet
        open={sheetOpen}
        onClose={closeDossier}
        labelledBy={titleId}
        closeLabel={CLOSE_DOSSIER_LABEL}
        catchOutside={false}
        initialSnap={getSheetSnap(SHEET_KEY)}
        onSnapChange={persistSheetSnap}
        enterInstant={morphOpen}
        upkeepKey={detail?.host.id}
      >
        {detail && (
          <GachaHostDetail
            host={detail.host}
            services={svcByHost.get(detail.host.id) ?? []}
            art={detailArt}
            mode={starMode}
            busy={busy.has(detail.host.id)}
            run={run}
            titleId={titleId}
            onClose={closeDossier}
            onShowArt={openShowcase}
          />
        )}
      </BottomSheet>

      {/* THE ART SHOWCASE — a SIBLING of the sheet, never a child of it (`.bs-sheet` is a transformed
          containing block, so a fixed overlay inside it would be trapped in the sheet's box). Gated on the
          dossier being genuinely OPEN, not merely retained, so the art can never outlive the portrait it
          morphs back into.

          That gate governs the LIVE DOM only (Codex G2-close L1): a View Transition already in flight
          keeps painting its own `::view-transition-*` snapshots over the whole page for the rest of its
          420 ms, whatever the tree underneath does — which is why `dropShowcase` skips the transition it
          owns instead of relying on this line. The two together are what keep the overlay and the tab
          reel off the screen at the same time, and what make the z-rung above it (46) a statement of
          kind rather than a contested overlap. */}
      {showArt && sheetOpen && detail && detailArt && (
        <GachaArtShowcase
          hostName={detail.host.name}
          art={detailArt}
          fade={showArt === "fade"}
          onClose={closeShowcase}
          onClosed={restoreArtFocus}
        />
      )}
    </div>
  );
}
