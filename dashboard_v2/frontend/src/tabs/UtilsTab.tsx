// Tools tab (Phase 8, D8). Renders a generic Vapor `.util` card per utility tool from the registry
// (`GET /api/tools`) — yt_captions, ip_info, dns_trace today; "add a tool = one backend file" makes
// a new card appear here automatically. Labelled "Tools" (was Vapor's "Utils") since it now hosts
// the full tool surface; the route id stays `tab-utils`. The agent-tool catalog (per-tool mode +
// descriptions) lands in the Conf-consolidation slice (8b).

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

      <div style={{ height: 24 }} />
    </div>
  );
}
