import type { ReactNode } from "react";

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
  right?: ReactNode;
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const [collapsed, toggle] = useCollapsed(props.id, props.defaultCollapsed);
  return (
    <div className={"confgroup" + (collapsed ? " collapsed" : "")}>
      <div className="conftitle conf-toggle" onClick={toggle}>
        <span className="conf-chev" aria-hidden>›</span>
        <span className="num">{props.num}</span>
        <b>{props.title}</b>
        {props.right != null && <span className="right">{props.right}</span>}
      </div>
      {props.children}
    </div>
  );
}
