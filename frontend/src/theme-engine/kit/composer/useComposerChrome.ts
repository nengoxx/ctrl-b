import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

// Shared PRESENTATIONAL chrome for the Kit composer variants (COMPOSER_SURFACE_PLAN §3.1). KitComposer and
// SheetComposer share three pure-presentational concerns — NOT behaviour (behaviour is `useComposer`, the
// headless controller): the mic-press JS-toggle (Fennec `:active`-wedge fix), the textarea auto-grow (max
// 96px), and Enter-to-send. Extracted here so a second variant reuses them instead of copy-pasting; this is
// a CHARACTERIZED extraction (behaviour byte-identical to the pre-A2 KitComposer), not a redesign.
//
// vapor's `components/Composer.tsx` keeps its own copy (frozen, D7 — not touched here).

/** Mic-button aria-label/title per dictation status — a shared presentational constant (both variants read
 *  it). Lives here (not in a variant) so the two composers stay in lockstep on the labels. */
export const MIC_LABEL: Record<string, string> = {
  idle: "start dictation",
  recording: "stop dictation",
  sending: "transcribing…",
  unavailable: "voice servers unreachable",
  insecure: "microphone needs a secure (HTTPS) connection",
};

export interface ComposerChrome {
  /** Whether the mic is in its brief JS-toggled pressed state (drives the `.press` class). */
  micPressed: boolean;
  pressMic: () => void;
  releaseMic: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function useComposerChrome(
  taRef: RefObject<HTMLTextAreaElement | null>,
  draft: string,
  send: () => void,
): ComposerChrome {
  // Mic press feedback as a JS-toggled class (not CSS :active — Fennec leaves :active wedged after a tap).
  const [micPressed, setMicPressed] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressMic = () => {
    setMicPressed(true);
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setMicPressed(false), 200);
  };
  const releaseMic = () => {
    clearTimeout(pressTimer.current);
    setMicPressed(false);
  };
  useEffect(() => () => clearTimeout(pressTimer.current), []);

  // Auto-grow the textarea to fit content (max 96px), including the initial render so a restored draft
  // gets the right height as soon as the composer becomes visible.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "";
    if (ta.value === "") return;
    ta.style.height = "auto";
    ta.style.height = Math.min(96, ta.scrollHeight) + "px";
  }, [draft, taRef]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return { micPressed, pressMic, releaseMic, onKeyDown };
}
