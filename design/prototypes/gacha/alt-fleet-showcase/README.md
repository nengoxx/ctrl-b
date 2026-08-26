# CTRL/B Alt Fleet Selector Lab

Standalone prototype only. It does not import, modify, or integrate with the React app.

Open `index.html` through a local HTTP server. The prototype bundles copies of the four images currently dealt by the app's default four-host roster — `pegasus.webp`, `atlas.webp`, `3.webp`, and `4.webp` — in its own `assets/` folder so every approach compares the exact current set and the showcase remains portable. The production originals are untouched.

## Contents

- 8 genuinely different fleet-selector compositions.
- Shared mock roster and shared interactive dossier.
- Mobile-first responsive behavior.
- Keyboard focus, trapped modal focus, Escape/backdrop/× dismissal, focus return, and reduced-motion handling.
- Explicitly simulated dossier action; no command is sent anywhere.
- Current-image crop notes.
- `showcase-preview.jpg` for a one-image overview.

## Review readout

The strongest candidates after visual and feasibility review are:

1. **Signal Bands** — best balance of distinctive gacha identity and fleet-wide utility.
2. **Contact Sheet** — clearest, safest operational overview.
3. **Manga Grid** — strongest manga energy for a fixed four-machine fleet.

`Selector Rail` is the most familiar character-select interaction, but it weakens simultaneous fleet monitoring.

## Run

From this folder:

```bash
python3 -m http.server 8912
```

Then open `http://127.0.0.1:8912/`.

No build, dependency install, backend, app config, or repository commit is required.
