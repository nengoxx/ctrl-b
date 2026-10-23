"""Central secret redaction (DESIGN.md §0.6, §11). Runs on any captured text before it lands in a
ToolResult / Event / log / SSE payload. Actions still mask their own known secrets at capture (the SSH
password, the shell's echo), and `ActionService._record` — the egress funnel every `invoke` outcome
passes — masks the whole result against the live config's secrets once more (`redact_result`, ISS-98).

`clip` is the ONE truncation of result text: every cut ends in `TRUNCATION_MARKER`, which is what lets
`redact` catch a secret the cut split in half (the straddle rule).
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any

from app.domain.result import ToolResult

_MASK = "••••"
#: Appended by `clip` to every cut of result text — `redact`'s straddle rule keys on it.
TRUNCATION_MARKER = "\n… [truncated]"
#: The shortest secret LEAD the straddle rule masks before a marker: a 3-char lead such as `sk-` is
#: shared by every key of its kind and discloses nothing; 4+ chars of a specific value start to.
_STRADDLE_MIN = 4


def clip(text: str, limit: int) -> str:
    """Head-clip `text` to `limit` chars + `TRUNCATION_MARKER` (unchanged when it fits)."""
    return text if len(text) <= limit else text[:limit] + TRUNCATION_MARKER


def _forms(secrets: Iterable[str | None]) -> list[str]:
    """The match set: each non-empty secret AND its JSON-escaped form (a value carrying `"`, `\\` or a
    non-ASCII char reads differently inside `json.dumps` text), deduped, LONGEST first — so a secret
    nested in a longer one (`abc` ⊂ `abcdef`) can never leave a remnant of the longer one."""
    out: set[str] = set()
    for s in secrets:
        if s:
            out.add(s)
            out.add(json.dumps(s)[1:-1])
    return sorted(out, key=len, reverse=True)


def _mask_lead(head: str, forms: list[str]) -> str:
    """The straddle rule on the text before one marker: the LONGEST lead (`len - 1` down to
    `_STRADDLE_MIN` chars) of ANY form that `head` ends with is masked, once — longest across forms,
    not first-match, so a short secret's lead is never left showing behind a longer secret's shorter one."""
    best = 0
    for form in forms:
        for n in range(len(form) - 1, best, -1):
            if n >= _STRADDLE_MIN and head.endswith(form[:n]):
                best = n
                break
    return head[:-best] + _MASK if best else head


def _redact_forms(text: str, forms: list[str]) -> str:
    for form in forms:
        if form in text:  # assign only on change — a str subclass (a `RunState` in `data`) passes as is
            text = text.replace(form, _MASK)
    if TRUNCATION_MARKER in text:
        parts = text.split(TRUNCATION_MARKER)
        for i in range(len(parts) - 1):  # every segment a marker follows — trailing or embedded
            parts[i] = _mask_lead(parts[i], forms)
        text = TRUNCATION_MARKER.join(parts)
    return text


def redact(text: str | None, secrets: Iterable[str | None] = ()) -> str | None:
    """Replace each non-empty secret value in `text` with a mask. Idempotent; order-independent (the
    forms are matched longest first, so nested secrets leave no remnant). Also masks each secret's
    JSON-escaped form. **The straddle rule:** before each `TRUNCATION_MARKER` in `text` (a `clip`
    cut, trailing or embedded), a secret the cut split — its first `n` chars, `n` ≥ 4, just before
    the marker — is masked too; a 3-char lead such as `sk-` is not a disclosure. Recorded residual:
    two OVERLAPPING (not nested) secrets may leave a fragment of the one replaced second."""
    if not text:
        return text
    return _redact_forms(text, _forms(secrets))


def _redact_value(value: Any, forms: list[str]) -> Any:
    if isinstance(value, str):
        return _redact_forms(value, forms)
    if isinstance(value, dict):
        return {k: _redact_value(v, forms) for k, v in value.items()}  # keys are structure, untouched
    if isinstance(value, list):
        return [_redact_value(v, forms) for v in value]
    return value


def redact_result(result: ToolResult, secrets: Iterable[str | None]) -> None:
    """Mask `secrets` in place across a result's `summary`, `output`, `error` and `data` (walked
    recursively: strings masked, dict values and list items recursed, keys and non-strings untouched).
    `artifacts` are server-side names/paths — masking one would break its download."""
    forms = _forms(secrets)
    if not forms:
        return
    result.summary = _redact_forms(result.summary, forms)
    if result.output:
        result.output = _redact_forms(result.output, forms)
    if result.error:
        result.error = _redact_forms(result.error, forms)
    if result.data:
        result.data = _redact_value(result.data, forms)
