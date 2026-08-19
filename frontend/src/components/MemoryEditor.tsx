import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { SettingRow } from "./SettingRow";
import { Switch } from "./Switch";
import { useAgentList } from "../hooks/useAgents";
import { disclosureToggle } from "../lib/disclosure";
import {
  agentSlot,
  stateSlot,
  useCoreMemoryStatus,
  useMemoryContent,
  useSaveMemory,
  userSlot,
  type LongTermCfg,
  type MemoryCfg,
  type MemorySlot,
} from "../hooks/useMemory";
import { useSaveSettings } from "../hooks/useSettings";
import { requestConfirm } from "../store/confirm";
import { useRegisterDirty } from "../store/dirty";
import { requestPrompt } from "../store/prompt";

// Phase 7e-d-3 — Conf Memory panel. Toggles (enabled / user profile / auto-write) direct-mutate the
// `memory.*` settings (mirrors the Skills master switch); the two caps ride a small local draft +
// Save. Below them, one editable row per memory file — the global USER.md + each agent's MEMORY.md
// (default + specialists) — edited raw in the shared `.kv-text.skill-md` recipe (blank → clears).
// Net-new pixels live in themes/vapor/extras.css; vapor.css untouched (D7).

/** The Core Memory disclosure's key in the shared `openKey` accordion — a reserved id no memory-file
 *  slot can mint (slots are `user` / `agent:<slug>` / `state:<slug>`). */
const CORE_KEY = "core-memory";

/** The raw MEMORY.md / USER.md editor for one (open) slot — fetches lazily, edits, saves, clears. */
function MemoryFileEditor({ slot }: { slot: MemorySlot }) {
  const { data, isLoading } = useMemoryContent(slot);
  const save = useSaveMemory();
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (data) setText(data.content);
  }, [data]);

  const dirty = data != null && text != null && text !== data.content;
  useRegisterDirty(`memory:${slot.key}`, dirty);

  const onClear = async () => {
    const ok = await requestConfirm({
      title: `Clear ${slot.label} memory?`,
      body: "Removes this file's contents.",
      confirmLabel: "clear",
      danger: true,
    });
    if (ok) save.mutate({ slot, content: "" }, { onSuccess: () => setText("") });
  };

  if (isLoading || text == null) return <div className="agent-empty">loading…</div>;
  const len = text.length;
  const pct = slot.cap > 0 ? Math.round((100 * len) / slot.cap) : 0;
  const over = len > slot.cap;
  return (
    <>
      <div className="mem-md-bar">
        <span className={"mem-count" + (over ? " over" : "")}>
          {len.toLocaleString()}/{slot.cap.toLocaleString()} · {pct}%
        </span>
        <button
          type="button"
          className="prompt-open"
          onClick={async () => {
            const next = await requestPrompt({
              title: `Memory: ${slot.label}`,
              value: text,
              placeholder: "durable notes — markdown",
            });
            if (next != null) setText(next);
          }}
        >
          Open fullscreen ↗
        </button>
      </div>
      <textarea
        aria-label={`${slot.label} memory`}
        className="kv-text skill-md"
        value={text}
        spellCheck={false}
        placeholder="(empty — nothing injected for this store)"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mfoot">
        <button
          type="button"
          className="danger"
          disabled={save.isPending || !text.trim()}
          onClick={onClear}
        >
          clear
        </button>
        <button
          type="button"
          className="save"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ slot, content: text })}
        >
          {save.isPending ? "saving…" : "save"}
        </button>
      </div>
    </>
  );
}

/** The tier-2 (Core Memory) disclosure body, D57 §6.1 (+ D60's min recall charge) — the enable
 *  switch, the six tunables it is
 *  allowed to edit, and the read-only scan status. Mounted only while the row is open, so the status
 *  endpoint is hit when the owner actually looks. */
function CoreMemoryPanel({ cfg }: { cfg: LongTermCfg }) {
  const qc = useQueryClient();
  const saveSettings = useSaveSettings();
  const { data: status } = useCoreMemoryStatus(true);
  const core = cfg.core;

  // Same shape as the tier-1 caps above: numeric text in a local draft, coerced on save, reseeded
  // whenever the server doc moves.
  const [root, setRoot] = useState(core.root);
  const [indexCap, setIndexCap] = useState(String(core.index_char_limit));
  const [topicCap, setTopicCap] = useState(String(core.topic_char_limit));
  const [recallCap, setRecallCap] = useState(String(core.recall_char_limit));
  const [minCharge, setMinCharge] = useState(String(core.recall_min_charge_chars));
  const [nudgePct, setNudgePct] = useState(String(core.consolidation_nudge_pct));
  useEffect(() => {
    setRoot(core.root);
    setIndexCap(String(core.index_char_limit));
    setTopicCap(String(core.topic_char_limit));
    setRecallCap(String(core.recall_char_limit));
    setMinCharge(String(core.recall_min_charge_chars));
    setNudgePct(String(core.consolidation_nudge_pct));
  }, [
    core.root,
    core.index_char_limit,
    core.topic_char_limit,
    core.recall_char_limit,
    core.recall_min_charge_chars,
    core.consolidation_nudge_pct,
  ]);
  const dirty =
    root !== core.root ||
    indexCap !== String(core.index_char_limit) ||
    topicCap !== String(core.topic_char_limit) ||
    recallCap !== String(core.recall_char_limit) ||
    minCharge !== String(core.recall_min_charge_chars) ||
    nudgePct !== String(core.consolidation_nudge_pct);
  useRegisterDirty("memory:core", dirty);

  // Nested patches ride the ordinary settings PUT, which deep-merges — so sending only the leaves
  // that moved never disturbs the rest of `memory.longterm`. The status below is a projection of
  // these settings OVER THE FILES (the caps bound the rendered index; the switch gates it), so it is
  // re-read after every save — the one place a stale line would misreport what the agent now sees.
  const setLongterm = (patch: Record<string, unknown>) =>
    saveSettings.mutate(
      { memory: { longterm: patch } },
      { onSuccess: () => void qc.invalidateQueries({ queryKey: ["core-memory-status"] }) },
    );
  const on = cfg.backend === "core";

  return (
    <>
      <div className="mem-md-bar">
        <span className="mem-count">
          {status
            ? `${status.topics} topic${status.topics === 1 ? "" : "s"} · ${status.skipped} skipped · ${status.anomalies.length} anomal${status.anomalies.length === 1 ? "y" : "ies"}`
            : "scanning…"}
        </span>
        {/* The anomaly LIST is a tooltip, not a rendered block: a copied-in corpus can carry dozens
            of dangling links, and the count is what the owner acts on. */}
        <span className="mem-count" title={status?.anomalies.join("\n") || undefined}>
          {status ? `index ${status.index_pct}% · ${status.root ?? "root refused"}` : ""}
        </span>
      </div>
      <div className="mform">
        <label>Enabled</label>
        <div className="mrow-switch">
          <Switch
            on={on}
            label="Core Memory enabled"
            onToggle={() => setLongterm({ backend: on ? null : "core" })}
          />
          <span className="mrow-hint">tier 2 · index each turn + a read/curate tool</span>
        </div>

        <label>Corpus root</label>
        <input
          aria-label="Corpus root"
          autoComplete="off"
          value={root}
          placeholder="core"
          onChange={(e) => setRoot(e.target.value)}
        />

        <label>Index cap</label>
        <input
          aria-label="Index cap"
          type="text"
          inputMode="numeric"
          value={indexCap}
          onChange={(e) => setIndexCap(e.target.value)}
        />

        <label>Topic cap</label>
        <input
          aria-label="Topic cap"
          type="text"
          inputMode="numeric"
          value={topicCap}
          onChange={(e) => setTopicCap(e.target.value)}
        />

        <label>Recall cap</label>
        <input
          aria-label="Recall cap"
          type="text"
          inputMode="numeric"
          value={recallCap}
          onChange={(e) => setRecallCap(e.target.value)}
        />

        {/* D60 §15b-3 — reads no longer count against `max_calls_per_tool`, so the recall budget is
            their only bound: every read/search charges at least this much, whatever it returns. */}
        <label>Min recall charge</label>
        <input
          aria-label="Minimum recall charge"
          type="text"
          inputMode="numeric"
          value={minCharge}
          onChange={(e) => setMinCharge(e.target.value)}
        />

        <label>Nudge threshold</label>
        <input
          aria-label="Core Memory nudge threshold"
          type="text"
          inputMode="numeric"
          value={nudgePct}
          onChange={(e) => setNudgePct(e.target.value)}
        />
      </div>
      <div className="mfoot">
        <button
          type="button"
          className="save"
          disabled={!dirty || saveSettings.isPending}
          onClick={() =>
            setLongterm({
              core: {
                root,
                index_char_limit: Number(indexCap),
                topic_char_limit: Number(topicCap),
                recall_char_limit: Number(recallCap),
                recall_min_charge_chars: Number(minCharge),
                consolidation_nudge_pct: Number(nudgePct),
              },
            })
          }
        >
          {saveSettings.isPending ? "saving…" : "save"}
        </button>
      </div>
    </>
  );
}

export function MemoryEditor({ cfg }: { cfg: MemoryCfg }) {
  const saveSettings = useSaveSettings();
  const qc = useQueryClient();
  const { data: agentList } = useAgentList();
  const [openKey, setOpenKey] = useState<string | null>(null);

  // Numeric settings ride a small local draft (numeric text → coerced on save), reseeded from the cfg.
  const [memCap, setMemCap] = useState(String(cfg.memory_char_limit));
  const [userCap, setUserCap] = useState(String(cfg.user_char_limit));
  const [nudgePct, setNudgePct] = useState(String(cfg.consolidation_nudge_pct));
  const [stateCap, setStateCap] = useState(String(cfg.state_char_limit));
  const [reflectN, setReflectN] = useState(String(cfg.reflection_interval));
  useEffect(() => {
    setMemCap(String(cfg.memory_char_limit));
    setUserCap(String(cfg.user_char_limit));
    setNudgePct(String(cfg.consolidation_nudge_pct));
    setStateCap(String(cfg.state_char_limit));
    setReflectN(String(cfg.reflection_interval));
  }, [
    cfg.memory_char_limit,
    cfg.user_char_limit,
    cfg.consolidation_nudge_pct,
    cfg.state_char_limit,
    cfg.reflection_interval,
  ]);
  const capsDirty =
    memCap !== String(cfg.memory_char_limit) ||
    userCap !== String(cfg.user_char_limit) ||
    nudgePct !== String(cfg.consolidation_nudge_pct) ||
    stateCap !== String(cfg.state_char_limit) ||
    reflectN !== String(cfg.reflection_interval);
  useRegisterDirty("memory:caps", capsDirty);

  const setCfg = (patch: Partial<MemoryCfg>) =>
    saveSettings.mutate(
      { memory: patch },
      // The master switch sits inside `core_memory_on()`, so the tier-2 status line must re-read
      // after it flips too — an open Core disclosure would otherwise keep the old fill (S4 review).
      "enabled" in patch
        ? { onSuccess: () => void qc.invalidateQueries({ queryKey: ["core-memory-status"] }) }
        : undefined,
    );

  const defaultSlug = agentList?.default ?? "default";
  const specialists = agentList?.agents ?? [];
  const slots: MemorySlot[] = [
    userSlot(cfg.user_char_limit),
    agentSlot(defaultSlug, true, cfg.memory_char_limit),
    ...specialists.map((s) => agentSlot(s, false, cfg.memory_char_limit)),
    // Emotional-state files (D27-B) — one per agent, only when the store is enabled.
    ...(cfg.state_enabled
      ? [
          stateSlot(defaultSlug, true, cfg.state_char_limit),
          ...specialists.map((s) => stateSlot(s, false, cfg.state_char_limit)),
        ]
      : []),
  ];

  return (
    <div className="conf-card">
      <SettingRow label="Enabled" desc="master switch · inject saved notes each turn">
        <Switch
          on={cfg.enabled}
          onToggle={() => setCfg({ enabled: !cfg.enabled })}
          label="Memory enabled"
        />
      </SettingRow>
      <SettingRow label="User profile" desc="inject + allow writes to the global USER.md">
        <Switch
          on={cfg.user_profile_enabled}
          label="User profile"
          onToggle={() => setCfg({ user_profile_enabled: !cfg.user_profile_enabled })}
        />
      </SettingRow>
      <SettingRow label="Auto-write" desc="agent may save memory itself · off → propose only">
        <Switch
          on={cfg.auto_write}
          onToggle={() => setCfg({ auto_write: !cfg.auto_write })}
          label="Auto-write"
        />
      </SettingRow>
      <SettingRow
        label="Consolidation nudge"
        desc="near cap → tell the agent to consolidate before adding"
      >
        <Switch
          on={cfg.consolidation_nudge}
          label="Consolidation nudge"
          onToggle={() => setCfg({ consolidation_nudge: !cfg.consolidation_nudge })}
        />
      </SettingRow>
      <SettingRow
        label="Emotional state"
        desc="inject + let the agent rewrite a per-agent STATE.md (mood/energy)"
      >
        <Switch
          on={cfg.state_enabled}
          label="Emotional state"
          onToggle={() => setCfg({ state_enabled: !cfg.state_enabled })}
        />
      </SettingRow>
      <SettingRow
        label="Periodic reflection"
        desc="every N turns → nudge the agent to save anything worth remembering"
      >
        <Switch
          on={cfg.reflection_enabled}
          label="Periodic reflection"
          onToggle={() => setCfg({ reflection_enabled: !cfg.reflection_enabled })}
        />
      </SettingRow>

      <div className="confrow">
        <div className="k">
          <div className="label">Agent cap</div>
          <div className="desc">per-agent MEMORY.md char limit</div>
        </div>
        <input
          aria-label="Agent cap"
          type="text"
          value={memCap}
          inputMode="numeric"
          onChange={(e) => setMemCap(e.target.value)}
        />
      </div>
      <div className="confrow">
        <div className="k">
          <div className="label">User cap</div>
          <div className="desc">global USER.md char limit</div>
        </div>
        <input
          aria-label="User cap"
          type="text"
          value={userCap}
          inputMode="numeric"
          onChange={(e) => setUserCap(e.target.value)}
        />
      </div>
      <div className="confrow">
        <div className="k">
          <div className="label">Nudge threshold</div>
          <div className="desc">store % full that triggers the nudge (1–100)</div>
        </div>
        <input
          aria-label="Nudge threshold"
          type="text"
          value={nudgePct}
          inputMode="numeric"
          onChange={(e) => setNudgePct(e.target.value)}
        />
      </div>
      {cfg.state_enabled && (
        <div className="confrow">
          <div className="k">
            <div className="label">State cap</div>
            <div className="desc">per-agent STATE.md char limit</div>
          </div>
          <input
            aria-label="State cap"
            type="text"
            value={stateCap}
            inputMode="numeric"
            onChange={(e) => setStateCap(e.target.value)}
          />
        </div>
      )}
      {cfg.reflection_enabled && (
        <div className="confrow">
          <div className="k">
            <div className="label">Reflection interval</div>
            <div className="desc">user turns between reflection nudges (≥1)</div>
          </div>
          <input
            aria-label="Reflection interval"
            type="text"
            value={reflectN}
            inputMode="numeric"
            onChange={(e) => setReflectN(e.target.value)}
          />
        </div>
      )}
      <div className="conf-savebar">
        <button
          className="conf-save"
          disabled={!capsDirty || saveSettings.isPending}
          onClick={() =>
            setCfg({
              memory_char_limit: Number(memCap),
              user_char_limit: Number(userCap),
              consolidation_nudge_pct: Number(nudgePct),
              state_char_limit: Number(stateCap),
              reflection_interval: Number(reflectN),
            })
          }
        >
          {saveSettings.isPending ? "Saving…" : capsDirty ? "Save" : "Saved"}
        </button>
      </div>

      {/* D57 — tier 2. One disclosure so the tier-1 panel above reads unchanged: this is a separate
          lane (a shared topic corpus, not another store), and its own switch lives inside it. */}
      <div className={"mwrap" + (openKey === CORE_KEY ? " open" : "")}>
        <div
          className="confrow"
          {...disclosureToggle(openKey === CORE_KEY, () =>
            setOpenKey(openKey === CORE_KEY ? null : CORE_KEY),
          )}
        >
          <div className="k">
            <div className="label">Core Memory (long-term)</div>
            <div className="desc">
              {cfg.longterm.backend === "core" ? "on" : "off"} · shared topic corpus, read on demand
            </div>
          </div>
          <span className="chev" aria-hidden>
            ›
          </span>
        </div>
        <div className="mconf">
          {openKey === CORE_KEY && <CoreMemoryPanel cfg={cfg.longterm} />}
        </div>
      </div>

      {slots.map((slot) => (
        <div className={"mwrap" + (openKey === slot.key ? " open" : "")} key={slot.key}>
          <div
            className="confrow"
            {...disclosureToggle(openKey === slot.key, () =>
              setOpenKey(openKey === slot.key ? null : slot.key),
            )}
          >
            <div className="k">
              <div className="label">{slot.label}</div>
              <div className="desc">{slot.sublabel}</div>
            </div>
            <span className="chev" aria-hidden>
              ›
            </span>
          </div>
          <div className="mconf">{openKey === slot.key && <MemoryFileEditor slot={slot} />}</div>
        </div>
      ))}
    </div>
  );
}
