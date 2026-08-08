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
  /** Which machine wears the `NEW` ribbon (G6 item iv) — a sticky pick made above, `null` for none. */
  ribbonHost: string | null;
  /** The shared roster resolution (§5.3's ONE resolver), passed as a lookup so the roster query itself stays
   *  with the derivations: `art(i)` is the same entry the host's promo slide and dossier portrait use. */
  art: (index: number) => ResolvedArt | null;
  /** The already-formatted online/total counter (`counterText`), including its unresolved-poll form. */
  counter: string;
  /** The theme's ONE "open this machine" seam. A card also hands over its portrait — the M3 morph's FROM. */
  onOpenHost: (hostId: string, morphImg?: HTMLImageElement | null) => void;

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
   *  ceremony for a request that was never sent. */
  onTapHost: (hostId: string) => FleetTap | null;
  /** `useFleet().busy` — per-HOST, not per-action (R25 §Q1b). A slice lights and disables for ANY in-flight
   *  action on its machine, which is the correct read of a shared busy set. */
  busy: ReadonlySet<string>;
  /** The machine whose WAKE REQUEST is currently in flight, or `null`. Distinct from `busy` because busy
   *  cannot say WHICH action: this is the only fact that licenses a `WAKING` presentation, and it ends when
   *  the request settles — the card goes back to the SERVER-REPORTED state, and only a poll may flip it
   *  online (ruling 4, poll-truthful). */
  wakingHost: string | null;
}

export function GachaTrack({
  hosts,
  error,
  isLoading,
  reeling,
  shapes,
  starMode,
  ribbonHost,
  art,
  counter,
  onOpenHost,
}: GachaTrackProps) {
  return (
    <>
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
            />
          ))}
        </div>
      )}
    </>
  );
}
