import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/hub-*.test.ts'],
    setupFiles: ['src/__tests__/env-setup.ts'],
    testTimeout: 15000,
    reporters: 'verbose',
  },
});
