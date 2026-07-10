"""ctrl-b backend (FastAPI). See ../../docs/ARCHITECTURE.md."""

from importlib.metadata import PackageNotFoundError, version

# The version is derived from the git tag at install time (hatch-vcs; backend/pyproject.toml
# [tool.hatch.version]) and read from the installed dist metadata — the single source of truth.
# It refreshes whenever `pip install -e .` runs (install.sh does, on every prod re-pin / dev
# setup), so prod reports the exact release tag. The fallback only triggers when app is imported
# without being pip-installed (not a supported run mode) — loud, so it's obvious in /api/health.
try:
    __version__ = version("ctrl-b-dashboard")
except PackageNotFoundError:
    __version__ = "0.0.0+not-installed"
