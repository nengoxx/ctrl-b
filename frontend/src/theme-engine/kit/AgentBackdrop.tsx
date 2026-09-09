import { FocalImg } from "../../components/FocalImg";
import type { AgentBackdropMode } from "../types";
import type { BackdropArt } from "./agentBackdrop";

// THE AGENT BACKDROP's layer (D70 §8.3 / §8.3a) — the rendering half; the vocabulary, its heal, the store
// read and the scroll driver are in `agentBackdrop.ts` beside it.
//
// This module is PRESENTATIONAL: it takes a resolved `mode` and a resolved `art` and renders the layer.
// WHICH art is each body's own answer (`hooks/useActiveBackdrop` for the agent's own picture; gacha folds
// its oracle ladder in behind that), for the reason every art surface in this app resolves in its body and
// hands the picture down — the surface renders what it is given.
//
// The three states, and what each REUSES rather than invents:
//   · `off`      — nothing mounts. On gacha the oracle block stays with its plate and scanline and paints
//                  no picture (its shipped art-resolved-null state, GachaAgent's call); here, no node.
//   · `operator` — an IN-FLOW art strip at the top of the tab: a token-height block, the picture, a
//                  readability scrim, framed through the shared `FocalImg`. It simply scrolls away with the
//                  content — gacha's own `data-oracle="scroll"` posture, so there is NO driver in this
//                  mode. cosmos/vapor/minimal have no operator-image place of their own; this is it.
//   · `full`     — ONE shared arrangement (used by the kit themes AND gacha): a zero-height sticky PIN
//                  hosting a sharp full-bleed art layer and a SEPARATE readability veil. It does not
//                  react to scroll AT ALL — the picture the owner sees at the top of the thread is the
//                  picture at every offset (the wave-3 feel round, 2026-09-09: "not fade it out … just
//                  leave it like when the chat is unscrolled"). The veil is what makes the text readable
//                  over it, and it is static, so there is nothing here to drive: no ref, no listener, no
//                  per-frame property. No blurred copy either — that is the difference from gacha's own
//                  oracle fade, which is that theme's operator art and keeps its own driver.

/** The `operator` strip — an ordinary in-flow block. No driver, no sticky, no stacking: it scrolls away
 *  with the content, which is the whole presentation. */
function OperatorStrip({ art }: { art: BackdropArt }) {
  return (
    <div className="kit-backdrop-strip" aria-hidden>
      <FocalImg
        className="kit-backdrop-art"
        art={art.focus}
        src={art.url}
        alt=""
        draggable={false}
      />
      <div className="kit-backdrop-veil" />
    </div>
  );
}

/** The `full` arrangement — the zero-height sticky pin (the frontier `.fr-rigstack-pin` precedent: it keeps
 *  its overflowing child in view for the whole scroll of the thread without taking flow space and without a
 *  `position: fixed` ancestor-transform trap), the sharp art layer, and a SEPARATE veil so the readability
 *  wash is its own layer.
 *
 *  PRESENTATIONAL TO THE LETTER since the wave-3 feel round: the layer is what it renders, and it renders
 *  the same at every scroll offset. The `motion` read and the tab gate that used to live here existed only
 *  to arm the scroll driver, and went out with it. */
function FullBackdrop({ art }: { art: BackdropArt }) {
  return (
    <div className="kit-backdrop-pin" aria-hidden>
      <div className="kit-backdrop-full">
        <FocalImg
          className="kit-backdrop-art"
          art={art.focus}
          src={art.url}
          alt=""
          draggable={false}
        />
        <div className="kit-backdrop-veil" />
      </div>
    </div>
  );
}

/** The layer itself. `art === null` (the agent binds nothing paintable, and the theme offers no fallback)
 *  renders NOTHING — dormancy by absence, exactly like `KitBackground`: a fresh install and every agent
 *  without a picture are byte-identical to the shell that shipped before this slice. `off` renders nothing
 *  whatever the art is (§8.3's F14 correction: `off` beats the ladder). */
export function AgentBackdrop({ mode, art }: { mode: AgentBackdropMode; art: BackdropArt | null }) {
  if (mode === "off" || art === null) return null;
  return mode === "full" ? <FullBackdrop art={art} /> : <OperatorStrip art={art} />;
}
