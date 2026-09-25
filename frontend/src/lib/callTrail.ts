// THE CALL TRAIL, browser half (D77) — a buffered, debug-only record of what the call machine decided.
//
// Every decision that matters in a live call is made HERE, in the browser — the relative gate's floor,
// the noise and voice estimates, the leak probe's verdicts, the ear hold, the transcript gate's drops,
// the route readbacks, the phase changes — and the relay sees only the wire. So `useLiveCall` pushes
// what it decided into this buffer, and the buffer ships it to `POST /api/voice/live/trail`, which
// appends it to the SAME per-call file the relay writes (`$CTRLB_HOME/calls/<callId>.jsonl`). The main
// seat reads the file after the owner's phone round instead of reconstructing the call from memory.
//
// PURE-ISH ON PURPOSE: no React, no store, no fetch of its own — the POST is injected (`post`), the
// clock is injectable (`now`), and the ONE timer is the flush interval. Nothing renders off it.
//
// DEBUG DATA, SHAPED LIKE IT. A rejected POST drops its batch (one `console.debug`, never a retry, never
// a throw into the call); a disposed trail ignores every push. The call must never notice the trail.

/** How often the buffer flushes on its own, ms. A property of READING the trail afterwards, not of the
 *  call: two seconds of lines is fine-grained enough to line up with the relay's own stamps and coarse
 *  enough that a call makes one small POST at a time. Started lazily by the first push, cleared when a
 *  flush empties the buffer — an idle call makes no requests at all. */
export const TRAIL_INTERVAL_MS = 2000;

/** Entries per batch before the buffer flushes early (`"count"`). */
export const TRAIL_MAX_ENTRIES = 50;

/** SERIALIZED bytes per batch before the buffer flushes early (`"count"`, council F3). The browser's
 *  `keepalive` budget is ~64 KiB per ORIGIN across every in-flight keepalive request, and the `hidden`
 *  / `end` flushes are exactly the ones that ride it — so one batch stays at half of it. The server's
 *  64 KB body cap is the hard bound beside this soft one. */
export const TRAIL_FLUSH_BYTES = 32 * 1024;

/** Entries per POST — the trail route's own `entries` bound. A flush larger than this splits. */
export const TRAIL_POST_ENTRIES = 200;

/** SERIALIZED size of ONE entry — the trail route's own per-entry bound (`TRAIL_MAX_ENTRY_BYTES` in
 *  `services/call_trail.py`), mirrored like `TRAIL_POST_ENTRIES`. The server refuses the WHOLE batch
 *  over one entry past it, and a line can copy an unbounded upstream text (a `serverError`'s message),
 *  so an entry past it is replaced by a marker at push — see `push`. */
export const TRAIL_MAX_ENTRY_BYTES = 2048;

export type TrailFlushReason = "interval" | "count" | "hidden" | "end";

export interface CallTrail {
  /** Buffer one line: `{t, leg, gen, ev, ...data}` — stamped at push time. */
  push(ev: string, data?: Record<string, unknown>): void;
  /** Ship the buffer now. `hidden`/`end` ride `keepalive`, so the POST outlives a page going away. */
  flush(reason: TrailFlushReason): void;
  /** Stop the timer and ignore every later push. Idempotent. */
  dispose(): void;
}

export interface CallTrailOpts {
  callId: string;
  /** The injected write — `postJSON(<route>, body, { keepalive })` in production. */
  post: (body: unknown, keepalive: boolean) => Promise<void>;
  /** WHICH leg and generation a line belongs to, read at PUSH time (council F4): one call is many legs
   *  (reconnects, route cycles), and the relay's lines carry the same `leg`. */
  stamp: () => { leg: number; gen: number };
  now?: () => number;
  intervalMs?: number;
  maxEntries?: number;
}

export function createCallTrail(opts: CallTrailOpts): CallTrail {
  const now = opts.now ?? Date.now;
  const intervalMs = opts.intervalMs ?? TRAIL_INTERVAL_MS;
  const maxEntries = opts.maxEntries ?? TRAIL_MAX_ENTRIES;
  let buf: Record<string, unknown>[] = [];
  /** The serialized size of `buf` so far — each entry measured ONCE, at push. */
  let bytes = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let warned = false;

  const stopTimer = (): void => {
    clearInterval(timer);
    timer = undefined;
  };

  const drop = (e: unknown): void => {
    if (warned) return;
    warned = true;
    console.debug("call trail: a batch was dropped (debug data, not retried)", e);
  };

  const ship = (entries: Record<string, unknown>[], keepalive: boolean): void => {
    for (let i = 0; i < entries.length; i += TRAIL_POST_ENTRIES) {
      const body = { call_id: opts.callId, entries: entries.slice(i, i + TRAIL_POST_ENTRIES) };
      // `.catch` on the promise AND a try around the call: a `post` that throws synchronously must
      // not reach the call machine either.
      try {
        void opts.post(body, keepalive).catch(drop);
      } catch (e) {
        drop(e);
      }
    }
  };

  const flush = (reason: TrailFlushReason): void => {
    stopTimer();
    if (buf.length === 0) return;
    const entries = buf;
    buf = [];
    bytes = 0;
    ship(entries, reason === "hidden" || reason === "end");
  };

  return {
    push(ev, data) {
      if (disposed) return;
      const head = { t: now(), ...opts.stamp(), ev };
      let entry: Record<string, unknown> = { ...head, ...data };
      let json = JSON.stringify(entry).length;
      // ONE OVERSIZED LINE MUST NOT COST ITS NEIGHBOURS: the server 422s a batch over any entry past
      // its per-entry bound, which would drop every other line of that batch with it. So the entry is
      // replaced by a marker that still says WHAT happened and WHEN (and how big it was). `.length`
      // counts UTF-16 units, never fewer than the characters the server counts — the check errs early.
      if (json > TRAIL_MAX_ENTRY_BYTES) {
        // …and WHICH signal it was, when the line is a `sig`: the type is the one field that names it.
        const type = data?.type;
        entry = { ...head, ...(typeof type === "string" ? { type } : {}), oversize: json };
        json = JSON.stringify(entry).length;
      }
      const size = json + 1; // + the array comma
      // BYTES FIRST: the entry that would push the batch past the keepalive half goes into the NEXT
      // batch, so no batch ever exceeds it (every entry is within the per-entry bound above, far
      // inside the half).
      if (buf.length > 0 && bytes + size > TRAIL_FLUSH_BYTES) flush("count");
      buf.push(entry);
      bytes += size;
      if (buf.length >= maxEntries) {
        flush("count");
        return;
      }
      if (timer === undefined) timer = setInterval(() => flush("interval"), intervalMs);
    },
    flush(reason) {
      if (disposed) return;
      flush(reason);
    },
    dispose() {
      disposed = true;
      stopTimer();
      buf = [];
      bytes = 0;
    },
  };
}
