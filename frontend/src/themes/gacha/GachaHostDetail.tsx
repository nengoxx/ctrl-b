import { hostDetailFacts } from "../../lib/hostDetail";
import type { Host, Service } from "../../types";
import { GACHA_COPY } from "./copy";
import { PENDING, dossierSub } from "./fleet";
import type { ResolvedArt } from "./roster";
import { isHighStar, starsFor, type StarMode } from "./stars";

// THE UNIT DOSSIER (D52 / GACHA_PLAN §4.8, G2) — the prototype's `.detail-panel`, rendered inside the
// shared <BottomSheet> (the C3 primitive cosmos pioneered and frontier reuses). The theme's ONE light
// surface: gacha stays `modes: ["dark"]`, so the inversion is a SURFACE, not a mode — an arcade prize
// slip pulled out from under the night-time cabinet.
//
// A PURE presentation of `useFleet` data (the cosmos C3b / frontier F3 shape): host, its live services and
// the resolved art all come from GachaFleet. No data fetching, no store reads, no star or roster logic — `starsFor` and the roster resolver stay the single sources,
// so a machine's dossier shows the SAME character and the SAME rarity its capsule card does.
//
// THE METRIC GRID IS RULED (§4.8, Codex R4-10) and is deliberately NOT frontier's: Ping is real, Uptime is
// the deferred-seam dash, Services is the CONFIGURED count (the star input — not frontier's live up/total),
// Seen is now-or-relative. The prototype's Load/Temp tiles are dropped: no backend seam feeds them.

interface Props {
  host: Host;
  /** The host's LIVE services (`useFleet().svcByHost`) — the dot rows. NOT the star/metric input, which is
   *  the host's own CONFIGURED `services` array. */
  services: Service[];
  /** The roster's assignment for this host — the SAME entry its capsule card and promo slide render. */
  art: ResolvedArt | null;
  mode: StarMode;
  /** The host's position in the fleet's DISPLAY order — picks its accent pair (see `data-pair` below). */
  index: number;
  titleId: string; // aria-labelledby target the sheet points at (the host name)
}

/** How many accent pairs the tri-accent yields — pink→violet, violet→cyan, cyan→pink. The prototype's
 *  fixture hand-assigned each host a `color`/`color2`; live hosts have no such field, so the port deals
 *  them deterministically by DISPLAY INDEX (`i % 3`). Deterministic means a poll can never re-tint a
 *  dossier, and the pairs themselves are token-authored in gacha.css (no per-host values anywhere). */
const ACCENT_PAIRS = 3;

export function GachaHostDetail({ host, services, art, mode, index, titleId }: Props) {
  const facts = hostDetailFacts(host, services);
  const online = facts.online;
  // The ruled star + Services input (§6.1/§4.8): CONFIGURED services, the same count the capsule card
  // rolls its rarity from — never the live list, which would make both flicker when a service blinks.
  const configured = (host.services ?? []).length;
  const stars = starsFor(configured, mode);

  // Ping is real only while the machine answers; an online host with no measurement reads the placeholder
  // rather than inventing a number (the frontier precedent).
  const ping = online && facts.ping != null ? `${facts.ping} ms` : PENDING;
  // `relativeTime`'s own null case is an em dash — a glyph the frozen font subset does not carry (it would
  // render in the fallback face beside the ASCII dash the tile above it uses). An unpolled host therefore
  // reads the theme's own placeholder; a real timestamp reads its relative form.
  const seen = online ? "now" : host.status?.last_seen ? facts.lastSeen : PENDING;

  const metrics: [value: string, label: string, jp: string][] = [
    [ping, "Ping", GACHA_COPY.metricPing],
    // Uptime is DEFERRED (no backend boot time — the cosmos/frontier precedent): a VISIBLE dash, wired to
    // become additive the day the seam exists.
    [PENDING, "Uptime", GACHA_COPY.metricUptime],
    // A real 0 renders as "0", not a dash: a machine with no services configured is a fact, not a gap.
    [String(configured), "Services", GACHA_COPY.metricServices],
    [seen, "Seen", GACHA_COPY.metricSeen],
  ];

  return (
    <div className="gc-dossier" data-pair={index >= 0 ? index % ACCENT_PAIRS : 0}>
      {/* data-bs-peek: the PEEK detent ends here — the sheet opens showing the portrait, the rarity and the
          name/role line; drag-up reveals the metrics + services. Nothing interactive lives in the top 16px,
          which is where the handle's invisible drag hit-strip (`.bs-handle::after`, z 1) overlaps the body
          — the cosmos chevron lesson: a control up there gets its taps eaten. */}
      <div className="gc-dossier-head" data-bs-peek>
        <div className="art-frame">
          {art ? (
            <img
              className="avatar"
              src={art.url}
              alt=""
              draggable={false}
              style={art.focus === undefined ? undefined : { objectPosition: art.focus }}
            />
          ) : (
            // The resolver's placeholder case (empty roster / unusable file): the frame still holds the
            // rarity badge, so the dossier's composition survives a missing character.
            <span className="avatar blank" aria-hidden />
          )}
          {/* aria-hidden for the same reason the card's rarity row is: the glyphs would be read out one by
              one, and the sheet is already labelled by the machine's name. */}
          <span className="art-rar" aria-hidden>
            {Array.from({ length: stars }, (_, i) => (
              <i key={i} className={isHighStar(i, mode) ? "hi" : undefined}>
                {GACHA_COPY.star}
              </i>
            ))}
          </span>
        </div>
        <div className="gc-dossier-title">
          <span className="unit-no">UNIT DOSSIER</span>
          <h2 id={titleId}>{host.name}</h2>
          <p>{dossierSub(host, online)}</p>
        </div>
      </div>

      <div className="gc-metrics">
        {metrics.map(([value, label, jp]) => (
          <div className="gc-metric" key={label}>
            <b>{value}</b>
            <span>
              {label} {jp}
            </span>
          </div>
        ))}
      </div>

      <div className="gc-svcs">
        {services.length === 0 ? (
          <div className="gc-svc-empty">no services on this unit</div>
        ) : (
          services.map((s) => {
            const svcOn = !!s.status?.online;
            return (
              <div
                className={"gc-svc" + (svcOn ? " on" : "")}
                key={s.id}
                role="group"
                aria-label={`${s.name} ${svcOn ? "online" : "offline"}`}
              >
                <i aria-hidden />
                <strong>{s.name}</strong>
                <small>{s.port == null ? (svcOn ? "healthy" : "offline") : `:${s.port}`}</small>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
