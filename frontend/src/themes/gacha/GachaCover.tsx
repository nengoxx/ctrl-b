import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { FocalImg } from "../../components/FocalImg";
import type { Host } from "../../types";
import { GACHA_COPY } from "./copy";
import { GachaStar } from "./GachaStar";
import { useCeremony } from "./ceremony";
import {
  COVER_HERO_SHIFT,
  coverDevelopAnnounce,
  coverPromoteAnnounce,
  coverSettledAnnounce,
  issueLine,
  labelCover,
  roleLabel,
  unitHueToken,
} from "./fleet";
import type { GachaTrackProps } from "./GachaTrack";
import { isHighStar, starsFor } from "./stars";

// THE COVER (GACHA_PLAN §12.6 E2, anatomy ruling 9) — gacha's third and last fleet layout, and the
// finalists lab's screen B, ported: a FIXED full-viewport magazine cover. One hero machine fills the frame,
// the rest are printed cut-outs stacked down the leading edge, and the masthead / strapline / barcode
// furniture prints around them.
//
// SIX THINGS TO KNOW BEFORE EDITING, all §12.6-ruled:
//
//  · THE PAGE DOES NOT SCROLL. A magazine cover doesn't. The composition is absolutely positioned to fill
//    the fleet tab's frame, so this layout contributes NO in-flow height and the tab's scroller has
//    nothing to move; the one thing that scrolls is `.cv-stack`, internally, when the fleet outgrows the
//    column. Every floor is a `--cv-*` token seeded off the app's REAL bottom chrome (`--composer-h`),
//    because the lab's flat pixel numbers were authored against a bare viewport.
//  · THE TRACK HEAD IS SUPPRESSED, and the MASTHEAD carries the h1 (ruling 9 — one heading per fleet,
//    whichever layout draws it). The lab marks its masthead `aria-hidden` because it was mock scaffolding
//    beside a real heading; here it IS the heading. That is also why `counter` goes unused: `NN / NN` is
//    the TRACK's read of the fleet, and a magazine states its ISSUE number instead (`issueLine`).
//  · THE TAP TABLE IS THE COVER'S OWN (`tapGrammarFor("cover")` -> `select-first`): tapping a CUT-IN always
//    PROMOTES it, online or not, because a cut-in is not a machine you act on — it is the next cover.
//    Only the HERO acts: it opens its dossier when online, and DEVELOPS (wakes) when asleep. The routing
//    itself is `GachaFleet`'s; this file only dramatizes what came back, poll-truthfully (ruling 4).
//  · THE HERO CROP IS DERIVED, NOT DATA (ruling 9): the lab's per-id `COVER_HERO_FOCUS` map does not port.
//    The hero window shifts whatever framing the art entry resolved LEFT by a fixed fraction, which slides
//    the subject out from under the cut-in column; the E5 device round tunes the constant. Since S4 that
//    shift is applied by the WINDOW to its own resolved position (`FocalImg`'s `shiftX`) rather than
//    published as a second custom property — see the `--cv-focus`/`--cv-hero-focus` note in MEDIA_MANAGER
//    _PLAN §5: a centred point is a function of each box's own overflow and cannot be inherited.
//  · IT OPENS PLAIN. No View-Transition morph is offered (ruling 5(2), as signed for cover — the walked lab
//    opens the cover's dossier with the plain path, and R26's re-amendment named only the poster). The
//    plain fallback already lives in `openHostDossier`, so this passes nothing and there is no branch here.
//    (Whether the hero `<img>` should fly into the dossier is a BANKED owner-eyeball question for the E5
//    walk — it is not built, and building it is a ruling, not a refactor.)
//  · PROMOTE REPARENTS THE MOVED CONTROLS. The hero slot and the internal scroller are two containers —
//    a scroller cannot hold the full-bleed hero — so React remounts the buttons that swap, which drops
//    focus. `focusReturn` puts it back on the machine that had it (the lab's `hadFocus`, and GachaFleet's
//    own portrait-focus-return is the in-repo precedent).

/** R24's ceremony budget: both of the cover's sequences land inside 900 ms. */
const PROMOTE_MS = 880;
const DEVELOP_MS = 900;

/** The develop ceremony's presentation state — which machine is being staged and which beats have landed.
 *  ONE object, so "which card" and "which beat" can never disagree (the poster's `WakeStage` idiom). */
interface DevelopStage {
  id: string;
  /** the 150 ms beat: the white frame flash + the page shake */
  flash: boolean;
  /** the 600 ms beat: the AWAKE stamp thuds down. Decoration, gone at cleanup. */
  stamped: boolean;
}

/** Every host control currently inside the frame. A DOM read rather than a ref map, because a promote
 *  moves nodes between two parents: React unmounts and remounts them, and a ref map would have to reason
 *  about detach/attach ordering inside a single commit to stay correct. `GachaFleet`'s own
 *  `document.querySelector(".gc-dossier .gc-art-btn")` focus return is the in-repo precedent. */
const cardNodes = (frame: HTMLElement | null): HTMLButtonElement[] => [
  ...(frame?.querySelectorAll<HTMLButtonElement>(".cv-card") ?? []),
];

export function GachaCover({
  hosts,
  error,
  isLoading,
  reeling,
  starMode,
  banner,
  art,
  picked,
  onTapHost,
  onCommitSelect,
  busy,
  waking,
  announce,
}: GachaTrackProps) {
  const [dev, setDev] = useState<DevelopStage | null>(null);
  /** True while a promote's page turn is folded — beats 0..300. */
  const [turning, setTurning] = useState(false);
  /** True while the new hero replays its entrance — beats 300..860. */
  const [entering, setEntering] = useState(false);
  /** True while the masthead replays its beat — 520..860. A class the ceremony adds and then REMOVES, so
   *  the next promote's re-add replays the animation; re-keying the heading itself would rebuild the tab's
   *  one h1 on every page turn, which is a node an assistive technology is entitled to keep. */
  const [beating, setBeating] = useState(false);
  const ceremony = useCeremony();
  // ONE GESTURE, ONE EFFECT — the poster's `skippedGesture`, verbatim and for the identical reason (Codex
  // E1 MED-1 + its confirm-round LOW). A skip and a tap are one finger but TWO browser events: the hook's
  // document `pointerdown` listener skips, React commits `running: false`, and the `click` that follows
  // would find the guard already down — so the gesture that stopped the theatre would also promote a
  // machine, or send a second wake. The ref is written inside the pointerdown's OWN dispatch, where this
  // closure is still the pre-skip render; it is written on EVERY pointerdown so a gesture that never
  // clicked cannot leave a `true` behind, and `keydown` clears it because a keyboard activation is a click
  // with no pointerdown to overwrite it.
  const skippedGesture = useRef(false);
  /** Whether the activation now arriving is a HELD key REPEATING (Codex E2 LOW-6). One press is one
   *  gesture however long it is held: a repeat must neither clear the pointer suppression above nor act
   *  on its own — a held Enter would otherwise fire the control dozens of times, and the first repeat
   *  after a keyboard skip lands on a ceremony that has just ended and routes for real. Cleared by every
   *  genuine gesture START (a pointerdown, or a keydown that is not a repeat) and by the key's own RELEASE,
   *  so it can never go stale and swallow a real tap — including Space's, which is dispatched on keyup. */
  const keyRepeat = useRef(false);
  /** The frame, for the two DOM reads the focus restoration needs. */
  const frameRef = useRef<HTMLDivElement>(null);
  /** Which machine's control should get focus back on the next hero swap, or `null`.
   *
   *  ARMED AT PROMOTE START, not at the commit beat (Codex E2 MED-3). If the OLD hero leaves the fleet in
   *  the 170 ms before the commit, the poll's own render reparents the focused cut-in into the hero slot —
   *  React remounts it, focus falls to `<body>`, and by the commit beat there is nothing left to read. So
   *  the id is taken while the finger is still on the control, and spent by whichever hero-identity commit
   *  comes first — validated, so a machine that has left the fleet restores nothing.
   *
   *  IT IS NOT CLEARED ON A BEAT. That was tried and is a race: `advanceTimersByTime` (and a real 880 ms
   *  of wall clock under a busy main thread) can run several beats inside ONE React commit, so a "clear at
   *  the last beat" runs BEFORE the layout effect that was supposed to spend it and the restore is lost.
   *  The arm is overwritten by the next promote instead, and the worst residue is that a promote which
   *  never swapped anything hands focus back to the machine the user was standing on — which is where
   *  they were. */
  const focusReturn = useRef<string | null>(null);
  /** THE BEATS FIRE LATE — up to 880 ms after the gesture — and a closure created when the ceremony
   *  STARTED would read the fleet as it was then. This ref is what they read through instead, so the
   *  commit lands against the CURRENT poll and the settled sentence reports the machine's CURRENT status
   *  word rather than the one it had when the finger went down (ruling 4 again: the narration must not be
   *  able to describe a fleet the app no longer has).
   *
   *  A LAYOUT effect, not a passive one (Codex E2 HIGH-1's rider): a passive update leaves a window
   *  between the commit that changed `hosts` and the effect that records it, and a beat firing inside that
   *  window would read the previous fleet — the exact staleness this ref exists to remove. */
  const latest = useRef({ hosts, onCommitSelect, starMode });
  useLayoutEffect(() => {
    latest.current = { hosts, onCommitSelect, starMode };
  });

  // THE DEVELOP THEATRE IS LICENSED BY THE REQUEST, NOT BY THE CLOCK (Codex E2 MED-2). The beats keep the
  // lab's timing, but every artifact they raise — the hue wash, the frame flash, the page shake, the AWAKE
  // stamp — RENDERS only while that machine's wake is genuinely in flight. A request that resolves (or
  // fails) at 40 ms used to leave the cover flashing and then stamping a machine whose request had already
  // come back: synthetic liveness, which is precisely what ruling 4 forbids. `waking` is cleared in the
  // same commit the request settles, so the theatre goes with it, and the chip is back to the server's
  // word. `aria-hidden` on the stamp was never enough — it hid the false claim from one audience only.
  const devLive = dev !== null && waking.has(dev.id);

  // `picked` is RESOLVED above (`resolvePick`), so on a non-empty fleet it always names a live machine;
  // the clamp is the render-path belt for the one frame a caller could hand over something else.
  const heroIndexRaw = hosts.findIndex((h) => h.id === picked);
  const heroIndex = heroIndexRaw >= 0 ? heroIndexRaw : 0;
  const hero = hosts[heroIndex] ?? null;

  // FOCUS SURVIVES THE REPARENT (ruling 9), and it is keyed to the ARMED MACHINE rather than to "the next
  // hero change" (Codex E2-confirm F3). Those are not the same event: with `[A, C, B]`, focusing B and
  // promoting it, a poll that drops A first makes C the FALLBACK hero — a hero change that has nothing to
  // do with this gesture. Spending the arm there left B's own promotion, 170 ms later, to reparent it with
  // no restoration at all. So the arm waits for ITS host to become the hero; an intermediate hero is
  // simply not its swap.
  //
  // It is also bounded in the two ways it can go stale: the armed machine LEAVING the fleet clears it
  // (nothing to restore, and it must not outlive its host), and a REFUSED commit clears it at the beat.
  useLayoutEffect(() => {
    const id = focusReturn.current;
    if (id === null) return;
    if (!hosts.some((h) => h.id === id)) {
      focusReturn.current = null; // its machine is gone; the arm goes with it
      return;
    }
    // some other machine took the cover: that is not this gesture's swap, so the arm keeps waiting
    if (hero?.id !== id) return;
    focusReturn.current = null;
    const node = cardNodes(frameRef.current).find((c) => c.dataset.gcHost === id);
    if (node && document.activeElement !== node) node.focus({ preventScroll: true });
  }, [hero?.id, hosts]);

  /** PROMOTE — a cut-in takes the cover (the lab's `promote()`, beats verbatim).
   *
   *  ROUTED ONCE, AT THE TAP; COMMITTED AT BEAT 170 (Codex E2 HIGH-1). The router decides what the gesture
   *  means while the finger is still down — and under the cover grammar a cut-in can only ever mean
   *  `select` — and the beat then spends `onCommitSelect`, which can select a still-present machine and
   *  nothing else. That split is the whole fix: calling the ROUTER again at 170 let a poll that removed the
   *  old hero turn the very same gesture into a wake, because the tapped machine had meanwhile become the
   *  selection. Committing inside the fold is what keeps the swap unseen; committing through a seam that
   *  cannot route is what keeps it harmless.
   *
   *  A skip COMPLETES rather than abandons (the runner fires every remaining beat, in order), so the commit
   *  still lands; under reduced motion the runner collapses the sequence and the swap is instant. */
  const promote = (hostId: string) => {
    const tapped = hosts.find((h) => h.id === hostId);
    // ARMED HERE, while the control is still under the finger — see `focusReturn`. A poll can reparent it
    // before the commit beat, and by then there is nothing left to read.
    focusReturn.current =
      cardNodes(frameRef.current).find((c) => c === document.activeElement)?.dataset.gcHost ?? null;
    // Whether the commit was accepted, for the beats that speak about a swap. A ref rather than state:
    // nothing renders off it, and it is written and read inside one ceremony's own beats.
    let committed = false;
    ceremony.start(
      [
        [
          0,
          () => {
            setTurning(true);
            announce(coverPromoteAnnounce(tapped?.name ?? hostId));
          },
        ],
        [
          170,
          () => {
            committed = latest.current.onCommitSelect(hostId);
            // refused ⇒ no swap is coming, so the arm must not sit waiting for one (Codex E2-confirm F3's
            // tail: a later reappearance of the same id could otherwise steal focus on an unrelated turn)
            if (!committed) focusReturn.current = null;
          },
        ],
        [
          300,
          () => {
            setTurning(false);
            setEntering(true);
          },
        ],
        [520, () => setBeating(true)],
        [
          860,
          () => {
            setEntering(false);
            setBeating(false);
            // REFUSED means the machine left mid-turn: there is no cover to report, so the settled
            // sentence is suppressed. (The beat-0 "takes the cover" has already spoken by then — accepted:
            // it described an intent that was true when it was said.)
            if (!committed) return;
            // The SETTLED sentence, poll-truthful by construction: it reads the machine out of the LATEST
            // fleet (see `latest`), so it reports the status the app currently has rather than the one it
            // had 880 ms ago — and the lab's "{name} is online.", which claimed a wake that had not
            // happened, is not what lands here.
            const now = latest.current;
            const settled = now.hosts.find((h) => h.id === hostId);
            if (settled)
              announce(
                coverSettledAnnounce(
                  settled,
                  starsFor((settled.services ?? []).length, now.starMode),
                ),
              );
          },
        ],
      ],
      PROMOTE_MS,
    );
  };

  /** DEVELOP — a sleeping HERO is woken (the lab's `develop()`).
   *
   *  ROUTED FIRST, staged second (the poster's pattern): a ceremony is only ever run for a request that
   *  was actually sent, so a busy machine — or one that left the fleet between render and click — gets no
   *  theatre. Everything the lab did AFTER the request is prototype fiction and does NOT port (§12.6
   *  ruling 4): its 430 ms ONLINE flip, its persistent stamp, its banner refresh and its settled "is
   *  online" sentence are all gone. The chip reads `WAKING` from the in-flight set, then the SERVER's
   *  word, and only a hosts poll may say ONLINE. */
  const develop = (hostId: string) => {
    const host = hosts.find((h) => h.id === hostId);
    if (onTapHost(hostId) !== "wake") return;
    ceremony.start(
      [
        [
          0,
          () => {
            setDev({ id: hostId, flash: false, stamped: false });
            announce(coverDevelopAnnounce(host?.name ?? hostId));
          },
        ],
        [150, () => setDev((s) => (s ? { ...s, flash: true } : s))],
        [600, () => setDev((s) => (s ? { ...s, stamped: true } : s))],
        [880, () => setDev(null)],
      ],
      DEVELOP_MS,
    );
  };

  /** One tap on a machine's control. A tap DURING a ceremony is swallowed into a SKIP (R24 §B.3) and never
   *  doubles as a second route — the same guard the poster carries, for the same two-event reason. */
  const onCardTap = (hostId: string, isHero: boolean) => {
    if (keyRepeat.current) return; // a held key repeating is ONE gesture, and it is already spent
    if (skippedGesture.current) {
      // this finger's pointerdown already ended a ceremony; the click it produced is spent
      skippedGesture.current = false;
      return;
    }
    if (ceremony.running) {
      // the keyboard path, and the belt for any dispatch that reaches here with the ceremony still live
      ceremony.skip();
      return;
    }
    if (isHero) {
      develop(hostId);
      return;
    }
    // THE ROUTE HAPPENS HERE, ONCE (Codex E2 HIGH-1): the decision is made while the finger is down, and
    // it is what starts the ceremony. Under the cover grammar a cut-in can only route to `select`;
    // anything else means the machine left between render and click, and there is nothing to dramatize.
    if (onTapHost(hostId) === "select") promote(hostId);
  };

  /** One machine's control. The hero and a cut-in are the SAME button, with the same accessible-name shape
   *  and both copy blocks present — CSS shows whichever the seat calls for — so a promote moves one node
   *  between two containers rather than trading one component for another. */
  const card = (host: Host, index: number, isHero: boolean) => {
    const online = !!host.status?.online;
    const stars = starsFor((host.services ?? []).length, starMode);
    const isBusy = busy.has(host.id);
    const stamped = devLive && dev.stamped && dev.id === host.id;
    const entry = art(index);
    const chip = waking.has(host.id) ? "WAKING" : online ? "ONLINE" : "SLEEPING";
    return (
      <button
        key={host.id}
        type="button"
        data-gc-host={host.id}
        className={
          "cv-card gc-host-hit" +
          (isHero ? " is-hero" : " is-cut") +
          (online ? "" : " asleep") +
          (isBusy ? " busy" : "") +
          (devLive && dev.id === host.id ? " developing" : "") +
          (stamped ? " stamped" : "")
        }
        style={
          {
            // The PER-UNIT hue INPUT, by fleet position — the poster's `--po-rar`/`--po-hue` split, and
            // load-bearing for the same reason: an inline custom property beats every selector, so the
            // sleeping suppression has to override a DIFFERENT property than the one written here.
            "--cv-rar": unitHueToken(index),
          } as CSSProperties
        }
        aria-label={labelCover(host, stars, isHero)}
        // The hero IS the selection — `aria-pressed` says so, exactly as a poster slice's does.
        aria-pressed={isHero}
        aria-busy={isBusy || undefined}
        disabled={isBusy}
        // CAPTURE phase, recording the ceremony's state rather than acting on it (see `skippedGesture`).
        onPointerDownCapture={() => {
          keyRepeat.current = false; // a new POINTER gesture: no held key can still be in progress
          skippedGesture.current = ceremony.running;
        }}
        // A keyboard activation is click-without-pointerdown: any suppression still standing belongs to a
        // pointer gesture that never clicked, and this key must not pay for it. A REPEAT is not a new
        // gesture, though — it clears nothing and marks itself so the click it produces is swallowed.
        onKeyDownCapture={(e) => {
          keyRepeat.current = e.repeat;
          if (!e.repeat) skippedGesture.current = false;
        }}
        // …and the HELD KEY ends here (Codex E2-confirm L1). ENTER activates on keydown, so a repeat is a
        // second activation and is rightly swallowed; SPACE activates on KEYUP, so its one real click
        // arrives after the repeats have set the flag — without this it was swallowed and a held Space
        // did nothing at all. Keyup runs before that default click, which is what makes this the release.
        onKeyUpCapture={() => {
          keyRepeat.current = false;
        }}
        // No morph element is handed over: the cover opens PLAIN (see the header note).
        onClick={() => onCardTap(host.id, isHero)}
      >
        <span className="cv-shot">
          {entry ? (
            // §5: ONE element, TWO windows — the same node is a full-frame hero in one render and a
            // 112px cut-in in the next, so its framing has to be a function of the box it currently
            // has. The hero's leftward shift is applied HERE, to this window's own resolved value; it
            // used to be a second custom property (`--cv-hero-focus`) computed off the item alone.
            <FocalImg
              src={entry.url}
              alt=""
              draggable={false}
              decoding="async"
              art={entry.focus}
              shiftX={isHero ? -COVER_HERO_SHIFT : undefined}
            />
          ) : (
            // The resolver's placeholder case: a machine without art is still on the cover — hue, name,
            // role and chip all read (§5.3's "render stays silent"; the Conf gallery is where the owner
            // is told).
            <span className="cv-shot-blank" aria-hidden />
          )}
        </span>
        <span className="cv-scrim" aria-hidden />
        {/* The develop WASH — the unit's hue flooding the mono plate. Opacity + transform only. */}
        <span className="cv-dev" aria-hidden />
        {/* THE HERO COPY — the cover's own bottom-trailing name block. */}
        <span className="cv-herocopy">
          <small>{GACHA_COPY.coverFeatured}</small>
          <b>{host.name.toUpperCase()}</b>
          <i>{roleLabel(host)}</i>
          <span className="cv-line">
            <span className="cv-stars" aria-hidden>
              {Array.from({ length: stars }, (_, s) => (
                <GachaStar key={s} hi={isHighStar(s, starMode)} />
              ))}
            </span>
            {/* STATUS, always literal (§12.3 (4)). `WAKING` is licensed by the request being in flight and
                by nothing else; when it settles the chip returns to the server's word. */}
            <span className="cv-chip">{chip}</span>
          </span>
        </span>
        {/* …and the CUT-IN's, which is the same two facts on a 112 px card: the name on its own row,
            because a hostname and a status word cannot share that width without one of them ellipsing
            away (the lab's measured finding). */}
        <span className="cv-cutcopy">
          <b>{host.name.toUpperCase()}</b>
          <span className="cv-cchip">{chip}</span>
        </span>
        {stamped && (
          <span className="cv-stamp" aria-hidden>
            {GACHA_COPY.coverStamp}
          </span>
        )}
      </button>
    );
  };

  return (
    // THE FRAME — absolutely positioned to fill the fleet tab's own box, which is what makes the cover
    // fixed and the page unscrollable (it contributes no in-flow height at all). `inert` while the reel
    // sweeps (§6.4/F3), exactly as the capsule grid and the poster body are.
    <div
      className="cv-frame"
      ref={frameRef}
      inert={reeling}
      // THE ISSUE's own colour — the HERO's per-unit hue, published here because the masthead kicker and
      // the strapline's tag sit OUTSIDE the hero card and cannot inherit it (the lab's `--cover-rar`).
      style={{ "--cv-cover": unitHueToken(heroIndex) } as CSSProperties}
    >
      <div className={"cv-shake" + (devLive && dev.flash ? " shaking" : "")}>
        <div className={"cv-page" + (turning ? " turning" : "")}>
          {/* THE MASTHEAD carries the h1 (ruling 9). It renders in EVERY state — including the one where
              nothing else does — because a magazine with no contents is still a magazine, and the tab
              would otherwise be blank while the first poll is in flight.

              TWO SEATS, one over the display lines and one under them, and the OWNER SWAPPED WHAT THEY
              SAY (eyeball wave 2): the coloured seat on top now carries the LIVE issue line and the grey
              seat below carries the static brand. The classes name the SEATS rather than their contents
              for exactly that reason — the styling belongs to the position, the text is a ruling that has
              already moved once. The live seat renders only once there is a machine to number, so the
              heading never claims an issue that does not exist. */}
          <h1 className={"cv-mast" + (beating ? " beating" : "")}>
            {hero && (
              <span className="cv-mast-over">{issueLine(heroIndex, !!hero.status?.online)}</span>
            )}
            <b>
              {GACHA_COPY.coverTitle1}
              <br />
              {GACHA_COPY.coverTitle2}
            </b>
            <span className="cv-mast-under">{GACHA_COPY.coverKicker}</span>
          </h1>

          {/* The state semantics are the capsule track's, to the letter (the poster's, verbatim): the
              error notice renders BESIDE whatever the last successful poll left, an answered-but-empty
              fleet says so, and while the FIRST poll is in flight nothing renders below the masthead. */}
          {error && <div className="gc-msg">backend unreachable: {error.message}</div>}
          {!error && hosts.length === 0 && !isLoading && (
            <div className="gc-msg">no hosts in config.yaml</div>
          )}

          {hero && (
            <>
              <div className={"cv-heroslot" + (entering ? " entering" : "")}>
                {card(hero, heroIndex, true)}
              </div>

              {/* THE CUT-IN COLUMN. At N=1 there is no column and no hint (ruling 9): a cover with one
                  machine has nothing to change to, and a standing "TAP A CUT-IN" would be a lie. */}
              {hosts.length > 1 && (
                <div className="cv-side">
                  <div className="cv-stack">
                    {hosts.map((h, i) => (i === heroIndex ? null : card(h, i, false)))}
                  </div>
                  <p className="cv-hint" aria-hidden>
                    {GACHA_COPY.coverHint1}
                    <br />
                    {GACHA_COPY.coverHint2}
                  </p>
                </div>
              )}

              {/* THE STRAPLINE — the pickup banner, seated as a printed strip between the hero's name
                  block and the barcode footer (§12.6 ruling 7). ONE instance, built by `GachaFleet` and
                  handed down; under cover its `on` form IS the strip (owner-confirmed), which is a
                  STRUCTURAL fact of this composition rather than the `banner` setting E3 owns. */}
              <div className="cv-strap">{banner}</div>

              {/* THE FOOTER — barcode, registry fine print, cover price. Static fiction, `aria-hidden`:
                  it says nothing about the fleet, so there is nothing here to read out. */}
              <div className="cv-foot" aria-hidden>
                <span className="cv-barcode" />
                <span className="cv-fine">
                  {GACHA_COPY.coverFine1}
                  <br />
                  {GACHA_COPY.coverFine2}
                </span>
                <span className="cv-price">{GACHA_COPY.coverPrice}</span>
              </div>
            </>
          )}
        </div>
      </div>
      {/* The develop FLASH — a pre-existing node on an opacity-only animation (the lab's `.flash`), so the
          ceremony never mounts anything mid-flight. */}
      <span className={"cv-flash" + (devLive && dev.flash ? " fire" : "")} aria-hidden />
    </div>
  );
}
