import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  /** The house confirm, mocked at the module — `confirmDialog.test.tsx` owns the dialog itself, and
   *  what this suite has to see is the QUESTION the picker asks (the sentence is the design) and what
   *  it does with each answer. Deterministic, and no second overlay in the harness. */
  confirm: vi.fn(
    async (_req: {
      title: string;
      body?: string;
      confirmLabel?: string;
      danger?: boolean;
    }): Promise<boolean> => true,
  ),
}));

vi.mock("../../src/hooks/useMediaUpload", () => ({
  useMediaUpload: (args: UploadArgs) => {
    h.args.set(args.section?.role ?? "none", args);
    return h.upload;
  },
}));
vi.mock("../../src/hooks/useImageJob", () => ({ useImageJob: () => ({ crop: null }) }));
vi.mock("../../src/store/confirm", () => ({ requestConfirm: h.confirm }));
// The framing sheet (wave 3's second door) measures its stage with a `ResizeObserver`, and so does
// react-easy-crop inside it; jsdom ships none. A no-op is enough — the sheet's own arms live in
// `framingSheet.test.tsx`, and what this suite is about is the DOOR.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

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

/** The framing write, spied — the studio hands the picker's Focus door the SAME queued chokepoint the
 *  Conf gallery uses, so what this suite pins is that it is reached with the right subject. */
const setFocalSpy = vi.fn();
/** The DELETE write, spied — same story: the picker's tile corner reaches the media manager's own
 *  `write.remove`, so what is pinned is that it is reached with the right subject.
 *
 *  It ANSWERS, because the shipped one does (the feel-round review's MED 2): `true` = the BYTES went.
 *  The default is the happy path; the arm that needs a refused DELETE overrides it once. */
const removeSpy = vi.fn(
  async (_section: { role: string }, _item: { id: string }): Promise<boolean> => true,
);

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
    setFocal: setFocalSpy,
    remove: removeSpy,
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

  it("carries NO manage affordances but the delete corner — the add row is the rest of it", () => {
    render(<Form rows={{ avatars: [row("lyra.png"), row("mira.png")] }} />);
    openPicker();
    expect(document.querySelectorAll(".mgal-use")).toHaveLength(0); // no In-use corners
    expect(document.querySelector(".mgal-detail")).toBeNull(); // no detail panel to reach
    expect(screen.queryByRole("button", { name: "Restore defaults" })).toBeNull();
    expect(screen.getByRole("button", { name: /Add an image/ })).toBeTruthy();
    // The ONE that crossed over at the wave-3 feel round, and it is a corner rather than a screen —
    // its own arms are below.
    expect(document.querySelectorAll(".mgal-del")).toHaveLength(2);
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

// ── WAVE 3 — THE SECOND DOOR ON THE FRAMING SHEET ───────────────────────────────────────────────
//
// §8.2 kept framing in the Conf gallery; the owner's wave-2 round amended that. What did NOT change is
// that there is ONE framing UI: the door is a button in the picker, and what it opens is the media
// manager's own sheet on the media manager's own write.

describe("AgentArtRow · the picker's Focus door", () => {
  it("offers Focus only where there is a bound picture to frame", () => {
    render(<Form rows={{ avatars: [row("lyra.png")] }} values={{ avatar: "lyra.png" }} />);
    openPicker();
    expect(screen.getByRole("button", { name: "Focus" })).toBeTruthy();
    cleanup();
    // Nothing bound: neither the unbind nor the framing door, because both act on a binding.
    render(<Form rows={{ avatars: [row("lyra.png")] }} />);
    openPicker();
    expect(screen.queryByRole("button", { name: "Focus" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Use no picture" })).toBeNull();
  });

  it("opens the sheet as a SIBLING of the picker — outside it, and outside the form", async () => {
    render(<Form rows={{ avatars: [row("lyra.png")] }} values={{ avatar: "lyra.png" }} />);
    openPicker();
    const picker = document.querySelector(".mgal-modal") as HTMLElement;
    fireEvent.click(screen.getByRole("button", { name: "Focus" }));
    const sheet = await screen.findByRole("dialog", { name: "Set focus" });
    // A nested overlay's Escape would ride the picker's own keydown trap and close it underneath.
    expect(picker.contains(sheet)).toBe(false);
    expect(sheet.contains(picker)).toBe(false);
    // …and the form's `all: unset` field recipe must not reach either of them.
    expect(document.querySelector(".mform .mgal-frame")).toBeNull();
    // The picker stays UP behind the sheet, so finishing in the sheet lands the owner back where they
    // were rather than on the form. (Dismissing the sheet is the shared back-guard's job and has its
    // own suite — `hooks/useOverlayBackGuard.test.tsx`.)
    expect(document.querySelector(".mgal-modal")).not.toBeNull();
  });

  it("saves through the library's own framing write, with the bound entry as its subject", async () => {
    render(<Form rows={{ avatars: [row("lyra.png")] }} values={{ avatar: "lyra.png" }} />);
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Focus" }));
    const sheet = await screen.findByRole("dialog", { name: "Set focus" });
    fireEvent.change(within(sheet).getByRole("slider", { name: "Zoom" }), {
      target: { value: "2" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(setFocalSpy).toHaveBeenCalledTimes(1);
    const [section, item, focal, expectedRev] = setFocalSpy.mock.calls[0] as [
      { role: string },
      { id: string },
      unknown,
      string,
    ];
    expect(section.role).toBe("avatars");
    expect(item.id).toBe("f:lyra.png"); // the library's own identity, through `libraryItems`
    expect(focal).toEqual({ x: 0.5, y: 0.5, z: 2 });
    expect(expectedRev).toBe("r1"); // the revision the sheet RENDERED, never a send-time read
    // Saving closes the sheet and nothing else: the picker the owner opened it from is still there.
    expect(screen.queryByRole("dialog", { name: "Set focus" })).toBeNull();
    expect(document.querySelector(".mgal-modal")).not.toBeNull();
  });

  it("outlives a picker closed under it — a framing gesture is not yanked off the screen", () => {
    // The wave-2 F1 path: an upload begun in this picker completes LATE, binds its file and fires the
    // shared close. The sheet is not conditioned on the picker being up, so the owner finishes framing
    // and lands on the form. It is also what makes the state unable to go stale — only Focus raises
    // the sheet and only the sheet's own Save or Cancel lowers it, so there is nothing to reset.
    render(
      <Form
        rows={{ avatars: [row("lyra.png"), row("nova.png")] }}
        values={{ avatar: "lyra.png" }}
      />,
    );
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Focus" }));
    expect(screen.getByRole("dialog", { name: "Set focus" })).toBeTruthy();
    act(() => h.args.get("avatars")?.onStored?.("nova.png"));
    expect(document.querySelector(".mgal-modal"), "the picker closed under it").toBeNull();
    expect(screen.getByRole("dialog", { name: "Set focus" })).toBeTruthy();
    // …and it still frames the entry it was OPENED on, never whatever the binding became.
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Set focus" })).getByRole("button", {
        name: "Save",
      }),
    );
    expect(setFocalSpy.mock.calls[0][1]).toMatchObject({ id: "f:lyra.png" });
    expect(screen.queryByRole("dialog", { name: "Set focus" })).toBeNull();
  });
});

// ── THE WAVE-3 FEEL ROUND — THE PICKER'S DELETE CORNER ──────────────────────────────────────────
//
// The pain the owner named: an upload lands in this library, from this screen, and there was no way to
// take it out again — "Use no picture" only unbinds, and the tile stays forever. The answer is a corner
// on the tile, the media manager's own confirm, and the media manager's own `write.remove`.

describe("AgentArtRow · the picker's delete corner", () => {
  const corners = () => screen.queryAllByRole("button", { name: /^Delete / });
  /** Tap one corner and let the confirm settle — `requestConfirm` is a promise even when it answers
   *  immediately, so the write happens a microtask after the click. */
  const tapDelete = async (file: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `Delete ${file}` }));
    });
  };

  it("every deletable tile wears one, named by its own file", () => {
    render(<Form rows={{ avatars: [row("lyra.png"), row("mira.png")] }} />);
    openPicker();
    // NOT gated on being bound: the pain is a library that can only be added to, which is every tile
    // in it and not just the one this agent happens to use.
    expect(corners().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Delete lyra.png",
      "Delete mira.png",
    ]);
    // A SIBLING of the tile, never a child — a button inside a button is invalid HTML, and a press
    // that starts on the corner must reach no tile handler at all.
    expect(document.querySelector(".mgal-tile .mgal-del")).toBeNull();
  });

  it("a BUNDLED entry has none — absent, not disabled (the rule the detail panel's Delete follows)", () => {
    render(<Form rows={{ avatars: [row("lyra.png"), row("shipped.png", { bundled: "lyra" })] }} />);
    openPicker();
    expect(tiles()).toHaveLength(2);
    expect(corners().map((b) => b.getAttribute("aria-label"))).toEqual(["Delete lyra.png"]);
  });

  it("deleting the BOUND picture empties the slot in the same gesture — and says so first", async () => {
    const onChange = vi.fn();
    render(
      <Form
        rows={{ avatars: [row("lyra.png"), row("mira.png")] }}
        values={{ avatar: "lyra.png" }}
        onChange={onChange}
      />,
    );
    openPicker();
    await tapDelete("lyra.png");
    // THE QUESTION: the house confirm, with the one clause that is this screen's rather than the
    // file's said in the owner's own words — a binding is a single slot, so it goes empty rather than
    // promoting a successor the way the gallery's does.
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.confirm.mock.calls[0][0]).toMatchObject({
      title: "Delete lyra.png?",
      body: "The file is removed from the server and this slot goes back to no picture. This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    // THE WRITE: the media manager's own chokepoint, with the section and the library's own identity.
    expect(removeSpy).toHaveBeenCalledTimes(1);
    const [section, item] = removeSpy.mock.calls[0] as [{ role: string }, { id: string }];
    expect(section.role).toBe("avatars");
    expect(item.id).toBe("f:lyra.png");
    // …and the slot, in the SAME gesture: the row would otherwise point at a file that is gone.
    expect(onChange).toHaveBeenCalledWith("avatar", "");
    // The picker STAYS OPEN — the owner may be clearing out several.
    expect(document.querySelector(".mgal-modal")).not.toBeNull();
  });

  it("deleting an UNBOUND tile takes the file and leaves the binding alone", async () => {
    const onChange = vi.fn();
    render(
      <Form
        rows={{ avatars: [row("lyra.png"), row("mira.png")] }}
        values={{ avatar: "lyra.png" }}
        onChange={onChange}
      />,
    );
    openPicker();
    await tapDelete("mira.png");
    // The other sentence — the shared confirm's non-active branch, unchanged from the gallery's.
    expect(h.confirm.mock.calls[0][0]).toMatchObject({
      title: "Delete mira.png?",
      body: "The file is removed from the server. This cannot be undone.",
    });
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Avatar: lyra.png" })).toBeTruthy();
  });

  it("a cancelled confirm writes nothing at all — not the file, not the slot", async () => {
    const onChange = vi.fn();
    h.confirm.mockResolvedValueOnce(false);
    render(
      <Form
        rows={{ avatars: [row("lyra.png")] }}
        values={{ avatar: "lyra.png" }}
        onChange={onChange}
      />,
    );
    openPicker();
    await tapDelete("lyra.png");
    expect(removeSpy).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Avatar: lyra.png" })).toBeTruthy();
  });

  // ── the review round's two MEDs: what the slot-clear is allowed to trust ──────────────────────

  it("a REFUSED delete leaves the slot alone — the picture is still on the server (MED 2)", async () => {
    // `write.remove` answers for its DELETE. Clearing on a refusal would blank the face beside a toast
    // saying the file could not be deleted — the owner would be looking at two contradictory reports of
    // the same failure, and the binding they still have would be the one that was thrown away.
    const onChange = vi.fn();
    removeSpy.mockResolvedValueOnce(false);
    render(
      <Form
        rows={{ avatars: [row("lyra.png")] }}
        values={{ avatar: "lyra.png" }}
        onChange={onChange}
      />,
    );
    openPicker();
    await tapDelete("lyra.png");
    expect(removeSpy).toHaveBeenCalledTimes(1); // it was attempted…
    expect(onChange).not.toHaveBeenCalled(); // …and refused, so nothing of ours moved
    expect(screen.getByRole("button", { name: "Avatar: lyra.png" })).toBeTruthy();
  });

  it("a rebind DURING the confirm survives the delete that was already open (MED 1)", async () => {
    // The stale-closure window, and it is a real one: the owner opens the confirm on the bound tile
    // while an upload is still running, the upload lands (`onStored` rebinds this field and closes the
    // picker), and only then is Delete tapped. A callback holding the CLICK-TIME binding would blank
    // the picture that was just bound — the S5 `updateDraft` lesson, one surface over. The check reads
    // a ref that renders keep current, so it sees the binding as it is at RESOLUTION time.
    const onChange = vi.fn();
    let release!: (ok: boolean) => void;
    h.confirm.mockImplementationOnce(() => new Promise<boolean>((r) => (release = r)));
    render(
      <Form
        rows={{ avatars: [row("lyra.png"), row("late.webp")] }}
        values={{ avatar: "lyra.png" }}
        onChange={onChange}
      />,
    );
    openPicker();
    // The confirm is UP and unanswered — no `await` here, deliberately.
    fireEvent.click(screen.getByRole("button", { name: "Delete lyra.png" }));
    expect(removeSpy).not.toHaveBeenCalled();
    // …the upload lands behind it: this field rebinds and the picker closes (the wave-2 F1 path).
    act(() => h.args.get("avatars")?.onStored?.("late.webp"));
    expect(onChange).toHaveBeenLastCalledWith("avatar", "late.webp");
    // …and NOW the owner confirms. The file goes; the binding that arrived meanwhile stays.
    await act(async () => {
      release(true);
    });
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy.mock.calls[0][1]).toMatchObject({ id: "f:lyra.png" }); // the clicked tile, still
    expect(onChange).not.toHaveBeenCalledWith("avatar", "");
    expect(screen.getByRole("button", { name: "Avatar: late.webp" })).toBeTruthy();
  });
});
