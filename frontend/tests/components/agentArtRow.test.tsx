import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// D70 §8.2 — the agent's avatar/backdrop BINDING row. What is worth pinning here is the small amount
// this surface actually owns: which library rows it offers, what a pick writes, and that an upload's
// stored filename becomes the binding. The upload MACHINE itself (guard · crop · PUT · register) is
// the media manager's and is covered on the wire by `mediaUpload.test.tsx` — mocked here so this file
// tests the hop it adds rather than re-testing that.

const h = vi.hoisted(() => ({
  args: null as { onStored?: (f: string) => void } | null,
  upload: {
    failure: null,
    busy: false,
    phase: null,
    ready: true,
    pick: vi.fn(),
    inputRef: { current: null },
    onInputChange: vi.fn(),
    offer: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("../../src/hooks/useMediaUpload", () => ({
  useMediaUpload: (args: { onStored?: (f: string) => void }) => {
    h.args = args;
    return h.upload;
  },
}));
vi.mock("../../src/hooks/useImageJob", () => ({ useImageJob: () => ({ crop: null }) }));

import { AgentArtRow, type AgentArtStudio } from "../../src/components/AgentArtRow";
import type { MediaFile } from "../../src/hooks/useMedia";

const row = (file: string, over: Partial<MediaFile> = {}): MediaFile => ({
  name: file.replace(/\.\w+$/, ""),
  file,
  url: `/media/agents/avatars/${file}`,
  format: "png",
  size_bytes: 100,
  revision: "r1",
  width: 100,
  height: 100,
  unusable: false,
  unusable_reason: null,
  ...over,
});

const studio = (rows: MediaFile[]): AgentArtStudio =>
  ({
    job: { crop: null },
    sections: [{ section: { id: "agents:avatars", role: "avatars" }, rows }],
    append: vi.fn(),
    ready: true,
  }) as unknown as AgentArtStudio;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.args = null;
});

describe("AgentArtRow", () => {
  it("shows the bound entry, and offers the role's usable library to pick from", () => {
    const onChange = vi.fn();
    render(
      <AgentArtRow
        studio={studio([
          row("lyra.png"),
          row("hidden.png", { hidden: true }),
          row("broken.png", { unusable: true }),
        ])}
        role="avatars"
        value="lyra.png"
        onChange={onChange}
      />,
    );
    expect(screen.getByText("lyra.png")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "choose" }));
    // A switched-off entry and one whose bytes cannot paint are exactly what a binding must not point
    // at — the two shipped predicates, the same ones `useAgentArt` resolves bindings through.
    const tiles = [...document.querySelectorAll(".agart-tile")];
    expect(tiles.map((t) => t.getAttribute("aria-label"))).toEqual(["lyra"]);
    expect(tiles[0].getAttribute("aria-pressed")).toBe("true"); // the bound one is marked

    fireEvent.click(screen.getByRole("button", { name: "lyra" }));
    expect(onChange).toHaveBeenCalledWith("lyra.png");
  });

  it("clearing writes the empty binding, and an empty library offers nothing to choose", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <AgentArtRow
        studio={studio([row("lyra.png")])}
        role="avatars"
        value="lyra.png"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(onChange).toHaveBeenCalledWith("");

    rerender(<AgentArtRow studio={studio([])} role="avatars" value="" onChange={onChange} />);
    expect(screen.getByText("none")).toBeTruthy();
    expect(screen.getByRole("button", { name: "library empty" })).toHaveProperty("disabled", true);
  });

  it("an upload's STORED filename becomes the binding (the one hop this row adds)", () => {
    const onChange = vi.fn();
    render(<AgentArtRow studio={studio([])} role="avatars" value="" onChange={onChange} />);
    // The delivery tail answers with the name the library actually stored — never the picked file's.
    h.args?.onStored?.("my-photo.webp");
    expect(onChange).toHaveBeenCalledWith("my-photo.webp");
  });
});
