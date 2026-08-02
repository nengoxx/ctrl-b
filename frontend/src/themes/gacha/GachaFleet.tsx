import { useFleet } from "../../hooks/useFleet";
import { useThemeSetting } from "../../theme-engine/settings";
import { GachaBanner, type BannerSlide } from "./GachaBanner";
import { HERO_KEY } from "./carousel";
import { hostsResolved, rateText } from "./fleet";
import { defaultRoster, heroArt, wideArtForHost } from "./roster";
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

/** THE SHARED OPEN-HOST SEAM (main-seat ruling) — one handler behind both the capsule cards and the promo
 *  slides, so there is exactly one "open this machine" concept in the theme.
 *
 *  It is a STUB at G1 and that is deliberate: the unit dossier is G2's slice, and building an interim sheet
 *  here would be a surface G2 has to delete (fix-in-the-owning-phase). The buttons, their accessible names
 *  and their press feedback are real NOW so the interaction design is reviewable at the G1 eyeball; only the
 *  destination is missing. */
function openHostDossier(_hostId: string): void {
  // G2: open the unit dossier for this host.
}

export function GachaFleet({ active }: { active: boolean }) {
  const { hosts, isLoading, error } = useFleet();
  const starMode = toStarMode(useThemeSetting<string>("gacha", "starMode"));

  const onlineCount = hosts.filter((h) => h.status?.online).length;
  // §6.3's loading semantics, shared by the rate pill and (G1's track) the counter: an unresolved fleet
  // reads as a held value, never as a confident "0".
  const resolved = hostsResolved(isLoading, error, hosts.length);

  // The §6.4 slide set: the fixed hero, then ONE promo per host — online AND sleeping (the ruled membership;
  // a sleeping promo renders dimmed, which keeps its click useful: open the dossier, then wake).
  const slides: BannerSlide[] = [
    { key: HERO_KEY, host: null, art: heroArt(ROSTER), online: true },
    ...hosts.map((host, i) => ({
      key: host.id,
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
    </div>
  );
}
