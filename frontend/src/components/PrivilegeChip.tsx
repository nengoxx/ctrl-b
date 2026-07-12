import { useState } from "react";

import { PRIVILEGE_LEVELS, privilegeLabel, type Privilege } from "../lib/privilege";
import { setSessionPrivilege, useChatSlice } from "../store/chat";

// The session privilege chip (A1/D16) in the chat section header: shows the active session override (or
// "default" = follow the agent's own privilege) and opens a small menu to change it. The `/privilege`
// composer verb sets the same sticky state; this is the tap-friendly setter for mobile.
//
// Extracted from AgentTab (F4) so a BESPOKE theme body (frontier's FrontierAgent) can reuse the exact same
// chip — DOM/classes byte-identical — inside its own `.sec` header without forking the privilege menu. The
// `.priv-*` class family is a §15 chat-hook contract member, styled by every theme via tokens.
export function PrivilegeChip() {
  const sessionPrivilege = useChatSlice((s) => s.sessionPrivilege); // slice — don't re-render per token
  const [open, setOpen] = useState(false);
  const label = sessionPrivilege ? privilegeLabel(sessionPrivilege) : "Default";
  const pick = (p: Privilege | null) => {
    setSessionPrivilege(p);
    setOpen(false);
  };
  return (
    <span className="priv-chip-wrap">
      <button
        type="button"
        className={"priv-chip" + (sessionPrivilege ? " set" : "")}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`session privilege: ${label} — tap to change`}
        title="session privilege"
      >
        <span className="priv-dot" aria-hidden />
        <span className="priv-lbl">{label}</span>
        <span className="chev" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
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
