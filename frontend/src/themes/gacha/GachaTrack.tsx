import type { ReactNode } from "react";

import type { PendingKind } from "../../store/fleetPending";
import type { Host } from "../../types";
import { GachaCard } from "./GachaCard";
import { GACHA_COPY } from "./copy";
import type { CapsuleShape, FleetTap } from "./fleet";
import type { ResolvedArt } from "./roster";
import type { StarMode } from "./stars";

// THE CAPSULE TRACK — gacha's DEFAULT fleet layout (D52 §6.1, the prototype's two-column capsule grid), and
// since GACHA_PLAN §12.6 E0 the first variant behind the fleet Surface (`fleetSurface.ts`). The markup moved
// here VERBATIM out of `GachaFleet`; nothing about what it renders changed, and `gachaFleetFence.test.tsx`
// holds the DOM and the a11y tree to that.
//
// The split boundary is the §12.6 sizing rule: `GachaFleet` keeps the DERIVATIONS, the dossier, the showcase,
// the banner and the tap seam — everything all three layouts must agree on — and a layout replaces only the
// track BODY. So every prop below is a RESOLVED value: no derivation lives here, and poster/cover cannot
// drift from capsule by re-deriving one of them differently.

/** What a fleet LAYOUT variant is handed. The named contract poster (E1) and cover (E2) implement too — a
 *  surface's variants are interchangeable presenters over one controller, so they take one prop shape. */
export interface GachaTrackProps {
  /** The live fleet, in poll order. */
  hosts: Host[];
  /** The hosts query's error, if any — rendered BESIDE whatever the last successful poll left. */
  error: Error | null;
  /** The hosts query's first-poll flight, which is the only state that renders nothing at all. */
  isLoading: boolean;
  /** The tab reel owns the screen while it sweeps (§6.4/F3) — the track must refuse input under it. */
  reeling: boolean;
  /** Per-host capsule geometry, `cardShapes(hosts.length)` — a pure function of the COUNT, resolved above. */
  shapes: CapsuleShape[];
  /** The rarity mode the whole theme reads (`starMode`), so the card and its promo slide agree. */
  starMode: StarMode;
  /** Which machine wears the `NEW` ribbon (G6 item iv) — a sticky pick made above, `null` for none.
   *
   *  CAPSULE-ONLY, and that is a ruling rather than an oversight: the poster wore it briefly and the owner
   *  cut it ("I don't want it anymore"), and the COVER never wore one — the walked lab shows none, and a
   *  magazine already says which machine is featured by putting it on the front. So `GachaPoster` and
   *  `GachaCover` both deliberately decline to destructure this, and neither omission is a bug to fix. The
   *  prop stays on the shared contract because the capsule track — where the demo was owner-confirmed at
   *  G6.1 and shipped in v1.5.0 — still reads it. */
  ribbonHost: string | null;
  /** THE PICKUP BANNER, as a SLOT (§12.6 ruling 7, deferred from E1 to E2 where its second seat exists).
   *
   *  `GachaFleet` builds exactly ONE `<GachaBanner>` and hands it here, because the three layouts do not
   *  agree about where it goes: capsule and poster seat it FIRST IN SCROLL FLOW (which is byte-identically
   *  where the body used to mount it — the fence test is the proof), while the cover seats it inside the
   *  composition as a printed STRAPLINE between the hero copy and the barcode footer. A prop is the only
   *  shape that lets one instance land in two places.
   *
   *  ⚠ A LAYOUT SWITCH REMOUNTS IT, and that is accepted (ruling 7): React reparents the element into a
   *  different tree, so its autoplay index, its snap state and any in-flight gesture reset. The owner
   *  switches layouts rarely; what is NOT acceptable is a leaked timer, which is why the banner's own
   *  cadence effect is unmount-clean and tested that way. */
  banner: ReactNode;
  /** The shared roster resolution (§5.3's ONE resolver), passed as a lookup so the roster query itself stays
   *  with the derivations: `art(i)` is the same entry the host's promo slide and dossier portrait use. */
  art: (index: number) => ResolvedArt | null;
  /** The already-formatted online/total counter (`counterText`), including its unresolved-poll form. */
  counter: string;
  /** The theme's ONE "open this machine" seam. A layout also hands over the M3 morph's FROM element.
   *  `HTMLElement`, not `HTMLImageElement`: a capsule card hands its `<img>` (its crop is its capture),
   *  while a poster slice hands the SPAN that carries the shear clip — see `onTapHost`. */
  onOpenHost: (hostId: string, morphImg?: HTMLElement | null) => void;

  // ── SELECT-THEN-ACT (§12.6 rulings 2-4) — the four the ALT layouts read and capsule ignores ──────────
  // Widened at E1 (the E0 deferral): ONE prop shape for every variant, resolved values only. The capsule
  // track keeps its one-tap-opens behavior and simply does not destructure these — a surface's variants
  // are interchangeable presenters, not four different contracts.
  /** The RESOLVED selection — `pickedId ?? hosts[0]?.id`, resolved in the view and never written to state
   *  (ruling 2), so a vanished selection re-derives instead of leaving the layout pointing at a gone host.
   *  `null` only when the fleet is empty. */
  picked: string | null;
  /** Route one tap through `tapAction` and execute it. Returns what it DID, so a layout can dramatize the
   *  outcome (the poster's wake ceremony) without re-deriving the routing — and without ever being the
   *  place that decides it. `null` means NOTHING happened: the machine left between render and click, or
   *  a wake was refused because an action on that host is already in flight. A layout must not stage a
   *  ceremony for a request that was never sent.
   *
   *  `morphImg` is the M3 morph's FROM element, handed over on the same terms `onOpenHost` takes it: used
   *  only when the routed action is `open`, and only when a View Transition can actually carry it. `null`
   *  or nothing gives a plain open — a machine with no resolved art has no portrait to fly.
   *
   *  IT IS AN `HTMLElement`, AND WHICH ELEMENT MATTERS (R26). A captured element's OWN `clip-path` bakes
   *  into its snapshot; only ANCESTOR clipping is lost. So a layout whose art is clipped must hand over
   *  the element CARRYING the clip, not the picture inside it — the poster hands its `.po-art` span, the
   *  capsule keeps handing its `<img>` (its crop already is its capture). */
  onTapHost: (hostId: string, morphImg?: HTMLElement | null) => FleetTap | null;
  /** COMMIT a selection the router ALREADY DECIDED — the deferred half of a dramatized select, and the
   *  narrow seam that makes a mid-ceremony commit safe (Codex E2 HIGH-1).
   *
   *  WHY IT EXISTS. Under the cover grammar a selection is not instantaneous: it is a page turn, and the
   *  swap has to land INSIDE the fold, ~170 ms after the finger. Calling the ROUTER again at that beat is
   *  what makes it dangerous — a poll can remove the old hero in those 170 ms, which promotes the tapped
   *  machine to `selectedId`, and `tapAction` would then read the very same tap as a `wake` (or an `open`).
   *  A gesture that meant "put this on the cover" would send a real wake request. So the beat spends THIS
   *  instead: it can select, and it can do nothing at all. It can never open and it can never wake.
   *
   *  Returns whether the commit was ACCEPTED — `false` only when the machine has left the fleet, which is
   *  the one case where there is nothing to select. A layout uses the verdict to suppress whatever it was
   *  going to say about a swap that did not happen. */
  onCommitSelect: (hostId: string) => boolean;
  /** `useFleet().busy` — per-HOST, not per-action (R25 §Q1b). A slice lights and disables for ANY in-flight
   *  action on its machine, which is the correct read of a shared busy set. */
  busy: ReadonlySet<string>;
  /** The machines inside a power transition's grace window, and WHICH one (`store/fleetPending`'s own
   *  map, handed down whole; it superseded the request-in-flight set at D67, whose ~100ms lifetime made
   *  the chip blink). Distinct from `busy` because busy cannot say WHICH action: this is the only fact
   *  that licenses a `WAKING` or `REBOOTING` presentation. A machine leaves it on poll AGREEMENT (a
   *  wake observed online, a reboot observed down and then up again), on the window's expiry, or on the
   *  request failing; ruling 4 stays honored because the window is bounded and a failure clears
   *  instantly.
   *
   *  THE MAP, not a set per kind (2026-08-31): a second `rebooting` Set beside a `waking` one would be
   *  exactly the parallel-sibling shape the repo's extend-not-migrate rule forbids — one entry per host
   *  carrying its kind extends to a fourth transition with no new prop and no new plumbing. A MAP rather
   *  than one id for the reason the Set was one: two transitions genuinely overlap (wake A, then reboot
   *  B while A is still pending), and one slot made A stop saying `WAKING` inside its own window. */
  pending: ReadonlyMap<string, { kind: PendingKind }>;
  /** Speak into the fleet's ONE live region (ruling 3). The region itself stays `GachaFleet`'s — a layout
   *  never owns an ARIA landmark — but WHO speaks follows the tap grammar: under `act-first` the body
   *  narrates at the dispatch (`pickAnnounce` / `wakeAnnounce`) and the layouts say nothing, while the
   *  COVER narrates its own two-ended ceremonies on their own beats, because "X takes the cover" and "X is
   *  on the cover" are separated by a 880 ms page turn that only the layout knows about.
   *
   *  Stable identity (a `useCallback` with no deps up there), so it is safe in a ceremony beat's closure. */
  announce: (text: string) => void;
}

export function GachaTrack({
  hosts,
  error,
  isLoading,
  reeling,
  shapes,
  starMode,
  ribbonHost,
  banner,
  art,
  counter,
  onOpenHost,
  pending,
}: GachaTrackProps) {
  return (
    <>
      {/* THE PICKUP BANNER, seated FIRST IN SCROLL FLOW — which is byte-identically where `GachaFleet`
          mounted it before the slot existed (§12.6 ruling 7). It moved into the layout so the COVER can
          seat the same instance in its strapline; capsule's markup did not change, and the E0 equality
          fence is what holds that claim. */}
      {banner}

      {/* THE CAPSULE TRACK. The head is the prototype's 編成 / "Select a unit" / counter row; the grid is
          its two-column track, with the geometry rule deciding which cards span the full width. */}
      <div className="gc-track-head">
        <h1>
          {GACHA_COPY.trackHead}
          <em>Select a unit</em>
        </h1>
        <span className="count">{counter}</span>
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
              art={art(i)}
              shape={shape}
              mode={starMode}
              onOpen={onOpenHost}
              isNew={hosts[i].id === ribbonHost}
              pending={pending.get(hosts[i].id)?.kind}
            />
          ))}
        </div>
      )}
    </>
  );
}
