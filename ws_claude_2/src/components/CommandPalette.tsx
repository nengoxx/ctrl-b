import { useEffect, useMemo, useRef, useState } from "react";
import { Search, CornerDownLeft } from "lucide-react";
import { BodyPortal } from "./primitives";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter((c) => (c.label + " " + (c.hint ?? "")).toLowerCase().includes(s));
  }, [q, commands]);

  useEffect(() => setActive(0), [q]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === "Enter") {
      e.preventDefault();
      const c = filtered[active];
      if (c) { c.run(); onClose(); }
    }
  }

  return (
    <BodyPortal>
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal cmdk" onClick={(e) => e.stopPropagation()} onKeyDown={onKey} role="dialog" aria-modal="true">
          <div className="cmdk-input">
            <Search size={16} className="muted" />
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Run a command or jump to…" />
            <span className="faint" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
              <CornerDownLeft size={12} /> to run
            </span>
          </div>
          <div className="cmdk-list">
            {filtered.map((c, i) => (
              <button
                key={c.id}
                className={`cmdk-item ${i === active ? "active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => { c.run(); onClose(); }}
              >
                <span className="ci-ic">{c.icon}</span>
                {c.label}
                {c.hint && <span className="ci-meta">{c.hint}</span>}
              </button>
            ))}
            {filtered.length === 0 && <div className="cmdk-empty">No matching commands.</div>}
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}
