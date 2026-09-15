"""C-F5 — `server.debug` drives the APP logger's level, and only the app logger's.

`server.debug` has existed since Phase 0 and was read by nothing but `/health`, while the one DEBUG
trail the app writes — `_log_presence`'s per-tick line, documented as the diagnostic for a drifted
DHCP reservation — could not be turned on without editing source. The fix is one level set inside
`lifespan`, where settings exist.

The scope is the load-bearing half. Flipping the ROOT level instead would turn on every dependency
at once, and since D71's `--ws-ping-interval 5` that means `websockets` logging a frame every five
seconds — burying the very trail the owner flipped the flag to read. `basicConfig` still owns the
handler and root stays INFO.

Runs on a temp `$CTRLB_HOME`/`CTRLB_CONFIG` — never the operator's real config.yaml.
"""

from __future__ import annotations

import logging
from pathlib import Path

import pytest
from test_media_g5 import home, make_client

__all__ = ["home"]  # the fixture is imported, not redefined — one temp-workspace recipe


@pytest.mark.parametrize("debug", [True, False])
def test_the_app_logger_follows_server_debug_and_root_stays_INFO(home: Path, debug: bool) -> None:
    # Written WHOLE, not appended: a second top-level `server:` key is a duplicate the migration's
    # ruamel reader refuses outright (exit 78 at the import-time preflight), even though PyYAML's
    # last-wins would have hidden it.
    (home / "config.yaml").write_text(
        f"server:\n  port: 5433\n  debug: {str(debug).lower()}\n", encoding="utf-8"
    )
    # Root's level is whatever the process already set (`basicConfig` is a no-op once root has a
    # handler — pytest's, here), so the property is that the lifespan LEAVES IT ALONE, not that it is
    # any particular number. That is the half that keeps `websockets`' 5 s ping frames out of the log.
    before = logging.getLogger().level
    with make_client():  # the level is set in `lifespan`, which the context manager runs
        assert logging.getLogger("app").level == (logging.DEBUG if debug else logging.INFO)
        assert logging.getLogger().level == before
        # The set is symmetric on purpose: a one-directional flip would leave the level wherever the
        # previous boot in this process put it — which in a test run is another test's config.
        assert logging.getLogger("app").isEnabledFor(logging.DEBUG) is debug
