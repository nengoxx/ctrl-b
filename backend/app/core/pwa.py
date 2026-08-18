"""The installed-PWA icon backdrop (D59 / W5) — the manifest's maskable icon, selected by the owner.

**Why the MANIFEST is dynamic while the icons are static.** Chrome 144+ treats a manifest icon URL as
IMMUTABLE: once a WebAPK is minted it never re-downloads the bytes at a URL it already has, so shipping
new bytes at `icon-maskable-512.png` would be a no-op for every installed phone. A *changed* icon URL is
what Chrome notices — and it is guaranteed to surface a "Review app update" suggestion in the installed
app's ⋮ menu (pre-144: a daily-throttled check plus a blocking identity dialog). So the variant lives in
the URL, the five PNGs are ordinary committed build artifacts, and `/manifest.webmanifest` is served by
`app.main` from the owner's `appearance.pwa_icon_background` rather than straight off disk.

**Closed allowlist, never a path.** The config value selects a FILENAME from `PWA_ICON_VARIANTS` by
lookup — there is no string interpolation of owner input into a URL anywhere in this module, and
`AppearanceCfg` validates against the same map so a bad value is a 422 rather than a 404 in the manifest.

**`transparent` keeps today's filename AND today's bytes.** It is the default and the pre-W5 behaviour,
so an owner who never touches the setting sees zero icon-update events: same URL, same bytes, nothing for
Chrome to review. The generator (`frontend/scripts/gen-pwa-icons.mjs`) guarantees the byte-identity.

Background on what composites the white box, and why an opaque maskable icon is the fix at all:
`docs/research/R28-pwa-installed-icon-backdrop.md` (§9 = the recommendation, §12 = the Chrome-144 addendum).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

#: The dist filename of the built manifest, and the URL the app serves it at. Both are named here so the
#: startup loader and the route can never drift into two different spellings.
PWA_MANIFEST_FILENAME = "manifest.webmanifest"
PWA_MANIFEST_PATH = "/manifest.webmanifest"

#: The owner-selectable maskable icons: `id → filename in frontend/public/` (copied verbatim into `dist/`).
#: Each id is one baked-in backdrop; the ART is identical across them. `transparent` is TODAY'S file, listed
#: by its unchanged name on purpose (see the module docstring). Adding a variant = a row here + the matching
#: PNG + a `gen-pwa-icons.mjs` backdrop + a Conf option — pinned together by `test_arch_invariants_sys10.py`.
PWA_ICON_VARIANTS: dict[str, str] = {
    "transparent": "icon-maskable-512.png",
    "ink": "icon-maskable-512-ink.png",
    "night": "icon-maskable-512-night.png",
    "orchid": "icon-maskable-512-orchid.png",
    "paper": "icon-maskable-512-paper.png",
}

#: The unseeded / unknown answer: the pre-W5 file, so the feature is inert until the owner picks something.
DEFAULT_PWA_ICON_BG = "transparent"

#: The manifest `purpose` this module rewrites. Matched by EQUALITY, not by token membership: a hypothetical
#: `"any maskable"` entry serves the browser-tab / splash paths too, and giving those an opaque backdrop is a
#: different decision from the one the owner made here (R28 §9.1 keeps the `any` icons transparent).
_MASKABLE_PURPOSE = "maskable"


def maskable_src(variant: str | None) -> str:
    """The manifest `src` for `variant` — `None` or an unknown id → the default (never raises).

    Degrades rather than raising because this sits on the request path of the one file that decides whether
    an installed app can be updated at all: `AppearanceCfg`'s validator is the input gate, so anything
    reaching here with a bad id is already a bug we would rather serve a working manifest through.
    """
    filename = PWA_ICON_VARIANTS.get(variant or DEFAULT_PWA_ICON_BG)
    if filename is None:
        logger.warning("unknown pwa icon variant %r — serving %r", variant, DEFAULT_PWA_ICON_BG)
        filename = PWA_ICON_VARIANTS[DEFAULT_PWA_ICON_BG]
    return f"/{filename}"  # root-relative, matching the static `icons[].src` in vite.config.ts


def patch_manifest(doc: dict[str, Any], variant: str | None) -> dict[str, Any]:
    """A COPY of `doc` with every `purpose: maskable` icon repointed at `variant`'s file.

    A manifest with no maskable entry (or no `icons` at all) comes back unchanged — the app must serve
    whatever the build emitted, not a manifest this module reshaped.
    """
    icons = doc.get("icons")
    if not isinstance(icons, list):
        return dict(doc)
    src = maskable_src(variant)
    patched = [
        {**icon, "src": src} if isinstance(icon, dict) and icon.get("purpose") == _MASKABLE_PURPOSE else icon
        for icon in icons
    ]
    return {**doc, "icons": patched}


def if_none_match_matches(header: str | None, etag: str) -> bool:
    """RFC 9110 §13.1.2 WEAK comparison of an `If-None-Match` header against `etag` (a quoted strong tag).

    Weak is the correct comparison for a GET precondition, so `W/"x"` matches `"x"`; `*` matches anything
    we hold; the header is a comma-separated list. Lives here because the manifest route is its only user
    — move it to a shared home the moment a second route needs it."""
    if not header:
        return False
    for raw in header.split(","):
        candidate = raw.strip()
        if candidate == "*":
            return True
        if candidate.removeprefix("W/") == etag.removeprefix("W/"):
            return True
    return False


def load_base_manifest(dist: Path) -> dict[str, Any] | None:
    """Parse `dist/manifest.webmanifest` once at startup — `None` if it is missing or unreadable.

    `None` means "serve nothing dynamic": the caller skips registering the route and the SPA file route
    keeps serving whatever is on disk. A malformed manifest must not stop the control panel from booting
    (the degrade-never-brick rule the media mounts follow).
    """
    path = dist / PWA_MANIFEST_FILENAME
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.error("PWA manifest unreadable (%s) — serving it statically: %s", path, exc)
        return None
    if not isinstance(doc, dict):
        logger.error("PWA manifest %s is not an object — serving it statically", path)
        return None
    return doc


def available_variants(dist: Path) -> frozenset[str]:
    """Which variants actually have their PNG in `dist` — checked once at startup (dist is immutable per
    deploy). A configured variant missing from this set falls back to the default: a build that shipped
    without one of the icons degrades to the old look instead of pointing the manifest at a 404."""
    present = frozenset(name for name, file in PWA_ICON_VARIANTS.items() if (dist / file).is_file())
    missing = set(PWA_ICON_VARIANTS) - present
    if missing:
        logger.warning("PWA icon variants absent from the build: %s", ", ".join(sorted(missing)))
    return present
