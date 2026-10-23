import { defineConfig } from 'vitest/config';

export default defineConfig({
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
