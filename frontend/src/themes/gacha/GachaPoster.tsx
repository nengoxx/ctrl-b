import { useRef, useState, type CSSProperties } from "react";

import { hostDetailFacts } from "../../lib/hostDetail";
import { useThemeSetting } from "../../theme-engine/settings";
import type { Host, Service } from "../../types";
import { GACHA_COPY } from "./copy";
import { GachaStar } from "./GachaStar";
import { useCeremony } from "./ceremony";
import { partingStep, pickLabel, pingText, roleLabel } from "./fleet";
import type { GachaTrackProps } from "./GachaTrack";
import { isHighStar, rarityToken, starsFor, type StarMode } from "./stars";

// THE POSTER (GACHA_PLAN §12.6 E1, anatomy ruling 8) — gacha's second fleet layout and the finalists lab's
// screen A, ported: one black field carrying a parallelogram of equal SHEARED slices with open gutters, the
// selected one grown, and that machine's registry beneath.
//
// It replaces the TRACK BODY and nothing else. The head above it is the INHERITED `gc-track-head` (the lab's
// local "Fleet" kicker dies as its duplicate), the banner above that belongs to `GachaFleet`, and the
// dossier below is the same shared sheet the capsule track opens. Every prop is a RESOLVED value, so this
// layout cannot drift from capsule about what the fleet is.
//
// FIVE THINGS TO KNOW BEFORE EDITING THE MARKUP — all measured in the lab, all §12.6-ruled:
//
//  · THREE BOXES PER SLICE, because a clip-path erases an offset shadow — the shipped capsule card already
//    paid for this finding (`gacha.css`, "THE SLOT, and the ARCADE DROP"). The BUTTON is unpainted and wears
//    the UNION of the slice and its drop as its hit shape; `.po-drop` is the same polygon translated, in the
//    rarity hue; `.po-plate` is the slice, whose BACKGROUND is the keyline with the art one pixel inside the
//    SAME polygon (an inset box-shadow would be laid on the border-box rectangle and clipped away by it).
//  · SELECT-THEN-ACT: the first tap selects, the second opens (online) or wakes (asleep). Still exactly one
//    button per machine. The ROUTING is `GachaFleet`'s (`onTapHost`) — this file only dramatizes what came
//    back, and the dramatization is poll-truthful (ruling 4): the request is what is staged, the STATE is
//    the server's, and only a hosts poll flips a slice online.
//  · BLADE IS THE NAME'S SEAT AND NOTHING ELSE (the owner's amended WALK-3 ruling): same face, same size,
//    same hue, same hard shadow as PLATE; it sits lower, on the diagonal, with the role line lifted above
//    it. Both treatments are one `[data-name]` attribute on the root, exactly as the lab walked them.
//  · STATUS NEVER RIDES ON DECORATION ALONE (§12.3 ④): the chip stays, in its one authored seat, in both
//    treatments and both liveness skins. `WAKING` rides it only while the request is genuinely in flight.
//  · THE DATA BLOCK IS IN THE FLOW, LAST, and never sticky: production's bottom belongs to the tab bar and
//    the composer floating over it, so a pinned readout there is the natural WRONG implementation.

/** The `posterName` setting's two values — WHERE the machine name sits on a slice. */
type PosterName = "plate" | "blade";

/** Narrow the raw setting value, `toStarMode`'s shape. Poster-private: this is the only reader, so the
 *  bridge lives beside it rather than in `stars.ts` — there is nothing here for it to drift from. */
function toPosterName(raw: string | boolean | undefined): PosterName {
  return raw === "plate" ? "plate" : "blade";
}

/** The registry block reads only HOST-derived facts (liveness, ping, last seen) — it draws no service ROWS,
 *  so it has no live services to hand `hostDetailFacts`, and its SERVICES line lists the machine's
 *  CONFIGURED names, which is the same input its rarity is rolled from. A module-level constant rather than
 *  a fresh `[]` per render. */
const NO_LIVE_SERVICES: Service[] = [];

/** R24's ceremony budget: the wake's beats all land inside 900 ms. */
const WAKE_MS = 900;

/** The wake ceremony's presentation state — which machine is being staged, and which of the two beats'
 *  classes are currently on. ONE object, so "which slice" and "which beat" can never disagree. */
interface WakeStage {
  id: string;
  parting: boolean;
  flash: boolean;
}

export function GachaPoster({
  hosts,
  error,
  isLoading,
  reeling,
  starMode,
  art,
  counter,
  picked,
  onTapHost,
  busy,
  waking,
}: GachaTrackProps) {
  // Read HERE rather than threaded down from `GachaFleet`: `posterName` is meaningless to every other
  // layout (it is `showWhen`-scoped to this one in Conf for exactly that reason), so a prop would put a
  // poster-private axis into the shared variant contract.
  const nameMode = toPosterName(useThemeSetting<string>("gacha", "posterName"));
  const [stage, setStage] = useState<WakeStage | null>(null);
  const ceremony = useCeremony();
  // ONE GESTURE, ONE EFFECT (Codex E1 MED-1). A skip and a tap are the SAME finger, but they are two
  // browser events, and the ceremony ends between them: `useCeremony`'s document `pointerdown` listener
  // skips, React commits `running: false`, and by the time the browser dispatches the `click` the guard
  // below reads a ceremony that is no longer running — so the gesture that meant "stop the theatre" also
  // selected another machine, or (if the wake request had already settled and re-enabled the slice) sent
  // a SECOND wake.
  //
  // The ref closes the gap because it is written in the pointerdown's OWN dispatch, where this closure is
  // still the pre-skip render and `ceremony.running` is still true. It is written on EVERY pointerdown,
  // not only on a skipping one: a `true` left behind by a gesture that never produced a click (a drag, a
  // scroll, a pointer that left the button) would otherwise swallow the NEXT real tap. That overwrite
  // reaches only POINTER gestures, though — a keyboard activation produces a `click` with no pointerdown —
  // so `keydown` clears the ref too (Codex E1 confirm-round LOW): a skip whose gesture never clicked (the
  // finger dragged away) must not swallow an Enter/Space that arrives next.
  const skippedGesture = useRef(false);

  // The staged machine's index. A machine that left the fleet mid-ceremony resolves to -1, which stands the
  // whole parting down rather than translating every slice by a bogus distance.
  const stageIndex = stage ? hosts.findIndex((h) => h.id === stage.id) : -1;
  const parting = !!stage?.parting && stageIndex >= 0;

  /** One tap on a slice. A tap DURING a ceremony is swallowed into a skip: R24 §B.3's tap-anywhere-skip
   *  already reaches here through the hook's own document listener, and letting the same gesture ALSO
   *  re-select would move the stack out from under the finger that is skipping it. */
  const onSliceTap = (hostId: string) => {
    if (skippedGesture.current) {
      // this finger's pointerdown already ended a ceremony; the click it produced is spent
      skippedGesture.current = false;
      return;
    }
    if (ceremony.running) {
      // the keyboard path, and the belt for any dispatch that reaches here with the ceremony still live:
      // Enter/Space produce a `click` with no pointerdown at all, so the ref above can never cover them.
      ceremony.skip();
      return;
    }
    if (onTapHost(hostId) !== "wake") return;
    // THE WAKE CEREMONY — the lab's beats verbatim (`app.js`: 0 part · 180 flashline · 700 part off · 880
    // flashline off) MINUS its 520 ms ONLINE flip, which is prototype fiction and does not port. The
    // ANNOUNCEMENT is not here: `GachaFleet` owns the live region and speaks "Waking X." as it dispatches,
    // so the sentence is tied to the REQUEST rather than to the theatre.
    ceremony.start(
      [
        [0, () => setStage({ id: hostId, parting: true, flash: false })],
        [180, () => setStage((s) => (s ? { ...s, flash: true } : s))],
        [700, () => setStage((s) => (s ? { ...s, parting: false } : s))],
        [880, () => setStage(null)],
      ],
      WAKE_MS,
    );
  };

  // The machine the registry describes. `picked` is resolved ABOVE (`pickedId ?? hosts[0]?.id`), so a
  // selection whose machine left the fleet has already re-derived by the time it arrives here — this can
  // never dereference a gone host, and it is never empty while the fleet has machines.
  const shown = hosts.find((h) => h.id === picked) ?? null;

  return (
    <>
      {/* The INHERITED head (§12.6 ruling 9): capsule and poster keep it, and the poster's lab-local
          "Fleet" kicker dies as its duplicate. Byte-identical to the capsule track's, deliberately — one
          fleet, one heading, whichever layout draws the machines. */}
      <div className="gc-track-head">
        <h1>
          {GACHA_COPY.trackHead}
          <em>Select a unit</em>
        </h1>
        <span className="count">{counter}</span>
      </div>

      {/* The state semantics are the capsule track's, to the letter: the error notice renders BESIDE
          whatever the last successful poll left, an answered-but-empty fleet says so, and while the FIRST
          poll is in flight nothing renders below the head at all. */}
      {error && <div className="gc-msg">backend unreachable: {error.message}</div>}
      {!error && hosts.length === 0 && !isLoading && (
        <div className="gc-msg">no hosts in config.yaml</div>
      )}

      {/* THE POSTER's COLUMN — the stack and its registry as one box, which is what lets the two agree on
          the leading edge (`--lead`/`--trail` live on it) and lets the registry's display line scale off
          the COLUMN while a slice scales off the stack. `inert` while the reel sweeps (§6.4/F3): the whole
          layout must refuse input, exactly as the capsule track's grid does. */}
      {hosts.length > 0 && (
        <div className="po-body" inert={reeling}>
          <div className={"po-poster" + (parting ? " parting" : "")} data-name={nameMode}>
            {hosts.map((host, i) => {
              const online = !!host.status?.online;
              const stars = starsFor((host.services ?? []).length, starMode);
              const isPicked = host.id === picked;
              const isBusy = busy.has(host.id);
              const slice = art(i);
              return (
                <button
                  key={host.id}
                  type="button"
                  className={
                    "po-slice gc-host-hit" +
                    (online ? "" : " asleep") +
                    (isPicked ? " picked" : "") +
                    (isBusy ? " busy" : "") +
                    (stage?.flash && stage.id === host.id ? " waking" : "")
                  }
                  style={
                    {
                      // The rarity hue INPUT, per slice. The CSS resolves it into `--po-hue`, which is
                      // what the keyline, the drop, the wash and the name actually read — because an
                      // inline custom property beats every selector, so a `.asleep` rule writing THIS
                      // one could never override it, and the sleeping suppression IS that override
                      // (gacha.css states the trap in full). A machine that is asleep still HAS its
                      // rarity, which is why the suppression is presentation and not this value.
                      "--po-rar": rarityToken(stars, starMode),
                      // How far this slice steps aside while the stack parts. Zero at rest so the ceremony's
                      // transition has a resting value to animate from and back to.
                      "--po-part": parting ? partingStep(i, stageIndex) : 0,
                      // The roster entry's own focal crop, when it declares one (the card/promo idiom).
                      ...(slice?.focus === undefined ? null : { "--po-focus": slice.focus }),
                    } as CSSProperties
                  }
                  aria-label={pickLabel(host, stars, isPicked)}
                  aria-pressed={isPicked}
                  aria-busy={isBusy || undefined}
                  disabled={isBusy}
                  // CAPTURE phase, and it records the ceremony's state RATHER than acting on it — the
                  // hook's own document listener does the skipping. See `skippedGesture`.
                  onPointerDownCapture={() => {
                    skippedGesture.current = ceremony.running;
                  }}
                  // A keyboard activation is click-without-pointerdown: any suppression still standing
                  // belongs to a pointer gesture that never clicked, and this key must not pay for it.
                  onKeyDownCapture={() => {
                    skippedGesture.current = false;
                  }}
                  onClick={() => onSliceTap(host.id)}
                >
                  {/* THE HARD OFFSET DROP — the theme's `5px 5px 0` motif, as a DUPLICATED POLYGON (see the
                    header note: a clip-path erases a real box-shadow). */}
                  <span className="po-drop" aria-hidden />
                  <span className="po-plate">
                    <span className="po-art">
                      {slice ? (
                        <img src={slice.url} alt="" draggable={false} decoding="async" />
                      ) : (
                        // The resolver's placeholder case (an empty roster or an unusable file): a slice
                        // without art is still a slice — hue, name, role and chip all read (§5.3's "render
                        // stays silent"; the Conf gallery is where the owner is told).
                        <span className="po-art-blank" aria-hidden />
                      )}
                      <span className="po-glow" aria-hidden />
                      <span className="po-veil" aria-hidden />
                    </span>
                    {/* THREE SIBLINGS so BLADE can re-order the role ABOVE the name (beneath it, the shear
                      would slice the role away). The zone is rotated onto the shear in CSS, anchored at its
                      bottom-leading corner. */}
                    <span className="po-zone">
                      <span className="po-stars" aria-hidden>
                        {Array.from({ length: stars }, (_, s) => (
                          <GachaStar key={s} hi={isHighStar(s, starMode)} />
                        ))}
                      </span>
                      <span className="po-name">
                        <b>{host.name.toUpperCase()}</b>
                      </span>
                      <span className="po-role">{roleLabel(host)}</span>
                    </span>
                    {/* STATUS, always literal (§12.3 ④). `WAKING` is licensed by the REQUEST being in flight
                      and by nothing else — when it settles the chip returns to the server's word, which
                      stays SLEEPING until a poll says otherwise. */}
                    <span className="po-chip">
                      {waking.has(host.id) ? "WAKING" : online ? "ONLINE" : "SLEEPING"}
                    </span>
                    <span className="po-flashline" aria-hidden />
                  </span>
                </button>
              );
            })}
          </div>

          {/* THE REGISTRY — the selected machine's own data, in the flow, LAST, never pinned. A readout:
              no buttons, because the poster already owns exactly one control per machine. Keyed on the
              machine so a re-selection REPLAYS its entrance (the lab's `replay(foot)`): React would
              otherwise reuse the node and the swap would land with no acknowledgement at all. */}
          {shown && <PosterData key={shown.id} host={shown} mode={starMode} />}
        </div>
      )}
    </>
  );
}

/** The selected machine's registry block. Every value comes from a formatter the DOSSIER already uses, so
 *  the two surfaces can never describe one machine differently. */
function PosterData({ host, mode }: { host: Host; mode: StarMode }) {
  const facts = hostDetailFacts(host, NO_LIVE_SERVICES);
  const stars = starsFor((host.services ?? []).length, mode);
  const ping = facts.online && facts.ping != null ? pingText(facts.ping) : GACHA_COPY.metricPending;
  const services = (host.services ?? []).map((s) => s.name);
  const sep = ` ${GACHA_COPY.sep} `;
  return (
    <div className="po-data" style={{ "--po-rar": rarityToken(stars, mode) } as CSSProperties}>
      {/* The hostname as a DISPLAY line in the machine's own rarity hue — with the lab's left rail cut,
          this block is the only place the selected machine is named. */}
      <b className="po-fname">{host.name}</b>
      <div>{[roleLabel(host), facts.online ? "ONLINE" : "SLEEPING", `PING ${ping}`].join(sep)}</div>
      {/* UPTIME prints the DEFERRED seam's ruled dash — no backend boot time, the same em dash the
          dossier's own metric grid shows for the same reason. */}
      <div>
        {[`UPTIME ${GACHA_COPY.metricPending}`, `SEEN ${facts.seen.toUpperCase()}`].join(sep)}
      </div>
      <div className="po-fsvc">
        {`SERVICES${sep}${services.length === 0 ? "NONE" : services.join(sep).toUpperCase()}`}
      </div>
    </div>
  );
}
