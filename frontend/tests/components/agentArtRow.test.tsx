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

/** The REAL `agents` sections (the registry that actually ships), so the pickers render the aspects,
 *  the caps and the bundled maps the owner meets rather than a local fixture's. */
const SECTIONS = mediaSections("agents", MEDIA_NS.agents, ["avatars", "backgrounds"]);
const sectionOf = (role: string) => SECTIONS.find((s) => s.role === role);

const studio = (rows: Partial<Record<string, MediaFile[]>>, live = true): AgentArtStudio =>
  ({
    job: { crop: null },
    sections: live
      ? ["avatars", "backgrounds"].map((role) => ({
          section: sectionOf(role),
          rows: rows[role] ?? [],
          active: { ids: [], mode: "first" },
        }))
      : /* the media index has not landed yet */ [],
    append: vi.fn(),
    ready: true,
  }) as unknown as AgentArtStudio;

/** The FORM's composition, in miniature: BOTH faces in the grid, BOTH pickers beside it, and the
 *  bindings held as state so a pick is visible on the next render exactly as a draft edit is. Both
 *  fields, because the wave-2 review's F1 is a cross-field claim: one field's upload must not reach
 *  into the other field's open picker. */
function Form(props: {
  rows: Partial<Record<string, MediaFile[]>>;
  values?: Partial<Record<ArtField, string>>;
  onChange?: (field: ArtField, v: string) => void;
  live?: boolean;
}) {
  const [values, setValues] = useState<Record<ArtField, string>>({
    avatar: props.values?.avatar ?? "",
    background: props.values?.background ?? "",
  });
  const [open, setOpen] = useState<ArtField | null>(null);
  const s = studio(props.rows, props.live !== false);
  return (
    <>
      <div className="mform">
        {(["avatar", "background"] as ArtField[]).map((field) => (
          <AgentArtRow
            key={field}
            studio={s}
            field={field}
            value={values[field]}
            onOpen={() => setOpen(field)}
          />
        ))}
      </div>
      <AgentArtPickers
        studio={s}
        open={open}
        values={values}
        onChange={(field, entry) => {
          setValues((v) => ({ ...v, [field]: entry }));
          props.onChange?.(field, entry);
        }}
        onClose={() => setOpen(null)}
      />
    </>
  );
}

const openPicker = (label = "Avatar") =>
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}:`) }));
const tiles = () => [...document.querySelectorAll<HTMLElement>(".mgal-tile")];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.args.clear();
});

describe("AgentArtRow · the face", () => {
  it("paints the bound picture, names it, and offers the pencil", () => {
    render(<Form rows={{ avatars: [row("lyra.png")] }} values={{ avatar: "lyra.png" }} />);
    const face = screen.getByRole("button", { name: "Avatar: lyra.png" });
    expect(face.querySelector("img")?.getAttribute("src")).toContain("lyra.png");
    expect(face.textContent).toContain("lyra.png");
    expect(face.querySelector(".agart-shot.empty")).toBeNull();
    expect(face.querySelector(".agart-pencil")).not.toBeNull();
  });

  it("nothing bound → the gallery's own empty face, and no picture to edit", () => {
    render(<Form rows={{}} />);
    const face = screen.getByRole("button", { name: "Avatar: add an image" });
    expect(face.textContent).toContain("Add an image");
    expect(face.querySelector(".agart-shot.empty")).not.toBeNull();
    expect(face.querySelector(".agart-pencil")).toBeNull();
  });

  it("the library has not resolved yet → the face is disabled rather than a picker over nothing", () => {
    render(<Form rows={{}} live={false} />);
    expect(screen.getByRole("button", { name: /^Avatar:/ })).toHaveProperty("disabled", true);
    openPicker();
    expect(document.querySelector(".mgal-modal")).toBeNull();
  });

  it("the PICKER is a sibling of the form, never a child of it (the field recipe would dress it)", () => {
    render(<Form rows={{ avatars: [row("lyra.png")] }} values={{ avatar: "lyra.png" }} />);
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
        rows={{
          avatars: [
            row("lyra.png"),
            row("hidden.png", { hidden: true }),
            row("broken.png", { unusable: true }),
          ],
        }}
        values={{ avatar: "lyra.png" }}
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
    expect(onChange).toHaveBeenCalledWith("avatar", "lyra.png");
    expect(document.querySelector(".mgal-modal")).toBeNull(); // the pick closes it
  });

  it("carries NO manage affordances — the add row is the only thing beside the pictures", () => {
    render(<Form rows={{ avatars: [row("lyra.png"), row("mira.png")] }} />);
    openPicker();
    expect(document.querySelectorAll(".mgal-use")).toHaveLength(0); // no In-use corners
    expect(document.querySelector(".mgal-detail")).toBeNull(); // no detail panel to reach
    expect(screen.queryByRole("button", { name: "Restore defaults" })).toBeNull();
    expect(screen.getByRole("button", { name: /Add an image/ })).toBeTruthy();
  });

  it("an EMPTY library still opens — the way in is the add row it points at", () => {
    render(<Form rows={{}} />);
    openPicker();
    expect(document.querySelector(".mgal-empty")?.textContent).toContain("Add an image");
    expect(tiles()).toHaveLength(0);
  });

  it("unbinding is offered ONLY while something is bound, and it writes the empty binding", () => {
    const onChange = vi.fn();
    render(<Form rows={{ avatars: [row("lyra.png")] }} onChange={onChange} />);
    openPicker();
    expect(screen.queryByRole("button", { name: "Use no picture" })).toBeNull();
    // …bind one, and the way back appears with it.
    fireEvent.click(tiles()[0]);
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Use no picture" }));
    expect(onChange).toHaveBeenLastCalledWith("avatar", "");
    expect(document.querySelector(".mgal-modal")).toBeNull();
  });

  it("an upload's STORED filename becomes the binding (the one hop this row adds)", () => {
    const onChange = vi.fn();
    render(<Form rows={{}} onChange={onChange} />);
    openPicker();
    // The delivery tail answers with the name the library actually stored — never the picked file's —
    // and the picker's work is done, so it closes on the way out.
    act(() => {
      h.args.get("avatars")?.onStored?.("my-photo.webp");
    });
    expect(onChange).toHaveBeenCalledWith("avatar", "my-photo.webp");
    expect(document.querySelector(".mgal-modal")).toBeNull();
  });

  it("the tiles speak the PICKER's vocabulary, not the gallery's", () => {
    // The wave-2 review's F2: `active · in use · not in use` answers "what does this destination
    // paint", which is the manage screen's question — over a library the owner is picking FROM it
    // contradicts the binding the tap is about to make.
    render(
      <Form
        rows={{ avatars: [row("lyra.png"), row("mira.png")] }}
        values={{ avatar: "lyra.png" }}
      />,
    );
    openPicker();
    const said = tiles().map((t) => {
      const id = t.getAttribute("aria-describedby");
      return id === null ? null : document.getElementById(id)?.textContent;
    });
    expect(said).toEqual(["selected", "available"]);
  });
});

describe("AgentArtRow · a completing upload YIELDS (the wave-2 review's F1)", () => {
  it("never overrides a NEWER explicit pick on its own field", () => {
    const onChange = vi.fn();
    render(
      <Form rows={{ avatars: [row("lyra.png"), row("mira.png")] }} onChange={onChange} />, //
    );
    openPicker();
    // A job is running (its Add row said "keep this open until it finishes") — and the owner picks a
    // picture that is already there instead, which closes the picker.
    fireEvent.click(tiles()[1]);
    expect(onChange).toHaveBeenLastCalledWith("avatar", "mira.png");
    // …and the upload lands afterwards. It must not win: the choice made SECOND is the owner's.
    act(() => {
      h.args.get("avatars")?.onStored?.("late.webp");
    });
    expect(onChange).toHaveBeenLastCalledWith("avatar", "mira.png");
    expect(screen.getByRole("button", { name: "Avatar: mira.png" })).toBeTruthy();
  });

  it("never overrides a newer CLEAR either", () => {
    const onChange = vi.fn();
    render(
      <Form
        rows={{ avatars: [row("lyra.png")] }}
        values={{ avatar: "lyra.png" }}
        onChange={onChange}
      />,
    );
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Use no picture" }));
    act(() => {
      h.args.get("avatars")?.onStored?.("late.webp");
    });
    expect(onChange).toHaveBeenLastCalledWith("avatar", "");
    expect(screen.getByRole("button", { name: "Avatar: add an image" })).toBeTruthy();
  });

  it("closes only ITS OWN field's picker — an avatar job never shuts the backdrop's", () => {
    const onChange = vi.fn();
    render(
      <Form
        rows={{ avatars: [row("lyra.png")], backgrounds: [row("hall.png")] }}
        onChange={onChange}
      />,
    );
    // Start on the avatar, leave it for the backdrop — the avatar's job keeps running behind.
    openPicker("Avatar");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    openPicker("Backdrop");
    act(() => {
      h.args.get("avatars")?.onStored?.("late.webp");
    });
    // The backdrop's picker is still up, and nothing was bound behind it.
    expect(screen.getByRole("dialog").textContent).toContain("Choose backdrop");
    expect(onChange).not.toHaveBeenCalled();
  });
});
