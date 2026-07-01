import js from "@eslint/js";
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
    },
  },

  // Tests / e2e / root config files / scripts — keep linting, drop the type-aware
  // rules (not in a TS project yet; 1b-2b gives tests/e2e their own tsconfig).
  {
    files: ["tests/**", "e2e/**", "scripts/**", "*.{js,mjs,ts}"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Turn off ESLint rules that conflict with Prettier — must be last.
  prettier,
);
