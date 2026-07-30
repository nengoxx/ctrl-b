import { useEffect, useId, useRef, useState } from "react";

import { NumField } from "./NumField";
import { Seg } from "./Seg";
import { Switch } from "./Switch";
import { useAgentList } from "../hooks/useAgents";
import {
  draftOf,
  fmtWhen,
  useAutomationRuns,
  useAutomations,
  useCreateAutomation,
  useDeleteAutomation,
  useMarkRunRead,
  useRunAutomationNow,
  useSchedulePreview,
  useSetAutomationEnabled,
  useUpdateAutomation,
  type Automation,
  type AutomationDraft,
  type AutomationRun,
  type AutomationsDoc,
  type AutomationView,
  type RunStatus,
} from "../hooks/useAutomations";
import {
  DEFAULT_PRESET,
  WEEKDAYS,
  fromTimeValue,
  presetOf,
  presetToCron,
  toTimeValue,
  type PresetKind,
  type PresetValue,
} from "../lib/cronPreset";
import { dialogOpener, disclosureToggle } from "../lib/disclosure";
import { modalKeyDown } from "../lib/focusTrap";
import { PRIVILEGE_LEVELS, type Privilege } from "../lib/privilege";
import { requestConfirm } from "../store/confirm";
import { openThread } from "../store/chat";
import { setUI } from "../store/ui";

// A3 slice 3 (D49 / AUTOMATIONS_PLAN §D-6) — Conf › Automations: the LIST (name · enable switch ·
// last-status chip · next-fire echo · unread badge) and the EDITOR, which opens in a sheet rather than
// inline. That split is the spec's, for a concrete reason: ConfTab is 2300 lines and phone width is
// the primary viewport, so an inline disclosure carrying a prompt textarea, a schedule builder, four
// segmented controls and a run history would bury the rest of the group.
//
// Styling is REUSE, not net-new chrome: the list rows are the `.conf-card`/`.confrow` recipe every
// Conf group uses, the sheet is the PromptModal shell (`.pm-backdrop`/`.pm`/`.pm-head`), and the form
// inside it is the machine-editor's `.mconf`/`.mform`/`.mfoot`/`.svc-edit` recipe — all of which are
// already styled for vapor (extras.css) AND every kit theme (kit.css).
//
// NOT the `<BottomSheet>` primitive, deliberately: its CSS lives under the `.kit` marker
// (`kit.css` — `.kit .bs-sheet` et al.), so on VAPOR, which is the default theme and frozen (D7), a
// BottomSheet renders completely unstyled. Conf is a token-themed region shared by every theme
// (§14.14), so its overlay has to be one that exists in both stylesheets — and PromptModal's already
// is, having solved the same problem (a full-height panel sized to the `--app-h` viewport shell, so
// the Android keyboard shrinks it rather than covering the fields). What it borrows from the kit
// overlay contract is the DISMISSAL half: a document-level Escape that honours `defaultPrevented`,
// so a PromptModal or ConfirmDialog opened on top consumes its own Escape first.

const RUN_LABEL: Record<RunStatus, string> = {
  running: "running",
  ok: "ok",
  error: "error",
  timed_out: "timed out",
  interrupted: "interrupted",
  missed: "missed",
};

/** The `.badge` variant for a run status. `ok` is the affirmative badge, the two FAILURES are the
 *  `.stale` (danger) one, and everything else — running, interrupted, missed, never-run — is `.dim`:
 *  those are states, not verdicts, and painting them red would cry wolf on an orderly restart. */
function chipClass(status: RunStatus | undefined): string {
  if (status === "ok") return "badge";
  if (status === "error" || status === "timed_out") return "badge stale";
  return "badge dim";
}

function fmtDuration(run: AutomationRun): string {
  if (!run.finished_at) return "…";
  const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return ms < 1000 ? `${ms}ms` : `${Math.round(ms / 1000)}s`;
}

/** One list row. The header is a plain `<div onClick>`, NOT a `role="button"` (D25): it contains the
 *  enable Switch, and a button containing a switch is the `nested-interactive` violation. The chevron
 *  is the real `<button>` that carries the keyboard path — the DeviceRow shape. */
function AutomationRowView({ view, onOpen }: { view: AutomationView; onOpen: () => void }) {
  const a = view.automation;
  const setEnabled = useSetAutomationEnabled();
  const next = view.next_fires[0];
  const status = view.running ? "running" : view.last_run?.status;
  const desc = a.enabled
    ? next
      ? `${view.schedule_text} · next ${fmtWhen(next, a.tz)}`
      : `${view.schedule_text} · no upcoming run`
    : `${view.schedule_text} · off`;
  return (
    <div className="confrow" onClick={onOpen}>
      <div className="k">
        <div className="label">
          {a.name}
          {view.unread_runs > 0 && (
            <span className="badge dim auto-unread">{view.unread_runs} new</span>
          )}
        </div>
        <div className="desc">{desc}</div>
      </div>
      {status && <span className={chipClass(status)}>{RUN_LABEL[status]}</span>}
      {/* The switch acts on its own row without also opening the sheet (the DeviceRow `act` shape). */}
      <span className="auto-sw" onClick={(e) => e.stopPropagation()}>
        <Switch
          on={a.enabled}
          label={`${a.name} enabled`}
          onToggle={() => setEnabled.mutate({ id: a.id, enabled: !a.enabled })}
        />
      </span>
      <button type="button" className="chev" aria-label={`edit ${a.name}`} onClick={onOpen}>
        ›
      </button>
    </div>
  );
}

/** The run history, opened from inside the editor sheet. Opening it is what clears the unread markers
 *  — that is what "read" means here: the owner looked at the results. */
function RunHistory({ automation }: { automation: Automation }) {
  const [open, setOpen] = useState(false);
  const { data: runs } = useAutomationRuns(open ? automation.id : null);
  const markRead = useMarkRunRead();
  // Runs we have already sent a mark-read for, so a re-render (or the invalidation the mutation
  // triggers) cannot fire a second POST for the same row. A ref, not state: it must not re-render.
  const marked = useRef<Set<string>>(new Set());
  const unread = (runs ?? []).filter((r) => r.read_at === null && r.status !== "running");

  useEffect(() => {
    for (const run of unread) {
      if (marked.current.has(run.id)) continue;
      // Added BEFORE the mutate so a re-render mid-flight cannot double-POST, and removed again on
      // failure so a transient error retries on the next change instead of leaving the row unread
      // forever (post-14c review, MED). `mutateAsync` + a per-promise catch, NOT `mutate`'s options:
      // consecutive `mutate` calls on ONE observer drop the earlier call's callbacks (TanStack v5),
      // so with several unread rows only the last row's onError could ever fire (R2 verify).
      marked.current.add(run.id);
      markRead
        .mutateAsync({ runId: run.id, automationId: automation.id })
        .catch(() => marked.current.delete(run.id));
    }
    // Keyed on the unread ids only: re-running on every `runs` identity change would re-enter for
    // rows already in `marked` (harmless, but pointless work on every refetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread.map((r) => r.id).join(","), automation.id]);

  const jump = async (threadId: string) => {
    if (await openThread(threadId)) setUI({ tab: "agent" });
  };

  return (
    <div className={"svc-edit" + (open ? " open" : "")}>
      <div className="svc-edit-head" {...disclosureToggle(open, () => setOpen(!open))}>
        <span>History{runs?.length ? ` · ${runs.length}` : ""}</span>
        <span className="svc-chev" aria-hidden>
          ›
        </span>
      </div>
      {open && (
        <div className="svc-body">
          {runs?.length === 0 && <div className="svc-empty">this automation has not run yet</div>}
          {(runs ?? []).map((run) => (
            <div className="svc-card auto-run" key={run.id}>
              <div className="auto-run-head">
                <span className={chipClass(run.status)}>{RUN_LABEL[run.status]}</span>
                <span className="auto-run-when">
                  {fmtWhen(run.started_at, automation.tz)} · {fmtDuration(run)} · {run.trigger}
                  {run.read_at === null && run.status !== "running" ? " · new" : ""}
                </span>
                {run.thread_id !== null && (
                  <button
                    type="button"
                    className="pm-alt"
                    onClick={() => void jump(run.thread_id as string)}
                  >
                    Open thread ↗
                  </button>
                )}
              </div>
              {run.error && <div className="auto-run-err">{run.error}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The schedule builder: three presets over the ONE stored 5-field cron, plus the raw-cron escape
 *  hatch and the server-computed live preview. */
function ScheduleFields({
  schedule,
  tz,
  serverTz,
  onChange,
}: {
  schedule: string;
  tz: string | null;
  serverTz: string;
  /** Patches the sheet's draft — the schedule and its zone are one setting, and the preview reads
   *  both, so they are edited through one callback rather than two the caller has to keep in step. */
  onChange: (patch: { schedule?: string; tz?: string }) => void;
}) {
  // `kind` is EXPLICIT state, not derived from the cron: a representable expression must still be
  // editable as raw cron if the owner asks for it, which a derived kind could never express.
  const [kind, setKind] = useState<PresetKind>(() => presetOf(schedule)?.kind ?? "custom");
  const [params, setParams] = useState<PresetValue>(() => presetOf(schedule) ?? DEFAULT_PRESET);
  const preview = useSchedulePreview(schedule, tz);
  const representable = presetOf(schedule) !== null;

  const apply = (k: PresetKind, p: PresetValue) => {
    setKind(k);
    setParams(p);
    // Picking `custom` keeps whatever is stored — it is the escape hatch, not a reset.
    if (k !== "custom") onChange({ schedule: presetToCron({ ...p, kind: k }, schedule) });
  };

  return (
    <>
      <label>Schedule</label>
      <Seg<PresetKind>
        label="Schedule"
        current={kind}
        options={[
          { val: "hourly", label: "Hourly" },
          { val: "daily", label: "Daily" },
          { val: "weekly", label: "Weekly" },
          { val: "custom", label: "Cron" },
        ]}
        onPick={(k) => apply(k, params)}
      />

      {kind === "hourly" && (
        <>
          <label htmlFor="auto-minute">At minute</label>
          <input
            id="auto-minute"
            inputMode="numeric"
            value={String(params.minute)}
            // Clamped like `fromTimeValue` does for HH:MM — a typed `99` must not become a cron field
            // the server then refuses; the input is the preset's, so it owns the range.
            onChange={(e) =>
              apply("hourly", {
                ...params,
                minute: Math.max(0, Math.min(59, Number(e.target.value) || 0)),
              })
            }
          />
        </>
      )}
      {(kind === "daily" || kind === "weekly") && (
        <>
          <label htmlFor="auto-time">At</label>
          <input
            id="auto-time"
            type="time"
            value={toTimeValue(params)}
            onChange={(e) => apply(kind, fromTimeValue(e.target.value, params))}
          />
        </>
      )}
      {kind === "weekly" && (
        <>
          <label htmlFor="auto-dow">On</label>
          <select
            id="auto-dow"
            value={String(params.dow)}
            onChange={(e) => apply("weekly", { ...params, dow: Number(e.target.value) })}
          >
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </>
      )}
      {kind === "custom" && (
        <>
          <label htmlFor="auto-cron">Cron</label>
          <input
            id="auto-cron"
            aria-label="cron expression"
            autoComplete="off"
            spellCheck={false}
            placeholder="0 3 * * *"
            value={schedule}
            onChange={(e) => onChange({ schedule: e.target.value })}
          />
        </>
      )}

      {/* The not-representable warning (§D-6): the presets cannot show this expression, so say so
          rather than silently displaying one that means something else. */}
      {!representable && (
        <div className="mform-note">
          {`this expression isn't one of the presets — edit it as cron, or pick a preset to replace it`}
        </div>
      )}

      {/* Live preview — the server's own cronsim, so it can never disagree with what the save
          computes. Advisory: an invalid expression comes back as data, not as a failed request. */}
      {preview.data && !preview.data.valid && <div className="json-err">{preview.data.error}</div>}
      {preview.data?.valid && (
        <div className="mform-note">
          {preview.data.describe} ({preview.data.tz})
          {preview.data.next_fires.length > 0 && (
            <>
              <br />
              next: {preview.data.next_fires.map((f) => fmtWhen(f, preview.data.tz)).join(" · ")}
            </>
          )}
        </div>
      )}
      {!preview.data && !schedule.trim() && (
        <div className="mform-note">a schedule is required (5-field cron)</div>
      )}

      <label htmlFor="auto-tz">Timezone</label>
      <input
        id="auto-tz"
        autoComplete="off"
        spellCheck={false}
        placeholder={`${serverTz} (this server)`}
        value={tz ?? ""}
        // The tz lives on the draft, so the preview above re-runs against it; a blank field means
        // "the server's zone", resolved to a real key at SAVE time (never stored as a null).
        onChange={(e) => onChange({ tz: e.target.value })}
      />
    </>
  );
}

interface SheetProps {
  doc: AutomationsDoc;
  automation: Automation | null; // null = create
  onClose: () => void;
}

/** The editor sheet.
 *
 *  The overlay is the PromptModal shell, so it is already styled under vapor AND every kit theme —
 *  but on its OWN `auto-pm` z-layer (45, under ConfirmDialog's 50): this sheet opens confirm dialogs
 *  (delete, discard-changes), which at the shared 60 would mount behind it. Escape + the Tab cycle are
 *  the shared `modalKeyDown`, scoped to the backdrop (not the document) — a ConfirmDialog on top holds
 *  its own focus, so an Escape aimed at it never reaches this layer at all. */
function AutomationSheet({ doc, automation, onClose }: SheetProps) {
  const labelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [draft, setDraft] = useState<AutomationDraft>(() => draftOf(automation));
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const { data: agentList } = useAgentList();
  const create = useCreateAutomation();
  const update = useUpdateAutomation();
  const remove = useDeleteAutomation();
  const runNow = useRunAutomationNow();

  const set = (patch: Partial<AutomationDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const busy = create.isPending || update.isPending || remove.isPending;
  // The draft as it was SEEDED, serialized once (a `useState` initializer, not a ref — nothing here may
  // read a ref during render). Compared by value, both sides being the same flat shape from `draftOf`,
  // to answer one question: would closing throw work away? A clean sheet must close instantly — a
  // confirm on every dismissal is the prompt everyone learns to click through.
  const [seed] = useState(() => JSON.stringify(draftOf(automation)));
  const dirty = JSON.stringify(draft) !== seed;

  // Capture the opening trigger, focus the name field, restore focus on close (ConfirmDialog's F17
  // shape — the cleanup runs after unmount, so focus lands back on the row that opened this).
  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    queueMicrotask(() => panelRef.current?.querySelector("input")?.focus());
    return () => {
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    };
  }, []);

  /** Close, asking first when there are unsaved edits (known-LOW: the sheet is the only editor here,
   *  so a stray Escape used to discard a half-written prompt silently). Clean → closes immediately. */
  const tryClose = async () => {
    if (!dirty) {
      onClose();
      return;
    }
    const ok = await requestConfirm({
      title: "Discard changes?",
      body: "This automation has unsaved edits.",
      confirmLabel: "discard",
      danger: true,
    });
    if (ok) onClose();
  };

  const save = () => {
    const payload: AutomationDraft = {
      ...draft,
      name: draft.name.trim(),
      tz: draft.tz?.trim() || null,
    };
    if (!payload.name || !payload.schedule.trim() || !payload.prompt.trim()) return;
    if (automation) update.mutate({ id: automation.id, draft: payload }, { onSuccess: onClose });
    else create.mutate(payload, { onSuccess: onClose });
  };

  const onDelete = async () => {
    if (!automation) return;
    const ok = await requestConfirm({
      title: `Delete ${automation.name}?`,
      body: "Removes the automation, its run history, and the threads those runs created.",
      confirmLabel: "delete",
      danger: true,
    });
    if (ok) remove.mutate(automation.id, { onSuccess: onClose });
  };

  const canSave =
    invalid.size === 0 && !!draft.name.trim() && !!draft.schedule.trim() && !!draft.prompt.trim();

  return (
    // `auto-pm` is this sheet's OWN z-index layer (45), under ConfirmDialog's 50 — it opens confirm
    // dialogs (delete, discard-changes) and at PromptModal's shared 60 they would mount BEHIND it.
    // The full ladder is documented beside the rule in extras.css / kit.css.
    <div
      className="pm-backdrop auto-pm"
      // Escape + the Tab cycle are the SHARED `modalKeyDown` (PromptModal's, extracted): scoped to this
      // BACKDROP rather than the document, so a ConfirmDialog opened on top of the sheet consumes its
      // own Escape without this one firing underneath it as well.
      onKeyDown={(e) => modalKeyDown(e, panelRef.current, () => void tryClose())}
    >
      <div className="pm" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <div className="pm-head">
          <h3 id={labelId}>{automation ? automation.name : "New automation"}</h3>
          <button className="pm-x" aria-label="Close" onClick={() => void tryClose()}>
            ✕
          </button>
        </div>
        <div className="pm-body pm-scroll">
          <div className="mconf">
            <div className="mform">
              <label htmlFor="auto-name">Name</label>
              <input
                id="auto-name"
                autoComplete="off"
                placeholder="nightly fleet check"
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
              />

              <label htmlFor="auto-prompt">Prompt</label>
              <textarea
                id="auto-prompt"
                className="kv-text"
                rows={5}
                spellCheck={false}
                placeholder="what the agent should do, unattended"
                value={draft.prompt}
                onChange={(e) => set({ prompt: e.target.value })}
              />

              <ScheduleFields
                schedule={draft.schedule}
                tz={draft.tz}
                serverTz={doc.server_tz}
                onChange={set}
              />

              <label htmlFor="auto-agent">Agent</label>
              <select
                id="auto-agent"
                value={draft.agent ?? ""}
                onChange={(e) => set({ agent: e.target.value || null })}
              >
                <option value="">default ({agentList?.default ?? "—"})</option>
                {(agentList?.agents ?? []).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <div className="mform-note">
                a named agent must still exist when the run starts — a missing one fails the run
                rather than quietly running as the default
              </div>

              <label>Privilege</label>
              <Seg<string>
                label="Privilege"
                current={draft.privilege ?? ""}
                options={[{ val: "", label: "Agent's" }, ...PRIVILEGE_LEVELS]}
                onPick={(v) => set({ privilege: (v || null) as Privilege | null })}
              />

              <label>Questions</label>
              <Seg<AutomationDraft["question_policy"]>
                label="Questions"
                current={draft.question_policy}
                options={[
                  { val: "use_default", label: "Best guess" },
                  { val: "skip", label: "Skip" },
                ]}
                onPick={(v) => set({ question_policy: v })}
              />
              <div className="mform-note">
                what happens when the agent asks YOU something and nobody is there: answer with the
                question's own default (or proceed on best judgement), or skip it. Confirmations are
                not covered by this — those always follow the privilege / approvals ladder.
              </div>

              <label>Results</label>
              <Seg<AutomationDraft["thread_mode"]>
                label="Results"
                current={draft.thread_mode}
                options={[
                  { val: "fresh", label: "New thread" },
                  { val: "rolling", label: "Continuing" },
                ]}
                onPick={(v) => set({ thread_mode: v })}
              />
              <div className="mform-note">
                {draft.thread_mode === "fresh"
                  ? "New thread each run — every run is a throwaway task you can continue in chat."
                  : "One continuing thread — the automation keeps appending, so it accumulates context across runs (chat into it is reserved for the automation)."}
              </div>

              <label htmlFor="auto-timeout">Timeout</label>
              <NumField
                id="auto-timeout"
                value={draft.timeout_s}
                onChange={(v) => set({ timeout_s: v })}
                onValidity={(id, ok) =>
                  setInvalid((prev) => {
                    const next = new Set(prev);
                    if (ok) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                ariaLabel="Timeout in seconds"
                placeholder={`${doc.default_timeout_s} (default)`}
                min={1}
              />
              <div className="mform-note">
                seconds before the run is cancelled — blank uses the server default
              </div>

              <label>Enabled</label>
              <div className="mrow-switch">
                <Switch
                  on={draft.enabled}
                  label="Enabled"
                  onToggle={() => set({ enabled: !draft.enabled })}
                />
                {!doc.enabled && (
                  <span className="mrow-hint">scheduler is off in config — nothing will fire</span>
                )}
              </div>
            </div>

            {automation && <RunHistory automation={automation} />}

            <div className="mfoot">
              {automation ? (
                <>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => void onDelete()}
                  >
                    delete
                  </button>
                  <button
                    type="button"
                    disabled={busy || runNow.isPending || doc.busy}
                    onClick={() => runNow.mutate(automation.id)}
                  >
                    {doc.busy ? "runner busy" : "run now"}
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => void tryClose()}>
                  cancel
                </button>
              )}
              <button type="button" className="save" disabled={busy || !canSave} onClick={save}>
                {busy ? "saving…" : automation ? "save" : "add automation"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The Conf group's body: the list, the add affordance, and the editor sheet. */
export function AutomationsPanel() {
  const { data } = useAutomations();
  //: `null` = closed · `""` = the create sheet · an id = editing that automation. One state, so the
  //: two sheets can never be open at once (they are the same component with a different seed).
  const [editing, setEditing] = useState<string | null>(null);

  // Array-proved like `automationsSummary` (the v1.4.2 release-gate catch): a malformed list payload
  // renders the same placeholder as "still loading" instead of crashing the Conf tab.
  if (!data || !Array.isArray(data.automations)) return <div className="conf-card" />;
  const views = data.automations;
  const current = editing
    ? (views.find((v) => v.automation.id === editing)?.automation ?? null)
    : null;
  // An id that no longer resolves (the row was deleted from another tab) must not open a create sheet.
  const open = editing !== null && (editing === "" || current !== null);
  const full = views.length >= data.max_count;

  return (
    <div className="conf-card">
      {views.map((v) => (
        <div className="mwrap" key={v.automation.id}>
          <AutomationRowView view={v} onOpen={() => setEditing(v.automation.id)} />
        </div>
      ))}

      <div className="mwrap add">
        <div
          className="confrow"
          {...dialogOpener(() => {
            if (!full) setEditing("");
          })}
          aria-disabled={full || undefined}
        >
          <div className="k">
            <div className="label">new automation</div>
            <div className="desc">
              {full
                ? `limit reached (${data.max_count}) — delete one first`
                : `runs the agent on a schedule · ${views.length}/${data.max_count}`}
            </div>
          </div>
          <span className="chev" aria-hidden>
            ›
          </span>
        </div>
      </div>

      {open && <AutomationSheet doc={data} automation={current} onClose={() => setEditing(null)} />}
    </div>
  );
}
