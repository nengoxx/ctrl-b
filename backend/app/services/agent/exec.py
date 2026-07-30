"""The ONE user-`!exec` implementation (D41 Slice 5, wave 2).

`run_user_exec` runs the owner's `!<cmd>` through the `run_shell` action at FULL privilege (so it
executes + is audited as an `Event`) and persists the command + result into the thread as an
`assistant` tool_call + `tool` result pair — the exact shape the agent loop produces, so it renders
as a command bubble AND feeds the agent's context on the next turn. The assistant + tool rows commit
in ONE `Database.transaction()` (SYS-1 atomicity).

This block used to live inline in the `/exec` endpoint. Slice 5's steer drain (`_drive`'s Drain A)
must run the SAME logic when it dequeues an `exec` steer, so it was EXTRACTED here verbatim: the
endpoint and the drain both call this — one implementation, zero duplication.

The `shell.user_exec_enabled` gate is the CALLER's responsibility (fail-closed at each site): the
endpoint checks it up-front (403), and the drain re-checks it LIVE at dequeue time (D41 fail-closed —
disabling the shell mid-queue must drop a queued command, never run it). This helper assumes the gate
already passed and just runs + persists.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.domain.conversation import Message, ToolCallPart, ToolResultPart
from app.domain.enums import Actor, Privilege, RunState
from app.domain.event import ORIGIN_USER_CHAT
from app.domain.result import ToolResult

if TYPE_CHECKING:
    from app.services.action_service import ActionService
    from app.services.conversation import MessageRepo


@dataclass
class ExecOutcome:
    """What `run_user_exec` produced: the synthesized `call_id` (the `/exec` response's `callId`), the
    persisted `assistant` message's `id` (the steer drain's `steer.applied.messageId`), and the
    `run_shell` `ToolResult` (the endpoint reports its `state`)."""

    call_id: str
    assistant_id: str
    result: ToolResult


async def run_user_exec(
    actions: ActionService, messages: MessageRepo, thread_id: str, command: str
) -> ExecOutcome:
    """Invoke `run_shell` at FULL for the owner's `!<cmd>`, then persist the assistant tool_call + tool
    result pair atomically (SYS-1). The single implementation shared by the `/exec` endpoint and the
    D41 steer drain. Caller must have already enforced `shell.user_exec_enabled` (fail-closed)."""
    outcome = await actions.invoke(
        "run_shell",
        {"command": command},
        origin=ORIGIN_USER_CHAT,
        actor=Actor.USER,
        privilege=Privilege.FULL,
    )
    result = outcome.result or ToolResult(state=RunState.ERROR, summary="run_shell produced no result")

    call_id = uuid.uuid4().hex
    assistant = Message(
        thread_id=thread_id,
        role="assistant",
        actor=Actor.USER,
        parts=[
            ToolCallPart(call_id=call_id, tool="run_shell", args={"command": command}, state=result.state)
        ],
    )
    tool_msg = Message(
        thread_id=thread_id,
        role="tool",
        actor=Actor.USER,
        parts=[ToolResultPart(call_id=call_id, result=result)],
    )
    async with messages.db.transaction():
        await messages.add(assistant)
        await messages.add(tool_msg)
    return ExecOutcome(call_id=call_id, assistant_id=assistant.id, result=result)
