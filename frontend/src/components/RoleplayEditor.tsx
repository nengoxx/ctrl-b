import { useEffect, useState } from "react";

import { TickGrid } from "./AgentsEditor";
import { SettingRow } from "./SettingRow";
import { Switch } from "./Switch";
import { useAgentToolGrid } from "../hooks/useActions";
import { pickLorebooks, pickRoleplay } from "../hooks/useRoleplay";
import { useSaveSettings, useSettings } from "../hooks/useSettings";
import { promptPreview } from "../lib/promptPreview";
import { useRegisterDirty } from "../store/dirty";
import { requestPrompt } from "../store/prompt";

// Conf › Roleplay + Lorebooks (D70 §9) — the two GLOBAL blocks of the character subsystem. The
// per-agent half lives on the agent form in the gallery; what is here is the mode switch, the tools a
// conversational agent starts with, the owner's own persona, and the lorebook scan budgets.
//
// Both read the settings doc themselves and write `PUT /api/settings` partials — the backend
// deep-merges, so a partial patch leaves every field this UI does not surface untouched (the
// `roleplay.card_import.*` caps, `lorebooks.books`). ConfTab's own draft is untouched by them, which
// is why they are self-contained rather than prop-fed: they share nothing with it but the query.
//
// The save posture is MemoryEditor's, verbatim: the master switch saves IMMEDIATELY (the SkillsEditor
// idiom — a mode is not a draft), everything else rides a small local draft reseeded from the doc,
// with one Save under it.

export function RoleplayEditor() {
  const { data: settings } = useSettings();
  const save = useSaveSettings();
  const cfg = pickRoleplay(settings?.roleplay);
  // The SAME tool list the per-agent grid offers (`useAgentToolGrid`), so "the tools a character
  // starts with" cannot name a tool the agent form would refuse to show.
  const { toolNames, toolModes } = useAgentToolGrid();

  const [name, setName] = useState(cfg.persona.name);
  const [desc, setDesc] = useState(cfg.persona.description);
  const [tools, setTools] = useState<string[]>(cfg.default_tools);
  // Reseeded from the DOC (the joined list, never the array: a fresh-but-equal array on every render
  // would reseed the draft continuously — the `clear_exclude_tools` lesson).
  const seededTools = cfg.default_tools.join(",");
  useEffect(() => setTools(seededTools ? seededTools.split(",") : []), [seededTools]);
  useEffect(() => setName(cfg.persona.name), [cfg.persona.name]);
  useEffect(() => setDesc(cfg.persona.description), [cfg.persona.description]);

  const dirty =
    name !== cfg.persona.name ||
    desc !== cfg.persona.description ||
    tools.join(",") !== seededTools;
  useRegisterDirty("roleplay", dirty);

  const toggleTool = (n: string) =>
    setTools((t) => (t.includes(n) ? t.filter((x) => x !== n) : [...t, n]));

  return (
    <div className="conf-card">
      <SettingRow
        label="Roleplay fields"
        desc="show the character fields (greeting, scenario, example dialogue, …) on every agent — an imported card lights up the ones it uses either way"
      >
        <Switch
          on={cfg.enabled}
          label="Roleplay fields"
          onToggle={() => save.mutate({ roleplay: { enabled: !cfg.enabled } })}
        />
      </SettingRow>

      <div className="confrow">
        <div className="k">
          <div className="label">Character tools</div>
          <div className="desc">
            the tools an imported card starts with — a starting set you widen per agent, never a
            ceiling
          </div>
        </div>
      </div>
      <div className="agent-allow">
        <div className="agent-allow-head">
          <span>{tools.length} selected</span>
        </div>
        <TickGrid
          all={toolNames}
          selected={new Set(tools)}
          onToggle={toggleTool}
          modes={toolModes}
        />
      </div>

      <div className="confrow">
        <div className="k">
          <div className="label">Your name</div>
          <div className="desc">what {"{{user}}"} renders as · an agent can override it</div>
        </div>
        <input
          aria-label="Persona name"
          autoComplete="off"
          value={name}
          placeholder='(blank → "User")'
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="confrow conf-promptrow">
        <div className="k">
          <div className="label">About you</div>
          <div className="desc">who the owner is — injected as its own block when it is set</div>
          <div className="prompt-preview">{promptPreview(desc, "empty — nothing injected")}</div>
        </div>
        <button
          type="button"
          className="prompt-open"
          onClick={async () => {
            const next = await requestPrompt({
              title: "About you",
              value: desc,
              placeholder: "who you are, for the agents that speak to you",
            });
            if (next != null) setDesc(next);
          }}
        >
          Edit fullscreen ↗
        </button>
      </div>

      <div className="conf-savebar">
        <button
          className="conf-save"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate({
              roleplay: { default_tools: tools, persona: { name, description: desc } },
            })
          }
        >
          {save.isPending ? "Saving…" : dirty ? "Save roleplay settings" : "Saved"}
        </button>
      </div>
    </div>
  );
}

export function LorebookGlobals() {
  const { data: settings } = useSettings();
  const save = useSaveSettings();
  const cfg = pickLorebooks(settings?.lorebooks);

  // Numeric settings ride a small local draft (numeric text → coerced on save), reseeded from the doc
  // — MemoryEditor's caps idiom.
  const [depth, setDepth] = useState(String(cfg.scan_depth));
  const [budget, setBudget] = useState(String(cfg.budget_chars));
  const [maxBytes, setMaxBytes] = useState(String(cfg.max_import_bytes));
  useEffect(() => setDepth(String(cfg.scan_depth)), [cfg.scan_depth]);
  useEffect(() => setBudget(String(cfg.budget_chars)), [cfg.budget_chars]);
  useEffect(() => setMaxBytes(String(cfg.max_import_bytes)), [cfg.max_import_bytes]);

  const dirty =
    depth !== String(cfg.scan_depth) ||
    budget !== String(cfg.budget_chars) ||
    maxBytes !== String(cfg.max_import_bytes);
  useRegisterDirty("lorebooks", dirty);

  return (
    <div className="conf-card">
      <div className="confrow">
        <div className="k">
          <div className="label">Scan depth</div>
          <div className="desc">
            how many earlier messages join the new one when matching entries
          </div>
        </div>
        <input
          className="lim-input"
          inputMode="numeric"
          aria-label="Scan depth"
          value={depth}
          onChange={(e) => setDepth(e.target.value)}
        />
      </div>
      <div className="confrow">
        <div className="k">
          <div className="label">Budget</div>
          <div className="desc">characters of lorebook text one turn may carry</div>
        </div>
        <input
          className="lim-input"
          inputMode="numeric"
          aria-label="Lorebook budget"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </div>
      <div className="confrow">
        <div className="k">
          <div className="label">Import cap</div>
          <div className="desc">bytes — the largest book file an import will read</div>
        </div>
        <input
          className="lim-input"
          inputMode="numeric"
          aria-label="Lorebook import cap"
          value={maxBytes}
          onChange={(e) => setMaxBytes(e.target.value)}
        />
      </div>
      {/* NO global attach-list editor here: `lorebooks.books` is the S5 manager/picker slice's, and a
          partial PUT leaves the stored list untouched (the deep merge). */}
      <div className="conf-savebar">
        <button
          className="conf-save"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate({
              lorebooks: {
                scan_depth: Math.max(0, Number(depth) || 0),
                budget_chars: Math.max(1, Number(budget) || cfg.budget_chars),
                max_import_bytes: Math.max(1, Number(maxBytes) || cfg.max_import_bytes),
              },
            })
          }
        >
          {save.isPending ? "Saving…" : dirty ? "Save lorebook settings" : "Saved"}
        </button>
      </div>
    </div>
  );
}
