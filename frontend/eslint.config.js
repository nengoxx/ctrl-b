import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

// Flat config (ESLint 9). Layered by zone (docs/QUALITY.md, DECISIONS D33):
//  - src/**        : TYPE-AWARE linting (the high-value tier) + React rules.
//  - tests/, e2e/  : linted, but type-aware rules OFF for now — 1b-2b upgrades
//    configs, scripts  these to type-aware via per-zone tsconfig.json.
// Prettier owns formatting, so eslint-config-prettier is applied LAST to switch
// off any stylistic rules that would fight it.
export default tseslint.config(
  // Build outputs & artifacts (mirrors .prettierignore).
  {
    ignores: [
      "dist",
      "dev-dist",
      "coverage",
      "test-results",
      "playwright-report",
      "**/*.tsbuildinfo",
    ],
  },

  // Baseline for every JS/TS file: recommended JS + non-type-checked TS (sets the
  // TS parser everywhere; the type-aware layer is added to src only, below).
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // App source — type-aware linting + React hooks/refresh.
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Async functions ARE fine as JSX event handlers (React discards the return; the
      // called fns self-handle errors). Keep the check for the dangerous `arguments`
      // position (async passed to forEach/setTimeout/etc.). typescript-eslint docs.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      // React Compiler-era rules (react-hooks v7) — DEFERRED to `warn`, deliberately.
      // These flag real Rules-of-React patterns (NOT false positives), but every current hit
      // is an intentional, correct pattern here: "sync an editable draft from async-loaded
      // data" (set-state-in-effect) and the ubiquitous, concurrent-safe "latest ref" idiom
      // (refs). A violating component is only *skipped for optimization* by React Compiler —
      // never broken — and the Compiler itself is deferred (UI_AUDIT F13). So fixing these now
      // is high-churn / near-zero benefit. We keep them at `warn` so the warnings ARE the
      // React-Compiler-readiness checklist (clear them when F13 lands). Do NOT set to `off` —
      // that hides the backlog and any future genuine violation. Full rationale: docs/QUALITY.md.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },

  // Theme code must not hand-roll rAF loops (§14.15.1-A rider c). Every canvas theme drives its
  // animation through the engine-owned `safeRafLoop` (try/catch per tick → cancel + reportError on
  // throw, never error-per-frame) instead of a bare `requestAnimationFrame` loop. Keyed to
  // CallExpression so a `typeof requestAnimationFrame` availability GUARD (camera.ts) never trips it.
  {
    files: ["src/themes/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: 'CallExpression[callee.name="requestAnimationFrame"]',
          message: "theme rAF loops must go through theme-engine/safeRafLoop (§14.15.1-A rider c)",
        },
      ],
    },
  },

  // Tests + e2e — TYPE-AWARE lint (projectService finds tests/tsconfig.json + e2e/tsconfig.json,
  // 1b-2b). Keeps the high-value rules (no-floating-promises catches a genuinely-missing `await`),
  // with targeted test-idiom relaxations below.
  {
    files: ["tests/**/*.{ts,tsx}", "e2e/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Mocks must be `async` to match real async interfaces (Audio.play/fetch/Response.json/
      // getUserMedia) even with no `await`; and `act(async () => …)` is the RTL flush idiom.
      "@typescript-eslint/require-await": "off",
      // Assertions legitimately poke loosely-typed parsed JSON (localStorage round-trips).
      "@typescript-eslint/no-unsafe-member-access": "off",
      // String() in mocks/assertions on loosely-typed values (RequestInfo|URL); FP-prone in tests.
      "@typescript-eslint/no-base-to-string": "off",
    },
  },

  // Root config files + scripts — non-type-checked (not in a TS project; low value).
  {
    files: ["scripts/**", "*.{js,mjs,cjs,ts}"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Node globals for build scripts + root config files (they run under Node, not the browser).
  {
    files: ["scripts/**", "*.{js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.node } },
  },

  // Shared rule tweaks (apply everywhere):
  // - honor the `_`-prefix "intentionally unused" convention (omit-destructures, drop args);
  // - allow ternary / short-circuit expressions used purely for side effects (the codebase's
  //   terse `cond ? a() : b()` idiom) — the rule still flags genuinely no-op expressions.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowTernary: true, allowShortCircuit: true },
      ],
    },
  },

  // Turn off ESLint rules that conflict with Prettier — must be last.
  prettier,
);
