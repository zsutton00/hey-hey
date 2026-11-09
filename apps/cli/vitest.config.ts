import { defineConfig } from 'vitest/config';
import { resolveSharedContract, SHARED_CONTRACTS_PATTERN } from './scripts/shared-contracts.mjs';

export default defineConfig({
  plugins: [
    {
      name: 'shared-contracts',
      enforce: 'pre',
      resolveId(source) {
        return SHARED_CONTRACTS_PATTERN.test(source) ? resolveSharedContract(source) : null;
      },
    },
  ],
  test: {
    environment: 'node',
    maxWorkers: 4,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/scanner/**/*.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
