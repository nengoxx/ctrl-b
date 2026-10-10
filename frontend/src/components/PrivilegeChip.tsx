import { useState } from "react";

import { PRIVILEGE_LEVELS, privilegeLabel, type Privilege } from "../lib/privilege";
import { setHomePrivilege, useHomePrivilege } from "../store/chat";

// The privilege chip (A1/D16) in the chat section header: shows the open conversation's HOME agent's
// privilege override (D84 R40 — keyed by the home, shared by its conversations, persisted per device by
// ON4), or "Default" = follow the home agent's own privilege, and opens a small menu to change it. The
// `/privilege` composer verb writes the same override; this is the tap-friendly setter for mobile. While
// the open conversation's home is UNKNOWN (a failed late read, §12.3 H6) it reads "…" and offers nothing:
// no override rides a send then, and none can be keyed by a guess.
//
// Extracted from AgentTab (F4) so a BESPOKE theme body (frontier's FrontierAgent) can reuse the exact same
// chip — DOM/classes byte-identical — inside its own `.sec` header without forking the privilege menu. The
// `.priv-*` class family is a §15 chat-hook contract member, styled by every theme via tokens.
// Every chat body now renders it through the one shared header cluster, `ChatHeaderActions` (D84 §7).
export function PrivilegeChip() {
  const homePrivilege = useHomePrivilege(); // slice — don't re-render per token
  const unknown = homePrivilege === undefined;
  const sessionPrivilege = homePrivilege ?? null;
  const [open, setOpen] = useState(false);
  const label = unknown ? "…" : sessionPrivilege ? privilegeLabel(sessionPrivilege) : "Default";
  const pick = (p: Privilege | null) => {
    setHomePrivilege(p);
    setOpen(false);
  };
  return (
    <span className="priv-chip-wrap">
      <button
        type="button"
        className={"priv-chip" + (sessionPrivilege ? " set" : "")}
        onClick={() => setOpen((o) => !o)}
        disabled={unknown}
        aria-expanded={open && !unknown}
        aria-label={`session privilege: ${label} — tap to change`}
        title="session privilege"
      >
        <span className="priv-dot" aria-hidden />
        <span className="priv-lbl">{label}</span>
        <span className="chev" aria-hidden>
          ▾
        </span>
      </button>
      {open && !unknown && (
        <>
          <button
            className="priv-backdrop"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <ul className="priv-menu" role="menu">
            {PRIVILEGE_LEVELS.map((l) => (
              <li key={l.val}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={sessionPrivilege === l.val}
                  className={sessionPrivilege === l.val ? "active" : ""}
                  onClick={() => pick(l.val)}
                >
                  {l.label}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!sessionPrivilege}
                className={!sessionPrivilege ? "active" : ""}
                onClick={() => pick(null)}
              >
                Default
              </button>
            </li>
          </ul>
        </>
      )}
    </span>
  );
}
