// A11 / D48 B3 — a small up/down reorder affordance for ordered list rows (fallback chains now;
// voice/embeddings fallbacks in Slice 2). Kit-consistent + keyboard- and screen-reader-friendly (R21);
// disabled at the ends. P11 layers a pointer DRAG handle (useDragReorder) OVER these — the arrows STAY as
// the keyboard/AT path + the reorder test hook (drag is a layer, never a replacement). Styled in both
// trees on the shared compact-action recipe (`.svc-add` neutral) + a square-icon override.
export function MoveButtons(props: {
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  label?: string;
}) {
  const { index, count, onMove, label } = props;
  const what = label ? ` ${label}` : "";
  return (
    <div className="move-btns">
      <button
        type="button"
        className="move-up"
        disabled={index === 0}
        aria-label={`move${what} up`}
        title="move up"
        onClick={() => onMove(index, index - 1)}
      >
        ↑
      </button>
      <button
        type="button"
        className="move-down"
        disabled={index >= count - 1}
        aria-label={`move${what} down`}
        title="move down"
        onClick={() => onMove(index, index + 1)}
      >
        ↓
      </button>
    </div>
  );
}
