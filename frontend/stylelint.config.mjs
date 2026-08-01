// stylelint config — the theme-engine CSS-invariant gate (Hardening slice v2 item ⑨, §14.15.1).
//
// ADOPTION MODE = WARN-FIRST (TRIAGE-3 / §14.15.1 ⑨): every rule is `severity: "warning"` EXCEPT the
// two custom accent rules, which are correctness invariants with zero current violations, so they run
// as ERRORS. A warning-only run exits 0 — the gate (`npm run check-all` → `tools/check.py`) goes RED
// only on an error, exactly the warn-first intent: the warning inventory is a burn-down backlog, not a
// blocker. Do NOT scatter `/* stylelint-disable */` in product CSS — every exemption lives here as a
// commented ladder waiver (the §14.15.3 vapor-assimilation tracker), so it SHRINKS as vapor graduates.

export default {
  plugins: [
    "stylelint-high-performance-animation",
    "./stylelint/ctrlb-accent-rules.js", // ctrlb/accent-fill-contexts + ctrlb/accent-is-color
  ],

  rules: {
    // ── Keyframe hygiene (§14.15.3 hook ③) ──────────────────────────────────────────────────────
    // @keyframes names are GLOBAL (no @scope isolation), so every theme prefixes its own to avoid
    // cross-theme collisions. The per-dir prefix is enforced in `overrides` below; this base rule is
    // the catch-all kebab-case floor for any stylesheet not matched by an override.
    "keyframes-name-pattern": [
      "^[a-z][a-z0-9]*(-[a-z0-9]+)*$",
      { severity: "warning", message: "keyframe names must be kebab-case" },
    ],

    // ── Animation-perf budget (§14.11: transform/opacity only) ───────────────────────────────────
    // Flags transitions/animations on layout- or paint-triggering properties (anything but transform
    // /opacity/filter). Warn-first: the inventory is the F-budget burn-down list, NOT auto-fixed here.
    "plugin/no-low-performance-animation-properties": [
      true,
      { severity: "warning", ignore: "paint-properties" },
    ],

    // ── Custom-property naming (kebab-case) ──────────────────────────────────────────────────────
    // stylelint tests the name WITHOUT the leading `--`; allows digits in segments (--surface-2, --text-3).
    "custom-property-pattern": [
      "^([a-z][a-z0-9]*)(-[a-z0-9]+)*$",
      { severity: "warning", message: "custom properties must be kebab-case" },
    ],

    // ── The two bespoke accent correctness rules (ERRORS — see plugin header) ────────────────────
    "ctrlb/accent-fill-contexts": true,
    "ctrlb/accent-is-color": true,
  },

  overrides: [
    // Per-theme @keyframes prefix. Each theme namespaces its keyframes with its theme-id.
    {
      files: ["src/themes/minimal/**/*.css"],
      rules: {
        "keyframes-name-pattern": [
          "^minimal-",
          { severity: "warning", message: "minimal's @keyframes must be prefixed `minimal-`" },
        ],
      },
    },
    {
      files: ["src/themes/cosmos/**/*.css"],
      rules: {
        "keyframes-name-pattern": [
          "^cosmos-",
          { severity: "warning", message: "cosmos's @keyframes must be prefixed `cosmos-`" },
        ],
      },
    },
    {
      files: ["src/themes/frontier/**/*.css"],
      rules: {
        "keyframes-name-pattern": [
          "^frontier-",
          { severity: "warning", message: "frontier's @keyframes must be prefixed `frontier-`" },
        ],
      },
    },
    {
      files: ["src/themes/vapor/**/*.css"],
      rules: {
        "keyframes-name-pattern": [
          "^vapor-",
          { severity: "warning", message: "vapor's @keyframes must be prefixed `vapor-`" },
        ],
      },
    },
    {
      files: ["src/theme-engine/kit/**/*.css"],
      rules: {
        "keyframes-name-pattern": [
          "^kit-",
          { severity: "warning", message: "the Kit's @keyframes must be prefixed `kit-`" },
        ],
      },
    },
  ],
};
