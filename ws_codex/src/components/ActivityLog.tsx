import { CheckCircle2, CircleAlert, CircleX, Info } from "lucide-react";
import type { ActionEvent } from "../types/models";

type Props = {
  events: ActionEvent[];
};

const iconByLevel = {
  info: Info,
  success: CheckCircle2,
  warning: CircleAlert,
  danger: CircleX,
};

export function ActivityLog({ events }: Props) {
  return (
    <section className="panel log-panel">
      <div className="panel-heading">
        <div>
          <h2>Action log</h2>
          <p>Mocked activity from this session</p>
        </div>
      </div>

      <div className="event-list">
        {events.map((event) => {
          const Icon = iconByLevel[event.level];
          return (
            <article className={`event-row level-${event.level}`} key={event.id}>
              <Icon size={16} />
              <div>
                <strong>{event.title}</strong>
                <span>{event.detail}</span>
              </div>
              <time>{event.time}</time>
            </article>
          );
        })}
      </div>
    </section>
  );
}
