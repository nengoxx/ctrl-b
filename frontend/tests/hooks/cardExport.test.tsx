import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// THE CARD EXPORT (D79 / §15.3). The image job is MOCKED (a worker cannot run in jsdom): what is pinned
// is the CALL — the whole file as the rect, the avatars role's own bound, the type forced to PNG —
// and the plumbing around it (the carrier POSTed to the card route, the answer downloaded under the
// sanitised display name; the JSON path straight from `GET …/card`).

const exportImage = vi.fn();
vi.mock("../../src/lib/imageExport", async (orig) => ({
  ...(await orig<typeof import("../../src/lib/imageExport")>()),
  exportImage: (...a: unknown[]) => exportImage(...a) as unknown,
}));
const paintFallbackTile = vi.fn();
vi.mock("../../src/lib/fallbackTile", async (orig) => ({
  ...(await orig<typeof import("../../src/lib/fallbackTile")>()),
  paintFallbackTile: (...a: unknown[]) => paintFallbackTile(...a) as unknown,
}));
const downloads: { name: string; blob?: Blob; json?: unknown }[] = [];
vi.mock("../../src/lib/download", async (orig) => ({
  ...(await orig<typeof import("../../src/lib/download")>()),
  downloadBlob: (name: string, blob: Blob) => downloads.push({ name, blob }),
  downloadJson: (name: string, json: unknown) => downloads.push({ name, json }),
}));

import { cardCarrier, useExportCard } from "../../src/hooks/useAgentArt";
import { MEDIA_NS } from "../../src/theme-engine/mediaRegistry";

const PNG_320x240 = readFileSync(resolve(__dirname, "../fixtures/images/photo-320x240.png"));
const AVATAR_URL = "/api/media/agents/files/avatars/lynette.png?v=r1";

const realFetch = globalThis.fetch;
let fetched: { url: string; init?: RequestInit }[];

function route(handler: (url: string, init?: RequestInit) => Response) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    fetched.push({ url, init });
    return Promise.resolve(handler(url, init));
  });
}

beforeEach(() => {
  fetched = [];
  downloads.length = 0;
  exportImage.mockReset();
  paintFallbackTile.mockReset();
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("cardCarrier", () => {
  it("draws the WHOLE bound file through the export, forced to PNG, at the avatars role's bound", async () => {
    route(() => new Response(PNG_320x240, { headers: { "content-type": "image/png" } }));
    const png = new Blob([new Uint8Array(80)], { type: "image/png" });
    exportImage.mockResolvedValue({ blob: png });
    const out = await cardCarrier({ title: "Lynette", avatar: { url: AVATAR_URL } });
    expect(out).toBe(png);
    expect(fetched[0].url).toBe(AVATAR_URL);
    const job = exportImage.mock.calls[0][0] as Record<string, unknown>;
    // Unbounded, clamped to the DECODED (EXIF-oriented) size inside the export — the attachments
    // precedent; a header-read size would be pre-rotation and crop a rotated JPEG.
    expect(job.rect).toEqual({
      x: 0,
      y: 0,
      width: Number.MAX_SAFE_INTEGER,
      height: Number.MAX_SAFE_INTEGER,
    });
    expect(job.sourceFormat).toBeNull(); // the type is forced — the source's format decides nothing
    expect(job.override).toEqual({ type: "image/png" });
    expect(job.bounds).toBe(MEDIA_NS.agents.roles.avatars.bounds);
    expect(job.bounds).toEqual({ bytes: 1_500_000, pixels: 4_000_000 }); // FULL_ART
  });

  it("paints the letter tile when there is no usable avatar — and fetches nothing", async () => {
    route(() => new Response(null, { status: 500 }));
    const tile = new Blob([new Uint8Array(90)], { type: "image/png" });
    paintFallbackTile.mockResolvedValue(tile);
    expect(await cardCarrier({ title: "seraphina" })).toBe(tile);
    expect(paintFallbackTile.mock.calls[0][0]).toBe("S");
    expect(fetched).toEqual([]);
    expect(exportImage).not.toHaveBeenCalled();
  });

  it("refuses when the avatar cannot be read", async () => {
    route(() => new Response(null, { status: 404, statusText: "Not Found" }));
    await expect(cardCarrier({ title: "x", avatar: { url: AVATAR_URL } })).rejects.toThrow(
      /avatar could not be read \(404/,
    );
  });
});

describe("useExportCard", () => {
  function mount(name: string, avatar = "lynette.png") {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    qc.setQueryData(["agents"], {
      agents: ["lynette"],
      default: "default",
      summaries: {
        lynette: { title: "Dr. Lyn", description: "", avatar, background: "", voice: "" },
      },
    });
    qc.setQueryData(["media", "agents"], {
      ns: "agents",
      collation: "library-v1",
      roles: {
        avatars: [
          {
            name: "lynette",
            file: "lynette.png",
            url: "/api/media/agents/files/avatars/lynette.png",
            format: "png",
            size_bytes: PNG_320x240.length,
            revision: "r1",
            width: 320,
            height: 240,
            unusable: false,
            unusable_reason: null,
          },
        ],
        backgrounds: [],
      },
      slots: {},
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    return renderHook(() => useExportCard(name), { wrapper });
  }

  it("PNG: posts the carrier to the card route and downloads the answer as <title>.png", async () => {
    const card = new Uint8Array([1, 2, 3]); // a typed array: jsdom's Blob is not undici's body type
    route((url) =>
      url.startsWith("/api/media/")
        ? new Response(PNG_320x240, { headers: { "content-type": "image/png" } })
        : new Response(card, { headers: { "content-type": "image/png" } }),
    );
    const carrier = new Blob([new Uint8Array(80)], { type: "image/png" });
    exportImage.mockResolvedValue({ blob: carrier });
    const { result } = mount("lynette");
    act(() => result.current.exportCard("png"));
    await waitFor(() => expect(downloads).toHaveLength(1));
    const post = fetched.find((f) => f.url === "/api/agents/lynette/card.png");
    expect(post?.init?.method).toBe("POST");
    expect(post?.init?.body).toBe(carrier);
    expect(downloads[0].name).toBe("Dr. Lyn.png");
    expect(new Uint8Array(await downloads[0].blob!.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("JSON: downloads GET …/card verbatim as <title>.json — no picture involved", async () => {
    const v3 = { spec: "chara_card_v3", spec_version: "3.0", data: { name: "Lynette" } };
    route(
      () => new Response(JSON.stringify(v3), { headers: { "content-type": "application/json" } }),
    );
    const { result } = mount("lynette");
    act(() => result.current.exportCard("json"));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(fetched.map((f) => f.url)).toEqual(["/api/agents/lynette/card"]);
    expect(downloads[0]).toEqual({ name: "Dr. Lyn.json", json: v3 });
    expect(exportImage).not.toHaveBeenCalled();
  });

  it("the root agent exports too — under its slug when it has no title", async () => {
    route(
      () =>
        new Response(JSON.stringify({ data: {} }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const { result } = mount("default");
    act(() => result.current.exportCard("json"));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(fetched[0].url).toBe("/api/agents/default/card");
    expect(downloads[0].name).toBe("default.json");
  });
});
