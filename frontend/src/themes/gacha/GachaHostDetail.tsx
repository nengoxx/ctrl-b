import type { FleetAction } from "../../hooks/useActions";
import { hostDetailFacts } from "../../lib/hostDetail";
import { rebaseServiceUrl, serviceBase } from "../../lib/serviceBase";
import { ServiceIcon } from "../../theme-engine/kit/ServiceIcon";
import type { Host, Service } from "../../types";
import { GACHA_COPY } from "./copy";
import { GachaStar } from "./GachaStar";
import { CLOSE_DOSSIER_LABEL, dossierSub, pingText, showArtLabel } from "./fleet";
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
  /** A host action is in flight (`useFleet().busy`) — disables the whole bar. */
  busy: boolean;
  run: (action: FleetAction, host: Host) => Promise<void>;
  titleId: string; // aria-labelledby target the sheet points at (the host name)
  /** Dismiss the dossier — the prototype's visible corner close (owner-restored 2026-08-02). Optional so
   *  the content stays renderable standalone (the tests do); with no handler the corner is simply absent. */
  onClose?: () => void;
  /** Show this unit's art FULL SCREEN (the showcase, owner request 2026-08-02) — the portrait becomes a
   *  real button when a host supplies this. Optional on the same terms as `onClose`, and additionally
   *  meaningless without art: a placeholder frame has nothing to enlarge, so it stays a plain span. */
  onShowArt?: () => void;
}

export function GachaHostDetail({
  host,
  services,
  art,
  mode,
  busy,
  run,
  titleId,
  onClose,
  onShowArt,
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

  // THE PORTRAIT. One node, two wrappings: bare when it is only a picture, inside a real BUTTON when the
  // host offers the full-screen showcase. The `.avatar` element itself is untouched by that choice — it is
  // what the morph is named on (gacha.css) and what GachaFleet suppresses for a capture, so wrapping it
  // must not move it. The placeholder case never becomes a button: there is no art to enlarge.
  const portrait = art ? (
    <img
      className="avatar"
      src={art.url}
      alt=""
      draggable={false}
      style={art.focus === undefined ? undefined : { objectPosition: art.focus }}
    />
  ) : (
    // The resolver's placeholder case (empty roster / unusable file): the frame still holds the rarity
    // badge, so the dossier's composition survives a missing character.
    <span className="avatar blank" aria-hidden />
  );

  return (
    <div className="gc-dossier">
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
      {/* THE CHARACTER WATERMARK (G6.4, owner request 2026-08-06: "put the character image as a background
          of the bottom sheet, like the dotted texture — faded, so it's visible, positioned center-right, in
          the empty zone right of the PC name"). A SECOND, purely decorative copy of the SAME resolved file
          the portrait draws — no second resolver, no second fetch (identical URL ⇒ the browser reuses the
          decode), and no art means no watermark: a placeholder frame has nothing to echo.
          It is NOT part of any View Transition group — `capsule-shell` is named on `.avatar` alone
          (gacha.css), and this node carries no name, so the detail/showcase morphs are untouched.
          PAINT ORDER is positional, not z-index'd: this is the first POSITIONED child of `.gc-dossier`, and
          the four content blocks below it are positioned too (gacha.css), so every one of them paints after
          it in tree order. Deliberately NOT `z-index: -1` + `isolation` on `.gc-dossier`: isolating it would
          trap `.gc-dossier-close`'s z-index 2 inside a local context, and that 2 exists precisely to clear
          the handle's z-1 drag strip in the SHEET's stacking context. */}
      {art && (
        <img
          className="gc-dossier-mark"
          src={art.url}
          alt=""
          aria-hidden
          draggable={false}
          style={art.focus === undefined ? undefined : { objectPosition: art.focus }}
        />
      )}
      {/* data-bs-peek: the PEEK detent ends here — the sheet opens showing the portrait, the rarity and the
          name/role line; drag-up reveals the metrics + services. The only interactive thing in the top 16px
          — where the handle's invisible drag hit-strip (`.bs-handle::after`, z 1) overlaps the body — is the
          close corner above, which is stacked over that strip on purpose (the cosmos chevron lesson). */}
      <div className="gc-dossier-head" data-bs-peek>
        <div className="art-frame">
          {art && onShowArt ? (
            <button
              type="button"
              className="gc-art-btn"
              aria-label={showArtLabel(host.name)}
              onClick={onShowArt}
            >
              {portrait}
            </button>
          ) : (
            portrait
          )}
          {/* aria-hidden for the same reason the card's rarity row is: five repeated marks would be read
              out one by one, and the sheet is already labelled by the machine's name. Same drawn primitive
              as the card (R16) — one mark, two sizes. The ELEMENT keeps its `art-rar` class through the
              G7 restyle: it carries the `dossier-rar` view-transition-name (gacha.css) and GachaFleet's
              lingering-badge suppression queries it by that selector. */}
          <span className="art-rar" aria-hidden>
            {Array.from({ length: stars }, (_, i) => (
              <GachaStar key={i} hi={isHighStar(i, mode)} />
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
            {/* Bilingual caption on TWO LINES (owner 2026-08-03). The prototype puts both halves in one
                span and lets them wrap, which is what shipped — but at this width only `Services サービス`
                is long enough to wrap, so the row came out ragged: three cards one line, one card two.
                The JP half is NESTED (not a sibling span) and blocked by CSS: it keeps the label's text
                exactly `Ping 応答`, which the dossier unit tests read as the card's identity, and it is the
                prototype's own bilingual idiom — its nav label nests an `em` inside `.lbl` the same way.
                `lang` so a screen reader on an English document voice switches for the caption. */}
            <span>
              {label} <i lang="ja">{jp}</i>
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
            // ONE row body, two wrappings — the portrait's own idiom, and the reason the LED/icon/name/port
            // layout cannot drift between the linked and the un-linked case.
            const row = (
              <>
                <i aria-hidden />
                {/* The owner's icon for this service (D53 M3) — nothing at all when they have dropped
                    none, which is every fresh install. */}
                <ServiceIcon service={s} />
                <strong>{s.name}</strong>
                <small>{s.port == null ? (svcOn ? "healthy" : "offline") : `:${s.port}`}</small>
              </>
            );
            // THE ROW IS A LINK (G6.4, owner device round — every sibling dossier already opens its
            // services and gacha's did not). The gate and the wire are the cosmos/frontier/kit ones,
            // verbatim: a LIVE service that declares a `url` becomes an anchor, rebased onto whichever
            // address this client can actually reach the host on (`serviceBase` prefers the tailnet name
            // when we arrived over it); everything else — offline, or up but with no URL to open — stays
            // the `role="group"` div it has always been, so there is never a dead link to tap.
            return svcOn && s.url ? (
              <a
                key={s.id}
                className="gc-svc on"
                href={rebaseServiceUrl(s.url, serviceBase(host, window.location))}
                target="_blank"
                rel="noopener"
              >
                {row}
              </a>
            ) : (
              <div
                className={"gc-svc" + (svcOn ? " on" : "")}
                key={s.id}
                role="group"
                aria-label={`${s.name} ${svcOn ? "online" : "offline"}`}
              >
                {row}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
