import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";

import { FocalImg } from "../../components/FocalImg";
import { useGachaReelRunning } from "../../store/gachaReel";
import { useUISlice } from "../../store/ui";
import type { Host } from "../../types";
import {
  AUTOPLAY_MS,
  CAROUSEL_IDLE,
  HERO_KEY,
  MAX_DOTS,
  SNAP_MS,
  carouselReduce,
  reconcileActive,
  type CarouselEvent,
  type CarouselState,
} from "./carousel";
import { GACHA_COPY } from "./copy";
import { openLabel, promoCopy, sceneTitle } from "./fleet";
import { safeRafLoop, type SafeRafLoop } from "../../theme-engine/safeRafLoop";
import type { ResolvedArt } from "./roster";

// The PICKUP BANNER (D52 / GACHA_PLAN §6.4) — the prototype's `.banner` slideshow, ported onto live data:
// slide 1 is the fixed NETWORK PRIZE POOL hero (frozen copy, zero data dependency), slides 2..N are one
// promo per host, ONLINE AND SLEEPING both (the membership is a RULING, not implementer latitude — crowding
// is solved by the dot/counter presentation below, never by narrowing the set).
//
// Everything genuinely tricky here is delegated to `carousel.ts`, which is pure: the tap-vs-drag machine,
// where a released drag lands, and where the active slide goes when its host disappears. This component owns
// only what a pure module cannot: the pointer capture, the rAF, the timer, and the DOM writes.
//
// ── WHY THE TRANSFORM IS IMPERATIVE ─────────────────────────────────────────────────────────────────────
// The strip's `transform` and `transition-duration` are written to the node directly (a layout effect for
// settled positions, a rAF while a finger is down) rather than rendered as React style. A drag produces a
// value per pointermove; routing that through state would re-render every slide — each with an <img> — at
// touch frequency for a compositor-only change. React owns WHICH slide is active; the node owns where the
// strip is. The two never fight: the layout effect bails out while a drag is live.
//
// ── WHY MEMBERSHIP IS BUFFERED ──────────────────────────────────────────────────────────────────────────
// `committed` is what is on screen; `slides` is what the last poll said. They are the same thing except
// during a gesture or snap, when a host appearing or vanishing must not re-key the strip under the finger
// (Codex R4-4). Between interactions they reconcile BY KEY. Rendering always prefers the LIVE slide for a
// key that still exists, so a committed set never shows stale liveness — only a host that vanished
// mid-gesture keeps painting from its snapshot, and only until the next reconciliation.

/** One banner slide, as a DISCRIMINATED UNION on `kind` — the single mechanism the render, the dot labels
 *  and the interactivity all branch on, so nothing anywhere has to sniff a key to know what it is holding:
 *
 *   · `hero`  the fixed NETWORK PRIZE POOL slide. Frozen copy, no data dependency, nothing to open.
 *   · `scene` an owner banner-art drop (G1 eyeball round 3). Inert like the hero — a picture names no
 *             machine, so there is nothing to open — but it wears the same copy block, filled from a
 *             TEMPLATE: `position` picks its TITLE out of the ruled `SCENE_TITLES` pool, so any future
 *             drop is titled without authoring a line per image; `name` is just the stable per-file key
 *             (the dot announces the title — see `dotLabel`).
 *   · `promo` one live machine. The only interactive kind, and the only one with a `host`, which the union
 *             makes the compiler's job rather than a `host &&` guard at every use. */
export type BannerSlide =
  | { kind: "hero"; key: string; art: ResolvedArt | null }
  | { kind: "scene"; key: string; name: string; position: number; art: ResolvedArt | null }
  | { kind: "promo"; key: string; host: Host; art: ResolvedArt | null; online: boolean };

/** A dot's accessible name. Each kind announces the thing it actually is. */
function dotLabel(s: BannerSlide): string {
  if (s.kind === "promo") return `show ${s.host.name}`;
  // A scene's dot announces its VISIBLE title, not its filename — an AT user hears what a sighted user
  // reads on the slide. The filename stays in the KEY (stable per file; titles shift if the pool does).
  if (s.kind === "scene") return `show ${sceneTitle(s.position)}`;
  return "show the prize pool";
}

interface Props {
  /** The LIVE slide set, hero first, in the fleet's display order. */
  slides: BannerSlide[];
  /** Whether the Fleet tab is showing — one of the autoplay eligibility conditions (§10.3). */
  active: boolean;
  /** The rate pill's text, resolved by the Fleet body (one source for the star mode + the online count). */
  rate: string;
  /** The pity pill's text — 天井 + the fleet-wide online-SERVICE count (owner 2026-08-06; was the
   *  prototype's frozen `200` flavour). Resolved by the Fleet body on the same terms as `rate`. */
  pity: string;
  /** The shared host-open handler — the SAME one the capsule cards use (main-seat ruling). */
  onOpenHost: (hostId: string) => void;
}

/** Key orders are compared as STRINGS so the reconciliation effect can depend on their VALUE rather than on
 *  an array's identity. NUL is the separator: it cannot occur in a host id. */
const KEY_SEP = "\u0000";
const splitKeys = (sig: string): string[] => (sig === "" ? [] : sig.split(KEY_SEP));
const keysOf = (list: BannerSlide[]): string => list.map((s) => s.key).join(KEY_SEP);

export function GachaBanner({ slides, active, rate, pity, onOpenHost }: Props) {
  const motion = useUISlice((s) => s.motion);
  const reeling = useGachaReelRunning();

  const [committed, setCommitted] = useState<BannerSlide[]>(slides);
  /** The committed order as a STRING, held beside the list rather than derived from it: a primitive is what
   *  effects and callbacks can depend on honestly (an array dependency is one React Compiler has to assume
   *  may be mutated, which costs the whole component its memoization). Always written with the list. */
  const [committedSig, setCommittedSig] = useState(() => keysOf(slides));
  const [activeKey, setActiveKey] = useState(HERO_KEY);
  /** True from pointerdown until the gesture resolves. */
  const [gesture, setGesture] = useState(false);
  /** True while a snap transition is still running. */
  const [snapping, setSnapping] = useState(false);
  /** Whether the NEXT strip write animates. A reconciliation jump sets it false; every deliberate move
   *  (dot, timer, released drag) sets it true. */
  const [snapAnimated, setSnapAnimated] = useState(false);
  /** Bumped when the strip must be re-written even though the active index did NOT change — a snap-back
   *  from an aborted or under-threshold drag. Without it the layout effect has no reason to fire and the
   *  strip stays where the finger left it. */
  const [paintTick, setPaintTick] = useState(0);
  /** Bumped when an interaction restarts the cadence without changing the slide (§6.4's one rule). */
  const [restartTick, setRestartTick] = useState(0);

  const liveSig = keysOf(slides);
  const liveByKey = new Map(slides.map((s) => [s.key, s]));
  const rendered = committed.map((c) => liveByKey.get(c.key) ?? c);
  const keys = splitKeys(committedSig);
  const count = rendered.length;
  const index = Math.max(0, keys.indexOf(activeKey));
  const busy = gesture || snapping;

  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<CarouselState>(CAROUSEL_IDLE);
  /** Read by `onClickCapture` to swallow the click the browser fires after a DRAG (§6.4). */
  const movedRef = useRef(false);
  /** The drag-follow loop + the index it follows against. A real loop rather than a single coalesced frame:
   *  it self-stops the moment the machine leaves `drag`, and it goes through the engine's `safeRafLoop` so a
   *  fault stops it for good instead of throwing once per frame (§14.15.1-A rider c). */
  const loopRef = useRef<SafeRafLoop | null>(null);
  const dragIndexRef = useRef(0);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The snap lock MIRRORED into a ref. `snapping` is captured state, so an effect reads whatever was true
   *  at the render it was scheduled from — and a pointerdown landing between that render and its commit
   *  would reconcile the strip out from under the finger. The ref is the value at COMMIT time, and it is
   *  written in exactly the two places `setSnapping` is. */
  const snapRef = useRef(false);

  // Reconcile membership BETWEEN interactions. Runs on every render and no-ops when the two orders already
  // agree, which is the honest way to keep `slides` (a fresh array each render) as a dependency.
  useEffect(() => {
    if (busy || liveSig === committedSig) return;
    // …and re-check the LIVE machine at commit time, not the render's snapshot of it (F2): `busy` above is
    // state, so a pointerdown or a snap that started after this effect was scheduled is invisible to it.
    if (dragRef.current.phase !== "idle" || snapRef.current) return;
    setCommitted(slides);
    setCommittedSig(liveSig);
    setActiveKey((k) => reconcileActive(splitKeys(committedSig), splitKeys(liveSig), k));
    // A reconciliation is a JUMP, never an animated slide (§6.4).
    setSnapAnimated(false);
  }, [busy, liveSig, committedSig, slides]);

  // ── The strip's position ───────────────────────────────────────────────────────────────────────────
  const applyOffset = useCallback((i: number): void => {
    const el = trackRef.current;
    if (el) el.style.transform = `translateX(calc(${-i * 100}% + ${dragRef.current.dx}px))`;
  }, []);

  useLayoutEffect(() => {
    const el = trackRef.current;
    // While a finger is down the rAF owns the node — never yank the strip out from under it.
    if (!el || dragRef.current.phase === "drag") return;
    el.style.transitionDuration = snapAnimated && motion !== "reduced" ? `${SNAP_MS}ms` : "0ms";
    applyOffset(index);
  }, [applyOffset, index, count, paintTick, snapAnimated, motion]);

  const beginSnap = useCallback((): void => {
    snapRef.current = true;
    setSnapping(true);
    clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {
      snapRef.current = false;
      setSnapping(false);
    }, SNAP_MS);
  }, []);

  /** THE one animated move (F1). Every deliberate slide change — a released drag, a dot, Prev/Next, the
   *  autoplay tick, a snap-back to where we already were — goes through here, so all of them arm the snap
   *  window rather than only the drag that happened to be written first. Owning the three writes together
   *  is what makes `snapping` mean "the strip is in motion": reconciliation defers on it and a fresh
   *  pointerdown is rejected while it holds, so nothing can re-key or zero the transition mid-flight. */
  const moveTo = useCallback(
    (key: string): void => {
      setSnapAnimated(true);
      setActiveKey(key);
      setPaintTick((t) => t + 1);
      beginSnap();
    },
    [beginSnap],
  );

  useEffect(
    () => () => {
      clearTimeout(snapTimer.current);
      snapRef.current = false;
      loopRef.current?.stop();
    },
    [],
  );

  // ── The machine's one entry point ──────────────────────────────────────────────────────────────────
  const dispatch = useCallback(
    (e: CarouselEvent): void => {
      const before = dragRef.current;
      const { state, effect } = carouselReduce(before, e);
      dragRef.current = state;
      if ((before.phase !== "idle") !== (state.phase !== "idle"))
        setGesture(state.phase !== "idle");

      const root = rootRef.current;
      const release = (): void => {
        const id = before.pointerId;
        if (root && id !== null && root.hasPointerCapture?.(id)) root.releasePointerCapture(id);
      };
      switch (effect.kind) {
        case "capture": {
          // Capture so the drag survives the finger leaving the banner; kill the transition so the strip
          // tracks rather than chases.
          const id = state.pointerId;
          if (root && id !== null) root.setPointerCapture?.(id);
          const el = trackRef.current;
          if (el) el.style.transitionDuration = "0ms";
          movedRef.current = true;
          break;
        }
        case "abort":
          release();
          if (before.moved) movedRef.current = true;
          // Back to where we already were, which is still an animated move and still owns the window.
          moveTo(activeKey);
          break;
        case "settle":
          release();
          movedRef.current = true;
          moveTo(splitKeys(committedSig)[effect.index] ?? HERO_KEY);
          break;
        case "tap":
          // Nothing moved, so the native click reaches the slide's button. The cadence restarts because the
          // gesture flag has just gone false — see the autoplay effect's `paused` dependency.
          release();
          break;
        case "none":
          break;
      }
    },
    [moveTo, activeKey, committedSig],
  );

  const onMove = useCallback(
    (e: PointerEvent<HTMLDivElement>): void => {
      if (dragRef.current.phase === "idle") return;
      dispatch({
        type: "move",
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        width: rootRef.current?.clientWidth ?? 0,
        index,
        count,
      });
      if (dragRef.current.phase === "drag") {
        dragIndexRef.current = index;
        loopRef.current ??= safeRafLoop(() => {
          if (dragRef.current.phase !== "drag") return false; // the gesture ended: stop cleanly
          applyOffset(dragIndexRef.current);
        });
        loopRef.current.start(); // idempotent while already running
      }
    },
    [applyOffset, dispatch, index, count],
  );

  // The reel sweeps over the whole shell and is `pointer-events: none`, so the banner disables ITSELF: a
  // gesture in flight resolves and the strip snaps back (§6.4). Autoplay is held by the `paused` gate below.
  useEffect(() => {
    if (reeling) dispatch({ type: "cancel" });
  }, [reeling, dispatch]);

  // ── Autoplay: ONE-SHOT, restarted in full by any change and any gesture (§6.4's matrix) ────────────
  const [docVisible, setDocVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  useEffect(() => {
    const on = (): void => setDocVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  // `snapping` is deliberately NOT a pause condition (F6): §6.4's matrix restarts the FULL cadence at an
  // interaction's END, and gating on the snap window would silently make that end + 620 ms. The gesture
  // flag alone is the interaction; `busy` still guards reconciliation and the pointerdown rejection, and
  // 5200 > 620 means the one-shot can never land mid-snap anyway.
  const paused = !active || !docVisible || reeling || motion === "reduced" || count <= 1 || gesture;
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => {
      const order = splitKeys(committedSig);
      const next = order[(Math.max(0, order.indexOf(activeKey)) + 1) % order.length];
      if (next !== undefined) moveTo(next);
    }, AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [paused, activeKey, restartTick, committedSig, moveTo]);

  /** Jump to a slide by KEY (a dot) — or, when it is already active, just restart the cadence.
   *
   *  The target is validated against the CURRENT committed membership (F2): a dot rendered from a set that
   *  has since been reconciled away would otherwise set an active key no slide answers to, which reads as
   *  the strip jumping to slide 0. Clicks DURING a snap stay allowed — a CSS transition retargets smoothly
   *  from wherever the strip currently is, and `moveTo` re-arms the window from this move. */
  const goTo = (key: string): void => {
    if (!keys.includes(key)) return;
    if (key === activeKey) setRestartTick((t) => t + 1);
    else moveTo(key);
  };

  /** Step by one, WRAPPING at both ends so the buttons match the auto-advance cycle (Codex R4-7). */
  const step = (delta: number): void => {
    if (count === 0) return;
    const next = keys[(index + delta + count) % count];
    if (next !== undefined) moveTo(next);
  };

  return (
    <div
      className="gc-banner"
      ref={rootRef}
      role="group"
      aria-roledescription="carousel"
      aria-label="Pickup banner"
      inert={reeling}
      onPointerDown={(e) => {
        // Disarm the click suppressor at the START of every pointer sequence — and BEFORE the rejections
        // below, which is load-bearing. A drag does not always produce the synthetic click that would
        // otherwise clear the token (pointer capture can retarget it away), so a re-tap inside the snap
        // window used to be rejected before the disarm and have its OWN click swallowed. Disarming first
        // is always safe: a fresh pointerdown means the previous sequence has ended, so there is no
        // pending click left to suppress, and the next drag re-arms the token at capture/settle well
        // before its own click can fire.
        movedRef.current = false;
        // The banner REJECTS input while the reel sweeps (F3, §6.4) — the overlay is `pointer-events: none`
        // so it cannot do that for us — and while a snap is still running (F1): starting a new gesture
        // mid-animation zeroes the strip's transition-duration in flight and leaves it stranded.
        if (reeling || snapRef.current) return;
        dispatch({
          type: "down",
          pointerId: e.pointerId,
          primary: e.isPrimary,
          x: e.clientX,
          y: e.clientY,
        });
      }}
      onPointerMove={onMove}
      onPointerUp={(e) =>
        dispatch({
          type: "up",
          pointerId: e.pointerId,
          width: rootRef.current?.clientWidth ?? 0,
          index,
          count,
        })
      }
      onPointerCancel={() => dispatch({ type: "cancel" })}
      // A TOUCH pointerdown gives its TARGET — a slide's img/button/copy span — IMPLICIT capture (Pointer
      // Events "implicit pointer capture"; mice get none, which is why desktop drag never saw this). When
      // the horizontal lock then captures on the root, the spec fires `lostpointercapture` at that CHILD,
      // and it BUBBLES here — where, unguarded, it read as "gesture died" and aborted every touch swipe at
      // the exact frame it locked. Only the ROOT losing capture is a real loss; a child's is just the
      // machine's own capture handoff.
      onLostPointerCapture={(e) => {
        if (e.target === e.currentTarget) dispatch({ type: "cancel" });
      }}
      // The post-drag click suppression (§6.4). The flag must survive from pointerup INTO the click the
      // browser synthesizes after it, which is why it is a ref rather than state, and why it is cleared
      // HERE rather than on the next pointerdown: a drag that ends over a button must not open it, and the
      // very next tap must.
      onClickCapture={(e) => {
        // A KEYBOARD or AT activation carries no pointer sequence (`detail === 0`), so it can never be the
        // click a drag produced — and must never be eaten by a suppression token that a drag which never
        // yielded its synthetic click left armed (F5). Only a real pointer click is suppressible.
        if (!movedRef.current || e.detail === 0) return;
        movedRef.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="gc-banner-track" ref={trackRef}>
        {rendered.map((s, i) => {
          const inactive = i !== index;
          // One copy block, three sources: a promo's live state, a scene's TEMPLATE (so the Nth dropped
          // image is captioned without a line authored for it), and the hero's frozen pair.
          const copy =
            s.kind === "promo"
              ? promoCopy(s.online)
              : s.kind === "scene"
                ? { tag: GACHA_COPY.sceneTag, caption: GACHA_COPY.sceneCaption }
                : { tag: `PICKUP ${GACHA_COPY.heroTag}`, caption: GACHA_COPY.heroCaption };
          const body = (
            <span className="gc-banner-copy">
              <span className="tag">{copy.tag}</span>
              <b>
                {s.kind === "promo" ? (
                  s.host.name
                ) : s.kind === "scene" ? (
                  // The hero's own two-line break, applied to the pool name (CAPSULE / FESTIVAL).
                  sceneLines(s.position)
                ) : (
                  <>
                    NETWORK
                    <br />
                    PRIZE POOL
                  </>
                )}
              </b>
              <small>{copy.caption}</small>
            </span>
          );
          return (
            <div
              className={
                "gc-slide" +
                (s.kind === "promo" ? " promo" : "") +
                (s.kind === "promo" && !s.online ? " sleep" : "")
              }
              key={s.key}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              // Offscreen slides are INERT: keyboard focus can never reach — let alone open — a promo the
              // user cannot see (Codex R4-7). Only the active slide is interactive.
              inert={inactive}
              aria-hidden={inactive || undefined}
            >
              {s.art && (
                <FocalImg
                  // PAINT-READY from the resolver (D65 defect #1 + its S2 review rider #8): the hero and
                  // the fleet backdrop can resolve to the SAME shared-background file, so the URL has to
                  // carry the file's `?rev=` — and the ladder is the one place that stamps it. Stamping
                  // again here gave the same bytes a second cache key on the one screen that shows both.
                  src={s.art.url}
                  alt=""
                  draggable={false}
                  // §5: the SLIDE is the window. A promo band and a capsule card are the same picture in
                  // two very different boxes, which is exactly the case a published-once value gets wrong.
                  art={s.art.focus}
                />
              )}
              {s.kind === "promo" ? (
                <button
                  type="button"
                  // …and the second carrier of the semantic host-control marker (GACHA_PLAN §12.6 ruling
                  // 5① — see GachaCard). A promo opens a MACHINE; the hero/scene `div` below opens
                  // nothing and is deliberately not marked.
                  className="gc-slide-hit gc-host-hit"
                  aria-label={openLabel(s.host.name, s.online)}
                  onClick={() => onOpenHost(s.host.id)}
                >
                  {body}
                </button>
              ) : (
                // The hero and the scenes are inert by design (§6.4): neither names a machine, so neither
                // has anything to open. Same box, same copy block, no button.
                <div className="gc-slide-hit">{body}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* M5, the one blended ambient layer the fleet affords: a static element on an opacity-only loop,
          gated in CSS by both the perf and the motion axis. */}
      <i className="gc-banner-glow" aria-hidden />

      <div className="gc-banner-rate">
        <span>{rate}</span>
        <span>{pity}</span>
      </div>

      {count > 1 &&
        (count <= MAX_DOTS ? (
          <div className="gc-banner-dots">
            {rendered.map((s, i) => (
              <button
                key={s.key}
                type="button"
                className={"gc-dot" + (i === index ? " on" : "")}
                aria-label={dotLabel(s)}
                aria-current={i === index ? "true" : undefined}
                onClick={() => goTo(s.key)}
              >
                <span className="pip" />
              </button>
            ))}
          </div>
        ) : (
          // Past the dot bound the rail becomes a counter — but the KEYBOARD path the dots provided has to
          // survive the swap, hence two labelled buttons that wrap like the auto-advance does.
          <div className="gc-banner-nav">
            <button type="button" aria-label="previous slide" onClick={() => step(-1)}>
              <Chevron back />
            </button>
            <span aria-live="polite">
              {index + 1} / {count}
            </span>
            <button type="button" aria-label="next slide" onClick={() => step(1)}>
              <Chevron />
            </button>
          </div>
        ))}
    </div>
  );
}

/** A scene's title, broken across two lines at its first space — the hero's own display shape. Titles that
 *  carry no space simply render as one line. */
function sceneLines(position: number) {
  const [head, ...rest] = sceneTitle(position).split(" ");
  return (
    <>
      {head}
      {rest.length > 0 && (
        <>
          <br />
          {rest.join(" ")}
        </>
      )}
    </>
  );
}

/** The Prev/Next glyph. An inline SVG rather than a character: gacha's TypeScript carries no non-ASCII
 *  outside `copy.ts` (the frozen-subset fence), and a chevron is not copy. */
function Chevron({ back = false }: { back?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={back ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}
