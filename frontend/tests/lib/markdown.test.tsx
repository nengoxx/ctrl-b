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

// ── session-51 polish #2 (owner-ruled Q2a/Q2b) — a `*…*` action carries across single AND blank-line
// breaks, the way the ear (lib/actionSpan, read by lib/toSpeech) already pairs it. The renderer emits
// one `<em>` per line/paragraph; single-line pairs render exactly as before.
describe("Markdown · multi-line actions (session-51 #2)", () => {
  const ems = (c: HTMLElement) => [...c.querySelectorAll("em")].map((e) => e.textContent);

  it("renders Lynette's seeded greeting italic end to end — a span over a `\\r\\n` break", () => {
    const greeting =
      "*I'm lounging on the couch, lazy Sunday afternoon vibe.\r\nAs I glance over at him, grateful for that.*\r\n*I set the remote down.*";
    const { container } = render(<Markdown text={greeting} settled />);
    expect(ems(container)).toEqual([
      "I'm lounging on the couch, lazy Sunday afternoon vibe.",
      "As I glance over at him, grateful for that.",
      "I set the remote down.",
    ]);
    expect(container.querySelectorAll("p")).toHaveLength(1); // single breaks stay one paragraph
    expect(container.querySelectorAll("p br")).toHaveLength(2);
    expect(container.textContent).not.toContain("*");
  });

  it("carries a span across a BLANK line — two paragraphs, each with its own <em>", () => {
    const { container } = render(
      <Markdown text={"*para one ends here.\n\npara two ends here.*"} />,
    );
    const ps = container.querySelectorAll("p");
    expect(ps).toHaveLength(2);
    expect(ps[0].querySelector("em")?.textContent).toBe("para one ends here.");
    expect(ps[1].querySelector("em")?.textContent).toBe("para two ends here.");
    expect(container.textContent).not.toContain("*");
  });

  it("leaves an unclosed opener LITERAL while streaming, and italicizes it to the end once settled", () => {
    const text = "She smiles. *walks to the door\nand leaves";
    const streaming = render(<Markdown text={text} />);
    expect(streaming.container.querySelector("em")).toBeNull();
    expect(streaming.container.textContent).toContain("*walks to the door");
    cleanup();
    const settled = render(<Markdown text={text} settled />);
    expect(ems(settled.container)).toEqual(["walks to the door", "and leaves"]);
    expect(settled.container.textContent).toContain("She smiles.");
  });

  it("never italicizes a fence inside the region — a span cannot pair across it", () => {
    const { container } = render(<Markdown text={"*before\n```\ncode *x\n```\nafter*"} settled />);
    expect(container.querySelector(".md-code pre code")?.textContent).toBe("code *x");
    expect(container.querySelector(".md-code em")).toBeNull();
  });

  it("leaves `3 * 4 * 5` alone (a `*` followed by a space is not an opener)", () => {
    const { container } = render(<Markdown text={"3 * 4 * 5\nnext line"} settled />);
    expect(container.querySelector("em")).toBeNull();
    expect(container.textContent).toContain("3 * 4 * 5");
  });

  it("keeps a continuation line's indentation and block marker OUTSIDE its wrapper", () => {
    const { container } = render(<Markdown text={"*she turns\n   and waits*"} />);
    expect(ems(container)).toEqual(["she turns", "and waits"]);
    const quoted = render(<Markdown text={"> *she turns\n> and waits*"} />);
    expect(
      [...quoted.container.querySelectorAll("blockquote em")].map((e) => e.textContent),
    ).toEqual(["she turns", "and waits"]);
  });

  it("does not let a `*` BULLET close a stray opener — the list stays a list", () => {
    const { container } = render(<Markdown text={"Use *args:\n* one\n* two"} />);
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelector("em")).toBeNull();
  });

  it("…and once settled the bullets still stay a list (the unclosed tail italicizes INSIDE the items)", () => {
    const { container } = render(<Markdown text={"Use *args:\n* one\n* two"} settled />);
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    // the bullet marker stays outside the wrapper, so each item is a list item holding its own <em>
    expect([...container.querySelectorAll("ul li em")].map((e) => e.textContent)).toEqual([
      "one",
      "two",
    ]);
    expect(container.textContent).not.toContain("*");
  });

  // fix wave 1 — the boundary guard (lib/actionSpan): a bold's inner stars never open or close a span.
  it("renders two same-line bolds on two lines as two bolds — no em, no stray star", () => {
    const { container } = render(<Markdown text={"**CPU**: 12%\n**RAM**: 40%"} settled />);
    expect([...container.querySelectorAll("strong")].map((b) => b.textContent)).toEqual([
      "CPU",
      "RAM",
    ]);
    expect(container.querySelector("em")).toBeNull();
    expect(container.textContent).not.toContain("*");
  });

  it("leaves a settled `**Note**: …` line free of stray stars", () => {
    const { container } = render(<Markdown text={"**Note**: the rest of the line"} settled />);
    expect(container.querySelector("strong")?.textContent).toBe("Note");
    expect(container.querySelector("em")).toBeNull();
    expect(container.textContent).not.toContain("*");
  });

  it("leaves a multi-line `**…**` and a `***…***` exactly as the per-line parse had them", () => {
    for (const text of ["**one\n two**", "***x***\nnext"]) {
      const before = render(<Markdown text={text} />).container.innerHTML;
      cleanup();
      // no span can form here, so settling (the tail rule) must not change a thing either
      const after = render(<Markdown text={text} settled />).container.innerHTML;
      cleanup();
      expect(after).toBe(before);
    }
    const { container } = render(<Markdown text={"**one\n two**"} settled />);
    expect(container.textContent).toContain("**one");
    expect(container.textContent).toContain("two**");
  });

  it("an intraword `*` (2*3) never opens a span", () => {
    const { container } = render(<Markdown text={"2*3 = 6\nand then *yes*"} settled />);
    expect([...container.querySelectorAll("em")].map((e) => e.textContent)).toEqual(["yes"]);
    expect(container.textContent).toContain("2*3 = 6");
  });

  // fix wave 1 — inline code is literal: its stars neither open nor close a span.
  it("keeps both code spans of `*.log` / `*.tmp` bullets", () => {
    const { container } = render(<Markdown text={"- `*.log`\n- `*.tmp`"} settled />);
    expect([...container.querySelectorAll("li code")].map((c) => c.textContent)).toEqual([
      "*.log",
      "*.tmp",
    ]);
    expect(container.querySelector("em")).toBeNull();
  });

  it("italicizes nothing on a settled `` `*args` `` line", () => {
    const { container } = render(<Markdown text={"pass `*args` through\nthen return"} settled />);
    expect(container.querySelector("code")?.textContent).toBe("*args");
    expect(container.querySelector("em")).toBeNull();
  });

  it("an unclosed trailing fence holding an apparent action renders no <em>", () => {
    const { container } = render(<Markdown text={"Here:\n```\n*she waits\nstill*"} settled />);
    expect(container.querySelector(".md-code pre code")?.textContent).toBe("*she waits\nstill*");
    expect(container.querySelector("em")).toBeNull();
  });

  it("renders single-line pairs exactly as before", () => {
    const { container } = render(
      <Markdown text={"*one* and *two*\n*three*\n\n**bold** *four*"} settled />,
    );
    expect(ems(container)).toEqual(["one", "two", "three", "four"]);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });
});
