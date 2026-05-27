import { AlertTriangle } from "lucide-react";

type Props = {
  title: string;
  detail: string;
  confirmLabel: string;
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({ title, detail, confirmLabel, open, onCancel, onConfirm }: Props) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="dialog-icon">
          <AlertTriangle size={19} />
        </div>
        <div className="dialog-copy">
          <h2 id="confirm-title">{title}</h2>
          <p>{detail}</p>
        </div>
        <div className="dialog-actions">
          <button className="button secondary" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="button danger" onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
