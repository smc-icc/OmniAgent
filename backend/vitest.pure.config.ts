import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/__tests__/phase3-ops-channels.test.ts',
      'src/__tests__/channel-media.test.ts',
      'src/__tests__/overseas-im.test.ts',
    ],
    setupFiles: ['src/__tests__/env-setup.ts'],
    testTimeout: 10000,
    reporters: 'verbose',
  },
});
