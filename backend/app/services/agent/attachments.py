"""The claim, as the chat stack calls it (D68 / ATTACHMENTS_PLAN §3).

`core.attachments` owns the store and knows nothing about `Settings`; this is the two-line seam that
binds the workspace root and the `attachments:` tunables to it and hops the blocking filesystem work
off the event loop. It exists so the **two** claim sites — the chat POST (`api/agent.py`) and the
steer drain (`services/agent/session.py`, E7) — call ONE thing: a second call site that forgot the
age bound, the thread hop or the cap would be a claim with different rules, which is exactly how a
transport contract rots.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from app.core.attachments import claim_all

if TYPE_CHECKING:
    from collections.abc import Sequence

    from app.config import Settings
    from app.domain.conversation import AttachmentPart


async def claim_attachments(
    settings: Settings, thread_id: str, attachment_ids: Sequence[str]
) -> list[AttachmentPart]:
    """Claim every staged id of one send into `thread_id`, returning the parts to persist.

    Raises `StoreWriteError(409, …)` on the first consumed/expired/unknown id — the caller decides
    what that means for its path (the POST refuses the send; the drain says so in a `notice` and
    persists the text it already holds). Empty in, empty out and no thread hop: the overwhelmingly
    common send carries no files and must cost nothing.
    """
    if not attachment_ids:
        return []
    return await asyncio.to_thread(
        claim_all,
        settings.home_dir(),
        thread_id,
        list(attachment_ids),
        max_age_s=settings.attachments.staging_orphan_s,
    )
