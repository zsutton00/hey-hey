import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".tsbuild",
      ".worktrees",
      "dist",
      "storybook-static",
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "unused-imports": unusedImports,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "all", // Check all arguments for usage
          argsIgnorePattern: "^_", // Ignore arguments starting with an underscore
          caughtErrors: "all", // Check caught errors for usage
          caughtErrorsIgnorePattern: "^_", // Ignore caught errors starting with an underscore
          destructuredArrayIgnorePattern: "^_", // Ignore destructured array elements starting with an underscore
          varsIgnorePattern: "^_", // Ignore variables starting with an underscore
          ignoreRestSiblings: true, // Ignore siblings of rest properties in destructuring
        },
      ],
    },
  },
  {
    files: ["src/api/**/*.ts"], // Generated API files
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
    },
  }
);
