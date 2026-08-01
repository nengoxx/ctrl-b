import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "../../src/components/ErrorBoundary";
import { crashBtn, crashBtnQuiet, rootErrorFallback } from "../../src/lib/crashScreen";

// F23 — the GLOBAL crash net (main.tsx wires `rootErrorFallback` into the outer ErrorBoundary). Every
// other layer only asserts this screen's ABSENCE (the ⑩ kit-render e2e's `.root-error` count), so this is
// the POSITIVE one: a child throws, the screen renders for real, and its single action reloads.
//
// It also pins the SELF-CONTAINMENT contract (D51 V0 rider): the crash screen may assume no theme CSS
// loaded — its classes are all `@scope([data-skin="vapor"])`-scoped, which since V0 is not the default
// skin. So the readability-critical properties must be INLINE, and the button's fg/bg pair must not read
// theme tokens (the earlier `var(--accent-fill)` fill + `var(--text)` ink mixed two sources).

function Boom(): never {
  throw new Error("subtree exploded");
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined); // silence React's caught-error noise
});
afterEach(cleanup); // globals:false → register RTL cleanup explicitly

describe("F23 root error fallback", () => {
  it("renders the error message + the Reload action when a child throws", () => {
    render(
      <ErrorBoundary fallback={rootErrorFallback}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/subtree exploded/)).toBeTruthy();
    expect(screen.getByText("// the app hit a snag")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeTruthy();
  });

  it("Reload calls the boundary's window.location.reload", () => {
    // jsdom's `location.reload` is non-configurable, so swap the whole `window.location` for this case
    // (nothing in this render path reads other Location fields). Restored below — the App.test.tsx idiom.
    const reloadSpy = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { reload: reloadSpy } });
    try {
      render(
        <ErrorBoundary fallback={rootErrorFallback}>
          <Boom />
        </ErrorBoundary>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: orig });
    }
  });

  it("is self-contained: the shell + button carry inline styling, and the button's pair is theme-free", () => {
    const { container } = render(
      <ErrorBoundary fallback={rootErrorFallback}>
        <Boom />
      </ErrorBoundary>,
    );
    const shell = container.querySelector<HTMLElement>(".root-error")!;
    expect(shell.style.background).not.toBe(""); // not relying on the vapor-scoped `.root-error` rule
    expect(shell.style.color).not.toBe("");
    const btn = screen.getByRole("button", { name: "Reload page" });
    // The fg/bg PAIR comes from one source (neutral literals); a `var(--…)` here would be the mixed-token
    // regression. The border may still read `var(--accent, …)` — a hint whose contrast gates nothing.
    expect(btn.style.background).not.toContain("var(");
    expect(btn.style.color).not.toContain("var(");
    expect(btn.style.background).not.toBe("");
    expect(btn.style.color).not.toBe("");
  });

  it("both button primitives keep the single-source pairing (incl. the quiet secondary)", () => {
    // Object-level pin so the guard covers every consumer (App.tsx's theme-fault panel renders the quiet
    // form, which no DOM test here reaches): literals only, and the quiet fill must never regress to
    // `transparent` — see-through would re-pair the neutral ink with the shell's THEMED `var(--bg)`.
    for (const b of [crashBtn, crashBtnQuiet]) {
      expect(b.background).not.toContain("var(");
      expect(b.color).not.toContain("var(");
      expect(b.background).not.toBe("transparent");
    }
  });
});
