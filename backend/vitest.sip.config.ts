import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/sip-tenancy.test.ts', 'src/__tests__/voice-tenancy.test.ts',
      'src/__tests__/conf-tenancy-access.test.ts', 'src/__tests__/conf-tenancy-icc-read.test.ts'],
    testTimeout: 10000,
    reporters: 'verbose',
  },
});
