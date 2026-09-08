import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// D70 §8.2 + §13-S6b wave 2 — the agent's avatar/backdrop BINDING row, after the owner's round turned it
// into IMAGE-AS-BUTTON → the media manager's library in PICK MODE.
//
// What is worth pinning is what this surface actually owns: the FACE (what is bound, and the empty state
// when nothing is), which library rows the picker may offer, what a pick writes, that an upload's stored
// filename becomes the binding, that unbinding is offered only when there is a binding — and that the
// picker is a PICKER: none of the gallery's manage affordances come with the shared grid.
//
// The harness mirrors the FORM's own composition, because that composition is load-bearing: the face
// sits in the `.mform` grid and the picker is a SIBLING of it (a dialog inside that grid has its hidden
// file input unset back into a visible "Choose File" widget by the form's own field recipe — the build
// round's find), so a test that mounted the row alone would be testing a shape the app does not have.
//
// The upload MACHINE itself (guard · crop · PUT · register) is the media manager's and is covered on the
// wire by `mediaUpload.test.tsx` — mocked here so this file tests the hop it adds rather than re-testing
// that.

type UploadArgs = { section?: { role: string }; onStored?: (f: string) => void };

const h = vi.hoisted(() => ({
  /** The `useMediaUpload` args PER ROLE — the form mounts one delivery tail per art field, and the one
   *  this suite drives is the avatars one. */
  args: new Map<string, UploadArgs>(),
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
  useMediaUpload: (args: UploadArgs) => {
    h.args.set(args.section?.role ?? "none", args);
    return h.upload;
  },
}));
vi.mock("../../src/hooks/useImageJob", () => ({ useImageJob: () => ({ crop: null }) }));

import {
  AgentArtPickers,
  AgentArtRow,
  type AgentArtStudio,
  type ArtField,
} from "../../src/components/AgentArtRow";
import type { MediaFile } from "../../src/hooks/useMedia";
import { MEDIA_NS, mediaSections } from "../../src/theme-engine/mediaRegistry";

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

/** The REAL `agents:avatars` section (the registry that actually ships), so the picker renders the
 *  aspect, the caps and the bundled map the owner meets rather than a local fixture's. */
const SECTION = mediaSections("agents", MEDIA_NS.agents, ["avatars", "backgrounds"]).find(
  (s) => s.role === "avatars",
);

const studio = (rows: MediaFile[], sections = true): AgentArtStudio =>
  ({
    job: { crop: null },
    sections: sections
      ? [{ section: SECTION, rows, active: { ids: [], mode: "first" } }]
      : /* the media index has not landed yet */ [],
    append: vi.fn(),
    ready: true,
  }) as unknown as AgentArtStudio;

/** The FORM's composition, in miniature: the face in the grid, the pickers beside it, and the binding
 *  held as state so a pick is visible on the next render exactly as a draft edit is. */
function Form(props: {
  rows: MediaFile[];
  value?: string;
  onChange?: (v: string) => void;
  live?: boolean;
}) {
  const [value, setValue] = useState(props.value ?? "");
  const [open, setOpen] = useState<ArtField | null>(null);
  const s = studio(props.rows, props.live !== false);
  const commit = (v: string) => {
    setValue(v);
    props.onChange?.(v);
  };
  return (
    <>
      <div className="mform">
        <AgentArtRow studio={s} field="avatar" value={value} onOpen={() => setOpen("avatar")} />
      </div>
      <AgentArtPickers
        studio={s}
        open={open}
        values={{ avatar: value, background: "" }}
        onChange={(_field, entry) => commit(entry)}
        onClose={() => setOpen(null)}
      />
    </>
  );
}

const openPicker = () => fireEvent.click(screen.getByRole("button", { name: /^Avatar:/ }));
const tiles = () => [...document.querySelectorAll<HTMLElement>(".mgal-tile")];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.args.clear();
});

describe("AgentArtRow · the face", () => {
  it("paints the bound picture, names it, and offers the pencil", () => {
    render(<Form rows={[row("lyra.png")]} value="lyra.png" />);
    const face = screen.getByRole("button", { name: "Avatar: lyra.png" });
    expect(face.querySelector("img")?.getAttribute("src")).toContain("lyra.png");
    expect(face.textContent).toContain("lyra.png");
    expect(face.querySelector(".agart-shot.empty")).toBeNull();
    expect(face.querySelector(".agart-pencil")).not.toBeNull();
  });

  it("nothing bound → the gallery's own empty face, and no picture to edit", () => {
    render(<Form rows={[]} />);
    const face = screen.getByRole("button", { name: "Avatar: add an image" });
    expect(face.textContent).toContain("Add an image");
    expect(face.querySelector(".agart-shot.empty")).not.toBeNull();
    expect(face.querySelector(".agart-pencil")).toBeNull();
  });

  it("the library has not resolved yet → the face is disabled rather than a picker over nothing", () => {
    render(<Form rows={[]} live={false} />);
    expect(screen.getByRole("button", { name: /^Avatar:/ })).toHaveProperty("disabled", true);
    openPicker();
    expect(document.querySelector(".mgal-modal")).toBeNull();
  });

  it("the PICKER is a sibling of the form, never a child of it (the field recipe would dress it)", () => {
    render(<Form rows={[row("lyra.png")]} value="lyra.png" />);
    openPicker();
    expect(document.querySelector(".mform .pm-backdrop")).toBeNull();
    expect(document.querySelector(".pm-backdrop")).not.toBeNull();
  });
});

describe("AgentArtRow · the library in pick mode", () => {
  it("offers the role's USABLE rows, rings the bound one, and a tap is the pick", () => {
    const onChange = vi.fn();
    render(
      <Form
        rows={[
          row("lyra.png"),
          row("hidden.png", { hidden: true }),
          row("broken.png", { unusable: true }),
        ]}
        value="lyra.png"
        onChange={onChange}
      />,
    );
    openPicker();
    expect(screen.getByRole("dialog").textContent).toContain("Choose avatar");
    // A switched-off entry and one whose bytes cannot paint are exactly what a binding must not point
    // at — the two shipped predicates, the same ones `useAgentArt` resolves bindings through.
    expect(tiles().map((t) => t.getAttribute("aria-label"))).toEqual(["lyra.png"]);
    // The BOUND entry wears the grid's own active ring + `aria-current` — no picker-specific mark.
    expect(tiles()[0].className).toContain("on");
    expect(tiles()[0].getAttribute("aria-current")).toBe("true");

    fireEvent.click(tiles()[0]);
    expect(onChange).toHaveBeenCalledWith("lyra.png");
    expect(document.querySelector(".mgal-modal")).toBeNull(); // the pick closes it
  });

  it("carries NO manage affordances — the add row is the only thing beside the pictures", () => {
    render(<Form rows={[row("lyra.png"), row("mira.png")]} />);
    openPicker();
    expect(document.querySelectorAll(".mgal-use")).toHaveLength(0); // no In-use corners
    expect(document.querySelector(".mgal-detail")).toBeNull(); // no detail panel to reach
    expect(screen.queryByRole("button", { name: "Restore defaults" })).toBeNull();
    expect(screen.getByRole("button", { name: /Add an image/ })).toBeTruthy();
  });

  it("an EMPTY library still opens — the way in is the add row it points at", () => {
    render(<Form rows={[]} />);
    openPicker();
    expect(document.querySelector(".mgal-empty")?.textContent).toContain("Add an image");
    expect(tiles()).toHaveLength(0);
  });

  it("unbinding is offered ONLY while something is bound, and it writes the empty binding", () => {
    const onChange = vi.fn();
    render(<Form rows={[row("lyra.png")]} onChange={onChange} />);
    openPicker();
    expect(screen.queryByRole("button", { name: "Use no picture" })).toBeNull();
    // …bind one, and the way back appears with it.
    fireEvent.click(tiles()[0]);
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Use no picture" }));
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(document.querySelector(".mgal-modal")).toBeNull();
  });

  it("an upload's STORED filename becomes the binding (the one hop this row adds)", () => {
    const onChange = vi.fn();
    render(<Form rows={[]} onChange={onChange} />);
    openPicker();
    // The delivery tail answers with the name the library actually stored — never the picked file's —
    // and the picker's work is done, so it closes on the way out.
    act(() => {
      h.args.get("avatars")?.onStored?.("my-photo.webp");
    });
    expect(onChange).toHaveBeenCalledWith("my-photo.webp");
    expect(document.querySelector(".mgal-modal")).toBeNull();
  });
});
