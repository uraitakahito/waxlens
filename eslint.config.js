import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Shared flat-config factory. Each workspace's `eslint.config.js`
 * calls `makeConfig(import.meta.dirname)` so `projectService` picks
 * up the workspace's own `tsconfig.json`. The factory bakes in
 * everything else (rule sets, ignores) so the per-workspace file is
 * a single-line re-export.
 */
export function makeConfig(workspaceDir) {
  return tseslint.config(
    {
      ignores: [
        "**/dist/**",
        "**/node_modules/**",
        "**/coverage/**",
        "**/*.config.js",
        "**/*.config.mjs",
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir: workspaceDir,
        },
      },
    },
    {
      files: ["test/**/*.ts", "test/**/*.tsx"],
      rules: {
        "@typescript-eslint/no-non-null-assertion": "off",
      },
    },
  );
}

export default makeConfig(import.meta.dirname);
