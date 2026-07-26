"""`python -m app.config_migration --check|--apply` — the entry point `install.sh` and `update.sh` call.

Kept to the one line that hands off to the runner, so the module stays importable (the boot check in
`main.py` imports `detect`) without executing anything.
"""

from __future__ import annotations

import sys

from app.config_migration import main

if __name__ == "__main__":
    sys.exit(main())
