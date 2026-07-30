// A3 slice 3 (§D-6) — the editor's schedule PRESETS, and the raw-cron escape hatch behind them.
//
// The stored form is always a 5-field cron (the backend accepts nothing else, deliberately: cronsim's
// 6-field form is a SECONDS schedule a 10s poll loop could only misfire on). Presets are a *view* of
// that one field — never a second stored representation — so this module is two pure functions:
// build a cron from a preset, and read a cron back as a preset if it can be expressed as one.
//
// "If it can be" is the whole point: an owner who hand-writes `0 3 * * 1-5` must not have it silently
// rewritten the next time the editor opens. `presetOf` returns `null` for anything outside the three
// shapes; the editor then opens on the raw-cron field and shows a standing NOTE that the expression is
// not one of the presets and that picking one would replace it. (It is a note, not an are-you-sure: the
// replacement only happens on an explicit preset tap, and the sheet's own discard guard is what catches
// closing with unsaved edits.)

/** The preset a schedule can be authored with. `custom` = the raw-cron escape hatch. */
export type PresetKind = "hourly" | "daily" | "weekly" | "custom";

/** A preset's parameters. `minute`/`hour` are 0-based clock fields; `dow` is cron's 0=Sunday. */
export interface PresetValue {
  kind: PresetKind;
  minute: number;
  hour: number;
  dow: number;
}

/** Weekday labels indexed by cron's day-of-week field (0 = Sunday, the form cronsim reads). */
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** The default a preset starts from when the current schedule can't seed it (09:00, Monday). */
export const DEFAULT_PRESET: PresetValue = { kind: "daily", minute: 0, hour: 9, dow: 1 };

function isNum(field: string, max: number): boolean {
  // A single plain integer in range — NOT a list/range/step. `01` is accepted (cron writers emit it);
  // anything with a `,`, `-`, `/` or `*` is by definition not a preset's single value.
  return /^\d{1,2}$/.test(field) && Number(field) <= max;
}

/** The cron a preset means. The three shapes, spelled once — the editor never assembles a cron
 *  string itself, so a preset and its stored form cannot drift. */
export function presetToCron(v: PresetValue, custom: string): string {
  const m = Math.max(0, Math.min(59, Math.trunc(v.minute)));
  const h = Math.max(0, Math.min(23, Math.trunc(v.hour)));
  const d = Math.max(0, Math.min(6, Math.trunc(v.dow)));
  switch (v.kind) {
    case "hourly":
      return `${m} * * * *`;
    case "daily":
      return `${m} ${h} * * *`;
    case "weekly":
      return `${m} ${h} * * ${d}`;
    case "custom":
      return custom;
  }
}

/** Read a cron back as a preset, or `null` when it is not representable as one (→ Custom).
 *
 *  Only the exact three shapes qualify: every other field must be a bare `*`, and the fields the
 *  preset owns must be single integers. Anything else — a list, a range, a step, a month filter — is
 *  an expression the owner wrote on purpose and the presets must not claim to represent. */
export function presetOf(cron: string): PresetValue | null {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [minute, hour, dom, month, dow] = f;
  if (dom !== "*" || month !== "*") return null;
  if (!isNum(minute, 59)) return null;
  if (hour === "*" && dow === "*") {
    return {
      kind: "hourly",
      minute: Number(minute),
      hour: DEFAULT_PRESET.hour,
      dow: DEFAULT_PRESET.dow,
    };
  }
  if (!isNum(hour, 23)) return null;
  if (dow === "*") {
    return { kind: "daily", minute: Number(minute), hour: Number(hour), dow: DEFAULT_PRESET.dow };
  }
  if (isNum(dow, 6)) {
    return { kind: "weekly", minute: Number(minute), hour: Number(hour), dow: Number(dow) };
  }
  return null;
}

/** `HH:MM` from a preset's clock fields — the editor's time input value. */
export function toTimeValue(v: PresetValue): string {
  return `${String(v.hour).padStart(2, "0")}:${String(v.minute).padStart(2, "0")}`;
}

/** Parse an `<input type="time">` value back into clock fields; unparseable input leaves them as-is. */
export function fromTimeValue(value: string, current: PresetValue): PresetValue {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return current;
  return { ...current, hour: Math.min(23, Number(m[1])), minute: Math.min(59, Number(m[2])) };
}
