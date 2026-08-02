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
import { useThemeSetting } from "../../theme-engine/settings";
import type { Host } from "../../types";
import { GachaBanner, type BannerSlide } from "./GachaBanner";
import { GachaCard } from "./GachaCard";
import { GachaHostDetail } from "./GachaHostDetail";
import { ART } from "./art";
import { HERO_KEY, HOST_KEY_PREFIX, SCENE_KEY_PREFIX } from "./carousel";
import { GACHA_COPY } from "./copy";
import { CLOSE_DOSSIER_LABEL, cardShapes, counterText, hostsResolved, rateText } from "./fleet";
import { artForHost, defaultRoster, heroArt, wideArtForHost } from "./roster";
import { MAX_STARS, toStarMode } from "./stars";

// The gacha bespoke FLEET (D52 / GACHA_PLAN §6) — the prototype's capsule-arcade fleet screen, injected into
// DefaultRoot's `fleet` body slot by GachaRoot (the cosmos/frontier/vapor precedent). A PURE CONSUMER of the
// headless `useFleet` controller: the same hosts/services data every other Fleet renders, presented as a
// pickup banner over a capsule track.
//
// The body owns the DERIVATIONS the two surfaces must agree on — the roster assignment (§5.3's one shared
// resolver), the star mode, the online count — and hands each surface the resolved values. That is what keeps
// a host's promo slide and its capsule card showing the same character with the same rarity.

/** The roster the theme resolves against. Until G5's media index endpoint exists this is the BUNDLED default
 *  set (§5.5) — a module constant rather than a hook, because it cannot change at runtime yet. G5 replaces
 *  this one line with its query; nothing downstream moves, which is the point of the resolver. */
const ROSTER = defaultRoster();

/** The dossier sheet's persisted detent — a stable key into the shared, theme-agnostic `sheetSnap` store,
 *  with a module-level setter so `onSnapChange` keeps a constant identity per the prop's contract (the
 *  cosmos/frontier precedent). */
const SHEET_KEY = "gacha-host-detail";
const persistSheetSnap = (snap: SheetDetent) => setSheetSnap(SHEET_KEY, snap);

export function GachaFleet({ active }: { active: boolean }) {
  const { hosts, svcByHost, busy, run, hasData, isLoading, error } = useFleet();
  const starMode = toStarMode(useThemeSetting<string>("gacha", "starMode"));

  const onlineCount = hosts.filter((h) => h.status?.online).length;
  // §6.3's loading semantics, shared by the rate pill and (G1's track) the counter: an unresolved fleet
  // reads as a held value, never as a confident "0".
  const resolved = hostsResolved(isLoading, error, hasData);

  // The card geometry (the main seat's Q8.10 ruling): host[0] featured, the rest in 3/4 pairs, a trailing
  // odd host wide. A pure function of the COUNT, so a poll can never re-shuffle the track's shape.
  const shapes = cardShapes(hosts.length);

  // ── THE UNIT DOSSIER (G2). The seam the capsule cards and the promo slides have shared since G1 now has
  //    its destination: one selected host id, one sheet. COMPONENT state rather than a store (the frontier/
  //    cosmos selection stores exist because their maps and grids select each other two ways — here nothing
  //    outside this body reads the selection, and a store would be state living further from its only user).
  const [selected, setSelected] = useState<string | null>(null);
  // Whether THIS open is being carried by the M3 morph — handed to the sheet as `enterInstant`. A morph
  // needs the dossier mounted AT REST inside the update callback (see BottomSheet's prop doc); every other
  // open keeps the primitive's slide-up.
  const [morphOpen, setMorphOpen] = useState(false);
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
  const prep = useRef<{ card: HTMLImageElement; avatar: HTMLElement | null } | null>(null);
  const cleanMorphPrep = useCallback(() => {
    const p = prep.current;
    if (!p) return;
    prep.current = null;
    p.card.style.removeProperty("view-transition-name");
    p.avatar?.style.removeProperty("view-transition-name");
    // …and end the superseded transition outright: a PLAIN open starts no transition of its own, so
    // without this the old one would capture the plainly-opened dossier as its morph destination.
    skipActiveViewTransition();
  }, []);
  const openHostDossier = useCallback(
    (hostId: string, morphImg?: HTMLImageElement | null) => {
      if (reeling) return;
      // Every open takes a ticket, morph or not: a plain open must also void a morph still in flight.
      const mine = ++gen.current;
      cleanMorphPrep();
      if (!morphImg || !viewTransitionsActive()) {
        setMorphOpen(false);
        setSelected(hostId);
        return;
      }
      const avatar = document.querySelector<HTMLElement>(".gc-dossier .avatar");
      avatar?.style.setProperty("view-transition-name", "none");
      morphImg.style.setProperty("view-transition-name", "capsule-shell");
      const myPrep = { card: morphImg, avatar };
      prep.current = myPrep;
      runViewTransition(() => {
        // Restore ONLY while still the owner — a newer intent may have cleaned and RE-STAMPED these
        // same nodes, and the stale callback must not undo its work (M1). Ownership lost ⇒ the newer
        // intent already restored (or re-claimed) them; nothing here is leaked.
        if (prep.current === myPrep) {
          prep.current = null;
          morphImg.style.removeProperty("view-transition-name");
          avatar?.style.removeProperty("view-transition-name");
        }
        if (gen.current !== mine) return; // a newer intent (or a close / tab change) owns the dossier now
        setMorphOpen(true);
        setSelected(hostId);
      }, "detail");
    },
    [reeling, cleanMorphPrep],
  );
  // Drop a selection whose machine has left the fleet (a config edit, a removal) so the sheet can never
  // reference a gone host — the cosmos/frontier precedent.
  useEffect(() => {
    if (selected && !hosts.some((h) => h.id === selected)) {
      gen.current++;
      cleanMorphPrep();
      setMorphOpen(false);
      setSelected(null);
    }
  }, [selected, hosts, cleanMorphPrep]);
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
      setMorphOpen(false);
      setSelected(null);
    }
    return () => {
      ticket.current++;
    };
  }, [active, cleanMorphPrep]);

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
    setMorphOpen(false);
    setSelected(null);
  }, [cleanMorphPrep]);
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
      // The sheet, the two things that OPEN one — and any modal layer standing ABOVE it: the dossier's
      // own shutdown button raises the shared ConfirmDialog, and dismissing the sheet under a dialog it
      // spawned (on Cancel, no less) would be the wrong reading of "outside". Same cooperative posture
      // the primitive's Escape handler takes toward a layer above it.
      if (target?.closest(".bs-root, .gc-card, .gc-slide-hit, .modal-backdrop, .pm-backdrop"))
        return;
      closeDossier();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [sheetOpen, closeDossier]);
  // The LIVE selection while open (so polls update the sheet), the retained one through the slide-out.
  const detail = selHost ? { host: selHost, index: selIndex } : shown;

  // The §6.4 slide set, in its ruled order: the fixed hero, then the owner's banner SCENES (G1 eyeball
  // round 3 — art-only slides, the owner's pick over cycling the hero's art), then ONE promo per host —
  // online AND sleeping (the ruled membership; a sleeping promo renders dimmed, which keeps its click
  // useful: open the dossier, then wake).
  //
  // The body composes the list because it is the one place that knows all three sources. The scenes come
  // from the bundled art PARTITION rather than the roster, which is what keeps them out of the per-host
  // cycle; G5's banner media folder replaces that one expression and nothing downstream moves.
  const slides: BannerSlide[] = [
    { kind: "hero", key: HERO_KEY, art: heroArt(ROSTER) },
    ...ART.scenes.map((scene, i) => ({
      kind: "scene" as const,
      key: SCENE_KEY_PREFIX + scene.name,
      name: scene.name,
      position: i,
      art: { url: scene.url },
    })),
    ...hosts.map((host, i) => ({
      kind: "promo" as const,
      // NAMESPACED, like the scenes above: a bare host id would share the key space with the hero's own
      // key, so a machine named `hero` collides with the fixed slide.
      key: HOST_KEY_PREFIX + host.id,
      host,
      art: wideArtForHost(ROSTER, i),
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
      <GachaBanner
        slides={slides}
        active={active}
        rate={rateText(MAX_STARS[starMode], onlineCount, resolved)}
        onOpenHost={openHostDossier}
      />

      {/* THE CAPSULE TRACK. The head is the prototype's 編成 / "Select a unit" / counter row; the grid is
          its two-column track, with the geometry rule deciding which cards span the full width. */}
      <div className="gc-track-head">
        <h1>
          {GACHA_COPY.trackHead}
          <em>Select a unit</em>
        </h1>
        <span className="count">{counterText(onlineCount, hosts.length, resolved)}</span>
      </div>

      {/* The states, on the Kit Fleet's own shape (Fleet.tsx:52-55) rather than a ternary chain: the error
          notice renders BESIDE whatever the last successful poll left, so a failed background refetch
          reports itself without deleting a track the banner above is still showing promos for — the two
          surfaces read the same fleet or they contradict each other. An error with no data ever is the only
          case where the notice stands alone; while the FIRST poll is in flight nothing renders below the
          head at all, because an empty grid under "Select a unit" would be dishonest chrome. */}
      {error && <div className="gc-msg">backend unreachable: {error.message}</div>}
      {!error && hosts.length === 0 && !isLoading && (
        <div className="gc-msg">no hosts in config.yaml</div>
      )}
      {hosts.length > 0 && (
        <div className="gc-track" inert={reeling}>
          {shapes.map((shape, i) => (
            <GachaCard
              key={hosts[i].id}
              host={hosts[i]}
              art={artForHost(ROSTER, i)}
              shape={shape}
              mode={starMode}
              onOpen={openHostDossier}
            />
          ))}
        </div>
      )}

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
            art={artForHost(ROSTER, detail.index)}
            mode={starMode}
            index={detail.index}
            busy={busy.has(detail.host.id)}
            run={run}
            titleId={titleId}
            onClose={closeDossier}
          />
        )}
      </BottomSheet>
    </div>
  );
}
