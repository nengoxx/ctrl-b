"""Character macros (Phase 23 / D70, ROLEPLAY_PLAN §4.3) — the `{{char}}` / `{{user}}` /
`{{original}}` vocabulary substituted into text the OWNER authored.

The renderer is the registry's own (`prompts.render`): one lenient `{{name}}` pass, leave-literal
on a miss. That miss rule is what makes the pass safe to run for EVERY agent over EVERY surface —
a SOUL.md with no macros in it comes back byte-identical, so nothing had to be gated on a
"is this a character" predicate that P1 refuses to model.

Two of the three tokens are plain values; `{{original}}` is not, and its rules live here:

  * **Field-specific value.** The V2 spec defines it as "the prompt that would have been used
    WITHOUT the card", so the caller supplies what that means for the surface it is rendering: in
    the persona/SOUL text it is the complete no-card head (§4.1), in `post_history` it is ctrl-b's
    default post-history text — which is empty, so it renders as nothing.
  * **Once.** `safe_substitute` replaces every occurrence, so the once-rule is applied explicitly
    before the pass: the FIRST `{{original}}` takes the value and every later one renders empty.
    Two copies of the whole head in one prompt is never what an author meant.

`consumes_original` answers the head builder's question — did this persona text embed the no-card
head itself? If so the Duties section is NOT emitted a second time beside it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.services.agent.prompts import TOKENS, placeholders, render

if TYPE_CHECKING:
    from app.config import Settings
    from app.domain.agent import AgentDef

#: The last rung of the `{{user}}` chain (ruling 7) — what the owner is called when neither the
#: agent's `user_name` nor `roleplay.persona.name` is set.
DEFAULT_USER = "User"

#: The token whose substitution is field-specific and once-only (§4.1).
ORIGINAL = "original"


@dataclass(frozen=True)
class Macros:
    """One agent's macro vocabulary, resolved once per turn. Immutable: the values project from the
    `AgentDef` + `Settings` the session already holds fixed for the turn."""

    char: str
    user: str

    def render(self, text: str, *, original: str = "") -> str:
        """`text` with the v1 vocabulary substituted. `original` is this surface's `{{original}}`
        value (empty by default — the surfaces that have no no-card equivalent). Empty text is
        returned as-is so a blank field can never grow a rendering."""
        if not text:
            return text
        values = {"char": self.char, "user": self.user, ORIGINAL: original}
        return render(_first_only(text, ORIGINAL), values)


def macros_for(agent: AgentDef, settings: Settings) -> Macros:
    """The vocabulary for one agent: `{{char}}` = its display title (else the slug), `{{user}}` =
    the agent's own `user_name` → the global `roleplay.persona.name` → `"User"` (ruling 7's three
    rungs, in that order)."""
    return Macros(
        char=agent.title.strip() or agent.name,
        user=agent.user_name.strip() or settings.roleplay.persona.name.strip() or DEFAULT_USER,
    )


def consumes_original(text: str) -> bool:
    """Does this text embed `{{original}}` — i.e. does it carry the no-card head itself, so the
    separate emission of that head's Duties section would be a duplicate (§4.1)?"""
    return ORIGINAL in placeholders(text)


def _first_only(text: str, name: str) -> str:
    """`text` with every `{{name}}` TOKEN past the FIRST removed — the explicit once-rule
    (`safe_substitute` replaces all occurrences, so blanking the repeats is what makes "once" true).

    Walks `TOKENS`, the renderer's own pattern — never literal substrings: a `{{name}}` inside a
    longer malformed brace run is not a token, and counting it as the "first" here would blank the
    real token later in the text (deleting owner content the renderer would have substituted)."""
    seen = False

    def _keep_first(m: re.Match[str]) -> str:
        nonlocal seen
        if m["named"] != name:
            return m[0]
        if seen:
            return ""
        seen = True
        return m[0]

    return TOKENS.sub(_keep_first, text)
