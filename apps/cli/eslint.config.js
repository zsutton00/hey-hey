import { fileURLToPath } from 'node:url';
import path from 'node:path';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url));

export default [
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      prettier,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      'prettier/prettier': 'error',
      '@typescript-eslint/array-type': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  prettierConfig,
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
];
