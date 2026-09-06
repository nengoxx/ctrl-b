import { useEffect, useRef, useState } from "react";

import { Seg } from "./Seg";
import { SettingRow } from "./SettingRow";
import { Switch } from "./Switch";
import { useAgentList, pickAgentSection, type AgentSectionCfg } from "../hooks/useAgents";
import { useSaveSettings } from "../hooks/useSettings";
import { numOrKeep } from "../lib/num";
import { useRegisterDirty } from "../store/dirty";

// Conf › Agents — the `agent.*` GLOBALS, and only those (D70 §8.4: "the `agent.defaults` GLOBALS keep
// their Conf home"). The per-agent list, the agent form and the add disclosure moved to the agents
// GALLERY (`tabs/AgentsTab`), which is the one home for agents regardless of kind; nothing about these
// rows moved with them, so this file is the old `AgentsEditor`'s globals half lifted verbatim —
// including its draft-epoch bookkeeping, which is load-bearing (see `pickGlobals`).
//
// Two save postures live here, as they always did: the auto-router controls save IMMEDIATELY (the
// SkillsEditor master-switch idiom) and everything else rides one draft behind the group's save bar.

/** The DRAFT-MANAGED slice of the agent section — the fields the globals save bar owns. The rest of
 *  `AgentSectionCfg` belongs to IMMEDIATE-SAVE controls that read and write the server doc directly
 *  (`auto_rotate` + `auto_rotate_min_overlap` here, `default_title` inside the default agent's form),
 *  so their echoes are not evidence that "the server moved" for this draft. v1.3.1: without that
 *  split, flipping auto-route echoed a changed `cfg` and the reseed below threw away unsaved
 *  globals/compaction edits. One projection feeds BOTH the reseed guard and `globalsDirty`, so the
 *  two can't drift apart — and it is exactly the field set `saveGlobals` submits. */
function pickGlobals(c: AgentSectionCfg) {
  return {
    default_agent: c.default_agent,
    global_subagent_limit: c.global_subagent_limit,
    subagent_clamp_privilege: c.subagent_clamp_privilege,
    streaming: c.streaming,
    compaction: c.compaction,
  };
}

export function AgentGlobals(props: { cfg: AgentSectionCfg }) {
  const { data: list } = useAgentList();
  const saveSettings = useSaveSettings();
  // v1.3.1 Codex verify round — the globals save gets its OWN mutation instance: a second `mutate()`
  // on a shared instance DETACHES the first call's observer (TanStack mutationObserver semantics — the
  // same class as ConfTab's I1 savingRef lesson), so an immediate-save toggle (auto-route, min-overlap)
  // fired during a pending globals save silently killed the per-call epoch reconcile below. A separate
  // instance keeps the two concerns' observers independent; the ref guards globals-on-globals re-entry
  // at call time (isPending is a rendered value — stale in the same tick, the I1 lesson verbatim).
  const saveGlobalsMut = useSaveSettings();
  const savingGlobalsRef = useRef(false);
  const specialists = list?.agents ?? [];

  const [cfg, setCfg] = useState<AgentSectionCfg>(props.cfg);

  // Codex FIX B — ConfTab rebuilds `agentCfg` fresh every render, so a reference-only prop change
  // (any unrelated parent re-render) must NOT clobber unsaved global/compaction edits. Reseed only
  // when the incoming cfg VALUE genuinely differs from the last-seeded one (JSON compare is cheap at
  // this size). This is the minimal guard; the wider ConfTab draft-lifecycle refactor is deferred.
  // v1.3.1 — the compare is over the DRAFT-MANAGED projection only (see `pickGlobals`): the
  // immediate-save controls in this same card write straight to the server, and their echo arrives as
  // a genuinely changed `props.cfg`, which reseeded the draft and dropped whatever was unsaved
  // ("edit compaction, flip auto-route, the compaction edit vanishes").
  // v1.3.1 (Codex review) — DRAFT EPOCH, exactly as ConfTab's (its `seededRef` + per-call onSuccess).
  // `seededRef` is the projection the local draft was last seeded from; the doc is adopted ONLY while
  // the draft is CLEAN against that seed. A dirty draft keeps its edits AND its epoch — including when
  // the changed prop is the echo of the user's OWN save, which previously reseeded over whatever was
  // typed while the save was in flight. `saveGlobals` reconciles that echo explicitly (below).
  const seededRef = useRef(JSON.stringify(pickGlobals(props.cfg)));
  useEffect(() => {
    const next = JSON.stringify(pickGlobals(props.cfg));
    if (next === seededRef.current) return;
    setCfg((c) => {
      if (JSON.stringify(pickGlobals(c)) !== seededRef.current) return c; // dirty → keep draft + epoch
      seededRef.current = next; // clean → adopt the fresh doc as the new epoch
      return props.cfg;
    });
  }, [props.cfg]);

  // Auto-router controls (7e-g) save immediately (mirrors the SkillsEditor master switch), so they
  // read straight off the server doc (props.cfg) rather than the savebar draft. The min-overlap
  // input keeps a local draft and commits on blur to avoid a save per keystroke.
  const [minOverlap, setMinOverlap] = useState(String(props.cfg.auto_rotate_min_overlap));
  useEffect(
    () => setMinOverlap(String(props.cfg.auto_rotate_min_overlap)),
    [props.cfg.auto_rotate_min_overlap],
  );
  const commitMinOverlap = () => {
    const n = Math.max(1, Number(minOverlap) || 1);
    if (n !== props.cfg.auto_rotate_min_overlap)
      saveSettings.mutate({ agent: { auto_rotate_min_overlap: n } });
    else setMinOverlap(String(props.cfg.auto_rotate_min_overlap)); // normalize a junk entry back
  };

  // Globals (default-agent picker + subagent limits) — config.yaml, saved via PUT /api/settings.
  // `default_title` is edited inside the default agent's form, so it's excluded from this draft.
  const globalsDirty = JSON.stringify(pickGlobals(cfg)) !== JSON.stringify(pickGlobals(props.cfg));
  useRegisterDirty("agents-globals", globalsDirty);

  const setCompaction = (p: Partial<AgentSectionCfg["compaction"]>) =>
    setCfg((c) => ({ ...c, compaction: { ...c.compaction, ...p } }));

  // D60 `clear_exclude_tools` — the ONE list field in this card. The draft carries the RAW text while
  // the owner types (round-tripping through `join(", ")` on every keystroke would eat a separator the
  // moment it's typed — ConfTab's watched-device precedent) while the parsed list rides the ordinary
  // `cfg` draft, so dirtiness and the savebar work exactly as for every other knob. Reseeded from the
  // doc whenever the saved list moves.
  const [excludeText, setExcludeText] = useState(cfg.compaction.clear_exclude_tools.join(", "));
  // Keyed on the JOINED string, never the array: ConfTab rebuilds `agentCfg` fresh every render, so an
  // array-reference dep would reseed on any unrelated parent re-render and eat the separator the owner
  // just typed (the same class Codex FIX B closed for the draft as a whole).
  const seededExclude = props.cfg.compaction.clear_exclude_tools.join(", ");
  useEffect(() => setExcludeText(seededExclude), [seededExclude]);
  const commitExclude = (text: string) => {
    setExcludeText(text);
    setCompaction({ clear_exclude_tools: text.split(/[\s,]+/).filter(Boolean) });
  };

  const saveGlobals = () => {
    if (!globalsDirty || savingGlobalsRef.current) return;
    savingGlobalsRef.current = true;
    // What we are actually submitting — the reconcile below compares against THIS, not against whatever
    // the draft looks like when the response lands (ConfTab's onSave pattern / D48 B5).
    const submittedGlobalsJson = JSON.stringify(pickGlobals(cfg));
    saveGlobalsMut.mutate(
      {
        agent: {
          default_agent: cfg.default_agent,
          global_subagent_limit: cfg.global_subagent_limit,
          subagent_clamp_privilege: cfg.subagent_clamp_privilege,
          streaming: cfg.streaming,
          // D42 — only the four surfaced compaction knobs; a partial PUT deep-merges so the YAML-only
          // fields (clear_keep_steps, summarizer, reserve_output, …) round-trip untouched. threshold_frac
          // is clamped to the schema bounds (0.5–0.95) at commit — the field's ge/le guard is the backstop.
          compaction: {
            enabled: cfg.compaction.enabled,
            threshold_frac: Math.min(0.95, Math.max(0.5, cfg.compaction.threshold_frac)),
            keep_recent_tokens: cfg.compaction.keep_recent_tokens,
            clear_output_min_tokens: cfg.compaction.clear_output_min_tokens,
            // D60 — the clearing gate. `clear_trigger_pct` is clamped to its schema range (0 < x ≤ 1)
            // at commit, like threshold_frac; the field's gt/le guard is the backstop.
            clear_trigger_pct: Math.min(1, Math.max(0.01, cfg.compaction.clear_trigger_pct)),
            clear_min_reclaim_tokens: cfg.compaction.clear_min_reclaim_tokens,
            clear_exclude_tools: cfg.compaction.clear_exclude_tools,
          },
        },
      },
      {
        onSuccess: (res) => {
          // The PUT echo is the new epoch: the same doc that lands as `props.cfg` one render later (the
          // mutation's own onSuccess writes it into the ["settings"] cache), projected through the SAME
          // function ConfTab uses — so the reseed effect above then sees `next === seededRef.current`
          // and no second adoption happens. The seed advances here exactly once, and never backwards.
          const echo = pickAgentSection(res.settings.agent as Partial<AgentSectionCfg> | undefined);
          seededRef.current = JSON.stringify(pickGlobals(echo));
          // …but the draft is only REPLACED when it is still what we sent. On a slow link the owner can
          // keep editing while the save is in flight; adopting the echo over that silently throws those
          // edits away. Keeping them leaves the draft dirty against the new epoch — the bar says
          // "Save agent settings" again, which is the truth.
          setCfg((c) => (JSON.stringify(pickGlobals(c)) === submittedGlobalsJson ? echo : c));
        },
        onSettled: () => {
          savingGlobalsRef.current = false;
        },
      },
    );
  };

  const defaultOpts = [
    { val: "", label: "default (root)" },
    ...specialists.map((s) => ({ val: s, label: s })),
  ];

  return (
    <div className="conf-card">
      <SettingRow
        label="Auto-route to specialists"
        desc="when no /agent is pinned, pick the best-matching specialist per turn"
      >
        <Switch
          on={props.cfg.auto_rotate}
          label="Auto-route to specialists"
          onToggle={() => saveSettings.mutate({ agent: { auto_rotate: !props.cfg.auto_rotate } })}
        />
      </SettingRow>
      {/* The threshold is only meaningful while auto-route is on — show it as its own labelled sub-row
          (like Memory's State-cap), not crammed next to the toggle, so the numeric field aligns with the
          other right-edge inputs. */}
      {props.cfg.auto_rotate && (
        <div className="confrow">
          <div className="k">
            <div className="label">Min matching words</div>
            <div className="desc">
              query words a specialist must match before a turn routes to it
            </div>
          </div>
          <input
            className="lim-input"
            inputMode="numeric"
            aria-label="min matching words to route"
            value={minOverlap}
            onChange={(e) => setMinOverlap(e.target.value)}
            onBlur={commitMinOverlap}
          />
        </div>
      )}

      <div className="confrow" style={{ marginTop: 6 }}>
        <div className="k">
          <div className="label">Default agent</div>
          <div className="desc">which agent new threads use · /agent switches per session</div>
        </div>
        <Seg<string>
          label="Default agent"
          current={cfg.default_agent}
          onPick={(v) => setCfg({ ...cfg, default_agent: v })}
          options={defaultOpts}
        />
      </div>
      <div className="confrow">
        <div className="k">
          <div className="label">Subagent fan-out limit</div>
          <div className="desc">process-wide cap on concurrent subagents (whole tree)</div>
        </div>
        <input
          className="lim-input"
          inputMode="numeric"
          aria-label="Subagent fan-out limit"
          value={String(cfg.global_subagent_limit)}
          onChange={(e) => setCfg({ ...cfg, global_subagent_limit: Number(e.target.value) || 0 })}
        />
      </div>
      <SettingRow
        label="Clamp subagent privilege"
        desc="a subagent can never exceed its parent's privilege"
      >
        <Switch
          on={cfg.subagent_clamp_privilege}
          label="Clamp subagent privilege"
          onToggle={() =>
            setCfg({ ...cfg, subagent_clamp_privilege: !cfg.subagent_clamp_privilege })
          }
        />
      </SettingRow>
      <SettingRow
        label="Chat delivery"
        desc="auto = client decides · on = always stream · off = buffer whole reply (flaky link)"
      >
        <Seg<"auto" | "on" | "off">
          label="Chat delivery"
          current={cfg.streaming}
          onPick={(v) => setCfg({ ...cfg, streaming: v })}
          options={[
            { val: "auto", label: "Auto" },
            { val: "on", label: "Stream" },
            { val: "off", label: "Buffer" },
          ]}
        />
      </SettingRow>

      {/* D42 — GLOBAL compaction defaults (per-agent overrides stay YAML-only). The threshold is a
          percent of the context window (stored as a fraction); the two token knobs feed the keep-recent
          floor + the tool-output trim tier. Saved with the other globals via the bar below. */}
      <SettingRow
        label="Auto-compact"
        desc="fold older turns into a summary as the context window fills"
      >
        <Switch
          on={cfg.compaction.enabled}
          label="Auto-compact"
          onToggle={() => setCompaction({ enabled: !cfg.compaction.enabled })}
        />
      </SettingRow>
      <div className="confrow">
        <div className="k">
          <div className="label">Compaction thresholds</div>
          <div className="desc">
            % of window to compact at (50–95) · recent tokens kept · trim floor
          </div>
        </div>
      </div>
      <div className="agent-lim agent-lim-inset">
        <div className="agent-lim-cell">
          <span>compact at %</span>
          <input
            aria-label="Compact at % of context"
            inputMode="numeric"
            value={String(Math.round(cfg.compaction.threshold_frac * 100))}
            onChange={(e) => setCompaction({ threshold_frac: (Number(e.target.value) || 0) / 100 })}
          />
        </div>
        <div className="agent-lim-cell">
          <span>keep recent</span>
          <input
            aria-label="Keep recent (tokens)"
            inputMode="numeric"
            value={String(cfg.compaction.keep_recent_tokens)}
            onChange={(e) =>
              setCompaction({
                keep_recent_tokens: numOrKeep(e.target.value, cfg.compaction.keep_recent_tokens),
              })
            }
          />
        </div>
        <div className="agent-lim-cell">
          <span>trim floor</span>
          <input
            aria-label="Tool output trim floor (tokens)"
            inputMode="numeric"
            value={String(cfg.compaction.clear_output_min_tokens)}
            onChange={(e) =>
              setCompaction({
                clear_output_min_tokens: numOrKeep(
                  e.target.value,
                  cfg.compaction.clear_output_min_tokens,
                ),
              })
            }
          />
        </div>
      </div>

      {/* D60 — the Tier-1 clearing gate: trimming old tool outputs only starts once the prompt
          passes a fraction of the serving chain's SMALLEST context window, never reclaims less than
          the floor, and never touches these tools' results (or anything the current turn produced). */}
      <div className="confrow">
        <div className="k">
          <div className="label">Tool-output clearing</div>
          <div className="desc">
            clear above % of window · min tokens reclaimed · tools never cleared (the current turn
            is never cleared) · a per-tool call cap lives in YAML as
            tool_overrides.&lt;tool&gt;.max_calls
          </div>
        </div>
      </div>
      <div className="agent-lim agent-lim-inset">
        <div className="agent-lim-cell">
          <span>clear above %</span>
          <input
            aria-label="Clear tool outputs above % of context"
            inputMode="numeric"
            value={String(Math.round(cfg.compaction.clear_trigger_pct * 100))}
            onChange={(e) =>
              setCompaction({ clear_trigger_pct: (Number(e.target.value) || 0) / 100 })
            }
          />
        </div>
        <div className="agent-lim-cell">
          <span>min reclaim</span>
          <input
            aria-label="Minimum tokens reclaimed by a trim"
            inputMode="numeric"
            value={String(cfg.compaction.clear_min_reclaim_tokens)}
            onChange={(e) =>
              setCompaction({
                clear_min_reclaim_tokens: numOrKeep(
                  e.target.value,
                  cfg.compaction.clear_min_reclaim_tokens,
                ),
              })
            }
          />
        </div>
      </div>
      <div className="confrow">
        <div className="k">
          <div className="label">Never clear</div>
          <div className="desc">comma-separated tool names</div>
        </div>
        <input
          aria-label="Tools never cleared"
          autoComplete="off"
          value={excludeText}
          onChange={(e) => commitExclude(e.target.value)}
        />
      </div>

      <div className="conf-savebar">
        <button
          className="conf-save"
          disabled={!globalsDirty || saveGlobalsMut.isPending}
          onClick={saveGlobals}
        >
          {saveGlobalsMut.isPending ? "Saving…" : globalsDirty ? "Save agent settings" : "Saved"}
        </button>
      </div>
    </div>
  );
}
