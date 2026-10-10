import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useAgentArt } from "../hooks/useAgentArt";
import { useAgentRoster } from "../hooks/useAgents";
import {
  flattenThreads,
  THREAD_DOT_WORDS,
  threadDot,
  trimThreads,
  useDeleteThread,
  useRenameThread,
  useThreads,
} from "../hooks/useThreads";
import { relativeTime } from "../lib/relativeTime";
import {
  armConversationRemoval,
  newConversation,
  openThread,
  refuseSwitchInCall,
  useChatSlice,
  useViewHome,
} from "../store/chat";
import { requestConfirm } from "../store/confirm";
import { closeConversationsSheet, useConversationsSheetOpen } from "../store/conversationsSheet";
import { requestPrompt } from "../store/prompt";
import { getSheetSnap, setSheetSnap } from "../store/sheetSnap";
import { useUISlice } from "../store/ui";
import type { ThreadSummary } from "../types";
import { BottomSheet, type SheetDetent } from "./BottomSheet";
import { FocalFace } from "./FocalFace";

// THE PER-HOME CONVERSATIONS SHEET (D84 §7, Phase 27 S9b) — opened by the chat header's conversations
// button (`ChatHeaderActions`), mounted ONCE at the root (`DefaultRoot`, before `<Toasts/>` so a toast
// paints over it; every theme renders that root under `.kit`). Never inside the header: in the `full`
// backdrop mode the chat's `.sec` is a z-1 stacking context, and a sheet inside it would paint UNDER the
// composer and the app bar.
//
// It lists the view's HOME agent's conversations (R36 — whoever answers), newest first: "New conversation"
// on top (`/new` for the home, with the O28 "already new" rule), each row = label · preview · time · the
// §5 dot, the OPEN one marked; a row's `⋯` discloses Rename · Delete (the D81 `.who-acts` row pattern);
// "Show older" while the last page came back full. Its own failures are TOASTS (visible over the sheet).
// The dots stay live through the `thread` frame consumer (S10 — `hooks/useEvents` invalidates
// `['threads']` on every frame), the store's stale bus, a focus refetch, and every rename/delete.

/** The sheet's detent memory key (`store/sheetSnap`) — one per sheet identity. */
const SNAP_KEY = "conversations";
const rememberSnap = (snap: SheetDetent): void => setSheetSnap(SNAP_KEY, snap);

/** The homes a mounted sheet body is showing right now (a count per home) — the close path's trim leaves
 *  a list alone while a body shows it again. */
const liveBodies = new Map<string, number>();

export function ConversationsSheet() {
  const open = useConversationsSheetOpen();
  const home = useViewHome();
  const tab = useUISlice((s) => s.tab);
  // The sheet belongs to the chat: a programmatic tab change (a notification, a nav door) closes it, so it
  // never hangs over Fleet. An unknown home (a door that knew nothing, mid-repair) closes it too — no
  // surface runs against a home this device cannot name.
  const stray = open && (tab !== "agent" || home === null);
  useEffect(() => {
    if (stray) closeConversationsSheet();
  }, [stray]);
  // The detent the owner last left it at — read when it OPENS (not per render).
  const initialSnap = useMemo(() => (open ? getSheetSnap(SNAP_KEY) : "peek"), [open]);
  const headId = useId();
  return (
    <BottomSheet
      open={open && !stray}
      onClose={closeConversationsSheet}
      className="cvs-bs"
      labelledBy={headId}
      closeLabel="Close conversations"
      initialSnap={initialSnap}
      onSnapChange={rememberSnap}
    >
      {home !== null && <SheetBody home={home} headId={headId} />}
    </BottomSheet>
  );
}

function SheetBody({ home, headId }: { home: string; headId: string }) {
  const qc = useQueryClient();
  const roster = useAgentRoster().data;
  const avatar = useAgentArt()(home).avatar;
  const openId = useChatSlice((s) => s.threadId);
  const { data, hasNextPage, fetchNextPage, isFetchingNextPage } = useThreads(home);
  const rows = flattenThreads(data);
  const [disclosed, setDisclosed] = useState<string | null>(null);
  const rename = useRenameThread();
  const remove = useDeleteThread();
  // The open view, for the checks that run AFTER an await (the confirm): a render-time value would be stale.
  const openRef = useRef(openId);
  useEffect(() => {
    openRef.current = openId;
  }, [openId]);
  // THE CLOSE PATH's trim: this body unmounts when the sheet has slid out (or re-renders for another home)
  // — the cached list goes back to its first page, so the always-on header query never refetches the
  // pages "Show older" loaded. Never under a sheet that REOPENED on the same home meanwhile (`liveBodies`).
  useEffect(() => {
    liveBodies.set(home, (liveBodies.get(home) ?? 0) + 1);
    return () => {
      const left = (liveBodies.get(home) ?? 1) - 1;
      if (left > 0) liveBodies.set(home, left);
      else liveBodies.delete(home);
      void trimThreads(qc, home, () => liveBodies.has(home));
    };
  }, [qc, home]);

  const nameOf = (agent: string): string => roster?.summaries?.[agent]?.title || agent;
  const labelOf = (row: ThreadSummary): string => row.label ?? "New conversation";

  const startNew = (): void => {
    void newConversation(); // `/new` for the HOME — on a conversation with no owner turn, the O28 note
    closeConversationsSheet();
  };
  const pick = (row: ThreadSummary): void => {
    void openThread(row.id, row.agent ?? home); // the door contract: a STRING home
    closeConversationsSheet();
  };
  const renameRow = async (row: ThreadSummary): Promise<void> => {
    setDisclosed(null);
    const next = await requestPrompt({
      title: "Rename conversation",
      value: row.title ?? "",
      mono: false,
      placeholder: "(empty → its first line, as before)",
      saveLabel: "Rename",
    });
    if (next === null) return;
    rename.mutate({ id: row.id, title: next.trim() || null });
  };
  const deleteRow = async (row: ThreadSummary): Promise<void> => {
    setDisclosed(null);
    // M8 — deleting the OPEN conversation ends in a swap, refused in a live call: at ENTRY, and again
    // after the confirm (a call may have started meanwhile — the S7a entry-and-commit rule).
    if (row.id === openRef.current && refuseSwitchInCall()) {
      closeConversationsSheet();
      return;
    }
    const ok = await requestConfirm({
      title: `Delete “${labelOf(row)}”?`,
      body: "Its messages and staged files go with it. This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    if (row.id === openRef.current && refuseSwitchInCall()) {
      closeConversationsSheet();
      return;
    }
    armConversationRemoval(row.id); // the commit's facts, ruled by at the DELETE's success
    remove.mutate(row.id);
  };

  // The PEEK fold: the head, "New conversation" and up to three rows.
  const peekAt = rows.length > 0 ? Math.min(2, rows.length - 1) : -1;
  return (
    <div className="cvs-sheet">
      <div className="cvs-head">
        {avatar && <FocalFace className="cvs-face" src={avatar.url} art={avatar.focus} />}
        <h2 className="cvs-title" id={headId}>
          {nameOf(home)}
        </h2>
      </div>
      <ul className="cvs-list">
        <li data-bs-peek={peekAt < 0 ? "" : undefined}>
          <button type="button" className="cvs-row cvs-new" onClick={startNew}>
            <span className="cvs-label">New conversation</span>
          </button>
        </li>
        {rows.map((row, i) => {
          const label = labelOf(row);
          const dot = threadDot(row);
          const isOpen = row.id === openId;
          const acts = disclosed === row.id;
          return (
            <li key={row.id} data-bs-peek={i === peekAt ? "" : undefined}>
              <div className="cvs-item">
                <button
                  type="button"
                  className="cvs-row"
                  aria-current={isOpen ? "true" : undefined}
                  aria-description={dot ? THREAD_DOT_WORDS[dot] : undefined}
                  onClick={() => pick(row)}
                >
                  <span className="cvs-main">
                    <span className="cvs-label">{label}</span>
                    {row.preview && (
                      <span className="cvs-preview">
                        {previewPrefix(row, home, nameOf)}
                        {row.preview.text}
                      </span>
                    )}
                  </span>
                  <span className="cvs-meta">
                    <span className="cvs-time">{relativeTime(row.updated_at)}</span>
                    {dot && <span className="thread-dot" data-state={dot} aria-hidden />}
                  </span>
                </button>
                <button
                  type="button"
                  className="cvs-more"
                  aria-label={`actions for ${label}`}
                  aria-expanded={acts}
                  onClick={() => setDisclosed(acts ? null : row.id)}
                >
                  ⋯
                </button>
              </div>
              {acts && (
                <div className="cvs-acts">
                  <button type="button" className="cvs-act" onClick={() => void renameRow(row)}>
                    Rename
                  </button>
                  <button
                    type="button"
                    className="cvs-act danger"
                    onClick={() => void deleteRow(row)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {hasNextPage && (
          <li>
            <button
              type="button"
              className="cvs-older"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              Show older
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

/** The preview's speaker (§7, R100): `You: ` for the owner; `<Name>: ` for an assistant row spoken by an
 *  agent that is NOT the home (a vanished agent reads as its slug); an assistant row with no `agent` is
 *  the home's own (§12.3 L4) — no prefix, like the home's own named rows. */
function previewPrefix(
  row: ThreadSummary,
  home: string,
  nameOf: (agent: string) => string,
): string {
  const p = row.preview;
  if (!p) return "";
  if (p.role === "user") return "You: ";
  return p.agent !== null && p.agent !== home ? `${nameOf(p.agent)}: ` : "";
}
