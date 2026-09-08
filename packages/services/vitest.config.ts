import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Source only. The build emits compiled copies of these very tests into
    // dist/, and vitest's default glob picked those up too — running each
    // suite twice, the second time against JS that bypasses the module mocks.
    include: ['src/**/*.{test,spec}.ts'],
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
