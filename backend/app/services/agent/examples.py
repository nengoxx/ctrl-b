"""Example dialogue (Phase 23 / D70, ROLEPLAY_PLAN §4.2) — `mes_example` parsed into the few-shot
pseudo-messages the field puts on the wire.

The shape is ST's, verified (R64 §7): each example turn goes out as
`{role: "system", name: "example_user" | "example_assistant", content}` — the OpenAI few-shot
convention — and `<START>` is a BLOCK SEPARATOR the model never sees (R64 §1.3), not a token.

Two format rules are taken from ST's own parser, because "the ST format kept verbatim" is the
compatibility contract an imported card is read under:

  * **A field with no `<START>` at all is one block.** ST prepends `<START>\\n` when the string
    doesn't start with one and then splits, so text before the first marker is a block of its own —
    which is what makes an unmarked field sensible input rather than nothing.
  * **Unlabelled lines belong to the message they precede.** ST accumulates lines and only flushes
    at the NEXT speaker line, so a block's preamble rides with its first labelled turn instead of
    being dropped.

Where we deliberately differ from ST, and why:

  * ST strips the speaker label with `content.replace(name + ':', '')` — the first occurrence
    ANYWHERE in the joined message, which can eat a later mention. We strip the prefix from the
    speaker's OWN line, at the point we recognize it: same result for well-formed input, no
    collateral edit.
  * A block with NO recognizable speaker line yields NOTHING in ST — the owner's text vanishes from
    the prompt with no signal. Here it is emitted verbatim as one `example_assistant` turn: the
    field exists to demonstrate how the character talks, and visible survival beats silent deletion
    (the same rule the S0 fix wave settled on for a malformed macro run).

Speaker lines are matched on the RESOLVED names, so the macro pass runs first — `{{user}}:` /
`{{char}}:` are what an author writes, `Alice:` / `Nyx:` is what the parser sees (ST's order).
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.agent.macros import Macros

#: The OpenAI `name` values on an example turn (R64 §7). Wire framing in the class of a role name —
#: structural, never owner-edited, deliberately not a registry prompt.
EXAMPLE_USER = "example_user"
EXAMPLE_ASSISTANT = "example_assistant"

#: The block separator. Case-insensitive because ST splits on `/<START>/gi`.
_START = re.compile(r"<START>", re.IGNORECASE)


def example_messages(raw: str, macros: Macros) -> list[dict]:
    """`raw` (an `AgentDef.example_dialogue`) as ordered pseudo-messages, macro-substituted. Empty
    or marker-only text yields `[]` — an absent field can never grow a rendering (ruling 10)."""
    text = macros.render(raw.strip())
    out: list[dict] = []
    for block in _blocks(text):
        out += _turns(block, f"{macros.user}:", f"{macros.char}:")
    return out


def _blocks(text: str) -> list[str]:
    """The `<START>`-delimited blocks, blanks dropped (so a field that is only markers is empty)."""
    return [b.strip() for b in _START.split(text) if b.strip()]


def _turns(block: str, user_prefix: str, char_prefix: str) -> list[dict]:
    """One block's turns. `side` is the turn currently being accumulated; `None` until the first
    speaker line, which is why the no-speaker-line fallback is decided in `flush`."""
    out: list[dict] = []
    side: str | None = None
    buf: list[str] = []

    def flush() -> None:
        body = "\n".join(buf).strip()
        buf.clear()
        if body:
            out.append({"role": "system", "name": side or EXAMPLE_ASSISTANT, "content": body})

    for raw_line in block.splitlines():
        line = raw_line
        speaker = (
            EXAMPLE_USER
            if line.startswith(user_prefix)
            else EXAMPLE_ASSISTANT
            if line.startswith(char_prefix)
            else None
        )
        if speaker is not None:
            if side is not None:  # the previous turn ends here; a preamble keeps riding with the first
                flush()
            side = speaker
            prefix = user_prefix if speaker == EXAMPLE_USER else char_prefix
            line = line[len(prefix) :].lstrip()
        buf.append(line)
    flush()
    return out
