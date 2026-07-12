import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { useSections } from "../hooks/useSections";
import type { TabId } from "../theme-engine/types";

// Section navigation as a single ORBIT-glyph launcher that opens a compact icon dropdown of the theme's
// sections. A PURE consumer of the headless `useSections` controller (the nav abstraction is explicitly
// "render the sections as a tab bar, a drawer, a rail, or nothing" — this is the "nothing-but-a-menu"
// presentation), so it never forks nav state. Theme-agnostic + token-driven → any DefaultRoot theme gets it.
// Icon-only (owner directive) with clear, explicit glyphs + per-item `aria-label`; non-modal popover a11y
// (Escape + click-outside close, focus returns to the launcher, arrow-key roving between items).
//
// DOCKING RULE (D35 §F0 fixup, owner-ratified 2026-07-12) — "the menu affordance docks to the chrome that
// exists". ONE component, two mounts (no forked popover/item/a11y logic — the `docked` prop only reshapes
// the trigger + popover geometry):
//   • `docked` (appbarMode="visible"): the trigger is an APPBAR TRAILING ACTION (styled `.kit-iconbtn`,
//     matching the TTS toggle) that KitAppBar renders; the popover is fixed just under the appbar.
//   • floating (appbarMode="off"/"minimal"): the standalone top-right orbit launcher, mounted by DefaultRoot.

// Launcher mark — the Lucide "Orbit" icon (ISC-licensed; docs/screenshot/icons/Orbit--Streamline-Lucide):
// a central body + two orbiting bodies on two orbital arcs. currentColor → cosmos tints it silver. `size`
// shrinks the glyph to ~18px in the docked appbar-button (to match the TTS icon scale); floating uses 25.
function OrbitGlyph({ size = 25 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <circle cx="19" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
      <path d="M10.4 21.9a10 10 0 0 0 9.941-15.416" />
      <path d="M13.5 2.1a10 10 0 0 0-9.841 15.416" />
    </svg>
  );
}

// Explicit section icons (clearer than the abstract tab glyphs ◆▲⌬●). Keyed by section id; an unknown
// (future custom) section falls back to its registry glyph string.
const ICONS: Record<string, ReactNode> = {
  fleet: (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </svg>
  ),
  agent: (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 21l2.1-5.4A8.5 8.5 0 1 1 21 11.5z" />
    </svg>
  ),
  utils: (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  conf: (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

// `docked` = mount as an appbar trailing-action button (visible chrome) vs the standalone floating launcher.
// Only the trigger styling + popover positioning differ; the popover, item list, and all a11y wiring below
// are identical across both modes (one source of truth).
export function NavMenu({ docked = false }: { docked?: boolean }) {
  // The menu lists the OFF-BAR-AND-UNHOSTED sections only (Axis A, D35 §F0) — everything in `appbarMode:
  // "minimal"` (all off-bar), or the odd one out under a partial layout (e.g. conf in 2-tab). Hosting
  // supersedes the menu, so a hosted section (utils in 3-/2-tab) never appears here. The active section may
  // legitimately be ABSENT from this list (e.g. the user is ON an on-bar section) — the focus logic below
  // falls back to the first item when so.
  const { menu: sections, active, navigate } = useSections();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  // close on an outside pointer-down (non-modal popover)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // on open, move focus to the active (else first) item
  useEffect(() => {
    if (!open) return;
    const items = rootRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']");
    const i = sections.findIndex((s) => s.id === active);
    items?.[i >= 0 ? i : 0]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    launcherRef.current?.focus();
  };
  const go = (id: TabId) => {
    navigate(id);
    close();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [],
    );
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const n = items.length;
    items[e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n]?.focus();
  };

  return (
    <div
      className={"navmenu" + (docked ? " docked" : "")}
      ref={rootRef}
      data-open={open || undefined}
      onKeyDown={onKeyDown}
    >
      <button
        ref={launcherRef}
        type="button"
        // Docked: reuse `.kit-iconbtn` so the trigger is byte-identical to the TTS toggle (bordered 34px
        // pill); it keeps `navmenu-launch` for the shared open-state/focus styling. Floating: the standalone
        // transparent orbit launcher (`.navmenu-launch` carries its own geometry).
        className={docked ? "kit-iconbtn navmenu-launch" : "navmenu-launch"}
        aria-label="Navigation menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <OrbitGlyph size={docked ? 18 : 25} />
      </button>
      {open && (
        <div className="navmenu-pop" role="menu" aria-label="Sections">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitem"
              className={"navmenu-item" + (s.id === active ? " active" : "")}
              aria-current={s.id === active ? "page" : undefined}
              aria-label={s.lbl}
              onClick={() => go(s.id)}
            >
              {ICONS[s.id] ?? <span className="navmenu-glyph">{s.glyph}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
