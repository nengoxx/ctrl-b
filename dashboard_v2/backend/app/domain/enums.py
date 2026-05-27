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
