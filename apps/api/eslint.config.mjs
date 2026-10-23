// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      'typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'all', // Check all arguments for usage
          argsIgnorePattern: '^_', // Ignore arguments starting with an underscore
          caughtErrors: 'all', // Check caught errors for usage
          caughtErrorsIgnorePattern: '^_', // Ignore caught errors starting with an underscore
          destructuredArrayIgnorePattern: '^_', // Ignore destructured array elements starting with an underscore
          varsIgnorePattern: '^_', // Ignore variables starting with an underscore
          ignoreRestSiblings: true, // Ignore siblings of rest properties in destructuring
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "TSParameterProperty > Identifier[name='DomainEventPublisher']",
          message: 'Inject DOMAIN_EVENT_PUBLISHER_TOKEN, not the class.',
        },
      ],
    },
  },
);
