import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { useSections } from "../hooks/useSections";
import type { AppbarMode } from "../store/ui";
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
//
// COLLAPSE LADDER (F0 follow-up, owner-ratified 2026-07-12): the affordance scales to the menu size —
// 0 sections → the parent never mounts it · 1 → a DIRECT section button (no launcher/popover: a lone item
// needs no menu) · >1 → the orbit launcher + popover above. The direct form is an early-return branch that
// reuses the SAME docked/floating class scheme, so all the launcher geometry (44px transparent floating /
// `.kit-iconbtn` docked pill) applies unchanged — only the popover machinery is skipped.

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
  // The agents/characters gallery (D70 §8.4) — lucide "Users" geometry, hand-inlined like every glyph
  // here (the package is not a dep): two figures, the second half-drawn behind the first.
  agents: (
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
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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

  // Collapse ladder, rung 1 (single off-bar section): skip the launcher+popover entirely and render a DIRECT
  // navigation button. Same wrapper + trigger class scheme as the menu form (so the docked/floating geometry
  // is identical), minus every popover affordance — no `aria-haspopup`/`aria-expanded`, no roving-focus wiring.
  // `navmenu-direct` scopes the icon-size fix (the 22px ICONS svg → 18px docked, matching the TTS glyph). When
  // the user is already ON this section, mark it as the current location (accent, like the launcher's open
  // state) + `aria-current` — clicking is a harmless re-navigate, exactly like tapping the active tab button.
  if (sections.length === 1) {
    // Defensive (audit NIT): if the menu was OPEN when a live layout/theme change collapsed it to one item,
    // drop the stale flag — the direct form renders no popover and omits `rootRef`, so a lingering
    // `open=true` would leave the outside-pointerdown effect holding a null ref. Guarded render-phase reset
    // (the sanctioned adjust-state-during-render form; practically unreachable — see the audit note).
    if (open) setOpen(false);
    const item = sections[0];
    const here = item.id === active;
    return (
      <div className={"navmenu" + (docked ? " docked" : "")}>
        <button
          type="button"
          className={
            (docked ? "kit-iconbtn navmenu-launch" : "navmenu-launch") +
            " navmenu-direct" +
            (here ? " active" : "")
          }
          aria-label={item.lbl}
          aria-current={here ? "page" : undefined}
          onClick={() => navigate(item.id)}
        >
          {ICONS[item.id] ?? <span className="navmenu-glyph">{item.glyph}</span>}
        </button>
      </div>
    );
  }

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

// NAV-HOME quick-jump (F0 follow-up, owner-ratified 2026-07-12) — a floating TOP-LEFT companion to the orbit
// launcher: a one-tap jump back to the theme's PRIMARY section. It OWNS its full visibility (single source),
// so DefaultRoot mounts it unconditionally and hands it the chrome mode:
//   • `appbarMode: "minimal"` ONLY — the sole mode with no tab bar to carry a "home" affordance (`off`/
//     `visible` both keep the bar, whose first button already IS home).
//   • hidden while you're already on the primary (no clutter: a button that only re-lands where you stand).
// The primary is `sections[0]` (the def-order first section), NEVER a hardcoded id → any theme's set works.
// Reuses the same ICONS map + the `navmenu` floating visual family; navigation goes through the shared
// `useSections` chokepoint like every other consumer.
export function NavHome({ appbarMode }: { appbarMode: AppbarMode }) {
  const { sections, active, navigate } = useSections();
  const primary = sections[0];
  if (appbarMode !== "minimal" || !primary || active === primary.id) return null;
  return (
    <button
      type="button"
      className="navhome"
      aria-label={primary.lbl}
      onClick={() => navigate(primary.id)}
    >
      {ICONS[primary.id] ?? <span className="navmenu-glyph">{primary.glyph}</span>}
    </button>
  );
}
