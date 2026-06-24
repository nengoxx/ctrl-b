import { useEffect, useState } from "react";

import { Switch } from "./Switch";
import { useAgentList } from "../hooks/useAgents";
import {
  agentSlot,
  useMemoryContent,
  useSaveMemory,
  userSlot,
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
// Net-new pixels live in theme/extras.css; vapor.css untouched (D7).

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
        className="kv-text skill-md"
        value={text}
        spellCheck={false}
        placeholder="(empty — nothing injected for this store)"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mfoot">
        <button type="button" className="danger" disabled={save.isPending || !text.trim()} onClick={onClear}>
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

export function MemoryEditor({ cfg }: { cfg: MemoryCfg }) {
  const saveSettings = useSaveSettings();
  const { data: agentList } = useAgentList();
  const [openKey, setOpenKey] = useState<string | null>(null);

  // Caps ride a small local draft (numeric text → coerced on save), reseeded from the saved cfg.
  const [memCap, setMemCap] = useState(String(cfg.memory_char_limit));
  const [userCap, setUserCap] = useState(String(cfg.user_char_limit));
  useEffect(() => {
    setMemCap(String(cfg.memory_char_limit));
    setUserCap(String(cfg.user_char_limit));
  }, [cfg.memory_char_limit, cfg.user_char_limit]);
  const capsDirty = memCap !== String(cfg.memory_char_limit) || userCap !== String(cfg.user_char_limit);
  useRegisterDirty("memory:caps", capsDirty);

  const setCfg = (patch: Partial<MemoryCfg>) => saveSettings.mutate({ memory: patch });

  const defaultSlug = agentList?.default ?? "default";
  const slots: MemorySlot[] = [
    userSlot(cfg.user_char_limit),
    agentSlot(defaultSlug, true, cfg.memory_char_limit),
    ...(agentList?.agents ?? []).map((s) => agentSlot(s, false, cfg.memory_char_limit)),
  ];

  return (
    <div className="conf-card">
      <div className="confrow">
        <div className="k">
          <div className="label">Enabled</div>
          <div className="desc">master switch · inject saved notes each turn</div>
        </div>
        <Switch on={cfg.enabled} onToggle={() => setCfg({ enabled: !cfg.enabled })} />
      </div>
      <div className="confrow">
        <div className="k">
          <div className="label">User profile</div>
          <div className="desc">inject + allow writes to the global USER.md</div>
        </div>
        <Switch on={cfg.user_profile_enabled} onToggle={() => setCfg({ user_profile_enabled: !cfg.user_profile_enabled })} />
      </div>
      <div className="confrow">
        <div className="k">
          <div className="label">Auto-write</div>
          <div className="desc">agent may save memory itself · off → propose only</div>
        </div>
        <Switch on={cfg.auto_write} onToggle={() => setCfg({ auto_write: !cfg.auto_write })} />
      </div>

      <div className="confrow">
        <div className="k">
          <div className="label">Agent cap</div>
          <div className="desc">per-agent MEMORY.md char limit</div>
        </div>
        <input type="text" value={memCap} inputMode="numeric" onChange={(e) => setMemCap(e.target.value)} />
      </div>
      <div className="confrow">
        <div className="k">
          <div className="label">User cap</div>
          <div className="desc">global USER.md char limit</div>
        </div>
        <input type="text" value={userCap} inputMode="numeric" onChange={(e) => setUserCap(e.target.value)} />
      </div>
      <div className="conf-savebar">
        <button
          className="conf-save"
          disabled={!capsDirty || saveSettings.isPending}
          onClick={() => setCfg({ memory_char_limit: Number(memCap), user_char_limit: Number(userCap) })}
        >
          {saveSettings.isPending ? "Saving…" : capsDirty ? "Save caps" : "Saved"}
        </button>
      </div>

      {slots.map((slot) => (
        <div className={"mwrap" + (openKey === slot.key ? " open" : "")} key={slot.key}>
          <div className="confrow" onClick={() => setOpenKey(openKey === slot.key ? null : slot.key)}>
            <div className="k">
              <div className="label">{slot.label}</div>
              <div className="desc">{slot.sublabel}</div>
            </div>
            <span className="chev" aria-hidden>›</span>
          </div>
          <div className="mconf">{openKey === slot.key && <MemoryFileEditor slot={slot} />}</div>
        </div>
      ))}
    </div>
  );
}
