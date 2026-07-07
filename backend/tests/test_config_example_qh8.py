"""QH-8 drift-guard — `config.example.yaml` must stay loadable and mask-clean.

The template is the owner's bootstrap path (README: "copy to config.yaml and fill in"), but no
gate exercised it — a config-model change could silently rot it into a file that fails validation
on first boot. This pins: it parses, it validates against the live `Settings` model, its secret
placeholders are seen by the secret machinery, and `mask_secrets` scrubs every one of them.
"""

from __future__ import annotations

from pathlib import Path

from app.config import load_settings, mask_secrets, secret_values

EXAMPLE = Path(__file__).resolve().parents[2] / "config.example.yaml"


def test_example_config_loads_validates_and_masks():
    assert EXAMPLE.exists(), "config.example.yaml missing from the repo root"
    settings = load_settings(EXAMPLE)  # raises on YAML/validation rot

    # The file actually populated the model (not an accidental empty-mapping pass).
    assert settings.server.port, "server block did not load"
    assert settings.computers, "computers (fleet) block did not load"

    # The template's placeholder secrets are recognized as secrets and masked on read.
    dump = settings.model_dump()
    secrets = [v for v in secret_values(dump) if v]
    assert secrets, "template carries no recognizable secret placeholders — secret rules drifted?"
    masked_flat = str(mask_secrets(dump))
    for value in secrets:
        assert value not in masked_flat, f"secret placeholder {value!r} survives mask_secrets"
