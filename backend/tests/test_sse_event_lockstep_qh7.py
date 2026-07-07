"""QH-7 drift-guard — session.py's emitter docstring IS the SSE event inventory (DESIGN §12).

DESIGN §12 promises its wire-contract inventory "mirrors `session.py`'s emitter docstring — keep
the two in lockstep when adding events". This pins the code half structurally: the event names the
module docstring lists must equal the event-name literals the module actually constructs — so
adding an `AgentEvent("x", ...)` without documenting it (or documenting an event that is never
emitted) fails the gate. Found live at the QH audit (2026-07-07): `notice` was emitted
(session.py) and inventoried (DESIGN §12) but missing from the docstring.

DESIGN §12 itself stays prose — it only has to mirror the (now-guarded) docstring.
"""

from __future__ import annotations

import re
from pathlib import Path

import app.services.agent.session as session_mod

# Docstring inventory lines look like `    message.start    {messageId, role, agent}   # ...` —
# a 4-space indent, the event name, then its payload shape in braces.
_DOC_EVENT = re.compile(r"^\s{4}([a-z]+(?:\.[a-z]+)?)\s+\{", re.MULTILINE)
# Every AgentEvent is constructed with a literal name (verified at the audit); `\s*` spans the
# newline of multi-line constructions.
_EMITTED_EVENT = re.compile(r'AgentEvent\(\s*"([a-z]+(?:\.[a-z]+)?)"')


def test_docstring_event_inventory_matches_emitted_events():
    doc_events = set(_DOC_EVENT.findall(session_mod.__doc__ or ""))
    src = Path(session_mod.__file__).read_text(encoding="utf-8")
    emitted = set(_EMITTED_EVENT.findall(src))
    assert doc_events, "no events parsed from the session.py docstring — did its format change?"
    assert emitted, "no AgentEvent literals parsed from session.py — did the emit pattern change?"
    assert doc_events == emitted, (
        f"session.py docstring vs emitted events drifted (DESIGN §12 lockstep): "
        f"documented-but-never-emitted={sorted(doc_events - emitted)} "
        f"emitted-but-undocumented={sorted(emitted - doc_events)}"
    )
