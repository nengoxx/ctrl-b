// Shared privilege ladder (A1/D16). One source of truth for the level type + labels, used by the
// AgentsEditor (the per-agent + global-default Seg), the chat `PrivilegeChip`, and the `/privilege`
// composer verb. Mirrors the backend `Privilege` StrEnum (domain/enums.py) + `decide()` ladder.

export type Privilege = "readonly" | "confirm" | "auto_low" | "full";

export interface PrivilegeLevel {
  val: Privilege;
  label: string;
}

/** The ladder, least → most privileged (the order the Seg + the chip menu render). */
export const PRIVILEGE_LEVELS: PrivilegeLevel[] = [
  { val: "readonly", label: "Read" },
  { val: "confirm", label: "Confirm" },
  { val: "auto_low", label: "Auto-low" },
  { val: "full", label: "Full" },
];

/** Valid level strings — for validating a `/privilege <level>` composer verb before it's sent. */
export const PRIVILEGE_VALUES: ReadonlySet<string> = new Set(PRIVILEGE_LEVELS.map((l) => l.val));

/** A level's short display label (falls back to the raw value for an unknown one). */
export function privilegeLabel(p: Privilege): string {
  return PRIVILEGE_LEVELS.find((l) => l.val === p)?.label ?? p;
}
