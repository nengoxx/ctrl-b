import { useEffect, useState } from "react";

import { useSaveSettings } from "../hooks/useSettings";
import {
  useDeleteSkill,
  useSaveSkill,
  useSkillFile,
  useSkills,
  type SkillInfo,
} from "../hooks/useSkills";
import { requestConfirm } from "../store/confirm";
import { useRegisterDirty } from "../store/dirty";
import { pushToast } from "../store/toast";

// Phase 7d-c — Skills management. Lists discovered skills (skills/<name>/SKILL.md), edits the raw
// markdown in place, adds/removes skills, and toggles the subsystem master switch (agent.skills_enabled).
// Reuses the vapor .mwrap/.mfoot recipe + the 7c .kv-text textarea; vapor.css untouched (D7).

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div className={"switch" + (on ? " on" : "")} onClick={onToggle}>
      <div className="knob" />
    </div>
  );
}

/** The raw SKILL.md editor for one (open) skill — fetches its content lazily, edits, saves, deletes. */
function SkillFileEditor({ name, onClose }: { name: string; onClose: () => void }) {
  const { data, isLoading } = useSkillFile(name);
  const saveSkill = useSaveSkill();
  const delSkill = useDeleteSkill();
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (data) setText(data.content);
  }, [data]);

  const dirty = data != null && text != null && text !== data.content;
  // F19 — keyed by skill name so a different SKILL.md being edited registers under its own
  // slot (in practice only one is open at a time, but this keeps the registry honest).
  useRegisterDirty(`skill:${name}`, dirty);

  const onDelete = async () => {
    const ok = await requestConfirm({
      title: `Remove skill ${name}?`,
      body: "Deletes its SKILL.md.",
      confirmLabel: "remove",
      danger: true,
    });
    if (ok) delSkill.mutate(name, { onSuccess: onClose });
  };

  if (isLoading || text == null) return <div className="agent-empty">loading…</div>;
  return (
    <>
      <textarea
        className="kv-text skill-md"
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mfoot">
        <button type="button" className="danger" disabled={delSkill.isPending} onClick={onDelete}>
          remove
        </button>
        <button
          type="button"
          className="save"
          disabled={!dirty || saveSkill.isPending}
          onClick={() => saveSkill.mutate({ name, content: text })}
        >
          {saveSkill.isPending ? "saving…" : "save"}
        </button>
      </div>
    </>
  );
}

export function SkillsEditor({ enabled }: { enabled: boolean }) {
  const { data: skills = [] } = useSkills();
  const saveSettings = useSaveSettings();
  const saveSkill = useSaveSkill();
  const [openName, setOpenName] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const commitNew = () => {
    const name = newName.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) return pushToast("name: lowercase letters, digits, - or _", "err");
    if (skills.some((s) => s.name === name)) return pushToast("a skill with that name exists", "err");
    // Blank content → the backend writes a scaffold; then open it for editing.
    saveSkill.mutate(
      { name, content: "" },
      {
        onSuccess: () => {
          setNewName("");
          setAdding(false);
          setOpenName(name);
        },
      },
    );
  };

  return (
    <div className="conf-card">
      <div className="confrow">
        <div className="k">
          <div className="label">Skills enabled</div>
          <div className="desc">master switch · skills auto-narrow the toolset by intent</div>
        </div>
        <Switch
          on={enabled}
          onToggle={() => saveSettings.mutate({ agent: { skills_enabled: !enabled } })}
        />
      </div>

      {skills.map((s: SkillInfo) => (
        <div className={"mwrap" + (openName === s.name ? " open" : "")} key={s.name}>
          <div className="confrow" onClick={() => { setOpenName(openName === s.name ? null : s.name); setAdding(false); }}>
            <div className="k">
              <div className="label">{s.name}</div>
              <div className="desc">{s.description || "(no description)"}</div>
            </div>
            {s.allowed_tools != null && <span className="badge">{s.allowed_tools.length} tools</span>}
            <span className="chev" aria-hidden>›</span>
          </div>
          <div className="mconf">{openName === s.name && <SkillFileEditor name={s.name} onClose={() => setOpenName(null)} />}</div>
        </div>
      ))}

      <div className={"mwrap add" + (adding ? " open" : "")}>
        <div className="confrow" onClick={() => { setAdding(!adding); setOpenName(null); }}>
          <div className="k">
            <div className="label">add skill</div>
            <div className="desc">creates skills/&lt;name&gt;/SKILL.md from a template</div>
          </div>
          <span className="chev" aria-hidden>›</span>
        </div>
        <div className="mconf">
          {adding && (
            <div className="mform">
              <label>Name</label>
              <input value={newName} placeholder="my-skill" onChange={(e) => setNewName(e.target.value)} />
              <div className="mfoot">
                <button type="button" onClick={() => { setAdding(false); setNewName(""); }}>cancel</button>
                <button type="button" className="save" disabled={saveSkill.isPending} onClick={commitNew}>
                  {saveSkill.isPending ? "creating…" : "create"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
