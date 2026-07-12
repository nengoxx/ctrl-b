import type { ReactNode } from "react";

import { disclosureToggle } from "../lib/disclosure";
import { useCollapsed } from "../store/collapse";

// A collapsible, numbered settings section (Phase 7c polish). Extracted from ConfTab (8b) so the
// Tools tab can host the agent-tool catalog in the same collapsible frame as the Conf groups — one
// source of truth for the disclosure chevron + persisted collapse state (store/collapse), no
// per-tab re-implementation. The numbered `.conftitle` divider + `.conf-card` body styling are
// vapor tokens (D7); collapse persists in localStorage keyed by `id`.
export function ConfGroup(props: {
  id: string;
  num: string;
  title: string;
  //: Keep `right` (and `title`) **non-interactive** — they render inside the `role="button"` header
  //: (D25), so a `<button>`/`<a>`/`Switch` here would re-create the nested-interactive violation and
  //: double-fire on click/Enter. For an interactive section affordance, put it in the body, not here.
  right?: ReactNode;
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const [collapsed, toggle] = useCollapsed(props.id, props.defaultCollapsed);
  return (
    // `id` doubles as the collapse key AND a DOM anchor (D35 §F0: the hosted-utils group is a scroll-to
    // target). Group ids are already unique collapse keys; the one reused id ("agent-tools") lives in
    // UtilsTab's content, which is UNMOUNTED whenever that content is hosted in Conf, so no duplicate DOM
    // id can co-exist.
    <div id={props.id} className={"confgroup" + (collapsed ? " collapsed" : "")}>
      {/* D25 — keyboard-operable disclosure (header is button-free, so role=button is safe here). */}
      <div className="conftitle conf-toggle" {...disclosureToggle(!collapsed, toggle)}>
        <span className="conf-chev" aria-hidden>
          ›
        </span>
        <span className="num">{props.num}</span>
        <b>{props.title}</b>
        {props.right != null && <span className="right">{props.right}</span>}
      </div>
      {props.children}
    </div>
  );
}
