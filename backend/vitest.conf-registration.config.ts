import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/conf-registration-delivery.test.ts'],
    testTimeout: 10000,
    reporters: 'verbose',
  },
});
