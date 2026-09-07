import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// D70 §6 — the lorebook file-API hooks. What is worth pinning is the CACHE wiring, not the fetch:
// `PUT /lorebooks/{slug}` is a full replace whose 200 echoes the VALIDATED book, so the echo (never
// the request) is what the editor's next draft must be seeded from — and the thin list carries the
// name/enabled/entry-count this write may have changed, so it invalidates too. The import path pins
// the deliberate ABSENCE of a success toast: the report is the outcome.

const h = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../src/api/client", async (importActual) => {
  const actual = await importActual<typeof import("../../src/api/client")>();
  return { ...actual, getJSON: h.get, putJSON: h.put, postForm: h.post, del: h.del };
});
vi.mock("../../src/store/toast", () => ({ pushToast: h.toast }));

import {
  newLorebookEntry,
  useDeleteLorebook,
  useImportLorebook,
  useSaveLorebook,
} from "../../src/hooks/useRoleplay";

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: qc }, children);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});
afterEach(() => {
  h.get.mockReset();
  h.put.mockReset();
  h.post.mockReset();
  h.del.mockReset();
  h.toast.mockReset();
});

describe("the lorebook write hooks", () => {
  it("a SAVE seeds the by-slug cache from the server's ECHO, not from what was sent", async () => {
    // The server fills defaults in on the way through `Lorebook.model_validate`, so the echo can
    // differ from the request — and it is the echo the next draft has to start from.
    const echo = {
      slug: "hollow-sea",
      book: { name: "Hollow Sea", description: "", enabled: true, entries: [] },
    };
    h.put.mockResolvedValue(echo);
    const { result } = renderHook(() => useSaveLorebook(), { wrapper });
    result.current.mutate({
      slug: "hollow-sea",
      book: { name: "Hollow Sea", description: "", enabled: true, entries: [] },
    });

    await waitFor(() => expect(qc.getQueryData(["lorebook", "hollow-sea"])).toEqual(echo));
    expect(h.put).toHaveBeenCalledWith("/api/lorebooks/hollow-sea", {
      book: { name: "Hollow Sea", description: "", enabled: true, entries: [] },
    });
    expect(h.toast).toHaveBeenCalledWith("Lorebook saved", "ok");
  });

  it("a DELETE drops the by-slug entry as well as the list", async () => {
    qc.setQueryData(["lorebook", "hollow-sea"], { slug: "hollow-sea", book: {} });
    const spy = vi.spyOn(qc, "invalidateQueries");
    h.del.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteLorebook(), { wrapper });
    result.current.mutate("hollow-sea");

    await waitFor(() => expect(h.toast).toHaveBeenCalledWith("Lorebook removed", "ok"));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["lorebooks"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["lorebook", "hollow-sea"] });
  });

  it("an IMPORT posts ONE multipart `file` field and stays SILENT on success", async () => {
    h.post.mockResolvedValue({
      slug: "traits",
      book: { name: "Traits", description: "", enabled: true, entries: [] },
      report: { mapped: [], stashed_keys: [], warnings: [] },
    });
    const { result } = renderHook(() => useImportLorebook(), { wrapper });
    result.current.mutate(new File(["{}"], "traits.json", { type: "application/json" }));

    await waitFor(() => expect(h.post).toHaveBeenCalled());
    const [path, form] = h.post.mock.calls[0] as [string, FormData];
    expect(path).toBe("/api/lorebooks/import");
    expect([...form.keys()]).toEqual(["file"]);
    // No success toast — the REPORT is the outcome, and a toast over it would say less.
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("an import FAILURE renders the backend's own refusal (413/422/409 all carry a detail)", async () => {
    h.post.mockRejectedValue(new Error("the lorebook is larger than lorebooks.max_import_bytes"));
    const { result } = renderHook(() => useImportLorebook(), { wrapper });
    result.current.mutate(new File(["x"], "big.json"));
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(
        "the lorebook is larger than lorebooks.max_import_bytes",
        "err",
      ),
    );
  });
});

describe("newLorebookEntry", () => {
  it("is the BACKEND's own defaults (LorebookEntry's field defaults, §6.2)", () => {
    expect(newLorebookEntry()).toEqual({
      keys: [],
      content: "",
      enabled: true,
      constant: false,
      secondary_keys: [],
      logic: "and_any",
      case_sensitive: false,
      // ST's SHIPPED default, not its code default (R65 §1.2) — the one non-obvious one.
      whole_words: true,
      position: "head",
      order: 100,
      priority: null,
    });
  });

  it("is a FACTORY — two appended entries never alias one array", () => {
    const a = newLorebookEntry();
    const b = newLorebookEntry();
    a.keys.push("ghostship");
    expect(b.keys).toEqual([]);
  });
});
