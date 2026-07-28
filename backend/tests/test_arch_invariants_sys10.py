"""SYS-10 drift-guard — the default theme agrees across the stack.

The backend seeds `AppearanceCfg.theme` and the frontend heals an unknown/persisted theme to its own
`DEFAULT_THEME` (`theme-engine/resolve.ts`). If the two drift apart, a fresh install would render one
default while the server reports another — the exact split SYS-10 flagged. This reads the FE constant
from source with a pinned regex and asserts equality, so a change on either side fails the gate until
both move together.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.config import AppearanceCfg

BACKEND = Path(__file__).resolve().parents[1]
_FE_RESOLVE = BACKEND.parent / "frontend" / "src" / "theme-engine" / "resolve.ts"

# `export const DEFAULT_THEME: ThemeId = "vapor";` — pinned to that exact declaration so a rename or a
# moved constant fails loudly here rather than silently skipping the comparison.
_DEFAULT_THEME_RE = re.compile(r'\bDEFAULT_THEME\s*:\s*ThemeId\s*=\s*"([^"]+)"')


def test_backend_default_theme_matches_the_frontend() -> None:
    assert _FE_RESOLVE.is_file(), f"FE theme resolver moved — update this guard: {_FE_RESOLVE}"
    match = _DEFAULT_THEME_RE.search(_FE_RESOLVE.read_text(encoding="utf-8"))
    assert match is not None, (
        f'could not find `DEFAULT_THEME: ThemeId = "…"` in {_FE_RESOLVE} — the constant was renamed '
        "or reshaped; update this guard (and confirm the backend default still matches)"
    )
    fe_default = match.group(1)
    assert AppearanceCfg().theme == fe_default, (
        f"default-theme drift: backend AppearanceCfg.theme={AppearanceCfg().theme!r} but the frontend "
        f"DEFAULT_THEME={fe_default!r} — move both together"
    )
