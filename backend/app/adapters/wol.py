"""Wake-on-LAN — a thin wrapper over `wakeonlan.send_magic_packet` (the same lib the live
`wol_server_win.py` uses). Sending is fire-and-forget UDP; it's blocking enough to keep off the
event loop, so the service calls `send_magic` via `asyncio.to_thread`.
"""

from __future__ import annotations

from wakeonlan import send_magic_packet


def send_magic(mac: str) -> None:
    """Broadcast a magic packet to `mac`. Raises `ValueError` on a malformed MAC (the action
    layer turns that into a DENIED ToolResult, never a 500)."""
    send_magic_packet(mac)
