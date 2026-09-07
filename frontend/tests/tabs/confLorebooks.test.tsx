import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// D70 §6.6 — the LOREBOOK MANAGER, driven over mocked hook boundaries (the agentsGallery posture).
//
// The load-bearing case is `the STASH survives`: both wire models are `extra="allow"` and the PUT is a
// FULL REPLACE with no ETag, so an imported book carries fields v1 has no editor for and a key the
// editor drops is a key deleted off disk. The editor's rule — every edit is a spread over the object
// the server handed back, never a rebuild from form state — is invisible in the source and would be
// re-broken by any future refactor that "tidies" the patch into a constructor, so it is pinned here.
//
// The other half is §6.6's own requirement: a book is a WALL of text, so the default view is one
// collapsed row per entry and only the open one mounts a form.

const h = vi.hoisted(
  (): {
    books: { slug: string; name: string; enabled: boolean; entries: number }[];
    book: { slug: string; book: Record<string, unknown> } | null;
    save: ReturnType<typeof vi.fn>;
    importMutate: ReturnType<typeof vi.fn>;
    toast: ReturnType<typeof vi.fn>;
  } => ({
    books: [],
    book: null,
    save: vi.fn(),
    importMutate: vi.fn(),
    toast: vi.fn(),
  }),
);

vi.mock("../../src/hooks/useRoleplay", async (importActual) => {
  const actual = await importActual<typeof import("../../src/hooks/useRoleplay")>();
  return {
    ...actual,
    useLorebooks: () => ({ data: h.books }),
    useLorebook: (slug: string | null) => ({ data: slug ? h.book : undefined, isLoading: false }),
    // what the row SWITCH reaches for on a book whose editor was never opened
    fetchLorebook: () => Promise.resolve(h.book),
    useSaveLorebook: () => ({ mutate: h.save, isPending: false }),
    useDeleteLorebook: () => ({ mutate: vi.fn(), isPending: false }),
    useImportLorebook: () => ({ mutate: h.importMutate, isPending: false }),
  };
});
vi.mock("../../src/store/toast", () => ({ pushToast: h.toast }));

import { LorebooksEditor } from "../../src/components/LorebooksEditor";
import { newLorebookEntry, type LorebookEntry } from "../../src/hooks/useRoleplay";

/** One entry as the file API hands it back — the v1 fields plus the stash an ST import leaves behind. */
const entry = (over: Record<string, unknown> = {}): LorebookEntry => ({
  ...newLorebookEntry(),
  ...over,
});

/** The row's chevron button (the D25 breakout toggle), by its own accessible name. */
const chev = (name: RegExp) => screen.getByRole("button", { name });
/** What the last Save PUT — the whole book, as the editor holds it. */
const saved = () =>
  (h.save.mock.calls[0][0] as { slug: string; book: Record<string, unknown> }).book;

/** The open row calls `useQueryClient` for the row switch's own fetch — a real (unused) client is enough. */
const render = (ui: ReactElement) =>
  rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

beforeEach(() => {
  h.books = [];
  h.book = null;
  h.save.mockReset();
  h.importMutate.mockReset();
  h.toast.mockReset();
});
afterEach(cleanup);

describe("LorebooksEditor · the shelf", () => {
  it("lists books COLLAPSED — a name, an entry count, an enable switch, and no editor", () => {
    h.books = [
      { slug: "hollow-sea", name: "Hollow Sea", enabled: true, entries: 209 },
      { slug: "traits", name: "", enabled: false, entries: 1 },
    ];
    render(<LorebooksEditor />);
    expect(screen.getByText("Hollow Sea")).toBeTruthy();
    expect(screen.getByText("209 entries")).toBeTruthy();
    expect(screen.getByText("1 entry")).toBeTruthy();
    // an unnamed book falls back to its slug — a book always has a name to show
    expect(screen.getByRole("switch", { name: "traits enabled" })).toBeTruthy();
    expect(screen.queryByLabelText("Lorebook name")).toBeNull();
  });

  it("expanding a row mounts exactly ONE book editor", () => {
    h.books = [
      { slug: "hollow-sea", name: "Hollow Sea", enabled: true, entries: 0 },
      { slug: "traits", name: "Traits", enabled: true, entries: 0 },
    ];
    h.book = {
      slug: "hollow-sea",
      book: { name: "Hollow Sea", description: "fog", enabled: true, entries: [] },
    };
    render(<LorebooksEditor />);
    fireEvent.click(chev(/expand Hollow Sea/));
    expect(screen.getAllByLabelText("Lorebook name")).toHaveLength(1);
    expect(screen.getByLabelText<HTMLInputElement>("Lorebook name").value).toBe("Hollow Sea");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Lorebook description").value).toBe("fog");
  });
});

describe("LorebooksEditor · the book's master switch", () => {
  it("flips `enabled` on a CLOSED book by fetching it whole — the rest of the file rides through", async () => {
    h.books = [{ slug: "traits", name: "Traits", enabled: true, entries: 1 }];
    h.book = {
      slug: "traits",
      book: {
        name: "Traits",
        description: "keep me",
        enabled: true,
        entries: [entry({ keys: ["brave"], comment: "keep me too" })],
      },
    };
    render(<LorebooksEditor />);
    fireEvent.click(screen.getByRole("switch", { name: "Traits enabled" }));

    // the switch is a MODE, not a draft: it saves immediately, and it PUTs the whole book
    await waitFor(() => expect(h.save).toHaveBeenCalled());
    expect(saved()).toEqual({ ...h.book.book, enabled: false });
  });
});

describe("LorebooksEditor · the entry list (§6.6)", () => {
  const openBook = () => {
    h.books = [{ slug: "hollow-sea", name: "Hollow Sea", enabled: true, entries: 2 }];
    h.book = {
      slug: "hollow-sea",
      book: {
        name: "Hollow Sea",
        description: "",
        enabled: true,
        entries: [
          entry({ keys: ["ghostship", "the captain"], content: "The Veile sails.\nOnly in fog." }),
          entry({ constant: true, content: "It is always winter." }),
        ],
      },
    };
    render(<LorebooksEditor />);
    fireEvent.click(chev(/expand Hollow Sea/));
  };

  it("entries render COLLAPSED — a key summary, ONE preview line, no form", () => {
    openBook();
    expect(screen.getByText("ghostship, the captain")).toBeTruthy();
    expect(screen.getByText("The Veile sails.")).toBeTruthy(); // the FIRST line only
    expect(screen.queryByText(/Only in fog/)).toBeNull();
    expect(screen.getByText("constant")).toBeTruthy(); // the always-on badge
    // the list's own head (the row above it carries the same count from the thin list route)
    expect(document.querySelector(".lb-entries-head")?.textContent).toContain("2 entries");
    expect(screen.queryByLabelText("Entry 1 content")).toBeNull();
  });

  it("expanding ONE entry mounts ONE form", () => {
    openBook();
    fireEvent.click(chev(/expand entry 1/));
    expect(screen.getByLabelText<HTMLTextAreaElement>("Entry 1 content").value).toBe(
      "The Veile sails.\nOnly in fog.",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Entry 1 keys").value).toBe(
      "ghostship, the captain",
    );
    expect(screen.queryByLabelText("Entry 2 content")).toBeNull();
  });

  it("+ add entry appends the BACKEND's own defaults, nothing invented", () => {
    h.books = [{ slug: "hollow-sea", name: "Hollow Sea", enabled: true, entries: 0 }];
    h.book = {
      slug: "hollow-sea",
      book: { name: "Hollow Sea", description: "", enabled: true, entries: [] },
    };
    render(<LorebooksEditor />);
    fireEvent.click(chev(/expand Hollow Sea/));
    fireEvent.click(screen.getByRole("button", { name: "+ add entry" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(saved().entries).toEqual([newLorebookEntry()]);
  });

  it("an EMPTY priority saves as null — the wire's 'rank by order' sentinel, never 0", () => {
    h.books = [{ slug: "hollow-sea", name: "Hollow Sea", enabled: true, entries: 1 }];
    h.book = {
      slug: "hollow-sea",
      book: {
        name: "Hollow Sea",
        description: "",
        enabled: true,
        entries: [entry({ priority: 5 })],
      },
    };
    render(<LorebooksEditor />);
    fireEvent.click(chev(/expand Hollow Sea/));
    fireEvent.click(chev(/expand entry 1/));
    fireEvent.change(screen.getByLabelText("Entry 1 priority"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect((saved().entries as LorebookEntry[])[0].priority).toBeNull();
  });
});

describe("LorebooksEditor · the import STASH survives an edit (the load-bearing rule)", () => {
  it("unknown fields ride through an edited + toggled entry byte-for-byte", () => {
    h.books = [{ slug: "traits", name: "Traits", enabled: true, entries: 1 }];
    h.book = {
      slug: "traits",
      book: {
        name: "Traits",
        description: "",
        enabled: true,
        // Three real ST/Risu keys v1 has no editor for, plus a book-level one.
        entries: [
          entry({
            keys: ["brave"],
            content: "old",
            comment: "x",
            uid: 7,
            selectiveLogic: 0,
          }),
        ],
        scan_depth: 4,
      },
    };
    render(<LorebooksEditor />);
    fireEvent.click(chev(/expand Traits/));
    fireEvent.click(chev(/expand entry 1/));
    fireEvent.change(screen.getByLabelText("Entry 1 content"), { target: { value: "new" } });
    fireEvent.click(screen.getByRole("switch", { name: "Entry 1 enabled" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    const book = saved();
    expect((book.entries as LorebookEntry[])[0]).toEqual({
      ...entry({ keys: ["brave"], comment: "x", uid: 7, selectiveLogic: 0 }),
      content: "new", // the edit
      enabled: false, // the toggle
    });
    expect(book.scan_depth).toBe(4); // …and the BOOK-level stash too
  });
});

describe("LorebooksEditor · the add row", () => {
  const add = (name: string) => {
    render(<LorebooksEditor />);
    fireEvent.click(screen.getByRole("button", { name: /add lorebook/ }));
    fireEvent.change(screen.getByLabelText("lorebook name"), { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: "create" }));
  };

  it("mints the slug off the NAME, the backend's own rule", () => {
    add("  Hollow Sea!! (v2)  ");
    expect(h.save.mock.calls[0][0]).toMatchObject({
      slug: "hollow-sea-v2",
      book: { name: "Hollow Sea!! (v2)", description: "", enabled: true, entries: [] },
    });
  });

  it("REFUSES a name that slugifies to nothing", () => {
    add("???");
    expect(h.save).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith("name: needs a letter or a digit", "err");
  });

  it("REFUSES a slug already on the shelf — the PUT would silently overwrite that book", () => {
    h.books = [{ slug: "hollow-sea", name: "Hollow Sea", enabled: true, entries: 3 }];
    add("Hollow Sea");
    expect(h.save).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith("a lorebook 'hollow-sea' exists", "err");
  });
});

describe("LorebooksEditor · import", () => {
  it("renders the server's report — warnings first, then what mapped and what was stashed", () => {
    h.importMutate.mockImplementation((_file: File, opts: { onSuccess: (r: unknown) => void }) =>
      opts.onSuccess({
        slug: "traits",
        book: {},
        report: {
          mapped: ["name", "entries"],
          stashed_keys: ["displayIndex", "probability"],
          warnings: ["3 entries at position 2 were placed at the tail"],
        },
      }),
    );
    render(<LorebooksEditor />);
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, {
      target: { files: [new File(["{}"], "traits.json", { type: "application/json" })] },
    });

    expect(screen.getByText("imported traits")).toBeTruthy();
    expect(screen.getByText("3 entries at position 2 were placed at the tail")).toBeTruthy();
    expect(screen.getByText("name · entries")).toBeTruthy();
    expect(screen.getByText("displayIndex · probability")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
    expect(screen.queryByText("imported traits")).toBeNull();
  });
});
