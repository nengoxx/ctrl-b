import { describe, expect, it } from "vitest";

import { PRIVILEGE_LEVELS, PRIVILEGE_VALUES, privilegeLabel } from "../../src/lib/privilege";

// lib/privilege — the shared privilege ladder (one source of truth, mirrors the backend StrEnum).

describe("privilege ladder", () => {
  it("orders least → most privileged", () => {
    expect(PRIVILEGE_LEVELS.map((l) => l.val)).toEqual(["readonly", "confirm", "auto_low", "full"]);
  });

  it("PRIVILEGE_VALUES validates exactly the four levels", () => {
    expect(PRIVILEGE_VALUES.has("full")).toBe(true);
    expect(PRIVILEGE_VALUES.has("readonly")).toBe(true);
    expect(PRIVILEGE_VALUES.has("read")).toBe(false); // alias is resolved by the composer, not here
    expect(PRIVILEGE_VALUES.size).toBe(4);
  });

  it("privilegeLabel maps known levels and falls back to the raw value", () => {
    expect(privilegeLabel("auto_low")).toBe("Auto-low");
    expect(privilegeLabel("full")).toBe("Full");
    // @ts-expect-error — unknown level falls back to itself
    expect(privilegeLabel("mystery")).toBe("mystery");
  });
});
