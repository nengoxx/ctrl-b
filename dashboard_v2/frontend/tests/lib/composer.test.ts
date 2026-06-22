import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/composer — `runComposer` is the input chokepoint: it routes the raw composer text by its leading
// sigil (`!`→shell · `/`→slash verbs · else→agent) and jumps to the Agent tab. We mock the chat + ui
// store actions and assert the dispatch; the privilege helper stays real (it validates the level).

vi.mock("../../src/store/chat", () => ({
  sendMessage: vi.fn(),
  runShell: vi.fn(),
  compactThread: vi.fn(),
  startNewThread: vi.fn(),
  setSessionMode: vi.fn(),
  setSessionAgent: vi.fn(),
  setSessionPrivilege: vi.fn(),
  pushSystemNote: vi.fn(),
}));
vi.mock("../../src/store/ui", () => ({ setUI: vi.fn() }));

import { runComposer } from "../../src/lib/composer";
import * as chat from "../../src/store/chat";
import { setUI } from "../../src/store/ui";

// loadSkills/loadAgents fire a best-effort fetch on import; make it a quiet no-op so nothing hits the
// network during routing tests (the routes under test don't depend on the loaded sets).
beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: false } as Response));
});

describe("runComposer routing", () => {
  it("`!cmd` runs the guarded shell", () => {
    runComposer("!ls -la");
    expect(chat.runShell).toHaveBeenCalledWith("ls -la");
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  it("plain text goes to the agent", () => {
    runComposer("wake the vault");
    expect(chat.sendMessage).toHaveBeenCalledWith("wake the vault");
  });

  it("every route jumps to the Agent tab", () => {
    runComposer("hello");
    expect(setUI).toHaveBeenCalledWith({ tab: "agent" });
  });

  it("empty input is a no-op (no tab switch, no dispatch)", () => {
    runComposer("   ");
    expect(setUI).not.toHaveBeenCalled();
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  it("`/local <msg>` sends one message on the local backend", () => {
    runComposer("/local ping");
    expect(chat.sendMessage).toHaveBeenCalledWith("ping", { mode: "local" });
  });

  it("bare `/cloud` sets the sticky session mode", () => {
    runComposer("/cloud");
    expect(chat.setSessionMode).toHaveBeenCalledWith("cloud");
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  it("`/clear` and `/compact` map to their thread actions", () => {
    runComposer("/clear");
    expect(chat.startNewThread).toHaveBeenCalled();
    runComposer("/compact");
    expect(chat.compactThread).toHaveBeenCalled();
  });

  it("`/privilege <level>` sets a valid level and rejects an invalid one", () => {
    runComposer("/privilege full");
    expect(chat.setSessionPrivilege).toHaveBeenCalledWith("full");

    runComposer("/privilege bogus");
    expect(chat.setSessionPrivilege).toHaveBeenCalledTimes(1); // not called again for the bad level
    expect(chat.pushSystemNote).toHaveBeenCalledWith(expect.stringContaining("unknown level"));
  });

  it("an unknown slash verb gets a note, not the agent", () => {
    runComposer("/definitelynotacommand");
    expect(chat.pushSystemNote).toHaveBeenCalledWith(expect.stringContaining("unknown command"));
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });
});
