"""Greeting seeding (Phase 23 / D70, ROLEPLAY_PLAN §4.2, ruling 11 + Emma F5).

`AgentDef.greeting` (a card's `first_mes`) is a REAL assistant message persisted into a new
thread — not an empty-state render. An empty-state greeting never reaches the wire and anchors
nothing; a persisted one is the character's opening turn for the model exactly as it is for the
owner, and it is written the way the agent loop writes every other assistant turn
(`actor=AGENT` + the resolved agent name) so attribution and the who-line read correctly.

ONE helper, called from exactly the two enumerated INTERACTIVE creation seams (§4.2): the explicit
new-thread endpoint and the chat endpoint's auto-created thread, the latter only AFTER
`_auto_route_agent` has resolved who the turn belongs to. Automation and subagent threads are
ruled out and reach this module from nowhere — a headless run wants no greeting in its transcript.

**Compaction, by design:** the seeded message is ordinary history, so a long thread's compactor may
fold it into the summary like any other old turn. That is correct — the head's persona carries the
identity, the greeting is only how the conversation opened — and it is pinned as such in
`tests/test_roleplay_s1.py` so nobody later "fixes" it into an immune row.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.domain.conversation import Message, TextPart
from app.domain.enums import Actor
from app.services.agent.macros import macros_for

if TYPE_CHECKING:
    from app.config import Settings
    from app.domain.agent import AgentDef
    from app.domain.conversation import Thread
    from app.services.conversation import MessageRepo


async def seed_greeting(
    messages: MessageRepo, settings: Settings, thread: Thread, agent: AgentDef
) -> Message | None:
    """Persist `agent`'s greeting as the thread's opening assistant turn. Returns the message, or
    `None` when the agent has no greeting — including one that only becomes empty once its macros
    render, so an empty seed is impossible to produce (ruling 10's zero-cost coexistence).

    Substituted at SEED time (§4.2): the greeting is stored history from here on, so it carries the
    `{{char}}`/`{{user}}` values that were true when the conversation opened, like every other
    persisted turn — nothing re-renders it later."""
    text = macros_for(agent, settings).render(agent.greeting.strip()).strip()
    if not text:
        return None
    return await messages.add(
        Message(
            thread_id=thread.id,
            role="assistant",
            actor=Actor.AGENT,
            agent=agent.name,
            parts=[TextPart(text=text)],
        )
    )
