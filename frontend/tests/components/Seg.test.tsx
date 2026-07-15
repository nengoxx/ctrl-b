import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Seg } from "../../src/components/Seg";

// Seg a11y semantics (F5 Gate A5). The segmented control is a labelled `role="group"` with each option a
// button carrying `aria-pressed` for its selected state (Primer/Workday pattern — NOT a radiogroup/tablist,
// so every option stays a tab stop). These lock in the contract axe + the render e2e machine-enforce.

afterEach(cleanup);

const OPTS = [
  { val: "local", label: "Local" },
  { val: "cloud", label: "Cloud" },
];

describe("Seg semantics", () => {
  it("the container is a labelled group", () => {
    const { container } = render(
      <Seg label="Backend" current="local" onPick={() => {}} options={OPTS} />,
    );
    const group = container.querySelector("[role='group']");
    expect(group).toBeTruthy();
    expect(group?.getAttribute("aria-label")).toBe("Backend");
  });

  it("marks exactly the current option aria-pressed", () => {
    const { container } = render(
      <Seg label="Backend" current="cloud" onPick={() => {}} options={OPTS} />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  });
});
