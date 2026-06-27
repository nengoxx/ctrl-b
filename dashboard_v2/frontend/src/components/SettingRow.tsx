import { type ReactNode } from "react";

// A settings row — the shared `.confrow` shape (label + caps description in `.k`, then a trailing control).
// It's the toggle/picker counterpart to the text-input `Field` helper (which renders the same `.confrow`/
// `.k` shape for inputs), so every settings row shares ONE declarative shape instead of repeated inline
// confrow markup. Web-researched: this is shadcn's horizontal `Field` (FieldContent = label + description,
// trailing control) — the documented fix for "manual styling doesn't scale" form rows.
//
// The label is a <div> (not a <label>) because the trailing control (Switch / Seg / Swatches) isn't a
// native form input (D25 a11y note); controls that need an accessible name take their own (e.g. Swatches'
// `ariaLabel`). Used in Conf → Appearance now; the rest of the Conf groups can adopt it incrementally.
export function SettingRow({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="confrow">
      <div className="k">
        <div className="label">{label}</div>
        {desc != null && <div className="desc">{desc}</div>}
      </div>
      {children}
    </div>
  );
}
