import { useState } from "react";

import { PromptRowFace } from "./PromptRowFace";
import { WarnRow } from "./WarnRow";
import { useSavePromptOverrides, usePrompts } from "../hooks/usePrompts";
import { promptPreview } from "../lib/promptPreview";
import { foldEqualDefault, groupPrompts, normPrompt } from "../lib/promptText";
import { useRegisterDirty } from "../store/dirty";
import { requestPromptPair } from "../store/prompt";
import type { PromptInfo, PromptPair } from "../types";

// Conf · Prompts (Phase 18 / D56, §6 C-18) — every model-facing prompt ctrl-b ships, in registry
// order, each editable as an `{override, append}` pair in the shared PromptModal.
//
// The catalog's state is reconstructed entirely from `GET /api/prompts` (the ToolCatalog posture):
// `override`/`append` are what the owner stored, `current` the effective template the model gets,
// `default_text` what ships. Pending edits live in a local draft; a Save PUTs only the CHANGED ids as
// whole pairs of RAW textarea text, and the server does the normalizing (blank → absent, an entry with
// no fields → deleted). That last rule is why Restore is just a both-blank pair: restoring a prompt is
// deleting its customization, so it rides the same batched save as every other edit.

/** The effective template a staged pair would produce — the client mirror of the backend's ONE
 *  composition rule (`prompts.effective_template`): the override (else the shipped default), plus a
 *  blank line and the append when set. Mirrored for the row PREVIEW only (the `agentModeOf`
 *  precedent), so a staged edit previews the text it would send instead of the saved one; the server
 *  stays the source of truth and an unedited row previews its `current` verbatim. */
function composeTemplate(pair: PromptPair, defaultText: string): string {
  const base = pair.override.trim() ? pair.override : defaultText;
  return pair.append.trim() ? `${base}\n\n${pair.append}` : base;
}

export function PromptsEditor() {
  const { data } = usePrompts();
  const save = useSavePromptOverrides();
  const [draft, setDraft] = useState<Record<string, PromptPair>>({});

  const rows = data?.prompts ?? [];
  const pairOf = (p: PromptInfo): PromptPair =>
    draft[p.id] ?? { override: p.override ?? "", append: p.append ?? "" };
  const isChanged = (p: PromptInfo): boolean => {
    const d = draft[p.id];
    return (
      d != null &&
      (normPrompt(d.override) !== (p.override ?? "") || normPrompt(d.append) !== (p.append ?? ""))
    );
  };
  const changed = rows.filter(isChanged);
  useRegisterDirty("prompts", changed.length > 0);

  const stage = (id: string, pair: PromptPair) => setDraft((d) => ({ ...d, [id]: pair }));

  const edit = async (p: PromptInfo) => {
    const cur = pairOf(p);
    const next = await requestPromptPair({
      title: p.label,
      override: cur.override,
      append: cur.append,
      defaultText: p.default_text,
      description: p.description,
      placeholders: p.placeholders,
      saveLabel: "Set",
    });
    // THE FREEZE-TRAP RULE (§9a-1), applied where save semantics live — the modal's own note says they
    // are the caller's. The field opens pre-filled with the shipped default; text that is STILL that
    // default folds back to "", so `isChanged` sees nothing to store for an untouched prompt while a
    // set `append` still saves.
    if (next != null) stage(p.id, foldEqualDefault(next, p.default_text));
  };

  const onSave = () => {
    const overrides: Record<string, PromptPair> = {};
    for (const p of changed) overrides[p.id] = draft[p.id];
    // setDraft on success: the refreshed DTO now reflects the new effective state.
    save.mutate(overrides, { onSuccess: () => setDraft({}) });
  };

  return (
    <div className="conf-card prompts">
      {/* Ids config.yaml carries that the registry doesn't know — preserved on disk, read by nothing,
          so the owner is TOLD rather than shown an editor for a prompt that doesn't exist (C-18). */}
      <WarnRow warnings={data?.warnings ?? []} />
      {groupPrompts(rows).map((section) => (
        <div className="pgroup" key={section.group || "#"}>
          {/* The section TITLE is the registry's own group label — no client-side vocabulary, so a
              group added on the backend appears here with no FE change (§9a-3). An unplaced row's
              section has no title and simply trails the named ones. */}
          {section.group !== "" && <div className="pgroup-head">{section.group}</div>}
          {section.rows.map((p) => (
            // THE ROW FACE is shared since D70 §13-S6b (`./PromptRowFace`) — the agent form's long-text
            // fields take this exact presentation on the owner's ruling, and one face is what keeps the
            // two surfaces from drifting. Nothing about this row changed with the extraction: the
            // badge rides `modified`, the restore rides `trailing`, and the preview accent (§9a-2 — a
            // quiet persistent border, not a transition) rides the same flag.
            <PromptRowFace
              key={p.id}
              label={p.label}
              description={p.description}
              modified={p.is_customized}
              preview={promptPreview(
                draft[p.id] ? composeTemplate(draft[p.id], p.default_text) : p.current,
                "empty",
              )}
              onOpen={() => void edit(p)}
              trailing={
                p.is_customized && (
                  <button
                    type="button"
                    className="prow-restore"
                    onClick={() => stage(p.id, { override: "", append: "" })}
                  >
                    restore
                  </button>
                )
              }
            />
          ))}
        </div>
      ))}
      <div className="conf-savebar">
        <button className="conf-save" disabled={!changed.length || save.isPending} onClick={onSave}>
          {save.isPending
            ? "Saving…"
            : changed.length
              ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}`
              : "Saved"}
        </button>
      </div>
    </div>
  );
}
