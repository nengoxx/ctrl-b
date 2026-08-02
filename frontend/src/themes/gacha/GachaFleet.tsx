import { useCallback, useEffect, useId, useState } from "react";

import { BottomSheet, type SheetDetent } from "../../components/BottomSheet";
import { useFleet } from "../../hooks/useFleet";
import { runViewTransition } from "../../lib/viewTransition";
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
import { cardShapes, counterText, hostsResolved, rateText } from "./fleet";
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
  // THE CAPSULE→DOSSIER IMAGE MORPH (M3's image half, owner-pulled from G4 at the G2 eyeball): a card
  // hands over its portrait, which is view-transition-named for THIS transition only. The name is stamped
  // before `startViewTransition` (the OLD capture happens after the call, at the next render step) and
  // cleared INSIDE the update callback — after the old capture, before the new one — so the new snapshot
  // sees only the sheet avatar carrying the name and no stray name survives to dup-skip a later
  // transition (the viewTransition.ts warning). Fresh opens only: with the sheet already up the avatar
  // holds the name, and a second named node would skip the transition anyway. The sheet keeps its own
  // slide-up (the owner's ruling — only the IMAGE morphs); promos open plain (no portrait to morph from).
  const openHostDossier = useCallback(
    (hostId: string, morphImg?: HTMLImageElement | null) => {
      if (morphImg && selected === null) {
        morphImg.style.setProperty("view-transition-name", "capsule-shell");
        runViewTransition(() => {
          morphImg.style.removeProperty("view-transition-name");
          setSelected(hostId);
        }, "detail");
      } else {
        setSelected(hostId);
      }
    },
    [selected],
  );
  // Drop a selection whose machine has left the fleet (a config edit, a removal) so the sheet can never
  // reference a gone host — the cosmos/frontier precedent.
  useEffect(() => {
    if (selected && !hosts.some((h) => h.id === selected)) setSelected(null);
  }, [selected, hosts]);

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
  // host-owned, so the theme that owns the sheet sets it.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (sheetOpen) document.body.dataset.sheet = "open";
    else delete document.body.dataset.sheet;
    return () => {
      delete document.body.dataset.sheet;
    };
  }, [sheetOpen]);
  // Collapse the composer's plan sheet when the dossier opens (D30) — otherwise it pokes out above it.
  useEffect(() => {
    if (sheetOpen) setPlanSheetOpen(false);
  }, [sheetOpen]);
  const closeDossier = useCallback(() => setSelected(null), []);
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
        <div className="gc-track">
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
        closeLabel="Close unit dossier"
        catchOutside={false}
        initialSnap={getSheetSnap(SHEET_KEY)}
        onSnapChange={persistSheetSnap}
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
          />
        )}
      </BottomSheet>
    </div>
  );
}
