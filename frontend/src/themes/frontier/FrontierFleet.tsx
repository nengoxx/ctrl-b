import { useEffect, useId, useMemo, useState } from "react";

import { BottomSheet, type SheetDetent } from "../../components/BottomSheet";
import { useFleet } from "../../hooks/useFleet";
import { setPlanSheetOpen } from "../../store/planSheet";
import { getSheetSnap, setSheetSnap } from "../../store/sheetSnap";
import { setFrontierSelection, useFrontierSelection } from "../../store/frontierSelection";
import { ART, assets } from "./art";
import { FrontierHostDetail } from "./FrontierHostDetail";
import { present } from "./present";

// The frontier badlands Fleet (F2/F3, D29 §14.4) — the theme's bespoke signature surface, injected into
// DefaultRoot's `fleet` body slot (FrontierRoot passes it). A hero MAP card with each host as a scattered
// beacon, over a 2-col rig grid — the prototype's `.map`/`.beacon`/`.rigs`, ported to real data. A PURE
// CONSUMER of the headless `useFleet` controller (same hosts data as every other Fleet) + the manual
// `frontierSelection` store (the owner directive: the bespoke fleets ignore the global auto-cycle and track
// their own selection). Placement + presentation come from `present()` (R2 scatter, indexed rig art, plate).
//
// Deliberately STATIC layout — no canvas, no ResizeObserver/measurement (the map is a fixed-height card, the
// grid is CSS): pure math that renders safely in jsdom (the B2 contract test mounts this). The sweep + beacon
// ping are CSS-only and gated by data-motion in frontier.css; off-tab the panel is display:none, so they cost
// nothing when hidden — no JS motion-gating needed here (unlike cosmos's WAAPI orbit).
//
// F3 opens a bottom sheet (the shared C3 primitive) on the selected rig — the same host-detail flow cosmos
// pioneered, wired here WITHOUT the camera bits (frontier's layout is static, so no onHeightChange lift). The
// sheet reuses the SAME placement art/plate the card shows, and stays interactive behind (catchOutside=false):
// tap another rig/beacon to SWAP, tap empty map ground to clear, flick-down/Escape to close.

// Persisted host-detail sheet detent (mirrors cosmos): a stable key into the shared, theme-agnostic
// `sheetSnap` store + a stable module-level setter (so `onSnapChange` keeps a constant identity per the prop's
// contract).
const SHEET_KEY = "frontier-host-detail";
const persistSheetSnap = (snap: SheetDetent) => setSheetSnap(SHEET_KEY, snap);

export function FrontierFleet({ active }: { active: boolean }) {
  const { hosts, svcByHost, run, busy, isLoading, error } = useFleet();
  const selected = useFrontierSelection();

  // Clear a selection whose host has left the fleet (config change / removal) — no stale `.sel` ghost, and
  // F3's sheet (which reads this store) won't reference a gone host. Mirrors the cosmos precedent.
  useEffect(() => {
    if (selected && !hosts.some((h) => h.id === selected)) setFrontierSelection(null);
  }, [selected, hosts]);

  // Resolve each host's placement + presentation ONCE per hosts array: R2 is deterministic, so beacons never
  // jitter across the 5s poll. `present` maps the host's own appearance blob. MEMOIZED on `hosts` (unlike
  // cosmos's plain map) because F3's `displayP` retention keys on a placement's IDENTITY — a per-render
  // rebuild would hand the retention effect a fresh object every render and loop it (setDisplayP → render →
  // new placement → effect …). TanStack's structural sharing keeps `hosts` stable across no-change polls,
  // so this is also why the sheet only re-renders when the fleet really changes.
  const placements = useMemo(
    () =>
      hosts.map((host, i) => {
        const enc = present(host, i, host.appearance?.frontier);
        const { x, y } = enc.position as { x: number; y: number };
        return {
          host,
          x,
          y,
          art: assets[enc.asset as string], // asset is a validated rig key → its hashed URL
          plate: enc.plate as string,
          online: !!host.status?.online,
        };
      }),
    [hosts],
  );
  const onlineCount = placements.filter((p) => p.online).length;

  // F3 host-detail sheet — open when the Fleet tab is showing AND a rig is selected. The sheet reuses the SAME
  // placement (art/plate) the card shows — never a re-run of present(). `displayP` retains the last placement
  // through the slide-OUT so the content doesn't blank while the sheet eases closed (selected→null).
  const selectedP = selected ? (placements.find((p) => p.host.id === selected) ?? null) : null;
  const sheetOpen = active && !!selectedP;
  const titleId = useId();
  const [displayP, setDisplayP] = useState<(typeof placements)[number] | null>(null);
  useEffect(() => {
    if (selectedP) setDisplayP(selectedP);
  }, [selectedP]);
  // `body[data-sheet=open]` drives the scoped frontier rule that hides the Kit composer while the sheet is up.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (sheetOpen) document.body.dataset.sheet = "open";
    else delete document.body.dataset.sheet;
    return () => {
      delete document.body.dataset.sheet;
    };
  }, [sheetOpen]);
  // When the host-detail sheet opens, collapse the composer plan sheet (D30) — otherwise it pokes out above the
  // host sheet. Its close is a downward slide+fade, so it slides away in step with the kit composer (which
  // frontier hides via body[data-sheet=open]). Frontier drives this since it owns the host sheet; the plan
  // sheet is kit chrome (so this reaches into the kit `planSheet` store). Mirrors the cosmos precedent.
  useEffect(() => {
    if (sheetOpen) setPlanSheetOpen(false);
  }, [sheetOpen]);

  // The label subtitle honestly reflects the fleet; while the first poll is in flight (no hosts yet) it reads
  // as a scan so the fixed-height card renders immediately with no layout jump (the loading state).
  const subtitle =
    isLoading && hosts.length === 0
      ? "scanning the badlands…"
      : `${hosts.length} rigs staked across the badlands`;

  return (
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-fleet"
      data-screen-label="01 frontier"
      role="tabpanel"
      aria-labelledby="tabbtn-fleet"
    >
      {/* THE MAP — always rendered (even at zero hosts: hero + an honest "0 live"), fixed height so the
          initial/loading paint never jumps. Tap empty ground → clear selection (the cosmos tap-empty-sky
          analog): a beacon click reaches the beacon (swap/toggle), any other spot on the card (art/scrim/label)
          reads as empty ground and closes the sheet. This is why the sheet passes catchOutside={false} — the
          map stays interactive behind it. */}
      <div
        className="frontier-map"
        onClick={(e) => {
          if (!(e.target as Element).closest(".frontier-beacon")) setFrontierSelection(null);
        }}
      >
        <div className="pic" style={{ backgroundImage: `url(${ART.hero})` }} />
        <div className="scrim" />
        <div className="frontier-sweep" aria-hidden />

        <div className="frontier-map-label">
          <div className="t">THE FRONTIER</div>
          <div className="s">{subtitle}</div>
        </div>
        <div className="frontier-count">
          <span className="led" />
          {onlineCount} live
        </div>

        {placements.map((p) => {
          const isSel = p.host.id === selected;
          return (
            <button
              type="button"
              key={p.host.id}
              className={"frontier-beacon" + (p.online ? "" : " off") + (isSel ? " sel" : "")}
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
              onClick={() => setFrontierSelection(isSel ? null : p.host.id)}
              aria-pressed={isSel}
              aria-label={`${p.host.name} — ${p.online ? "online" : "asleep"}`}
            >
              <span className="pin">
                {/* ping ring: online only (fewer live layers when asleep); animation is data-motion-gated */}
                {p.online && <span className="ring" aria-hidden />}
                <span className="dot" />
              </span>
              <span className="tag">{p.host.name}</span>
            </button>
          );
        })}
      </div>

      {/* THE RIG GRID — or one of the three explicit states (cosmos precedent). Error + empty replace the
          grid; while the FIRST poll is in flight nothing renders below the map (its subtitle already reads
          "scanning…" — an empty grid under a "tap to select" header would be dishonest chrome, audit F2).
          The map card above always stands, so the surface never blanks. */}
      {error ? (
        <div className="frontier-msg">// backend unreachable — {error.message}</div>
      ) : !hosts.length ? (
        !isLoading && <div className="frontier-msg">// no rigs in config.yaml</div>
      ) : (
        <>
          <div className="kit-sec">
            <span className="t">Your Rigs</span>
            <span className="grow" />
            <span className="hint">tap to select</span>
          </div>
          <div className="frontier-rigs">
            {placements.map((p) => {
              const isSel = p.host.id === selected;
              return (
                <button
                  type="button"
                  key={p.host.id}
                  className={"frontier-rig" + (p.online ? " on" : " dim") + (isSel ? " sel" : "")}
                  onClick={() => setFrontierSelection(isSel ? null : p.host.id)}
                  aria-pressed={isSel}
                  aria-label={`${p.host.name} — ${p.online ? "online" : "asleep"}`}
                >
                  <span className="led" aria-hidden />
                  <div className="art" style={{ backgroundImage: `url(${p.art})` }} />
                  <span className="plate">{p.plate}</span>
                  <div className="meta">
                    <div className="nm">{p.host.name}</div>
                    <div className="ro">{p.host.role ?? p.host.os_type}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div style={{ height: 16 }} />

      {/* F3 host-detail sheet — the shared C3 primitive, skinned by frontier.css. catchOutside={false} (owner
          ruling): the surface stays interactive so tapping another rig/beacon SWAPS the sheet; empty-ground tap
          clears; flick-down/Escape closes. No onHeightChange — frontier's layout is static (no camera lift). */}
      <BottomSheet
        open={sheetOpen}
        onClose={() => setFrontierSelection(null)}
        labelledBy={titleId}
        closeLabel="Close rig detail"
        catchOutside={false}
        initialSnap={getSheetSnap(SHEET_KEY)}
        onSnapChange={persistSheetSnap}
      >
        {/* `selectedP ?? displayP`: the live placement while open (so polls update the sheet), the retained
            last one through the slide-out (so content doesn't blank as it eases closed). */}
        {(selectedP ?? displayP) && (
          <FrontierHostDetail
            host={(selectedP ?? displayP)!.host}
            services={svcByHost.get((selectedP ?? displayP)!.host.id) ?? []}
            art={(selectedP ?? displayP)!.art}
            plate={(selectedP ?? displayP)!.plate}
            busy={busy.has((selectedP ?? displayP)!.host.id)}
            run={run}
            titleId={titleId}
          />
        )}
      </BottomSheet>
    </div>
  );
}
