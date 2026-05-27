"""Domain enums (DESIGN.md §2). StrEnum so values serialize as their string."""

from __future__ import annotations

from enum import StrEnum


class OSType(StrEnum):
    WINDOWS = "windows"
    LINUX = "linux"
    MACOS = "macos"

    @classmethod
    def coerce(cls, value: str | None) -> "OSType":
        """Map a free-form config string (e.g. 'Windows', 'LINUX') to an OSType.

        The live config.yaml stores os_type capitalized and the old server compares with
        `.lower()`; mirror that tolerance here. Unknown → LINUX (the common homelab default).
        """
        if not value:
            return cls.LINUX
        try:
            return cls(value.strip().lower())
        except ValueError:
            return cls.LINUX


class Risk(StrEnum):
    """Per-action risk (DESIGN.md §2). The post-v1 privilege ladder rides on this — set it on
    every action, even before the policy layer is built."""

    LOW = "low"
    MED = "med"
    HIGH = "high"


class Privilege(StrEnum):
    """The agent/actor privilege ladder (A1). Phase 2 uses CONFIRM for UI actions and FULL only
    where explicit; the full escalation UX lands post-v1."""

    READONLY = "readonly"
    CONFIRM = "confirm"
    AUTO_LOW = "auto_low"
    FULL = "full"


class Actor(StrEnum):
    """Who initiated an invocation — the audit subject written to every Event."""

    USER = "user"
    AGENT = "agent"
    SYSTEM = "system"
    AUTOMATION = "automation"


class RunState(StrEnum):
    """An action/tool invocation lifecycle (DESIGN.md §2). Expected outcomes (ERROR/DENIED/
    TIMEOUT) are *data* on a result, not exceptions — the agent reads and reacts to them."""

    PENDING = "pending"
    AWAITING_CONFIRM = "awaiting_confirm"
    RUNNING = "running"
    OK = "ok"
    ERROR = "error"
    DENIED = "denied"
    SKIPPED = "skipped"
    TIMEOUT = "timeout"
