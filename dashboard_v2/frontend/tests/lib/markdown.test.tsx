import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Markdown } from "../../src/lib/markdown";

// lib/markdown — the hand-rolled, dep-free markdown→React renderer. We render and assert the DOM
// *structure* (the parser's output), not styling — including the XSS-safety guard on link schemes.

afterEach(cleanup); // globals:false → register RTL cleanup explicitly

describe("Markdown renderer", () => {
  it("renders inline bold / italic / code", () => {
    const { container } = render(<Markdown text="**b** and *i* and `c`" />);
    expect(container.querySelector("strong")?.textContent).toBe("b");
    expect(container.querySelector("em")?.textContent).toBe("i");
    expect(container.querySelector("code")?.textContent).toBe("c");
  });

  it("renders a safe link with target/rel", () => {
    const { container } = render(<Markdown text="[site](https://example.com)" />);
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.getAttribute("rel")).toContain("noopener");
  });

  it("XSS guard: a javascript: link renders as plain text, not an anchor", () => {
    const { container } = render(<Markdown text="[x](javascript:alert(1))" />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("x");
  });

  it("renders headings and lists", () => {
    const { container } = render(<Markdown text={"## Title\n\n- one\n- two"} />);
    expect(container.querySelector("h2")?.textContent).toBe("Title");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
  });

  it("renders a fenced code block verbatim", () => {
    const { container } = render(<Markdown text={"```js\nconst x = 1;\n```"} />);
    expect(container.querySelector(".md-code pre code")?.textContent).toBe("const x = 1;");
  });
});
