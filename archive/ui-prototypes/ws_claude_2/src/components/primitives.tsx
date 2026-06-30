import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Brain, Search, Image, Server, Globe, Box, Info, CheckCircle2,
  AlertTriangle, XCircle, type LucideIcon,
} from "lucide-react";
import type { ServiceKind } from "../types";

export function StatusDot({ state }: { state: string }) {
  return <span className={`dot ${state}`} aria-label={state} />;
}

export function StateLabel({ state }: { state: string }) {
  return <span className={`state-label ${state}`}>{state}</span>;
}

const KIND_ICON: Record<ServiceKind, LucideIcon> = {
  llm: Brain, search: Search, media: Image, system: Server, web: Globe, other: Box,
};
export function KindIcon({ kind, size = 16 }: { kind: ServiceKind; size?: number }) {
  const Icon = KIND_ICON[kind] ?? Box;
  return <Icon size={size} />;
}

const LEVEL_ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle } as const;
export function LevelIcon({ level, size = 15 }: { level: keyof typeof LEVEL_ICON; size?: number }) {
  const Icon = LEVEL_ICON[level];
  return <Icon size={size} />;
}

/** Renders into <body> so position:fixed children are viewport-relative,
 *  immune to any transformed/contained ancestor. */
export function BodyPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

export function ConfirmDialog({
  title, body, confirmLabel, danger, onConfirm, onCancel,
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
    <BodyPortal>
      <div className="modal-backdrop" onClick={onCancel}>
        <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="head">{title}</div>
          <div className="body">{body}</div>
          <div className="foot">
            <button className="btn ghost" onClick={onCancel}>Cancel</button>
            <button className={`btn ${danger ? "danger" : "primary"}`} onClick={onConfirm} autoFocus>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}
