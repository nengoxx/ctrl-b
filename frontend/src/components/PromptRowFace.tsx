import type { ReactNode } from "react";

// THE ROW FACE (Phase 18's `.prow-*` anatomy, extracted at D70 §13-S6b wave 2) — a full-width label
// line, a faint description under it, and the body the row is about.
//
// It shipped as Conf → Prompts' own JSX, and the owner's backdrop round asked for exactly that
// presentation on the agent form's long-text fields: the label as its own head line rather than a 104px
// column, the help text under it rather than beside the control, and the PREVIEW as the thing you tap —
// no "Edit fullscreen ↗" button to aim at. So it is a component rather than a second copy, and the two
// halves are split because two bodies want the same head:
//
//   · `FieldRow`      — head + description + whatever the row IS (the agent form's art picker face);
//   · `PromptRowFace` — that, with the preview-is-the-button body (Conf → Prompts, and the agent form's
//                       Persona / Prompt append / Greeting / Example dialogue / Scenario / Post-history).
//
// The classes are the shipped ones (`.prow`, `.prow-head`, `.prow-name`, `.prow-desc`, `.prow-preview`,
// plus the `.tcat-*` badge family the tool catalog shares), so Conf → Prompts renders byte-identically
// and the agent form joins the same family rather than founding a second one. Inside the `.mform` grid a
// row spans both columns and drops the catalog's own frame — see kit.css.

/** The row's head + description, and one BODY. */
export function FieldRow(props: {
  label: string;
  /** `null` is admitted because the registry DTO spells "no description" that way. */
  description?: string | null;
  /** Anything on the right of the head line — Prompts' restore button rides here. */
  trailing?: ReactNode;
  /** The owner has customized this row (the accent badge; the body may accent itself too). */
  modified?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="prow">
      <div className="prow-head">
        <span className="prow-name">{props.label}</span>
        {props.modified === true && <span className="tcat-mod">customized</span>}
        {props.trailing}
      </div>
      {props.description != null && props.description !== "" && (
        <div className="prow-desc tcat-faint">{props.description}</div>
      )}
      {props.children}
    </div>
  );
}

/** The long-text row: the preview IS the opener.
 *
 *  A real `<button>` (Codex MED): the editor opener must be keyboard-reachable, and a real trigger is
 *  what the modal's close-focus restore lands back on. The `.mod` accent is a QUIET persistent mark on
 *  the field box beside the badge (§9a-2) — a border, not a transition. */
export function PromptRowFace(props: {
  label: string;
  description?: string | null;
  /** The one-line preview text, already folded by `lib/promptPreview`. */
  preview: string;
  modified?: boolean;
  trailing?: ReactNode;
  /** The opener's `title` — a desktop hover hint; the phone reads the row, not a tooltip. */
  openTitle?: string;
  onOpen: () => void;
}) {
  return (
    <FieldRow
      label={props.label}
      description={props.description}
      modified={props.modified}
      trailing={props.trailing}
    >
      <button
        type="button"
        className={"prow-preview" + (props.modified === true ? " mod" : "")}
        onClick={props.onOpen}
        // THE BUTTON IS NAMED BY ITS FIELD, not by what happens to be inside it (the wave-2 review's
        // F3). Without this the accessible name is the PREVIEW — "41 chars · "Hello there…" ✎" — so a
        // screen reader announces the value where the control's purpose belongs, and an empty field
        // announces its placeholder as the name of a button. The head line above says which field this
        // is visually; the label says it to everything else. It heals Conf → Prompts through the same
        // face, which is what sharing one was for.
        aria-label={props.openTitle ?? `Edit ${props.label}`}
        title={props.openTitle ?? "Edit prompt"}
      >
        {props.preview}
        {/* Decoration: the button already says "Edit …", and a glyph read as text would say it twice. */}
        <span className="tcat-edit" aria-hidden>
          {" "}
          ✎
        </span>
      </button>
    </FieldRow>
  );
}
