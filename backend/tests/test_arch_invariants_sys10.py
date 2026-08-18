"""SYS-10 drift-guard — the default theme agrees across the stack.

The backend seeds `AppearanceCfg.theme` and the frontend heals an unknown/persisted theme to its own
`DEFAULT_THEME` (`theme-engine/resolve.ts`). If the two drift apart, a fresh install would render one
default while the server reports another — the exact split SYS-10 flagged. This reads the FE constant
from source with a pinned regex and asserts equality, so a change on either side fails the gate until
both move together.

The D59 PWA-icon guards below are the same shape for the same reason: the backend's variant map, the
five PNGs and the Conf option list are three copies of one list that must move together.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.config import AppearanceCfg
from app.core.pwa import DEFAULT_PWA_ICON_BG, PWA_ICON_VARIANTS

BACKEND = Path(__file__).resolve().parents[1]
_FRONTEND = BACKEND.parent / "frontend"
_FE_RESOLVE = _FRONTEND / "src" / "theme-engine" / "resolve.ts"
_FE_CONF_TAB = _FRONTEND / "src" / "tabs" / "ConfTab.tsx"
_FE_VITE_CONFIG = _FRONTEND / "vite.config.ts"

# `export const DEFAULT_THEME: ThemeId = "cosmos";` (vapor until D51 V0) — pinned to that exact
# declaration so a rename or a moved constant fails loudly here rather than silently skipping the
# comparison. The VALUE is read from source, never hardcoded: this guard only asserts the two agree.
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


# ── D59 / W5: the installed-icon backdrop variants agree across the stack ───────────────────────────

# `const PWA_ICON_BACKDROPS: {...}[] = [ … ];` in ConfTab — pinned to that exact declaration so a rename
# fails loudly here instead of silently skipping the comparison (the `_DEFAULT_THEME_RE` convention).
_CONF_BACKDROPS_RE = re.compile(r"const PWA_ICON_BACKDROPS\b[^=]*=\s*\[(.*?)\n\];", re.DOTALL)
_OPTION_VAL_RE = re.compile(r'\bval:\s*"([^"]+)"')

# The `icons[]` ENTRY carrying `purpose: "maskable"` in vite.config.ts. Anchored to the object (the
# entries have no nested braces) rather than to a bare substring: a whole-file search would pass on a
# filename that survives only inside a comment, which is exactly the drift this pins.
_MASKABLE_ENTRY_RE = re.compile(r'\{[^{}]*purpose:\s*"maskable"[^{}]*\}', re.DOTALL)
_ENTRY_SRC_RE = re.compile(r'\bsrc:\s*"([^"]+)"')

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _png_dimensions(path: Path) -> tuple[int, int]:
    """(width, height) from a PNG's IHDR — signature (8 bytes) + chunk length/type (8) + w/h (4+4).
    Stdlib only: the backend deliberately ships no image decoder (`core/media.py` docstring)."""
    head = path.read_bytes()[:24]
    assert head[:8] == _PNG_SIGNATURE, f"{path.name} is not a PNG"
    return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")


def test_every_pwa_icon_variant_has_a_real_512_png() -> None:
    """Each map entry names a PNG the build actually copies into `dist/`, and it really is a 512² PNG.
    A missing one degrades to the default at runtime (`core.pwa.available_variants`) — silently, which is
    exactly why it is a test; a wrong-sized one reaches the launcher and is nobody's silence to keep."""
    for variant, filename in PWA_ICON_VARIANTS.items():
        path = _FRONTEND / "public" / filename
        assert path.is_file(), (
            f"pwa icon variant {variant!r} names {filename!r}, which is not in frontend/public/ — "
            "run `npm run icons` from frontend/ (scripts/gen-pwa-icons.mjs)"
        )
        assert _png_dimensions(path) == (512, 512), (
            f"{filename} is {_png_dimensions(path)}, not 512x512 — the manifest declares "
            '`sizes: "512x512"` for the maskable slot'
        )


def test_the_apple_touch_icon_index_html_names_is_a_real_180_png() -> None:
    """iOS ignores the manifest, so this one is wired straight into `index.html` (D59) — the link and the
    file have to move together, and it must be 180² for the add-to-home-screen path."""
    index_html = _FRONTEND / "index.html"
    match = re.search(r'rel="apple-touch-icon"\s+href="/([^"]+)"', index_html.read_text(encoding="utf-8"))
    assert match is not None, f'no `rel="apple-touch-icon"` link in {index_html} — update this guard'
    path = _FRONTEND / "public" / match.group(1)
    assert path.is_file(), f"index.html links {match.group(1)}, which is not in frontend/public/"
    assert _png_dimensions(path) == (180, 180)


def test_conf_backdrop_options_match_the_backend_variants() -> None:
    """The Conf row writes one of these ids into `appearance.pwa_icon_background`; an id the backend does
    not know is a 422 the owner would meet by clicking a chip."""
    assert _FE_CONF_TAB.is_file(), f"ConfTab moved — update this guard: {_FE_CONF_TAB}"
    block = _CONF_BACKDROPS_RE.search(_FE_CONF_TAB.read_text(encoding="utf-8"))
    assert block is not None, (
        f"could not find `const PWA_ICON_BACKDROPS … = [ … ];` in {_FE_CONF_TAB} — the option list was "
        "renamed or reshaped; update this guard (and confirm the ids still match PWA_ICON_VARIANTS)"
    )
    assert _OPTION_VAL_RE.findall(block.group(1)) == list(PWA_ICON_VARIANTS)


def test_the_built_manifest_still_names_the_stable_maskable_file() -> None:
    """The STABLE-URL guarantee (D59): the `purpose: "maskable"` entry in `vite.config.ts` must keep
    naming the DEFAULT variant's file, which every already-installed app has already minted. Serving
    different BYTES at that URL is invisible to Chrome 144+, so the default variant's IDENTITY is what
    makes "the owner stays on Clear" mean zero icon-update events.

    The byte-identity half of that guarantee is enforced where it can be — in the generator, which hashes
    its candidate against a pinned sha256 and REFUSES to write on drift (`gen-pwa-icons.mjs`). It cannot
    live here: CI never runs the generator, so a test could only compare the committed file to itself."""
    assert _FE_VITE_CONFIG.is_file(), f"vite config moved — update this guard: {_FE_VITE_CONFIG}"
    entries = _MASKABLE_ENTRY_RE.findall(_FE_VITE_CONFIG.read_text(encoding="utf-8"))
    assert len(entries) == 1, (
        f'expected exactly one `purpose: "maskable"` icon entry in {_FE_VITE_CONFIG}, found '
        f"{len(entries)} — the backend rewrites that ONE entry's `src` (app/core/pwa.py)"
    )
    src = _ENTRY_SRC_RE.search(entries[0])
    assert src is not None and src.group(1) == f"/{PWA_ICON_VARIANTS[DEFAULT_PWA_ICON_BG]}", (
        "the manifest's maskable icon must keep the stable filename — the backend rewrites this `src` "
        f"per request, so vite.config.ts must keep naming the DEFAULT variant's file, got {entries[0]!r}"
    )
