"""Character macros (Phase 23 / D70, ROLEPLAY_PLAN §4.3) — the `{{char}}` / `{{user}}` /
`{{original}}` vocabulary plus the SillyTavern / CCv3 FEATURE macros (ISS-28), substituted into text
the OWNER authored.

The vocabulary renderer is the registry's own (`prompts.render`): one lenient `{{name}}` pass,
leave-literal on a miss. That miss rule is what makes the pass safe to run for EVERY agent over EVERY
surface — a SOUL.md with no macros in it comes back byte-identical, so nothing had to be gated on a
"is this a character" predicate that P1 refuses to model. The feature pass keeps the same promise:
its pattern only ever matches `{{<a supported name>…}}`, so text without one is untouched.

**The order, per `render` call** (each step sees the previous step's output):

  1. **Comments.** The SCOPED form `{{//}}…{{///}}` first — openers and closers paired by a stack
     (ST's `MacroCstWalker`), the whole span removed, nested pairs included — and only the openers
     left UNPAIRED are then the single form `{{// …}}` (ST's legacy rule: first `}}` closes it,
     across lines). The order is load-bearing: strip the single form first and it eats both markers,
     leaking the body (the pre-ISS-28 bug). An ORPHAN closer `{{///}}` stays literal (ST parity); an
     unclosed `{{//` survives visibly (the typo-is-visible rule). One linear walk does both.
  2. **Case.** A vocabulary name in any ASCII case is folded to its canonical spelling — and ONLY
     here: the registry keeps its case-sensitive grammar, whose identifier is ASCII-only, so
     `.lower()` on a matched name can never fold a Unicode look-alike (`{{uſer}}` stays literal).
  3. **`{{original}}`'s once-rule, then the vocabulary values** (`prompts.render`). This is ST's
     env-first order: `{{random:{{user}},x}}` sees the persona's NAME as an item.
  4. **The legacy rewrite** `{{time_UTC±N}}` → `{{time::UTC±N}}` (ST `MacroEngine`) — only for an
     offset the handler renders; any other text (a bad offset, a longer brace run) is left as written.
  5. **The feature pass**, innermost first: the pattern admits no brace inside an argument except a
     nested `{{char}}`/`{{user}}` (which the token pass refuses when it sits flush against the outer
     `}}`), so one sweep resolves every innermost call and the sweep repeats to a fixpoint (bounded).

**The grammar.** `{{name}}`, `{{name:args}}`, `{{name::args}}` or `{{name args}}`; names are matched
case-insensitively under `re.I | re.A` — WITHOUT `re.A` the Kelvin sign case-folds onto `k` and
`{{weeKday}}` would bind (this module's own Unicode look-alike rule). Whitespace before the name
(`{{ time }}`) is NOT a macro, the same rule `{{ char }}` already follows; the report names it.

  ============== ===================================================================== =========
  name           renders                                                               per turn
  ============== ===================================================================== =========
  random         one item, chosen per TURN: `a,b` (`\\,` escapes a comma) or `a::b`  yes
                 (`::` wins when present); items trimmed; no items → nothing
  pick           the same lists, chosen once per THREAD + position (stable)            no
  roll           `N` (= `1dN`) or droll's `[N]dS[±M]`; at most `ROLL_MAX_DICE` dice    yes
  reverse        its argument, reversed                                                no
  comment,       nothing (CCv3's author notes; `{{// …}}` above is the third form)     no
  hidden_key
  time           `h:mm A` ("3:05 PM"); `{{time::UTC±N}}` = that clock at UTC±N hours,  yes
                 whole hours, |N| ≤ `UTC_OFFSET_MAX` (14)
  date           `MMMM D, YYYY` ("October 6, 2026")                                   yes
  weekday        `dddd` ("Tuesday")                                                   yes
  isotime        `HH:mm`                                                               yes
  isodate        `YYYY-MM-DD`                                                          yes
  idle_duration  moment's `humanize()` (no suffix) of now − the owner's PREVIOUS        yes
  (idleDuration) message; none → "just now"
  ============== ===================================================================== =========

Month and weekday names are explicit English tables (moment's `en`), never `strftime`'s locale.

**The clock** is the SERVER's zone (`server_tz_key`, the convention automations and the monitor
follow), read ONCE per turn by the session and carried on `Macros.now` — never per render, or the
head's `{{time}}` and the tail's could disagree inside one turn.

**The seeds.** Every choice is a `random.Random(str)` (sha512-seeded, stable across processes and
`PYTHONHASHSEED`) keyed by (thread, the raw field text, the macro's raw text, its occurrence index
among identical macros in that field). `random`/`roll` prepend the turn's SALT — minted ONCE per
session (= per turn) by `AgentSession.__init__` — so they re-roll every turn (ST parity) yet stay
byte-stable across every loop iteration and every render site inside it. `pick` takes no salt, so it
is stable for the thread's life (ST/Risu parity, and cache-friendly). The occurrence index, not the
character offset, keeps a persona rename from reshuffling a pick.

**The prompt-cache cost (owner ruling 2026-10-06, accepted — ST parity, the card author's choice).**
A per-turn macro (`PER_TURN`) in a HEAD text — the SOUL, the scenario, the persona, the examples, a
head lorebook entry — changes the cached prefix every turn, so llama.cpp re-prefills from there,
the whole history included. A per-THREAD salt would avoid it and is deliberately NOT what we do. The
app WARNS instead: both importers emit one `per_turn_note` line for head-landing text that carries
one.

**Divergences from ST, recorded:**

  * A MALFORMED argument (`{{roll:abc}}`, `{{time::UTC+99}}`, an argument on a no-argument macro)
    stays LITERAL — the house typo-is-visible rule. ST renders `''` — except `time`, whose bad
    argument ST answers with the plain local time; ours stays literal there too.
  * `random` is deterministic within a turn; ST draws fresh entropy per resolve.
  * `pick`'s position is the occurrence index (ST: the character offset); no `/reroll-pick`.
  * `time::UTC±N` takes whole hours, |N| ≤ 14 (real zones' span); past that it stays literal. moment
    reads |N| < 16 as hours but |N| ≥ 16 as MINUTES — the clamp keeps ours inside the range where
    both agree. ST's `UTC` is case-sensitive; ours also accepts `utc`. The clock is the server's, not
    the browser's.
  * `roll` caps the dice count at `ROLL_MAX_DICE` (neither ST nor droll caps it).
  * `idle_duration` on a REGENERATE measures from the owner's message BEFORE the regenerated turn's
    anchor; an ST swipe measures from the newest user message (the anchor itself).
  * `{{original}}` nested in a feature argument is substituted by the token pass first (step 3), so
    `{{random:{{original}},x}}` splits the WHOLE original prompt into items at its commas. Only when it
    sits right against the closing `}}` (`{{random:x,{{original}}}}`) does the token pass refuse it,
    and then the call stays literal.

**Non-goals** (the import report keeps naming them): `datetimeformat`, `timeDiff`, `newline`, `trim`,
`space`, `noop`, `lastMessage`, `input`, `outlet`, `persona`, the variable macros, `if`.

`{{original}}`'s own rules:

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

import math
import random
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Literal
from zoneinfo import ZoneInfo

from app.services.agent.persona import resolve_persona
from app.services.agent.prompts import TOKENS, render
from app.services.automations.schedule import server_tz_key

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Iterator

    from app.config import Settings
    from app.domain.agent import AgentDef

#: The last rung of the `{{user}}` chain (ruling 7, D78) — what the owner is called when no persona
#: resolves for the agent, or the one that does has no name.
DEFAULT_USER = "User"

#: The token whose substitution is field-specific and once-only (§4.1).
ORIGINAL = "original"

#: The names the TOKEN pass substitutes (step 3) — the plain values. The case fold reads it, and
#: `unrendered` holds these to the stricter bare-token shape.
VOCABULARY = frozenset({"char", "user", ORIGINAL})

#: The most dice one `{{roll}}` throws. Neither ST nor droll caps it; a card asking for a billion
#: dice should cost a visible literal, not a stalled turn.
ROLL_MAX_DICE = 1000

#: How many innermost-first sweeps the feature pass makes before it stops. Real nesting is one or
#: two deep; the bound exists because a persona NAME is substituted into arguments, and a name that
#: itself spells a macro must not loop.
_MAX_SWEEPS = 16


def _now() -> datetime:
    """The wall clock in the server's zone — the monkeypatch point (the `turns._now` pattern)."""
    return datetime.now(ZoneInfo(server_tz_key()))


def clock() -> datetime:
    """The ONE clock read a turn makes for its macros (`AgentSession.__init__`)."""
    return _now()


@dataclass(frozen=True)
class Macros:
    """One agent's macro context, fixed for one turn. Immutable: `char`/`user` project from the
    `AgentDef` + `Settings` the session holds fixed for the turn, and the rest is the turn's own
    context — the thread (seeds `pick`), the salt (seeds `random`/`roll`; empty ⇒ they behave like
    `pick`), the clock read once, and the idle gap (`None` ⇒ "just now"). Every field past `user`
    has a default, so a bare `Macros(char=, user=)` still means "the vocabulary, now"."""

    char: str
    user: str
    thread: str = ""
    salt: str = ""
    now: datetime = field(default_factory=lambda: _now())
    idle: timedelta | None = None

    def render(self, text: str, *, original: str = "") -> str:
        """`text` with every supported macro rendered (the module docstring's five steps).
        `original` is this surface's `{{original}}` value (empty by default — the surfaces that have
        no no-card equivalent). Empty text is returned as-is so a blank field can never grow a
        rendering."""
        if not text:
            return text
        values = {"char": self.char, "user": self.user, ORIGINAL: original}
        # Case BEFORE the once-rule: `_first_only` compares canonical names, so a `{{Original}}`
        # ahead of an `{{original}}` must already be the first `{{original}}` when it looks.
        out = _fold_case(_strip_comments(text))
        out = render(_first_only(out, ORIGINAL), values)
        if "{{" not in out:
            return out
        return self._features(_LEGACY_TIME.sub(_legacy_time, out), field_text=text)

    def _features(self, text: str, *, field_text: str) -> str:
        """Step 5: resolve every feature call, innermost first, to a fixpoint. `field_text` is the
        RAW field (pre-render) — the seed's field term, so it is the same at every render site."""
        seen: dict[str, int] = {}

        def _one(m: re.Match[str]) -> str:
            raw = m[0]
            occurrence = seen.get(raw, 0)
            seen[raw] = occurrence + 1
            handler = SUPPORTED[m["name"].lower()].handler
            if handler is None:  # unreachable: the pattern only names handled macros
                return raw
            args = _NESTED_VALUE.sub(
                lambda v: self.char if v[1].lower() == "char" else self.user, m["args"] or ""
            )
            call = _Call(
                self, m["sep"] or "", args, f"{self.thread}\x1f{field_text}\x1f{raw}\x1f{occurrence}"
            )
            out = handler(call)
            return raw if out is None else out

        for _ in range(_MAX_SWEEPS):
            swept = _FEATURE.sub(_one, text)
            if swept == text:
                break
            text = swept
        return text


def macros_for(
    agent: AgentDef,
    settings: Settings,
    *,
    thread: str = "",
    salt: str = "",
    now: datetime | None = None,
    idle: timedelta | None = None,
) -> Macros:
    """The macro context for one agent: `{{char}}` = its display title (else the slug), `{{user}}` =
    the name of the persona it resolves to (`agent.persona` → `roleplay.default_persona`, D78) →
    `"User"` — two rungs, because the persona chain lives in `resolve_persona`, not here. The turn
    context (`thread`/`salt`/`now`/`idle`) is the caller's; `now` defaults to one clock read here."""
    resolved = resolve_persona(agent, settings)
    return Macros(
        char=agent.title.strip() or agent.name,
        user=(resolved[1].name.strip() if resolved else "") or DEFAULT_USER,
        thread=thread,
        salt=salt,
        now=now if now is not None else _now(),
        idle=idle,
    )


# ── the feature handlers ───────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class _Call:
    """One feature-macro occurrence: its context, the separator it was written with (`""` for a bare
    `{{name}}`), its argument text (nested `{{char}}`/`{{user}}` already substituted) and its
    UNSALTED seed key."""

    macros: Macros
    sep: str
    args: str
    key: str

    def rng(self, *, salted: bool) -> random.Random:
        return random.Random(f"{self.macros.salt if salted else ''}\x1f{self.key}")

    def bare(self) -> bool:
        """No argument at all — what a no-argument macro demands (anything else is malformed)."""
        return not self.args.strip()


def _items(args: str) -> list[str]:
    """`random`/`pick`'s list: `::`-separated when the text carries `::`, else comma-separated with
    `\\,` as a literal comma (ST's legacy reader; the `::` form takes the text verbatim). Trimmed."""
    if "::" in args:
        return [item.strip() for item in args.split("::")]
    return [item.replace("\\,", ",").strip() for item in re.split(r"(?<!\\),", args)]


def _random(call: _Call) -> str:
    return call.rng(salted=True).choice(_items(call.args))


def _pick(call: _Call) -> str:
    return call.rng(salted=False).choice(_items(call.args))


_DIGITS = re.compile(r"\d+", re.A)
#: droll's grammar verbatim (`droll.js`): `[count]d<sides>[±modifier]`, count and sides from 1.
_DICE = re.compile(r"([1-9]\d*)?d([1-9]\d*)([+-]\d+)?", re.I | re.A)


def _roll(call: _Call) -> str | None:
    formula = call.args.strip()
    if _DIGITS.fullmatch(formula):
        formula = f"1d{formula}"  # ST: a bare number is that many sides
    m = _DICE.fullmatch(formula)
    if m is None:
        return None
    count_text = m[1] or "1"
    if len(count_text) > len(str(ROLL_MAX_DICE)) or int(count_text) > ROLL_MAX_DICE:
        return None
    try:  # a many-thousand-digit side/modifier exceeds int()'s str limit — malformed, not a crash
        sides, modifier = int(m[2]), int(m[3] or 0)
    except ValueError:
        return None
    rng = call.rng(salted=True)
    return str(sum(rng.randint(1, sides) for _ in range(int(count_text))) + modifier)


def _reverse(call: _Call) -> str:
    return call.args[::-1]


def _nothing(_call: _Call) -> str:
    return ""


_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)
_WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_UTC_OFFSET = re.compile(r"UTC([+-]\d{1,2})", re.I | re.A)

#: The widest `UTC±N` offset `{{time}}` accepts, in whole hours — the span real zones use (UTC−12 …
#: UTC+14). Past it the text stays literal: moment would read |N| ≥ 16 as MINUTES, and a typo there is
#: better visible than silently a quarter-hour off.
UTC_OFFSET_MAX = 14


def _utc_offset(text: str) -> int | None:
    """`UTC±N` → N hours, or `None` when the text is not that or N is past `UTC_OFFSET_MAX` — the ONE
    rule the `{{time::UTC±N}}` handler and the legacy `{{time_UTC±N}}` rewrite share."""
    m = _UTC_OFFSET.fullmatch(text)
    if m is None:
        return None
    hours = int(m[1])
    return hours if abs(hours) <= UTC_OFFSET_MAX else None


def _clock_time(at: datetime) -> str:
    """moment's `LT` in `en`: `h:mm A`."""
    return f"{at.hour % 12 or 12}:{at.minute:02d} {'AM' if at.hour < 12 else 'PM'}"


def _time(call: _Call) -> str | None:
    if call.bare():
        return _clock_time(call.macros.now)
    hours = _utc_offset(call.args.strip())
    if hours is None:
        return None
    return _clock_time(call.macros.now.astimezone(timezone(timedelta(hours=hours))))


def _no_args(fmt: Callable[[datetime], str]) -> Callable[[_Call], str | None]:
    return lambda call: fmt(call.macros.now) if call.bare() else None


def _idle(call: _Call) -> str | None:
    return humanize(call.macros.idle) if call.bare() else None


# ── the ONE table ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Macro:
    """One supported name. `handler` is the feature pass's renderer; `None` means a PRE-pass renders
    it (the token pass's values, the comment strip, the legacy `time_UTC` rewrite). `name` is the
    canonical spelling the reports show. `per_turn` = it may change every turn (`PER_TURN`)."""

    name: str
    handler: Callable[[_Call], str | None] | None = None
    per_turn: bool = False


#: EVERY name this build renders, lower-cased — what the feature pass dispatches on and what the
#: importers' "will render literally" report reads, so the two cannot disagree about what is
#: supported. Aliases map to their canonical row.
SUPPORTED: dict[str, Macro] = {
    "char": Macro("char"),
    "user": Macro("user"),
    ORIGINAL: Macro(ORIGINAL),
    "//": Macro("//"),
    "comment": Macro("comment", _nothing),
    "hidden_key": Macro("hidden_key", _nothing),
    "random": Macro("random", _random, per_turn=True),
    "pick": Macro("pick", _pick),
    "roll": Macro("roll", _roll, per_turn=True),
    "reverse": Macro("reverse", _reverse),
    "time": Macro("time", _time, per_turn=True),
    "time_utc": Macro("time", per_turn=True),  # the legacy `{{time_UTC±N}}`, rewritten in step 4
    "date": Macro("date", _no_args(lambda t: f"{_MONTHS[t.month - 1]} {t.day}, {t.year}"), per_turn=True),
    "weekday": Macro("weekday", _no_args(lambda t: _WEEKDAYS[t.weekday()]), per_turn=True),
    "isotime": Macro("isotime", _no_args(lambda t: f"{t.hour:02d}:{t.minute:02d}"), per_turn=True),
    "isodate": Macro("isodate", _no_args(lambda t: f"{t.year:04d}-{t.month:02d}-{t.day:02d}"), per_turn=True),
    "idle_duration": Macro("idle_duration", _idle, per_turn=True),
    "idleduration": Macro("idle_duration", _idle, per_turn=True),
}

#: The names whose rendering may change EVERY TURN — the subset whose use in head text costs a
#: re-prefill (`per_turn_note`). `pick`, `reverse` and the comments are stable, so they are not here.
PER_TURN = frozenset(name for name, spec in SUPPORTED.items() if spec.per_turn)

#: The scoped comment's closer.
_CLOSER = "{{///}}"

#: ST's legacy `{{time_UTC±N}}` (MacroEngine's rewrite source) — matched case-insensitively here (ST's
#: `UTC` is case-sensitive; recorded divergence), and with the feature pattern's lookbehind, so a
#: longer malformed brace run (`{{{{time_UTC+2}}`) is never touched.
_LEGACY_TIME = re.compile(r"(?<!\{)\{\{time_(UTC[+-]\d+)\}\}", re.I | re.A)


def _legacy_time(m: re.Match[str]) -> str:
    """Step 4's rewrite — ONLY when the offset is one the handler renders; otherwise the text stays
    byte-identical (a rewrite of something that then stays literal would edit the owner's typo)."""
    return m[0] if _utc_offset(m[1]) is None else f"{{{{time::{m[1]}}}}}"


#: A `{{char}}`/`{{user}}` nested in a feature argument — the one brace shape an argument admits.
_NESTED_VALUE = re.compile(r"\{\{(char|user)\}\}", re.I | re.A)

#: One INNERMOST feature call: a handled name (longest first, so `isotime` never loses to a shorter
#: prefix), then `}}` or a separator and an argument with no brace but a nested value token. The
#: lookbehind keeps a call out of a longer malformed brace run (`{{{{time}}`), the `TOKENS` rule.
#: The separator's whitespace and the argument are POSSESSIVE: an argument can only end at a brace,
#: so giving characters back can never find a `}}`, and without it an unclosed `{{random` followed by
#: a long whitespace run (a hostile card) backtracks quadratically.
_FEATURE = re.compile(
    r"(?<!\{)\{\{(?P<name>"
    + "|".join(
        re.escape(n) for n in sorted((n for n, s in SUPPORTED.items() if s.handler), key=len, reverse=True)
    )
    + r")(?:(?P<sep>::|:|\s++)(?P<args>(?:[^{}]|\{\{(?:char|user)\}\})*+))?\}\}",
    re.I | re.A,
)

#: What the importers sniff for: anything that OPENS like a field macro — a name, or the comment
#: marker, optionally after whitespace (ST's engine tolerates it). Wider than `TOKENS` on purpose:
#: `{{datetimeformat …}}` and `{{lastMessage}}` are not tokens here either, and they are exactly
#: what the report exists to name. The groups say whether it is padded and whether it is also a bare
#: `{{name}}` — the only shape in which a VOCABULARY name actually renders.
_MACRO_OPENER = re.compile(r"\{\{(?P<pad>\s*)(?P<name>//|[A-Za-z_][A-Za-z0-9_]*)(?P<close>\}\})?")


# ── the idle humanizer ─────────────────────────────────────────────────────────────────────────

#: moment's default `relativeTime` thresholds (`humanize.js`): ss, s, m, h, d, M.
_SS, _S, _M, _H, _D, _MONTH = 44, 45, 45, 22, 26, 11


def humanize(delta: timedelta | None) -> str:
    """moment's `duration.humanize()` in `en`, no suffix — what `{{idle_duration}}` says. `None` (no
    earlier message to measure from) is ST's "just now". Rounding is JS `Math.round` (half up), and a
    month is moment's `days * 4800 / 146097`."""
    if delta is None:
        return "just now"
    secs = abs(delta.total_seconds())

    def _round(x: float) -> int:
        return math.floor(x + 0.5)

    seconds, minutes, hours = _round(secs), _round(secs / 60), _round(secs / 3600)
    days = _round(secs / 86400)
    months = _round(secs / 86400 * 4800 / 146097)
    years = _round(secs / 86400 * 4800 / 146097 / 12)
    for test, text in (
        (seconds <= _SS, "a few seconds"),
        (seconds < _S, f"{seconds} seconds"),
        (minutes <= 1, "a minute"),
        (minutes < _M, f"{minutes} minutes"),
        (hours <= 1, "an hour"),
        (hours < _H, f"{hours} hours"),
        (days <= 1, "a day"),
        (days < _D, f"{days} days"),
        (months <= 1, "a month"),
        (months < _MONTH, f"{months} months"),
        (years <= 1, "a year"),
    ):
        if test:
            return text
    return f"{years} years"


# ── the importers' report ──────────────────────────────────────────────────────────────────────


def unrendered(texts: Iterable[str]) -> list[str]:
    """The macro names `texts` use that this build will pass through LITERALLY — sorted,
    lower-cased (the field resolves names case-insensitively, so `LastMessage` and `lastmessage` are
    one macro). For the importers' report line (R87/RP-3): leave-literal-on-miss is right for a
    typo, but a card built on `{{lastMessage}}` should say so at the door rather than in the first
    reply. A comment is never listed — the render strips it. A supported name is listed only when it
    is written padded (`{{ time }}`), and a VOCABULARY name also when it is not a bare token
    (`{{char:x}}`) — both render literally, so both are named."""
    names: set[str] = set()
    for text in texts:
        for m in _MACRO_OPENER.finditer(text):
            name = m["name"].lower()
            if name == "//":
                continue
            if name in VOCABULARY:
                renders = not m["pad"] and m["close"]
            else:
                renders = name in SUPPORTED and not m["pad"]
            if not renders:
                names.add(name)
    return sorted(names)


#: What an unrendered macro DOES, per surface: in prompt text the model reads it verbatim; in a
#: lorebook KEY the scan looks for the literal braces, so the entry never activates on it.
LITERAL_TEXT = "reach the model as literal text"
LITERAL_TEXT_OR_KEY = "reach the model as literal text, or never match as a key"


def unrendered_note(texts: Iterable[str], where: str, effect: str = LITERAL_TEXT) -> list[str]:
    """The ONE report line naming `unrendered(texts)` (nothing when there are none), worded once for
    both importers. `where` says whose text it was ("the card's text", "the lorebook's entries");
    `effect` says what that costs there (a book's keys fail differently from its content)."""
    names = unrendered(texts)
    if not names:
        return []
    listed = ", ".join(f"{{{{{n}}}}}" for n in names)
    return [f"macros in {where} that this build does not render {effect}: {listed}"]


def per_turn_in(text: str) -> list[str]:
    """The per-turn macros (`PER_TURN`) `text` uses, by canonical name, sorted — THE predicate both
    importers' cache warning asks. Comments are stripped first (a `{{random}}` inside an author note
    never renders), and a padded name is not a macro (it renders literally, never per turn)."""
    names: set[str] = set()
    for m in _MACRO_OPENER.finditer(_strip_comments(text)):
        name = m["name"].lower()
        if name in PER_TURN and not m["pad"]:
            names.add(SUPPORTED[name].name)
    return sorted(names)


def per_turn_note(texts: Iterable[str], noun: tuple[str, str]) -> list[str]:
    """The ONE cache-warning line (ISS-28, owner ruling 2026-10-06) — how many of `texts` (the
    HEAD-landing fields or entries, the caller's selection; `noun` = its singular/plural) carry a
    per-turn macro, and which ones. Nothing when none does. The cost is accepted, not hidden."""
    hits = [found for found in map(per_turn_in, texts) if found]
    if not hits:
        return []
    listed = ", ".join(f"{{{{{n}}}}}" for n in sorted({n for found in hits for n in found}))
    one = len(hits) == 1
    return [
        f"{len(hits)} {noun[0] if one else noun[1]} {'uses' if one else 'use'} a per-turn macro ({listed}) "
        f"— the prompt cache re-prefills every turn {'it is' if one else 'they are'} active"
    ]


# ── the pre-passes ─────────────────────────────────────────────────────────────────────────────


def _comment_markers(text: str) -> Iterator[tuple[int, int, Literal["open", "close", "note"]]]:
    r"""Every `{{//…}}` marker in `text`, in order: `(start, end, kind)`. A marker is ST's legacy
    comment rule (`/\{\{\/\/([\s\S]*?)\}\}/gm`) — non-greedy, across lines, closed by the FIRST
    `}}` — so an opener with no `}}` after it is not a marker, and neither is any later one (none of
    them can close either): the walk stops there, which keeps it linear on a hostile run of `{{//`.

    The kind is ST's: `{{///}}` CLOSES a scope; only an ARGUMENT-LESS `{{//}}` (whitespace inside is
    no argument) OPENS one; `{{// text}}` is a single-form NOTE wherever it sits — inside a scope too."""
    pos = 0
    while (start := text.find("{{//", pos)) != -1:
        close = text.find("}}", start + 4)
        if close == -1:
            return
        pos = close + 2
        marker = text[start:pos]
        yield start, pos, "close" if marker == _CLOSER else "open" if not marker[4:-2].strip() else "note"


def _strip_comments(text: str) -> str:
    """Step 1: every scoped `{{//}}…{{///}}` span removed — stack-paired, so pairs nest — together
    with every note `{{// …}}` and every unpaired bare opener (both single-form comments). Pairing
    BEFORE the single form is the load-bearing order (the single form would eat both markers and leak
    the body), and a note inside a scope never pairs with its closer (ST: only `{{//}}` opens). An
    orphan closer stays, literally (ST parity); an unclosed `{{//` is no marker and stays visible."""
    if "{{//" not in text:
        return text
    stack: list[tuple[int, int]] = []
    spans: list[tuple[int, int]] = []
    for start, end, kind in _comment_markers(text):
        if kind == "open":
            stack.append((start, end))
        elif kind == "note":
            spans.append((start, end))
        elif stack:
            spans.append((stack.pop()[0], end))
    spans += stack  # the bare openers no closer claimed: single-form comments
    kept: list[str] = []
    cursor = 0
    for start, end in sorted(spans):
        if start >= cursor:
            kept.append(text[cursor:start])
        cursor = max(cursor, end)  # a span inside an already-removed outer one is covered by it
    kept.append(text[cursor:])
    return "".join(kept)


def _fold_case(text: str) -> str:
    """`text` with every vocabulary TOKEN written in another ASCII case (`{{Char}}`, `{{USER}}`)
    rewritten to its canonical lower-case spelling. Walks `TOKENS`, so a name inside a malformed
    brace run is left exactly as typed, like everything else the renderer does not call a token;
    a name outside the vocabulary keeps its case too (the feature pass matches case-insensitively,
    and an unknown name renders literally — the owner should see what they wrote)."""

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
