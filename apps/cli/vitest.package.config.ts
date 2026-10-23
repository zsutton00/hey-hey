import { defineConfig } from 'vitest/config';

/** Package integration tests launch the built artifact; run them after `pnpm build`. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.package-test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
