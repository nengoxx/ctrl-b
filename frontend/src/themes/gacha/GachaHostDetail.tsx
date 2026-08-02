import type { FleetAction } from "../../hooks/useActions";
import { hostDetailFacts } from "../../lib/hostDetail";
import type { Host, Service } from "../../types";
import { GACHA_COPY } from "./copy";
import { CLOSE_DOSSIER_LABEL, dossierSub, pingText } from "./fleet";
import type { ResolvedArt } from "./roster";
import { isHighStar, starsFor, type StarMode } from "./stars";

// THE UNIT DOSSIER (D52 / GACHA_PLAN §4.8, G2) — the prototype's `.detail-panel`, rendered inside the
// shared <BottomSheet> (the C3 primitive cosmos pioneered and frontier reuses). The theme's ONE light
// surface: gacha stays `modes: ["dark"]`, so the inversion is a SURFACE, not a mode — an arcade prize
// slip pulled out from under the night-time cabinet.
//
// A PURE presentation of `useFleet` data (the cosmos C3b / frontier F3 shape): host, its live services,
// the resolved art and the action handles all come from GachaFleet. No data fetching, no store reads, and
// no star or roster logic of its own — `starsFor` and the roster resolver stay the single sources, so a
// machine's dossier shows the SAME character and the SAME rarity its capsule card does.
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
  /** A host action is in flight (`useFleet().busy`) — disables the whole bar. */
  busy: boolean;
  run: (action: FleetAction, host: Host) => Promise<void>;
  titleId: string; // aria-labelledby target the sheet points at (the host name)
  /** Dismiss the dossier — the prototype's visible corner close (owner-restored 2026-08-02). Optional so
   *  the content stays renderable standalone (the tests do); with no handler the corner is simply absent. */
  onClose?: () => void;
}

/** How many accent pairs the tri-accent yields — pink→violet, violet→cyan, cyan→pink. The prototype's
 *  fixture hand-assigned each host a `color`/`color2`; live hosts have no such field, so the port deals
 *  them deterministically by DISPLAY INDEX (`i % 3`). Deterministic means a poll can never re-tint a
 *  dossier, and the pairs themselves are token-authored in gacha.css (no per-host values anywhere). */
const ACCENT_PAIRS = 3;

export function GachaHostDetail({
  host,
  services,
  art,
  mode,
  index,
  busy,
  run,
  titleId,
  onClose,
}: Props) {
  const facts = hostDetailFacts(host, services);
  const online = facts.online;
  // The ruled star + Services input (§6.1/§4.8): CONFIGURED services, the same count the capsule card
  // rolls its rarity from — never the live list, which would make both flicker when a service blinks.
  const configured = (host.services ?? []).length;
  const stars = starsFor(configured, mode);

  // Ping is real only while the machine answers; an online host with no measurement reads the placeholder
  // rather than inventing a number (the frontier precedent). The placeholder is §4.8's RULED em dash
  // (`metricPending` — from copy.ts, the ASCII fence's one non-ASCII home), which `relativeTime`'s own
  // null case already matches, so an unpolled host reads one identical dash in every held slot.
  const ping = online && facts.ping != null ? pingText(facts.ping) : GACHA_COPY.metricPending;
  const seen = online ? "now" : facts.lastSeen;

  const metrics: [value: string, label: string, jp: string][] = [
    [ping, "Ping", GACHA_COPY.metricPing],
    // Uptime is DEFERRED (no backend boot time — the cosmos/frontier precedent): a VISIBLE dash, wired to
    // become additive the day the seam exists.
    [GACHA_COPY.metricPending, "Uptime", GACHA_COPY.metricUptime],
    // A real 0 renders as "0", not a dash: a machine with no services configured is a fact, not a gap.
    [String(configured), "Services", GACHA_COPY.metricServices],
    [seen, "Seen", GACHA_COPY.metricSeen],
  ];

  return (
    <div className="gc-dossier" data-pair={index >= 0 ? index % ACCENT_PAIRS : 0}>
      {/* THE VISIBLE CLOSE (the prototype's `.close-detail`). It sits in the corner the handle's invisible
          16px drag hit-strip reaches into, so it carries the z-index that puts it ABOVE that strip — the
          cosmos chevron lesson, applied deliberately rather than avoided. The kit's own sr-only close stays
          (it is the primitive's, and gacha does not fork the primitive); both carry the SAME name, because
          they are the same action on the same sheet. */}
      {onClose && (
        <button
          type="button"
          className="gc-dossier-close"
          aria-label={CLOSE_DOSSIER_LABEL}
          onClick={onClose}
        />
      )}
      {/* data-bs-peek: the PEEK detent ends here — the sheet opens showing the portrait, the rarity and the
          name/role line; drag-up reveals the metrics + services. The only interactive thing in the top 16px
          — where the handle's invisible drag hit-strip (`.bs-handle::after`, z 1) overlaps the body — is the
          close corner above, which is stacked over that strip on purpose (the cosmos chevron lesson). */}
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

      {/* THE HOST ACTION BAR (council H3) — the prototype has no design for one, so this is gacha's own
          visual language on KIT SEMANTICS: the same action set the precedent dossiers carry, over the same
          typed-action `run` (which owns the confirm dialog for reboot/shutdown, the optimistic flip and the
          toast — no new execution path exists here). The PRIMARY action is a filled arcade ticket — the
          brand two-stop with the kit's verified `--accent-ink`, on the prototype's own 12px button radius,
          with the hard offset shadow this theme uses for anything that "sits on" a surface (the nav
          indicator, the user bubble); pressing it sinks the ticket into its own shadow. Shut down is the
          quiet white pill: a machine's power-off should never be the loudest thing on its dossier. */}
      <div className="gc-acts" aria-busy={busy || undefined}>
        {online ? (
          <>
            <button
              type="button"
              className="gc-act primary"
              disabled={busy}
              onClick={() => run("reboot", host)}
            >
              Reboot
            </button>
            <button
              type="button"
              className="gc-act danger"
              disabled={busy}
              onClick={() => run("shutdown", host)}
            >
              Shut down
            </button>
          </>
        ) : (
          <button
            type="button"
            className="gc-act primary"
            disabled={busy}
            onClick={() => run("wake", host)}
          >
            Wake
          </button>
        )}
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
