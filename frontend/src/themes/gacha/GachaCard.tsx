import type { PointerEvent } from "react";

import type { Host } from "../../types";
import { openLabel, plateSub, type CapsuleShape } from "./fleet";
import { GachaStar } from "./GachaStar";
import type { ResolvedArt } from "./roster";
import { isHighStar, starsFor, type StarMode } from "./stars";

// A CAPSULE CARD (D52 / GACHA_PLAN §6.1/§6.2) — the prototype's `.capsule-card`: a notched, masked portrait
// with a rarity row, a state chip, a nameplate and a shine sweep. One host, one card, one button.
//
// The card is a REAL BUTTON wired to the same `openHost` seam the promo slides use, so the theme has exactly
// one "open this machine" concept (main-seat ruling). At G1 the seam is a stub — the dossier is G2 — but the
// button, its accessible name and its press feedback are real now so the interaction is reviewable.

interface Props {
  host: Host;
  art: ResolvedArt | null;
  shape: CapsuleShape;
  mode: StarMode;
  /** The shared open seam. A card also hands over its portrait node — the M3 morph's FROM element; the
   *  promo slides pass nothing and open plain. */
  onOpen: (hostId: string, morphImg?: HTMLImageElement | null) => void;
  /** Wear the `NEW` ribbon (G6's demo — one card in the track; see `pickRibbonHost`). Decoration only. */
  isNew?: boolean;
}

/** Re-arm the shine so a TAP sweeps it (§10.3: the prototype's `:hover` sweep never fires on the owner's
 *  phone). A class-remove / reflow / class-add on a purely decorative node — the prototype's own
 *  `void offsetWidth` idiom — rather than React state: nothing about the app changes, and re-rendering a
 *  card to move a gradient would be the wrong tool. The `getBoundingClientRect()` read IS the reflow. */
function armShine(e: PointerEvent<HTMLButtonElement>): void {
  const shine = e.currentTarget.querySelector<HTMLElement>(".shine");
  if (!shine) return;
  shine.classList.remove("go");
  shine.getBoundingClientRect();
  shine.classList.add("go");
}

export function GachaCard({ host, art, shape, mode, onOpen, isNew }: Props) {
  const online = !!host.status?.online;
  // The ruled input (§6.1): CONFIGURED services, not live ones — so a card's rarity changes only when the
  // owner edits the machine, never when a service blinks.
  const stars = starsFor((host.services ?? []).length, mode);

  return (
    // THE BUTTON IS THE SLOT (Codex wave-12 #5). It owns the grid cell edge to edge, so everything the
    // owner can SEE of a card is also tappable — including the accent drop along its right and bottom,
    // which used to sit on an inert wrapper and swallow thumb taps that landed on it.
    //
    // Inside it, `.gc-card-face` is the visual card: the one that is `mask`ed to the capsule silhouette
    // (the 315° notch) and `overflow: hidden`, inset by the lift so the drop has somewhere to fall. That
    // split is forced — a mask is applied AFTER filters, so (verified by pixel probe) `box-shadow` and
    // `filter: drop-shadow()` on a masked element are both erased by it, and the drop can only be painted
    // by a box OUTSIDE the masked one. It is now the button's own `::before`; the button is unmasked, so
    // the pseudo survives, and the button is the hit area, so nothing visible is inert.
    //
    // Every positioned child keeps the face as its containing block, which is the SAME box they had when
    // the button carried the mask — so none of their geometry moves.
    <button
      type="button"
      className={"gc-card " + shape + (online ? "" : " sleep")}
      aria-label={openLabel(host.name, online)}
      onPointerDown={armShine}
      onClick={(e) => onOpen(host.id, e.currentTarget.querySelector("img"))}
    >
      <span className="gc-card-face">
        {art ? (
          <img
            src={art.url}
            alt=""
            draggable={false}
            style={art.focus === undefined ? undefined : { objectPosition: art.focus }}
          />
        ) : (
          // The resolver's placeholder case (an empty roster or an unusable file): a card without art is
          // still a card — the plate, chip and rarity all read, over the theme's own surface (§5.3's
          // "render stays silent"; the Conf gallery is where the owner is told).
          <span className="gc-card-blank" aria-hidden />
        )}
        {/* The rarity row is aria-hidden: five repeated marks would read out one by one, and the button's
          label already names the machine and its state. The mark itself is the DRAWN star (R16) — see
          GachaStar for why it is no longer the ★ glyph. */}
        <span className="rar" aria-hidden>
          {Array.from({ length: stars }, (_, i) => (
            <GachaStar key={i} hi={isHighStar(i, mode)} />
          ))}
        </span>
        <span className={"state" + (online ? " on" : "")}>{online ? "ONLINE" : "SLEEPING"}</span>
        {/* The `NEW` ribbon DEMO (G6 item iv). `aria-hidden` because it carries nothing: it is a look the
          owner is being shown, not a fact about the machine — and the button's own label already says the
          machine's name and state. It sits on the OPPOSITE corner from `.state` on purpose (gacha.css):
          the state chip is real status and must not be displaced by a decoration. */}
        {isNew && (
          <span className="gc-new" aria-hidden>
            NEW
          </span>
        )}
        <span className="plate">
          <b>{host.name}</b>
          <small>{plateSub(host)}</small>
        </span>
        <i className="shine" aria-hidden />
      </span>
    </button>
  );
}
