import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Brain,
  Search,
  Image,
  Server,
  Globe,
  Box,
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { ServiceKind } from "../types";

export function StatusDot({ state }: { state: string }) {
  return <span className={`dot ${state}`} aria-label={state} />;
}

const KIND_ICON: Record<ServiceKind, LucideIcon> = {
  llm: Brain,
  search: Search,
  media: Image,
  system: Server,
  web: Globe,
  other: Box,
};
export function KindIcon({ kind, size = 17 }: { kind: ServiceKind; size?: number }) {
  const Icon = KIND_ICON[kind] ?? Box;
  return <Icon size={size} />;
}

const LEVEL_ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const;
export function LevelIcon({ level, size = 15 }: { level: keyof typeof LEVEL_ICON; size?: number }) {
  const Icon = LEVEL_ICON[level];
  return <Icon size={size} />;
}

/** Renders into <body> so `position: fixed` is always viewport-relative,
 *  immune to any transformed/contained ancestor constraining its width. */
export function BodyPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

export function StateLabel({ state }: { state: string }) {
  return <span className={`state-label ${state}`}>{state}</span>;
}

export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ConfirmModal({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="head">{title}</div>
        <div className="body">{body}</div>
        <div className="foot">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className={`btn ${danger ? "danger" : "primary"}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
