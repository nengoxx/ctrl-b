import { PlayCircle, RotateCw, Activity as ActivityIcon } from "lucide-react";
import { useHosts, useServices, useHostAction, useServiceAction } from "../api/queries";
import { StatusDot, StateLabel } from "../components/common";
import { ActivityView } from "./ActivityView";

export function OverviewView({ onJump }: { onJump: (view: "hosts" | "services") => void }) {
  const { data: hosts } = useHosts();
  const { data: services } = useServices();
  const hostAction = useHostAction();
  const svcAction = useServiceAction();

  const sleeping = hosts?.filter((h) => h.status === "sleeping" || h.status === "unreachable") ?? [];
  const hostIssues = hosts?.filter((h) => h.status === "warning" || h.status === "unreachable") ?? [];
  const svcIssues = services?.filter((s) => s.state === "degraded" || s.state === "stopped") ?? [];
  const attention = hostIssues.length + svcIssues.length;

  return (
    <>
      {/* fleet at a glance — dense status chips, not big tiles */}
      <div>
        <p className="section-title">Fleet · {hosts?.length ?? 0}</p>
        <div className="fleet-strip">
          {(hosts ?? []).map((h) => (
            <button className="fleet-chip" key={h.id} onClick={() => onJump("hosts")}>
              <StatusDot state={h.status} />
              <span className="fn">{h.name}</span>
              <span className="fm">
                {h.status === "online" || h.status === "warning"
                  ? `${h.metrics.cpu ?? 0}% cpu`
                  : h.status}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="deck-2">
        {/* needs attention — actionable, only shows real problems */}
        <div>
          <p className="section-title">
            Needs attention {attention > 0 ? `· ${attention}` : ""}
          </p>
          <div className="panel">
            {attention === 0 ? (
              <div className="empty">
                <ActivityIcon size={18} style={{ opacity: 0.5 }} />
                <div style={{ marginTop: 8 }}>Everything nominal.</div>
              </div>
            ) : (
              <>
                {sleeping
                  .filter((h) => h.status === "unreachable")
                  .map((h) => (
                    <div className="attn-row" key={h.id}>
                      <StatusDot state={h.status} />
                      <div>
                        <div className="nm mono">{h.name}</div>
                        <div className="why">unreachable</div>
                      </div>
                      <button
                        className="btn sm act"
                        onClick={() => hostAction.mutate({ hostId: h.id, action: "wake_host" })}
                      >
                        <PlayCircle size={14} /> Wake
                      </button>
                    </div>
                  ))}
                {hostIssues
                  .filter((h) => h.status === "warning")
                  .map((h) => (
                    <div className="attn-row" key={h.id}>
                      <StatusDot state={h.status} />
                      <div>
                        <div className="nm mono">{h.name}</div>
                        <div className="why">
                          high load · {h.metrics.memory ?? 0}% mem
                        </div>
                      </div>
                      <StateLabel state="warning" />
                    </div>
                  ))}
                {svcIssues.map((s) => (
                  <div className="attn-row" key={s.id}>
                    <StatusDot state={s.state} />
                    <div>
                      <div className="nm">{s.name}</div>
                      <div className="why">
                        {s.state} on {hosts?.find((h) => h.id === s.hostId)?.name}
                      </div>
                    </div>
                    <button
                      className="btn sm act"
                      onClick={() =>
                        svcAction.mutate({
                          serviceId: s.id,
                          action: s.state === "stopped" ? "start_service" : "restart_service",
                        })
                      }
                    >
                      <RotateCw size={14} /> {s.state === "stopped" ? "Start" : "Restart"}
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* recent activity, compact */}
        <ActivityView limit={6} />
      </div>
    </>
  );
}
