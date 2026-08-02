import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";

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
import { openLabel, promoCopy } from "./fleet";
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

/** One banner slide. `host` is null on the fixed hero — the one slide that survives every data state. */
export interface BannerSlide {
  key: string;
  host: Host | null;
  art: ResolvedArt | null;
  online: boolean;
}

interface Props {
  /** The LIVE slide set, hero first, in the fleet's display order. */
  slides: BannerSlide[];
  /** Whether the Fleet tab is showing — one of the autoplay eligibility conditions (§10.3). */
  active: boolean;
  /** The rate pill's text, resolved by the Fleet body (one source for the star mode + the online count). */
  rate: string;
  /** The shared host-open handler — the SAME one the capsule cards use (main-seat ruling). */
  onOpenHost: (hostId: string) => void;
}

/** Key orders are compared as STRINGS so the reconciliation effect can depend on their VALUE rather than on
 *  an array's identity. NUL is the separator: it cannot occur in a host id. */
const KEY_SEP = "\u0000";
const splitKeys = (sig: string): string[] => (sig === "" ? [] : sig.split(KEY_SEP));
const keysOf = (list: BannerSlide[]): string => list.map((s) => s.key).join(KEY_SEP);

export function GachaBanner({ slides, active, rate, onOpenHost }: Props) {
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

  // Reconcile membership BETWEEN interactions. Runs on every render and no-ops when the two orders already
  // agree, which is the honest way to keep `slides` (a fresh array each render) as a dependency.
  useEffect(() => {
    if (busy || liveSig === committedSig) return;
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
    setSnapping(true);
    clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => setSnapping(false), SNAP_MS);
  }, []);

  useEffect(
    () => () => {
      clearTimeout(snapTimer.current);
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
          setSnapAnimated(true);
          setPaintTick((t) => t + 1);
          beginSnap();
          break;
        case "settle":
          release();
          movedRef.current = true;
          setSnapAnimated(true);
          setActiveKey(splitKeys(committedSig)[effect.index] ?? HERO_KEY);
          setPaintTick((t) => t + 1);
          beginSnap();
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
    [beginSnap, committedSig],
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

  const paused = !active || !docVisible || reeling || motion === "reduced" || count <= 1 || busy;
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => {
      const order = splitKeys(committedSig);
      setSnapAnimated(true);
      setActiveKey((k) => order[(Math.max(0, order.indexOf(k)) + 1) % order.length] ?? k);
    }, AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [paused, activeKey, restartTick, committedSig]);

  /** Jump to a slide by KEY (a dot) — or, when it is already active, just restart the cadence. */
  const goTo = (key: string): void => {
    setSnapAnimated(true);
    if (key === activeKey) setRestartTick((t) => t + 1);
    else setActiveKey(key);
  };

  /** Step by one, WRAPPING at both ends so the buttons match the auto-advance cycle (Codex R4-7). */
  const step = (delta: number): void => {
    if (count === 0) return;
    setSnapAnimated(true);
    setActiveKey(keys[(index + delta + count) % count] ?? activeKey);
  };

  return (
    <div
      className="gc-banner"
      ref={rootRef}
      role="group"
      aria-roledescription="carousel"
      aria-label="Pickup banner"
      onPointerDown={(e) =>
        dispatch({
          type: "down",
          pointerId: e.pointerId,
          primary: e.isPrimary,
          x: e.clientX,
          y: e.clientY,
        })
      }
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
      onLostPointerCapture={() => dispatch({ type: "cancel" })}
      // The post-drag click suppression (§6.4). The flag must survive from pointerup INTO the click the
      // browser synthesizes after it, which is why it is a ref rather than state, and why it is cleared
      // HERE rather than on the next pointerdown: a drag that ends over a button must not open it, and the
      // very next tap must.
      onClickCapture={(e) => {
        if (!movedRef.current) return;
        movedRef.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="gc-banner-track" ref={trackRef}>
        {rendered.map((s, i) => {
          const inactive = i !== index;
          const host = s.host;
          const copy = host ? promoCopy(s.online) : null;
          const body = (
            <span className="gc-banner-copy">
              <span className="tag">{copy ? copy.tag : `PICKUP ${GACHA_COPY.heroTag}`}</span>
              <b>
                {host ? (
                  host.name
                ) : (
                  <>
                    NETWORK
                    <br />
                    PRIZE POOL
                  </>
                )}
              </b>
              <small>{copy ? copy.caption : GACHA_COPY.heroCaption}</small>
            </span>
          );
          return (
            <div
              className={"gc-slide" + (host && !s.online ? " sleep" : "")}
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
                <img
                  src={s.art.url}
                  alt=""
                  draggable={false}
                  style={s.art.focus === undefined ? undefined : { objectPosition: s.art.focus }}
                />
              )}
              {host ? (
                <button
                  type="button"
                  className="gc-slide-hit"
                  aria-label={openLabel(host.name, s.online)}
                  onClick={() => onOpenHost(host.id)}
                >
                  {body}
                </button>
              ) : (
                // The fixed hero is inert by design (§6.4): it names no machine, so it has nothing to open.
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
        <span>{GACHA_COPY.pityLabel} 200</span>
      </div>

      {count > 1 &&
        (count <= MAX_DOTS ? (
          <div className="gc-banner-dots">
            {rendered.map((s, i) => (
              <button
                key={s.key}
                type="button"
                className={"gc-dot" + (i === index ? " on" : "")}
                aria-label={s.host ? `show ${s.host.name}` : "show the prize pool"}
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
