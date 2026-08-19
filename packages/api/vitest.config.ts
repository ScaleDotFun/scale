import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      JWT_SECRET: 'test-jwt-secret-do-not-use-in-production',
      NODE_ENV: 'test',
    },
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
