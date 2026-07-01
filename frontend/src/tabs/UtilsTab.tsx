// Tools tab (Phase 8, D8). Two sections:
//  · A — generic Vapor `.util` run cards, one per utility tool from `GET /api/tools` (yt_captions,
//    ip_info, dns_trace today); "add a tool = one backend file" makes a new card appear automatically.
//  · B — the agent-tool catalog (8b, D22): per-tool description override + tri-state agent-access
//    mode for *every* agent tool. Per-agent tool *selection* stays in Conf → Agents (a different axis).
// Labelled "Tools" (was Vapor's "Utils") since it hosts the full tool surface; route id stays
// `tab-utils`.

import { ConfGroup } from "../components/ConfGroup";
import { ToolCatalog } from "../components/ToolCatalog";
import { UtilCard } from "../components/UtilCard";
import { useTools } from "../hooks/useTools";

interface Props {
  active: boolean;
}

export function UtilsTab({ active }: Props) {
  const { data: tools, isLoading, isError } = useTools();

  return (
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-utils"
      data-screen-label="03 Tools"
      role="tabpanel"
      aria-labelledby="tabbtn-utils"
    >
      <div className="sec">
        <span className="num">03</span>
        <b>Tools</b>
        <span className="right">utility tools</span>
      </div>

      {isLoading && <div className="no-svc">// loading tools…</div>}
      {isError && <div className="no-svc">// couldn't load tools</div>}
      {tools?.map((t) => (
        <UtilCard key={t.name} tool={t} />
      ))}

      <ConfGroup
        id="agent-tools"
        num="04"
        title="agent tools"
        right="access & descriptions"
        defaultCollapsed
      >
        <ToolCatalog />
      </ConfGroup>

      <div style={{ height: 24 }} />
    </div>
  );
}
