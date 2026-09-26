import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../src/api/client";

// D78 — Conf › Roleplay's PERSONA LIBRARY. What is worth pinning is the wire the design argued about
// (Emma A-2/A-3/A-4): every row edit is its OWN request against the `personas` router (POST mints —
// server-side, the FE sends a name and never a slug · PUT edits under an unchanged slug · DELETE, no
// cascade), each write invalidates the settings query the library rides on, the one refusal a name can
// earn (409, the minted slug is taken) is said INLINE rather than toasted, the default is an immediate
// settings PUT, and a dangling default is visible as `missing: <slug>`.
//
// The REAL persona hooks run on a real QueryClient; only the transport (`postJSON`/`putJSON`/`del`), the
// settings hooks and the modal stores are mocked — so what is under test is the editor's own wiring AND
// the hooks' (the useAutomations harness, joined to the automationsPanel DOM posture). The agent form's
// half of A-4 (the picker + its `missing:` option) is pinned beside the rest of that form, in
// `agentRoleplayFields.test.tsx`, which already owns the harness for it.

const h = vi.hoisted(() => ({
  roleplay: null as unknown as Record<string, unknown>, // set by `setup` before every render
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  toast: vi.fn(),
  saveSettings: vi.fn(),
  confirm: vi.fn(),
  prompt: vi.fn(),
}));

vi.mock("../../src/api/client", async (importActual) => {
  const actual = await importActual<typeof import("../../src/api/client")>();
  return { ...actual, postJSON: h.post, putJSON: h.put, del: h.del, getJSON: vi.fn() };
});
vi.mock("../../src/store/toast", () => ({ pushToast: h.toast }));
vi.mock("../../src/hooks/useSettings", () => ({
  useSettings: () => ({ data: { roleplay: h.roleplay } }),
  useSaveSettings: () => ({ mutate: h.saveSettings, isPending: false }),
}));
vi.mock("../../src/hooks/useActions", () => ({
  useAgentToolGrid: () => ({ toolNames: ["web_search", "roll_dice"], toolModes: {} }),
}));
vi.mock("../../src/store/confirm", () => ({ requestConfirm: h.confirm }));
vi.mock("../../src/store/prompt", () => ({ requestPrompt: h.prompt }));

import { RoleplayEditor } from "../../src/components/RoleplayEditor";
import { isAnyDirty } from "../../src/store/dirty";

const LIB = {
  ari: { name: "Ari", description: "the owner, a night-owl engineer" },
  dm: { name: "The DM", description: "" },
};

function setup(roleplay: Record<string, unknown> = {}) {
  h.roleplay = {
    enabled: false,
    default_tools: [],
    personas: LIB,
    default_persona: "ari",
    ...roleplay,
  };
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidated: unknown[][] = [];
  const real = qc.invalidateQueries.bind(qc);
  vi.spyOn(qc, "invalidateQueries").mockImplementation((filters) => {
    invalidated.push((filters?.queryKey ?? []) as unknown[]);
    return real(filters);
  });
  render(
    <QueryClientProvider client={qc}>
      <RoleplayEditor />
    </QueryClientProvider>,
  );
  return { invalidated };
}

/** A persona row's header — the disclosure, found by its visible name. */
const rowHead = (name: string) =>
  screen.getByText(name, { selector: ".label" }).closest<HTMLElement>(".confrow")!;

const openAdd = () => fireEvent.click(rowHead("add persona"));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const f of [h.post, h.put, h.del, h.toast, h.saveSettings, h.confirm, h.prompt])
    f.mockReset();
});

describe("Conf › Roleplay · the persona rows", () => {
  it("one row per persona, drawn by NAME with its About preview — the slug is never display", () => {
    setup();
    expect(rowHead("Ari")).toBeTruthy();
    expect(rowHead("The DM")).toBeTruthy();
    expect(within(rowHead("The DM")).getByText("no About")).toBeTruthy();
    expect(screen.queryByText("dm", { selector: ".label" })).toBeNull();
  });

  it("the old singular rows are gone — no 'Your name' / 'About you' draft left in the card", () => {
    setup();
    expect(screen.queryByLabelText("Persona name")).toBeNull();
    expect(screen.queryByText("About you")).toBeNull();
  });
});

describe("Conf › Roleplay · add (POST, the server mints)", () => {
  it("sends a NAME and never a slug, invalidates settings, and opens the new row", async () => {
    h.post.mockResolvedValue({ slug: "the-bard", name: "The Bard", description: "" });
    const { invalidated } = setup();
    openAdd();
    fireEvent.change(screen.getByLabelText("New persona name"), {
      target: { value: "  The Bard  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    await waitFor(() => expect(h.post).toHaveBeenCalled());
    expect(h.post).toHaveBeenCalledWith("/api/personas", { name: "The Bard", description: "" });
    await waitFor(() => expect(invalidated).toContainEqual(["settings"]));
    expect(h.toast).toHaveBeenCalledWith("Added The Bard", "ok");
    // the add row closed (its name field is gone) — the create is done, not pending
    await waitFor(() => expect(screen.queryByLabelText("New persona name")).toBeNull());
  });

  it("a blank name cannot be sent (the server's 422, refused before the request)", () => {
    setup();
    openAdd();
    fireEvent.change(screen.getByLabelText("New persona name"), { target: { value: "   " } });
    const create = screen.getByRole<HTMLButtonElement>("button", { name: "create" });
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(h.post).not.toHaveBeenCalled();
  });

  it("a 409 (the minted slug is taken) shows INLINE under the name — no toast — and clears on edit", async () => {
    h.post.mockRejectedValue(new ApiError("a persona 'ari' exists", 409));
    setup();
    openAdd();
    const input = screen.getByLabelText<HTMLInputElement>("New persona name");
    fireEvent.change(input, { target: { value: "ARI" } });
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("a persona 'ari' exists");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(h.toast).not.toHaveBeenCalled();
    expect(screen.getByLabelText("New persona name")).toBeTruthy(); // the row stays open to fix it
    // a stale refusal must not outlive the name it was about
    fireEvent.change(input, { target: { value: "Ari II" } });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("any OTHER failure keeps the ordinary toast (the hosts hooks' posture)", async () => {
    h.post.mockRejectedValue(new ApiError("boom", 500));
    setup();
    openAdd();
    fireEvent.change(screen.getByLabelText("New persona name"), { target: { value: "Zed" } });
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith("boom", "err"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Conf › Roleplay · edit (PUT on the row, slug unchanged)", () => {
  it("a rename PUTs under the ORIGINAL slug, with the About riding along untouched", async () => {
    h.put.mockResolvedValue({ slug: "ari", name: "Arisu", description: LIB.ari.description });
    const { invalidated } = setup();
    fireEvent.click(rowHead("Ari"));
    const save = screen.getByRole<HTMLButtonElement>("button", { name: "saved" });
    expect(save.disabled).toBe(true); // a clean row has nothing to send
    fireEvent.change(screen.getByLabelText("Name of Ari"), { target: { value: "Arisu " } });
    expect(isAnyDirty()).toBe(true); // the seeded-snapshot rule: an unsaved row warns on unload
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(h.put).toHaveBeenCalled());
    expect(h.put).toHaveBeenCalledWith("/api/personas/ari", {
      name: "Arisu",
      description: LIB.ari.description,
    });
    await waitFor(() => expect(invalidated).toContainEqual(["settings"]));
    // the echo is the new epoch — the row is clean again before the doc refetch even lands
    await waitFor(() => expect(isAnyDirty()).toBe(false));
    expect(h.post).not.toHaveBeenCalled(); // an edit is never a re-create
  });

  it("the About opens the fullscreen editor and its result is saved by the row's own PUT", async () => {
    h.prompt.mockResolvedValue("rolls d20s for fun");
    h.put.mockResolvedValue({ slug: "dm", name: "The DM", description: "rolls d20s for fun" });
    setup();
    fireEvent.click(rowHead("The DM"));
    fireEvent.click(screen.getByRole("button", { name: "Edit About — The DM" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "save" })).toBeTruthy());
    expect(h.prompt).toHaveBeenCalledWith(expect.objectContaining({ value: "" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(h.put).toHaveBeenCalledWith("/api/personas/dm", {
        name: "The DM",
        description: "rolls d20s for fun",
      }),
    );
  });

  it("an emptied name cannot be saved", () => {
    setup();
    fireEvent.click(rowHead("Ari"));
    fireEvent.change(screen.getByLabelText("Name of Ari"), { target: { value: "  " } });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "save" }).disabled).toBe(true);
  });
});

describe("Conf › Roleplay · remove (DELETE, confirmed)", () => {
  it("confirms first, then DELETEs the row's slug and invalidates settings", async () => {
    h.confirm.mockResolvedValue(true);
    h.del.mockResolvedValue(undefined);
    const { invalidated } = setup();
    fireEvent.click(rowHead("The DM"));
    fireEvent.click(screen.getByRole("button", { name: "remove" }));
    await waitFor(() => expect(h.del).toHaveBeenCalledWith("/api/personas/dm"));
    expect(h.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Remove persona The DM?", danger: true }),
    );
    await waitFor(() => expect(invalidated).toContainEqual(["settings"]));
  });

  it("a declined confirm sends nothing", async () => {
    h.confirm.mockResolvedValue(false);
    setup();
    fireEvent.click(rowHead("The DM"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "remove" }));
    });
    expect(h.confirm).toHaveBeenCalled();
    expect(h.del).not.toHaveBeenCalled();
  });
});

describe("Conf › Roleplay · the default persona (an immediate settings PUT)", () => {
  const seg = () => screen.getByRole("group", { name: "Default persona" });

  it("none + every persona by name; a pick saves `{roleplay: {default_persona}}` at once", () => {
    setup();
    const opts = within(seg()).getAllByRole("button");
    expect(opts.map((b) => b.textContent)).toEqual(["none", "Ari", "The DM"]);
    expect(within(seg()).getByRole("button", { name: "Ari" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(within(seg()).getByRole("button", { name: "The DM" }));
    expect(h.saveSettings).toHaveBeenCalledWith({ roleplay: { default_persona: "dm" } });
    fireEvent.click(within(seg()).getByRole("button", { name: "none" }));
    expect(h.saveSettings).toHaveBeenLastCalledWith({ roleplay: { default_persona: "" } });
  });

  it("re-picking the current value is not a save", () => {
    setup();
    fireEvent.click(within(seg()).getByRole("button", { name: "Ari" }));
    expect(h.saveSettings).not.toHaveBeenCalled();
  });

  it("a DANGLING default is visible as `missing: <slug>` and pressed — so it can be cleared (A-4)", () => {
    setup({ default_persona: "ghost" });
    const missing = within(seg()).getByRole("button", { name: "missing: ghost" });
    expect(missing.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(seg()).getByRole("button", { name: "none" }));
    expect(h.saveSettings).toHaveBeenCalledWith({ roleplay: { default_persona: "" } });
  });

  it("an empty library still offers the control — just none", () => {
    setup({ personas: {}, default_persona: "" });
    expect(
      within(seg())
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["none"]);
  });
});

describe("Conf › Roleplay · the character tools keep their draft", () => {
  it("the tools bar saves ONLY default_tools — the personas never ride it", () => {
    setup({ default_tools: ["web_search"] });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Saved" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "roll_dice" }));
    expect(isAnyDirty()).toBe(true); // the "roleplay" key now guards the tools alone
    fireEvent.click(screen.getByRole("button", { name: "Save character tools" }));
    expect(h.saveSettings).toHaveBeenCalledWith({
      roleplay: { default_tools: ["web_search", "roll_dice"] },
    });
  });
});
