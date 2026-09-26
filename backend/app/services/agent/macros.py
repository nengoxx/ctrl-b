"""Character macros (Phase 23 / D70, ROLEPLAY_PLAN §4.3) — the `{{char}}` / `{{user}}` /
`{{original}}` vocabulary substituted into text the OWNER authored.

The renderer is the registry's own (`prompts.render`): one lenient `{{name}}` pass, leave-literal
on a miss. That miss rule is what makes the pass safe to run for EVERY agent over EVERY surface —
a SOUL.md with no macros in it comes back byte-identical, so nothing had to be gated on a
"is this a character" predicate that P1 refuses to model.

Two pre-passes run first, both card-convention parity rather than new vocabulary (R87):

  * **Case.** The field resolves macro names case-insensitively (ST lower-cases the name before
    the lookup; CCv3 says SHOULD), and real cards write `{{Char}}`/`{{User}}`. A vocabulary name
    in any ASCII case is folded to its canonical spelling here — and ONLY here: the registry keeps
    its case-sensitive grammar, whose identifier is ASCII-only, so `.lower()` on a matched name can
    never fold a Unicode look-alike (`{{uſer}}` is not a token and stays literal).
  * **Comments.** `{{// …}}` is an author's note the card hid from the model (ST renders it as
    nothing), so it is removed — first `}}` closes it, ST's own rule. An unclosed `{{//` is not a
    comment and survives visibly, the typo-is-visible rule.

Two of the three tokens are plain values; `{{original}}` is not, and its rules live here:

  * **Field-specific value.** The V2 spec defines it as "the prompt the frontend would have used",
    so the caller supplies what that means for the surface it is rendering: in the persona/SOUL
    text it is the owner's configured `inference.system_prompt` (else nothing — R87/RP-1), in
    `post_history` it is ctrl-b's default post-history text — which is empty, so it renders as
    nothing.
  * **Once.** `safe_substitute` replaces every occurrence, so the once-rule is applied explicitly
    before the pass: the FIRST `{{original}}` takes the value and every later one renders empty.
    Two copies of the same prompt in one text is never what an author meant.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.services.agent.prompts import TOKENS, render

if TYPE_CHECKING:
    from collections.abc import Iterable

    from app.config import Settings
    from app.domain.agent import AgentDef

#: The last rung of the `{{user}}` chain (ruling 7) — what the owner is called when neither the
#: agent's `user_name` nor `roleplay.persona.name` is set.
DEFAULT_USER = "User"

#: The token whose substitution is field-specific and once-only (§4.1).
ORIGINAL = "original"

#: Every name this build renders — the ONE list both the case fold and the importers' "will render
#: literally" report read, so the two cannot disagree about what is supported.
VOCABULARY = frozenset({"char", "user", ORIGINAL})

#: An author comment, `{{// …}}` — ST's legacy rule verbatim (`/\{\{\/\/([\s\S]*?)\}\}/gm`):
#: non-greedy, across lines, closed by the first `}}`.
_COMMENT = re.compile(r"\{\{//.*?\}\}", re.DOTALL)

#: What the importers sniff for: anything that OPENS like a field macro — a name, or the comment
#: marker, optionally after whitespace (ST's engine tolerates it). Wider than `TOKENS` on purpose:
#: `{{random:a,b}}` and `{{time}}` are not tokens here either, and they are exactly what the
#: report exists to name. The groups say whether it is also a bare `{{name}}` — no whitespace
#: inside the braces — which is the only shape in which a vocabulary name actually renders.
_MACRO_OPENER = re.compile(r"\{\{(?P<pad>\s*)(?P<name>//|[A-Za-z_][A-Za-z0-9_]*)(?P<close>\}\})?")


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
        # Case BEFORE the once-rule: `_first_only` compares canonical names, so a `{{Original}}`
        # ahead of an `{{original}}` must already be the first `{{original}}` when it looks.
        text = _fold_case(_COMMENT.sub("", text))
        return render(_first_only(text, ORIGINAL), values)


def macros_for(agent: AgentDef, settings: Settings) -> Macros:
    """The vocabulary for one agent: `{{char}}` = its display title (else the slug), `{{user}}` =
    the agent's own `user_name` → the global `roleplay.persona.name` → `"User"` (ruling 7's three
    rungs, in that order)."""
    return Macros(
        char=agent.title.strip() or agent.name,
        user=agent.user_name.strip() or settings.roleplay.persona.name.strip() or DEFAULT_USER,
    )


def unrendered(texts: Iterable[str]) -> list[str]:
    """The macro names `texts` use that this build will pass through LITERALLY — sorted,
    lower-cased (the field resolves names case-insensitively, so `Random` and `random` are one
    macro). For the importers' report line (R87/RP-3): leave-literal-on-miss is right for a typo,
    but a card built on `{{random:…}}` or `{{time}}` should say so at the door rather than in the
    first reply. A comment is never listed — the render strips it. A vocabulary name is listed only
    when it is NOT written as a bare token: `{{ char }}` renders literally, so it is named."""
    names: set[str] = set()
    for text in texts:
        for m in _MACRO_OPENER.finditer(text):
            name = m["name"].lower()
            renders = name == "//" or (name in VOCABULARY and not m["pad"] and m["close"])
            if not renders:
                names.add(name)
    return sorted(names)


def unrendered_note(texts: Iterable[str], where: str) -> list[str]:
    """The ONE report line naming `unrendered(texts)` (nothing when there are none), worded once for
    both importers. `where` says whose text it was ("the card's text", "the lorebook's entries")."""
    names = unrendered(texts)
    if not names:
        return []
    listed = ", ".join(f"{{{{{n}}}}}" for n in names)
    return [f"macros in {where} that this build does not render reach the model as literal text: {listed}"]


def _fold_case(text: str) -> str:
    """`text` with every vocabulary TOKEN written in another ASCII case (`{{Char}}`, `{{USER}}`)
    rewritten to its canonical lower-case spelling. Walks `TOKENS`, so a name inside a malformed
    brace run is left exactly as typed, like everything else the renderer does not call a token;
    a name outside the vocabulary keeps its case too (it will render literally either way, and the
    owner should see what they wrote)."""

    def _canonical(m: re.Match[str]) -> str:
        name = m["named"]
        if name is None:
            return m[0]
        lowered = name.lower()
        return f"{{{{{lowered}}}}}" if lowered != name and lowered in VOCABULARY else m[0]

    return TOKENS.sub(_canonical, text)


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
