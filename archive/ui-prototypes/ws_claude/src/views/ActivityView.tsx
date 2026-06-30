import { useEvents } from "../api/queries";
import { LevelIcon, relTime, clockTime } from "../components/common";
import type { ActivityEvent } from "../types";

export function ActivityRow({ e }: { e: ActivityEvent }) {
  return (
    <div className={`feed-row ${e.level}`}>
      <span className="ico">
        <LevelIcon level={e.level} />
      </span>
      <div className="body">
        <div className="msg">{e.message}</div>
        <div className="sub">
          <span>{e.source}</span>
          {e.target && <span className="chip">{e.target}</span>}
        </div>
      </div>
      <span className="when" title={clockTime(e.ts)}>
        {relTime(e.ts)}
      </span>
    </div>
  );
}

export function ActivityView({ limit }: { limit?: number }) {
  const { data: events, isLoading } = useEvents();
  if (isLoading) return <div className="empty">Loading activity…</div>;

  const list = limit ? (events ?? []).slice(0, limit) : events ?? [];
  return (
    <div>
      <p className="section-title">Activity</p>
      <div className="panel">
        <div className="feed">
          {list.map((e) => (
            <ActivityRow key={e.id} e={e} />
          ))}
          {list.length === 0 && <div className="empty">No recent activity.</div>}
        </div>
      </div>
    </div>
  );
}
