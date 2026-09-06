import { describe, expect, it } from "vitest";

import { resolveAgentArt } from "../../src/hooks/useAgentArt";
import type { AgentSummary } from "../../src/hooks/useAgents";
import type { MediaFile, MediaIndex } from "../../src/hooks/useMedia";

// D70 §10-S4 — the JOIN: `GET /agents`'s summary map (the binding) × `GET /api/media/agents` (what the
// bound entry actually is). The two halves are separate on the wire deliberately, so this is the one
// place a binding becomes a URL — and the one place every "no picture" case is decided.

function row(over: Partial<MediaFile> & { file: string }): MediaFile {
  return {
    name: over.file.replace(/\.[^.]+$/, ""),
    url: `/api/media/agents/files/avatars/${over.file}`,
    format: "png",
    size_bytes: 100,
    revision: "r1",
    width: 512,
    height: 512,
    unusable: false,
    unusable_reason: null,
    ...over,
  };
}

function index(avatars: MediaFile[], backgrounds: MediaFile[] = []): MediaIndex {
  return {
    ns: "agents",
    collation: "library-v1",
    roles: { avatars, backgrounds },
    slots: {},
  };
}

const summary = (over: Partial<AgentSummary> = {}): AgentSummary => ({
  title: "",
  description: "",
  avatar: "",
  background: "",
  voice: "",
  ...over,
});

describe("resolveAgentArt — the summary × media-index join", () => {
  it("turns a binding into the row's revision-stamped URL and its framing point", () => {
    const art = resolveAgentArt(
      "lynette",
      summary({ title: "Lynette", avatar: "lynette.png", voice: "af_sky" }),
      index([row({ file: "lynette.png", focal: { x: 0.4, y: 0.2, rev: "r1" } })]),
    );
    expect(art.title).toBe("Lynette");
    expect(art.avatar?.url).toBe("/api/media/agents/files/avatars/lynette.png?rev=r1");
    expect(art.avatar?.focus).toBeDefined(); // the point is live (its `rev` matches the row's)
    expect(art.voice).toBe("af_sky");
  });

  it("falls back to the slug when the agent set no title, and omits an unset voice", () => {
    const art = resolveAgentArt("ops", summary(), index([]));
    expect(art.title).toBe("ops");
    expect(art.voice).toBeUndefined();
  });

  it("resolves avatar and background independently, from their own roles", () => {
    const art = resolveAgentArt(
      "lynette",
      summary({ avatar: "face.png", background: "cafe.png" }),
      index([row({ file: "face.png" })], [row({ file: "cafe.png" })]),
    );
    expect(art.avatar?.url).toContain("face.png");
    expect(art.background?.url).toContain("cafe.png");
  });

  it("has no art when the agent binds nothing, when nothing is known about it, or with no index yet", () => {
    expect(
      resolveAgentArt("ops", summary(), index([row({ file: "a.png" })])).avatar,
    ).toBeUndefined();
    // an agent absent from the map (deleted between the two reads) — a name, and nothing claimed about it
    expect(resolveAgentArt("ghost", undefined, index([row({ file: "a.png" })]))).toEqual({
      name: "ghost",
      title: "ghost",
      avatar: undefined,
      background: undefined,
      voice: undefined,
    });
    expect(resolveAgentArt("ops", summary({ avatar: "a.png" }), undefined).avatar).toBeUndefined();
  });

  it("has no art when the binding names an entry the library no longer holds", () => {
    const art = resolveAgentArt(
      "ops",
      summary({ avatar: "gone.png" }),
      index([row({ file: "a.png" })]),
    );
    expect(art.avatar).toBeUndefined();
  });

  it("has no art when the owner switched the entry off, or the server cannot read its bytes", () => {
    const hidden = index([row({ file: "a.png", hidden: true })]);
    expect(resolveAgentArt("ops", summary({ avatar: "a.png" }), hidden).avatar).toBeUndefined();
    const broken = index([row({ file: "a.png", unusable: true, unusable_reason: "unreadable" })]);
    expect(resolveAgentArt("ops", summary({ avatar: "a.png" }), broken).avatar).toBeUndefined();
  });
});
